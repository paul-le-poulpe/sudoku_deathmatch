// Parties en ligne, côté page, sans DOM : adresse du WebSocket, ce que le navigateur garde (nom, jetons,
// mot de passe, couleur), textes des erreurs du Worker, liste du lobby. Repris de Fronts of Iron
// (client/src/online.ts). 01-Architecture §4 et §6.

import { isLevel, isPlayerColor, type LobbyEntry } from "@sudoku-deathmatch/shared";

/**
 * Adresse du WebSocket d'une partie, d'après l'`address` de son entrée du lobby. Jamais d'adresse écrite
 * en dur : chemin relatif → `wss://` (ou `ws://` si la page est en `http`) + hôte de la page ;
 * `https://…` → `wss://…` ; `http://…` → `ws://…`. `null` pour tout autre schéma.
 */
export function wsUrl(address: string, page: { readonly protocol: string; readonly host: string }): string | null {
  if (address.startsWith("/") && !address.startsWith("//")) {
    return `${page.protocol === "https:" ? "wss:" : "ws:"}//${page.host}${address}`;
  }
  if (address.startsWith("https://")) return `wss://${address.slice("https://".length)}`;
  if (address.startsWith("http://")) return `ws://${address.slice("http://".length)}`;
  return null;
}

// ---- stockage du navigateur ----

const NAME_KEY = "sd.playerName";
const TOKENS_KEY = "sd.tokens";
const PASSWORD_KEY = "sd.createPassword";
const COLOR_KEY = "sd.playerColor";
/** Nombre de jetons gardés ; les plus anciens sont oubliés. */
const MAX_TOKENS = 20;

/** Toute lecture ou écriture peut lever (stockage bloqué, navigation privée) : la page doit marcher sans. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Pas de stockage : la valeur sera redemandée.
  }
}

export const loadPlayerName = (): string => read(NAME_KEY) ?? "";
export const savePlayerName = (name: string): void => write(NAME_KEY, name);
export const loadCreatePassword = (): string => read(PASSWORD_KEY) ?? "";
export const saveCreatePassword = (password: string): void => write(PASSWORD_KEY, password);

export function loadPlayerColor(): number {
  const color = Number(read(COLOR_KEY) ?? "0");
  return isPlayerColor(color) ? color : 0;
}

export const savePlayerColor = (color: number): void => write(COLOR_KEY, String(color));

function readTokens(): Record<string, string> {
  const raw = read(TOKENS_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, token] of Object.entries(parsed)) if (typeof token === "string") out[id] = token;
    return out;
  } catch {
    return {};
  }
}

export function loadToken(gameId: string): string | undefined {
  return readTokens()[gameId];
}

export function saveToken(gameId: string, token: string): void {
  const tokens = readTokens();
  delete tokens[gameId];
  tokens[gameId] = token;
  write(TOKENS_KEY, JSON.stringify(Object.fromEntries(Object.entries(tokens).slice(-MAX_TOKENS))));
}

// ---- textes ----

/** Texte d'une réponse d'erreur du Worker (`{ error, message }`) : son `message`, ou à défaut le code HTTP. */
export function httpErrorText(status: number, body: unknown): string {
  const message = typeof body === "object" && body !== null ? (body as { message?: unknown }).message : undefined;
  if (typeof message === "string" && message !== "") return message;
  if (status === 502 || status === 503 || status === 504) return `Serveur injoignable (HTTP ${status}).`;
  return `Erreur du serveur (HTTP ${status}).`;
}

export const NETWORK_ERROR_TEXT = "Serveur injoignable : pas de réponse.";

// ---- liste du lobby ----

/** Les entrées valides de la réponse de `GET /api/games` ; les autres sont ignorées. */
export function parseLobbyList(body: unknown): LobbyEntry[] {
  const games = typeof body === "object" && body !== null ? (body as { games?: unknown }).games : undefined;
  if (!Array.isArray(games)) return [];
  const out: LobbyEntry[] = [];
  for (const g of games as unknown[]) {
    if (typeof g !== "object" || g === null) continue;
    const e = g as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.name !== "string" || typeof e.address !== "string") continue;
    if (typeof e.players !== "number" || typeof e.maxPlayers !== "number") continue;
    out.push({
      id: e.id,
      name: e.name,
      hostName: typeof e.hostName === "string" ? e.hostName : "",
      mode: e.mode === "cloudflare" ? "cloudflare" : "host",
      address: e.address,
      level: isLevel(e.level) ? e.level : "moyen",
      players: e.players,
      maxPlayers: e.maxPlayers,
      state: e.state === "started" ? "started" : "waiting",
    });
  }
  return out;
}

/** Ce que la liste propose pour une partie. */
export type GameAction = "join" | "resume" | "full" | "closed";

export function gameAction(entry: LobbyEntry, hasToken: boolean): GameAction {
  if (entry.state === "waiting") return hasToken ? "resume" : entry.players >= entry.maxPlayers ? "full" : "join";
  return hasToken ? "resume" : "closed";
}
