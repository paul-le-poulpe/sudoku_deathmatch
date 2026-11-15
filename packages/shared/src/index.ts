// Formats échangés entre les clients, l'hôte d'une partie (`packages/room`) et le lobby
// (`worker/`). Docs/Design/01-Architecture.md §3 et §4.
//
// Tout est du JSON. Ce module n'a aucune dépendance et n'appelle aucune API de plateforme :
// le client, le Worker et plus tard le serveur Node l'importent tel quel.

// ---- réglages communs ----

/**
 * Durée d'un tick, en millisecondes (01-Architecture §3, provisoire). La même pour l'hôte et pour la
 * prédiction du client : les vitesses du moteur sont en unités par tick, changer ce nombre change la
 * vitesse des bonshommes.
 */
export const TICK_MS = 50;

/** Joueurs d'une partie, hôte compris (00-Game §1). */
export const MAX_PLAYERS = 4;
/** Longueur maximale du nom d'un joueur, en caractères, après `trim`. */
export const PLAYER_NAME_MAX = 24;
/** Longueur maximale du nom d'une partie, en caractères, après `trim`. */
export const GAME_NAME_MAX = 40;

/** Niveaux de difficulté (02-Grilles §3, provisoire). */
export const LEVELS = ["facile", "moyen", "difficile"] as const;
export type Level = (typeof LEVELS)[number];
export const DEFAULT_LEVEL: Level = "moyen";

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/** Nombre de couleurs de joueur : indices de 0 à 5 de la palette du client. */
export const PLAYER_COLOR_COUNT = 6;

export function isPlayerColor(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < PLAYER_COLOR_COUNT;
}

/**
 * Couleur attribuée à un joueur qui demande `wanted`, quand `taken` sont déjà prises : `wanted` si elle est
 * valide et libre, sinon la première libre ; toutes prises : `wanted` si elle est valide, sinon 0.
 */
export function pickPlayerColor(wanted: unknown, taken: readonly number[]): number {
  if (isPlayerColor(wanted) && !taken.includes(wanted)) return wanted;
  for (let color = 0; color < PLAYER_COLOR_COUNT; color++) if (!taken.includes(color)) return color;
  return isPlayerColor(wanted) ? wanted : 0;
}

/** Caractères de contrôle (U+0000 à U+001F, U+007F à U+009F) : refusés dans les noms. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function normalizeName(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (name.length === 0 || CONTROL.test(name)) return null;
  // Longueur en caractères (points de code), pas en unités UTF-16.
  return Array.from(name).length <= max ? name : null;
}

/** Nom d'un joueur : 1 à 24 caractères après `trim`, sans caractère de contrôle. `null` si invalide. */
export function normalizePlayerName(raw: unknown): string | null {
  return normalizeName(raw, PLAYER_NAME_MAX);
}

/** Nom d'une partie : 1 à 40 caractères après `trim`, sans caractère de contrôle. `null` si invalide. */
export function normalizeGameName(raw: unknown): string | null {
  return normalizeName(raw, GAME_NAME_MAX);
}

// ---- entrée du lobby (GET /api/games) ----

/** Qui calcule la partie : un Durable Object du Worker, ou le serveur Node d'un joueur (01-Architecture §1). */
export type GameMode = "cloudflare" | "host";

/** `waiting` : salle d'attente, on peut rejoindre. `started` : lancée, on ne peut que reprendre avec un jeton. */
export type RoomState = "waiting" | "started";

export interface LobbyEntry {
  readonly id: string;
  readonly name: string;
  /** Nom de l'hôte ; vide tant que l'hôte n'est pas entré dans la salle. */
  readonly hostName: string;
  readonly mode: GameMode;
  /** `https://…` (tunnel d'un hôte) ou chemin relatif `/api/games/:id/ws` (partie Cloudflare). */
  readonly address: string;
  readonly level: Level;
  readonly players: number;
  readonly maxPlayers: number;
  readonly state: RoomState;
}

/** Chemin WebSocket d'une partie hébergée par Cloudflare ; c'est l'`address` de son entrée du lobby. */
export function cloudflareGamePath(id: string): string {
  return `/api/games/${encodeURIComponent(id)}/ws`;
}

// ---- partie : réglages des messages ----

/** Un `input` peut répéter au plus ce nombre de directions (01-Architecture §3, Transport). */
export const MAX_INPUT_DIRS = 4;
/** Un message client plus long que ceci est refusé par l'enveloppe. */
export const MAX_MESSAGE_CHARS = 1024;

// ---- client → hôte ----

export type ClientMessage =
  /**
   * Entrer dans la salle. `token` : jeton d'hôte (première entrée de l'hôte) ou jeton de joueur reçu à
   * l'arrivée (reconnexion). Avec un jeton connu, `name` et `color` sont ignorés.
   */
  | { readonly type: "join"; readonly name: string; readonly token?: string; readonly color?: number }
  /** Avant le lancement : prendre une couleur libre. */
  | { readonly type: "set_color"; readonly color: number }
  /** Hôte seulement, avant le lancement : niveau de la grille. */
  | { readonly type: "set_level"; readonly level: Level }
  /** Hôte seulement : lance la partie. */
  | { readonly type: "start" }
  /**
   * Partie lancée : les dernières directions du joueur, la plus récente en dernier ; `seq` est le numéro
   * de la dernière. Une direction : 4 bits (haut 1, bas 2, gauche 4, droite 8). Sur WebSocket, une seule.
   */
  | { readonly type: "input"; readonly seq: number; readonly dirs: readonly number[] }
  /** Partie lancée : écrire `digit` (1 à 9) dans la case `cell` (0 à 80, ligne par ligne). */
  | { readonly type: "fill"; readonly cell: number; readonly digit: number };

// ---- hôte → client ----

export interface RoomPlayer {
  /** Rang dans la salle, de 1 à n sans trou (l'hôte est 1). Change quand un joueur part. */
  readonly id: number;
  readonly name: string;
  readonly host: boolean;
  readonly color: number;
}

export interface StartPlayer {
  readonly id: number;
  readonly name: string;
  readonly color: number;
}

/** Un bonhomme dans l'état complet de la partie. */
export interface PlayerState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly dir: number;
  readonly hp: number;
  readonly alive: boolean;
  /** Cases remplies correctement. */
  readonly score: number;
}

/** Une ligne du classement de fin de partie, du premier au dernier. */
export interface RankEntry {
  readonly player: number;
  readonly score: number;
  readonly alive: boolean;
}

/** Ce qui s'est passé pendant un tick et ne se déduit pas des positions (01-Architecture §3). */
export type GameEvent =
  | { readonly type: "filled"; readonly cell: number; readonly digit: number; readonly player: number }
  /** Chiffre faux : refusé, `hp` est ce qui reste au joueur. */
  | { readonly type: "refused"; readonly cell: number; readonly digit: number; readonly player: number; readonly hp: number }
  /** Remplissage ignoré : case déjà remplie, ou bonhomme trop loin de la case pour l'hôte. Aucun PV perdu. */
  | { readonly type: "ignored"; readonly cell: number; readonly player: number }
  | { readonly type: "eliminated"; readonly player: number }
  | { readonly type: "ended"; readonly ranking: readonly RankEntry[] };

export type RoomErrorCode =
  | "invalid_message"
  | "not_joined"
  | "already_joined"
  | "game_full"
  | "game_started"
  | "invalid_name"
  | "not_host"
  | "invalid_level"
  | "invalid_color"
  | "color_taken"
  | "replaced"
  | "not_started";

/** Texte de chaque erreur de la salle, envoyé avec le code : la page l'affiche tel quel. */
export const ROOM_ERROR_TEXT: Readonly<Record<RoomErrorCode, string>> = {
  invalid_message: "Message refusé par le serveur : forme inattendue.",
  not_joined: "Message refusé par le serveur : vous n'êtes pas encore dans la salle.",
  already_joined: "Message refusé par le serveur : vous êtes déjà dans la salle.",
  game_full: "La partie est pleine (4 joueurs).",
  game_started: "La partie est déjà lancée : on ne peut plus la rejoindre.",
  invalid_name: "Nom invalide : 1 à 24 caractères, sans caractère de contrôle.",
  not_host: "Seul l'hôte peut faire cela.",
  invalid_level: "Niveau de difficulté inconnu.",
  invalid_color: "Couleur inconnue.",
  color_taken: "Cette couleur vient d'être prise par un autre joueur.",
  replaced: "Vous êtes connecté à cette partie depuis un autre onglet ou un autre appareil.",
  not_started: "Message refusé par le serveur : la partie n'est pas encore lancée.",
};

export type ServerMessage =
  /** Seulement à l'arrivée d'un nouveau joueur : le jeton à garder pour revenir. */
  | { readonly type: "welcome"; readonly token: string }
  /** État de la salle, à chaque changement tant que la partie n'est pas lancée. `you` : l'`id` du destinataire. */
  | { readonly type: "room"; readonly you: number; readonly players: readonly RoomPlayer[]; readonly level: Level }
  /** Au lancement et à chaque reconnexion après le lancement ; suivi de `state`. */
  | { readonly type: "start"; readonly you: number; readonly level: Level; readonly players: readonly StartPlayer[] }
  /**
   * État complet de la partie, sans la solution : au lancement et à la reconnexion.
   * `givens` : 81 chiffres, `0` pour une case à remplir. `cells` : cases remplies par des joueurs.
   */
  | {
      readonly type: "state";
      readonly tick: number;
      readonly givens: string;
      readonly cells: readonly (readonly [cell: number, digit: number, player: number])[];
      readonly players: readonly PlayerState[];
      readonly hpMax: number;
      readonly ranking: readonly RankEntry[] | null;
    }
  /**
   * À chaque tick. Remplaçable : un snapshot perdu est remplacé par le suivant. `players` : les bonshommes
   * non éliminés, `[id, x, y, dir]`. `ack` : `[seq, since]`, dernière entrée du destinataire appliquée par
   * l'hôte et ticks écoulés depuis (`[0, 0]` avant la première).
   */
  | {
      readonly type: "snapshot";
      readonly tick: number;
      readonly players: readonly (readonly [id: number, x: number, y: number, dir: number])[];
      readonly ack: readonly [seq: number, since: number];
    }
  /** Seulement pour un tick où il s'est passé quelque chose. Doit arriver. */
  | { readonly type: "events"; readonly tick: number; readonly events: readonly GameEvent[] }
  /** `message` : le texte à afficher (`ROOM_ERROR_TEXT`). */
  | { readonly type: "error"; readonly code: RoomErrorCode; readonly message: string };
