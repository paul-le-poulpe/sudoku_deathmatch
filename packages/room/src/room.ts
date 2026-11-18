// La salle d'attente et la partie d'une partie en ligne ou solo (Docs/Design/01-Architecture.md §3 et §4).
// Reprise de la salle de Fronts of Iron ; la partie lancée est celle de `Match`.
//
// Une `Room` ne connaît ni horloge, ni réseau, ni hasard : l'enveloppe (Durable Object, solo, plus tard
// serveur Node) lui donne les connexions comme des identifiants de chaîne, lui passe chaque message reçu,
// appelle `step` à chaque tick, et envoie ce qu'elle renvoie. Jetons et graines viennent de `RoomEnv`, le
// catalogue des grilles est celui de l'enveloppe (02-Grilles §1).

import {
  DEFAULT_BOT_LEVEL,
  DEFAULT_LEVEL,
  MAX_INPUT_DIRS,
  MAX_PLAYERS,
  ROOM_ERROR_TEXT,
  isBotLevel,
  isLevel,
  isPlayerColor,
  isTrapKind,
  normalizePlayerName,
  pickPlayerColor,
  type BotLevel,
  type ClientMessage,
  type GameEvent,
  type Level,
  type RoomErrorCode,
  type RoomPlayer,
  type RoomState,
  type ServerMessage,
} from "@sudoku-deathmatch/shared";

import { pickGrid, type Catalog } from "./grid.ts";
import { Match } from "./match.ts";

/** Ce que la salle demande à l'enveloppe. */
export interface RoomEnv {
  /** Un jeton difficile à deviner (jeton d'hôte, jeton de joueur). Deux appels ne donnent jamais la même valeur. */
  newToken(): string;
  /** Une graine tirée au hasard, entier de 0 à 2³² − 1 : choix et transformation de la grille. */
  randomSeed(): number;
}

/** Réglages de la salle donnés par l'enveloppe. */
export interface RoomOptions {
  /** Un jeton d'hôte déjà créé (salle reconstruite par l'enveloppe) ; sinon la salle en crée un. */
  readonly hostToken?: string;
  /** L'hôte peut ajouter des bots : en solo seulement (04-Bots §1). */
  readonly bots?: boolean;
}

/** Un message à envoyer à la connexion `to`. */
export interface Outgoing {
  readonly to: string;
  readonly message: ServerMessage;
}

/** Ce que l'enveloppe signale au lobby. */
export interface RoomSummary {
  readonly state: RoomState;
  /** Joueurs dans la salle ; après le lancement, joueurs de la partie (connectés ou non). */
  readonly players: number;
  /** Nom de l'hôte ; vide tant qu'il n'est pas entré. */
  readonly hostName: string;
  readonly level: Level;
}

interface Member {
  readonly token: string;
  readonly name: string;
  readonly host: boolean;
  color: number;
  /** Rang de 1 à n. Recalculé à chaque changement avant le lancement, figé ensuite. */
  id: number;
  /** Connexion actuelle ; `null` pour un joueur déconnecté après le lancement, et toujours pour un bot. */
  conn: string | null;
  /** Difficulté d'un bot joué par l'hôte (04-Bots) ; `null` pour un joueur. Son jeton n'est jamais envoyé. */
  bot: BotLevel | null;
}

export class Room {
  /** Jeton de l'hôte, créé avec la salle. Il désigne le joueur 1 ; l'enveloppe le remet au créateur de la partie. */
  readonly hostToken: string;
  readonly #env: RoomEnv;
  readonly #catalog: Catalog;
  readonly #botsAllowed: boolean;
  /** L'hôte en premier s'il est présent, puis les autres dans l'ordre d'arrivée. */
  readonly #members: Member[] = [];
  readonly #byConn = new Map<string, Member>();
  #state: RoomState = "waiting";
  #level: Level = DEFAULT_LEVEL;
  #match: Match | null = null;

  constructor(env: RoomEnv, catalog: Catalog, options: RoomOptions = {}) {
    this.#env = env;
    this.#catalog = catalog;
    this.#botsAllowed = options.bots === true;
    this.hostToken = options.hostToken ?? env.newToken();
  }

  /** Un message reçu de la connexion `conn` (déjà décodé du JSON ; `unknown` : il vient d'un client). */
  handle(conn: string, raw: unknown): Outgoing[] {
    const msg = parseClientMessage(raw);
    if (msg === null) return [error(conn, "invalid_message")];
    if (msg.type === "join") return this.#join(conn, msg);
    const member = this.#byConn.get(conn);
    if (member === undefined) return [error(conn, "not_joined")];
    switch (msg.type) {
      case "set_color":
        return this.#setColor(conn, member, msg.color);
      case "set_level":
        return this.#setLevel(conn, member, msg.level);
      case "add_bot":
        return this.#addBot(conn, member);
      case "set_bot":
        return this.#setBot(conn, member, msg);
      case "remove_bot":
        return this.#removeBot(conn, member, msg.bot);
      case "start":
        return this.#start(conn, member);
      case "restart":
        return this.#restart(conn, member);
      case "input":
        if (this.#match === null) return [error(conn, "not_started")];
        this.#match.input(member.id, msg.seq, msg.dirs);
        return [];
      case "fill":
        if (this.#match === null) return [error(conn, "not_started")];
        this.#match.fill(member.id, msg.cell, msg.digit);
        return [];
      case "place":
        if (this.#match === null) return [error(conn, "not_started")];
        this.#match.place(member.id, msg.cell, msg.kind);
        return [];
      case "hit":
        if (this.#match === null) return [error(conn, "not_started")];
        this.#match.hit(member.id, msg.ball);
        return [];
      case "block":
        if (this.#match === null) return [error(conn, "not_started")];
        this.#match.block(member.id, msg.ball);
        return [];
    }
  }

  /**
   * Un tick : la partie avance, chaque joueur connecté reçoit son `snapshot` (positions communes, `ack`
   * propre) et, s'il s'est passé quelque chose qu'il peut voir, un message `events`. Une pose refusée ne
   * va qu'au joueur concerné. Rien avant le lancement ni après la fin.
   */
  step(): Outgoing[] {
    const match = this.#match;
    if (match === null || match.ended) return [];
    const events = match.step();
    const tick = match.game.tick;
    const players = match.positions();
    const out: Outgoing[] = [];
    const shared = events.every((ev) => privateTo(ev) === null);
    const common: ServerMessage | null = shared && events.length > 0 ? { type: "events", tick, events } : null;
    for (const m of this.#members) {
      if (m.conn === null) continue;
      out.push({ to: m.conn, message: { type: "snapshot", tick, players, ack: match.ack(m.id) } });
      if (common !== null) {
        out.push({ to: m.conn, message: common });
      } else if (!shared) {
        const mine = events.filter((ev) => {
          const only = privateTo(ev);
          return only === null || only === m.id;
        });
        if (mine.length > 0) out.push({ to: m.conn, message: { type: "events", tick, events: mine } });
      }
    }
    return out;
  }

  /** La partie est lancée et finie. */
  get ended(): boolean {
    return this.#match?.ended ?? false;
  }

  /** La connexion `conn` s'est fermée. */
  disconnect(conn: string): Outgoing[] {
    const member = this.#byConn.get(conn);
    if (member === undefined) return [];
    this.#byConn.delete(conn);
    if (this.#state === "started") {
      // Il garde sa place et son jeton : il peut revenir.
      member.conn = null;
      return [];
    }
    // Avant le lancement, sa place est libérée. Le jeton de l'hôte reste valable.
    this.#members.splice(this.#members.indexOf(member), 1);
    this.#renumber();
    return this.#broadcastRoom();
  }

  summary(): RoomSummary {
    return {
      state: this.#state,
      players: this.#members.length,
      hostName: this.#members.find((m) => m.host)?.name ?? "",
      level: this.#level,
    };
  }

  #join(conn: string, msg: Extract<ClientMessage, { type: "join" }>): Outgoing[] {
    if (this.#byConn.has(conn)) return [error(conn, "already_joined")];

    // Un jeton connu : reconnexion (ou deuxième onglet). Le nom envoyé est ignoré.
    const known = msg.token === undefined ? undefined : this.#members.find((m) => m.token === msg.token);
    if (known !== undefined) return this.#rebind(conn, known);

    if (this.#state === "started") return [error(conn, "game_started")];
    const name = normalizePlayerName(msg.name);
    if (name === null) return [error(conn, "invalid_name")];

    // Le jeton d'hôte inconnu des membres : l'hôte entre (ou revient après avoir quitté la salle).
    const asHost = msg.token !== undefined && msg.token === this.hostToken;
    // La place de l'hôte absent est réservée : elle ne compte pas parmi celles des autres.
    const hostAbsent = !this.#members.some((m) => m.host);
    if (!asHost && this.#members.length >= MAX_PLAYERS - (hostAbsent ? 1 : 0)) return [error(conn, "game_full")];

    const color = pickPlayerColor(msg.color, this.#members.map((m) => m.color));
    const member: Member = { token: asHost ? this.hostToken : this.#env.newToken(), name, host: asHost, color, id: 0, conn, bot: null };
    if (asHost) this.#members.unshift(member);
    else this.#members.push(member);
    this.#byConn.set(conn, member);
    this.#renumber();
    return [{ to: conn, message: { type: "welcome", token: member.token } }, ...this.#broadcastRoom()];
  }

  /** Rattache le joueur à une nouvelle connexion ; l'ancienne, s'il y en a une, est remplacée. */
  #rebind(conn: string, member: Member): Outgoing[] {
    const out: Outgoing[] = [];
    if (member.conn !== null && member.conn !== conn) {
      this.#byConn.delete(member.conn);
      out.push(error(member.conn, "replaced"));
    }
    member.conn = conn;
    this.#byConn.set(conn, member);
    if (this.#match !== null) {
      // Après le lancement : le message de départ, puis l'état courant (pas d'historique, 01-Architecture §3).
      this.#match.resetInputs(member.id);
      out.push(this.#startMessage(member, conn), { to: conn, message: this.#match.state(member.id) });
    } else {
      out.push({ to: conn, message: { type: "welcome", token: member.token } }, ...this.#broadcastRoom());
    }
    return out;
  }

  #setColor(conn: string, member: Member, color: number): Outgoing[] {
    if (this.#state === "started") return [error(conn, "game_started")];
    if (!isPlayerColor(color)) return [error(conn, "invalid_color")];
    if (this.#members.some((m) => m !== member && m.color === color)) return [error(conn, "color_taken")];
    member.color = color;
    return this.#broadcastRoom();
  }

  #setLevel(conn: string, member: Member, level: unknown): Outgoing[] {
    if (!member.host) return [error(conn, "not_host")];
    if (this.#state === "started") return [error(conn, "game_started")];
    if (!isLevel(level)) return [error(conn, "invalid_level")];
    this.#level = level;
    return this.#broadcastRoom();
  }

  /**
   * Un bot de plus (04-Bots §1), si l'enveloppe les permet (solo) : « Bot n » au plus petit n libre, première
   * couleur libre, Normal (provisoire).
   */
  #addBot(conn: string, member: Member): Outgoing[] {
    if (!this.#botsAllowed) return [error(conn, "no_bots")];
    if (!member.host) return [error(conn, "not_host")];
    if (this.#state === "started") return [error(conn, "game_started")];
    if (this.#members.length >= MAX_PLAYERS) return [error(conn, "game_full")];
    const names = new Set(this.#members.map((m) => m.name));
    let n = 1;
    while (names.has(`Bot ${n}`)) n++;
    const color = pickPlayerColor(undefined, this.#members.map((m) => m.color));
    this.#members.push({ token: this.#env.newToken(), name: `Bot ${n}`, host: false, color, id: 0, conn: null, bot: DEFAULT_BOT_LEVEL });
    this.#renumber();
    return this.#broadcastRoom();
  }

  #findBot(id: unknown): Member | undefined {
    return this.#members.find((m) => m.bot !== null && m.id === id);
  }

  #setBot(conn: string, member: Member, msg: Extract<ClientMessage, { type: "set_bot" }>): Outgoing[] {
    if (!member.host) return [error(conn, "not_host")];
    if (this.#state === "started") return [error(conn, "game_started")];
    const bot = this.#findBot(msg.bot);
    if (bot === undefined) return [error(conn, "unknown_bot")];
    if (msg.color !== undefined) {
      if (!isPlayerColor(msg.color)) return [error(conn, "invalid_color")];
      if (this.#members.some((m) => m !== bot && m.color === msg.color)) return [error(conn, "color_taken")];
    }
    if (msg.level !== undefined && !isBotLevel(msg.level)) return [error(conn, "invalid_bot_level")];
    if (msg.color !== undefined) bot.color = msg.color;
    if (msg.level !== undefined) bot.bot = msg.level;
    return this.#broadcastRoom();
  }

  #removeBot(conn: string, member: Member, id: number): Outgoing[] {
    if (!member.host) return [error(conn, "not_host")];
    if (this.#state === "started") return [error(conn, "game_started")];
    const bot = this.#findBot(id);
    if (bot === undefined) return [error(conn, "unknown_bot")];
    this.#members.splice(this.#members.indexOf(bot), 1);
    this.#renumber();
    return this.#broadcastRoom();
  }

  #start(conn: string, member: Member): Outgoing[] {
    if (!member.host) return [error(conn, "not_host")];
    if (this.#state === "started") return [error(conn, "game_started")];
    // Les identifiants sont déjà `1..n` sans trou (#renumber) : on les fige en changeant d'état.
    this.#state = "started";
    return this.#launch();
  }

  /**
   * Partie finie, à la demande de l'hôte : une nouvelle grille du même niveau, avec les joueurs connectés et
   * les bots. Provisoire : un joueur déconnecté à ce moment quitte la partie, et son jeton n'est plus valable.
   */
  #restart(conn: string, member: Member): Outgoing[] {
    if (!member.host) return [error(conn, "not_host")];
    if (this.#match === null || !this.#match.ended) return [error(conn, "not_ended")];
    for (const m of this.#members.slice()) {
      if (m.conn === null && m.bot === null) this.#members.splice(this.#members.indexOf(m), 1);
    }
    return this.#launch();
  }

  /** Tire une grille, crée la partie, et envoie `start` puis `state` à chaque joueur connecté. */
  #launch(): Outgoing[] {
    const grid = pickGrid(this.#catalog, this.#level, this.#env.randomSeed());
    const players = this.#members.map((m) => ({ id: m.id, bot: m.bot }));
    const match = new Match(grid.puzzle, grid.solution, players, this.#env.randomSeed());
    this.#match = match;
    const out: Outgoing[] = [];
    for (const m of this.#members) {
      if (m.conn === null) continue;
      out.push(this.#startMessage(m, m.conn), { to: m.conn, message: match.state(m.id) });
    }
    return out;
  }

  #startMessage(member: Member, conn: string): Outgoing {
    return {
      to: conn,
      message: {
        type: "start",
        you: member.id,
        host: this.#members.find((m) => m.host)?.id ?? 0,
        level: this.#level,
        players: this.#members.map((m) => ({ id: m.id, name: m.name, color: m.color })),
      },
    };
  }

  #renumber(): void {
    this.#members.forEach((m, i) => (m.id = i + 1));
  }

  /** L'état de la salle à chaque joueur connecté, avec son propre `you`. */
  #broadcastRoom(): Outgoing[] {
    const players: RoomPlayer[] = this.#members.map((m) => ({ id: m.id, name: m.name, host: m.host, color: m.color, bot: m.bot }));
    const out: Outgoing[] = [];
    for (const m of this.#members) {
      if (m.conn === null) continue;
      out.push({ to: m.conn, message: { type: "room", you: m.id, players, level: this.#level } });
    }
    return out;
  }
}

/** Le seul joueur qui peut recevoir cet événement, ou `null` s'il va à tous. */
function privateTo(ev: GameEvent): number | null {
  if (ev.type === "not_placed") return ev.player;
  return null;
}

function error(to: string, code: RoomErrorCode): Outgoing {
  return { to, message: { type: "error", code, message: ROOM_ERROR_TEXT[code] } };
}

function isCount(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

/** Vérifie la forme d'un message ; les valeurs (nom, niveau, couleur) sont vérifiées par la salle, qui répond par un code précis. */
function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case "join":
      if (m.token !== undefined && typeof m.token !== "string") return null;
      return {
        type: "join",
        name: m.name as string,
        ...(m.token !== undefined ? { token: m.token as string } : {}),
        ...(m.color !== undefined ? { color: m.color as number } : {}),
      };
    case "set_color":
      return { type: "set_color", color: m.color as number };
    case "set_level":
      return { type: "set_level", level: m.level as Level };
    case "add_bot":
      return { type: "add_bot" };
    case "set_bot":
      if (!isCount(m.bot, 1, MAX_PLAYERS)) return null;
      return {
        type: "set_bot",
        bot: m.bot,
        ...(m.color !== undefined ? { color: m.color as number } : {}),
        ...(m.level !== undefined ? { level: m.level as BotLevel } : {}),
      };
    case "remove_bot":
      if (!isCount(m.bot, 1, MAX_PLAYERS)) return null;
      return { type: "remove_bot", bot: m.bot };
    case "start":
      return { type: "start" };
    case "restart":
      return { type: "restart" };
    case "input": {
      if (!isCount(m.seq, 1, Number.MAX_SAFE_INTEGER) || !Array.isArray(m.dirs)) return null;
      const dirs = m.dirs as unknown[];
      if (dirs.length < 1 || dirs.length > MAX_INPUT_DIRS || !dirs.every((d) => isCount(d, 0, 15))) return null;
      return { type: "input", seq: m.seq, dirs: dirs as number[] };
    }
    case "fill":
      if (!isCount(m.cell, 0, 80) || !isCount(m.digit, 1, 9)) return null;
      return { type: "fill", cell: m.cell, digit: m.digit };
    case "place":
      if (!isCount(m.cell, 0, 80) || !isTrapKind(m.kind)) return null;
      return { type: "place", cell: m.cell, kind: m.kind };
    case "hit":
      if (!isCount(m.ball, 1, Number.MAX_SAFE_INTEGER)) return null;
      return { type: "hit", ball: m.ball };
    case "block":
      if (!isCount(m.ball, 1, Number.MAX_SAFE_INTEGER)) return null;
      return { type: "block", ball: m.ball };
    default:
      return null;
  }
}
