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

/** Difficultés d'un bot (04-Bots §1) : seul le rythme des chiffres change. */
export const BOT_LEVELS = ["facile", "normal", "difficile"] as const;
export type BotLevel = (typeof BOT_LEVELS)[number];
export const DEFAULT_BOT_LEVEL: BotLevel = "normal";

export function isBotLevel(value: unknown): value is BotLevel {
  return typeof value === "string" && (BOT_LEVELS as readonly string[]).includes(value);
}

/** Nombre de couleurs de joueur : indices de 0 à 6 de la palette du client. */
export const PLAYER_COLOR_COUNT = 7;

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

// ---- pièges (03-Pieges) ----

/** Vus par tous ; la tourelle tire des boules, le bouclier les arrête autour de son poseur. */
export const TRAP_KINDS = ["mine", "turret", "shield"] as const;
export type TrapKind = (typeof TRAP_KINDS)[number];

export function isTrapKind(value: unknown): value is TrapKind {
  return typeof value === "string" && (TRAP_KINDS as readonly string[]).includes(value);
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
  /** Hôte du solo seulement, avant le lancement : un bot de plus (04-Bots §1), première couleur libre, niveau Normal. */
  | { readonly type: "add_bot" }
  /** Hôte seulement, avant le lancement : couleur ou difficulté du bot `bot` (son `id` dans la salle). */
  | { readonly type: "set_bot"; readonly bot: number; readonly color?: number; readonly level?: BotLevel }
  /** Hôte seulement, avant le lancement : retire le bot `bot`. */
  | { readonly type: "remove_bot"; readonly bot: number }
  /** Hôte seulement : lance la partie. */
  | { readonly type: "start" }
  /** Hôte seulement, partie finie : relance une partie avec les joueurs connectés (00-Game §1). */
  | { readonly type: "restart" }
  /**
   * Partie lancée : les dernières directions du joueur, la plus récente en dernier ; `seq` est le numéro
   * de la dernière. Une direction : 4 bits (haut 1, bas 2, gauche 4, droite 8). Sur WebSocket, une seule.
   */
  | { readonly type: "input"; readonly seq: number; readonly dirs: readonly number[] }
  /** Partie lancée : écrire `digit` (1 à 9) dans la case `cell` (0 à 80, ligne par ligne). */
  | { readonly type: "fill"; readonly cell: number; readonly digit: number }
  /** Partie lancée : poser un piège sur la case `cell`, remplie par ce joueur et sans piège (03-Pieges §1). */
  | { readonly type: "place"; readonly cell: number; readonly kind: TrapKind }
  /**
   * Partie lancée : sur l'écran du joueur, la boule `ball` a touché son bonhomme (01-Architecture §3,
   * Pièges et projectiles). Ne fait de tort qu'à lui.
   */
  | { readonly type: "hit"; readonly ball: number }
  /**
   * Partie lancée : sur l'écran du joueur, la boule `ball` a touché la bulle de son bouclier (03-Pieges §4).
   * Elle le protège : l'hôte vérifie que c'était possible avant de l'accepter.
   */
  | { readonly type: "block"; readonly ball: number };

// ---- hôte → client ----

export interface RoomPlayer {
  /** Rang dans la salle, de 1 à n sans trou (l'hôte est 1). Change quand un joueur part. */
  readonly id: number;
  readonly name: string;
  readonly host: boolean;
  readonly color: number;
  /** Difficulté d'un bot joué par l'hôte (04-Bots) ; `null` pour un joueur. */
  readonly bot: BotLevel | null;
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
  /** PV max : 4, ou 6 tant qu'il a moins de la moitié des cases du premier (00-Game §1). */
  readonly hpMax: number;
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
  /**
   * Chiffre juste : la case est à `player`, qui retrouve tous ses PV (`hp`). Précédé des `hp_max` des
   * joueurs que ce chiffre fait passer en retard ou en sortir, lui compris.
   */
  | { readonly type: "filled"; readonly cell: number; readonly digit: number; readonly player: number; readonly hp: number }
  /** Chiffre faux : refusé, `hp` est ce qui reste au joueur (1, ou 0 s'il n'en avait plus qu'un). */
  | { readonly type: "refused"; readonly cell: number; readonly digit: number; readonly player: number; readonly hp: number }
  /** Remplissage ignoré : case déjà remplie, ou bonhomme trop loin de la case pour l'hôte. Aucun PV perdu. */
  | { readonly type: "ignored"; readonly cell: number; readonly player: number }
  /**
   * PV max de `player` changés (00-Game §1) : 6 quand il passe sous la moitié des cases du premier (2 PV de
   * plus), 4 quand il revient à la moitié ou plus (PV au-dessus retirés). `hp` : ses PV après le changement.
   */
  | { readonly type: "hp_max"; readonly player: number; readonly hpMax: number; readonly hp: number }
  | { readonly type: "eliminated"; readonly player: number }
  | { readonly type: "ended"; readonly ranking: readonly RankEntry[] }
  /**
   * Piège posé, annoncé à tous ; il est posé au tick du message `events` (03-Pieges §2 pour la mine). Un
   * bouclier est plein à ce tick.
   */
  | { readonly type: "placed"; readonly cell: number; readonly kind: TrapKind; readonly player: number }
  /**
   * Pose refusée : bonhomme trop loin de la case, case pas à lui ou déjà piégée, ou tourelle (bouclier)
   * au-delà d'une pour 3 (5) de ses cases. Au seul joueur.
   */
  | { readonly type: "not_placed"; readonly cell: number; readonly player: number }
  /**
   * Une mine explose sous `player`, à qui il reste `hp` PV. Elle se recharge pendant MINE_REST_TICKS à
   * partir du tick du message, puis sa pose se rejoue (03-Pieges §2).
   */
  | { readonly type: "exploded"; readonly cell: number; readonly player: number; readonly hp: number }
  /** Une boule apparaît au centre de la tourelle `cell`, posée par `player` ; elle part au tick `launch`. */
  | { readonly type: "ball"; readonly ball: number; readonly cell: number; readonly player: number; readonly launch: number }
  /** La boule part, à son tick `launch`, dans la direction (`dx`, `dy`) en millièmes (longueur ≈ 1000). */
  | { readonly type: "launched"; readonly ball: number; readonly dx: number; readonly dy: number }
  /** La boule touche `player`, à qui il reste `hp` PV ; elle disparaît. */
  | { readonly type: "ball_hit"; readonly ball: number; readonly player: number; readonly hp: number }
  /**
   * La bulle de `player` arrête la boule, qui disparaît ; son bouclier de la case `cell` perd une unité et
   * sera de nouveau plein au tick `full` (03-Pieges §4, `shieldCharge` du moteur).
   */
  | { readonly type: "blocked"; readonly ball: number; readonly player: number; readonly cell: number; readonly full: number }
  /** La boule disparaît sans partir : plus aucun adversaire à viser. */
  | { readonly type: "ball_gone"; readonly ball: number };

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
  | "not_started"
  | "not_ended"
  | "unknown_bot"
  | "invalid_bot_level"
  | "no_bots";

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
  not_ended: "La partie n'est pas finie : on ne peut pas encore la relancer.",
  unknown_bot: "Ce bot n'est plus dans la salle.",
  invalid_bot_level: "Difficulté de bot inconnue.",
  no_bots: "Les bots ne sont disponibles qu'en solo.",
};

export type ServerMessage =
  /** Seulement à l'arrivée d'un nouveau joueur : le jeton à garder pour revenir. */
  | { readonly type: "welcome"; readonly token: string }
  /** État de la salle, à chaque changement tant que la partie n'est pas lancée. `you` : l'`id` du destinataire. */
  | { readonly type: "room"; readonly you: number; readonly players: readonly RoomPlayer[]; readonly level: Level }
  /**
   * Au lancement, à chaque relance et à chaque reconnexion après le lancement ; suivi de `state`. `host` :
   * l'`id` de l'hôte, le seul qui peut relancer.
   */
  | { readonly type: "start"; readonly you: number; readonly host: number; readonly level: Level; readonly players: readonly StartPlayer[] }
  /**
   * État complet de la partie, sans la solution : au lancement et à la reconnexion.
   * `givens` : 81 chiffres, `0` pour une case à remplir. `cells` : cases remplies par des joueurs.
   * `traps` : les pièges, le tick de leur pose et, pour un bouclier, le tick où il est plein (0 sinon).
   * `balls` : les boules en cours, `dx` et `dy` à 0 tant qu'elles ne sont pas parties.
   */
  | {
      readonly type: "state";
      readonly tick: number;
      readonly givens: string;
      readonly cells: readonly (readonly [cell: number, digit: number, player: number])[];
      readonly players: readonly PlayerState[];
      readonly ranking: readonly RankEntry[] | null;
      readonly traps: readonly (readonly [cell: number, kind: TrapKind, player: number, placed: number, full: number])[];
      readonly balls: readonly (readonly [ball: number, cell: number, player: number, launch: number, dx: number, dy: number])[];
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
