// La partie côté client, sans affichage (01-Architecture §3 et §6) : ce que l'hôte a envoyé (`state`,
// `snapshot`, `events`), la prédiction de son propre bonhomme, l'interpolation des autres. Phaser lit ce
// module à chaque image (scene.ts) ; il ne décide d'aucune règle : cases, PV et éliminations viennent
// des événements de l'hôte.

import { CELL, cellAt, move } from "@sudoku-deathmatch/engine";
import { TICK_MS, type ClientMessage, type GameEvent, type Level, type RankEntry, type ServerMessage, type StartPlayer } from "@sudoku-deathmatch/shared";

/** Les autres bonshommes sont affichés ce nombre de ticks dans le passé (100 ms, provisoire). */
const INTERP_TICKS = 2;
/** Ticks de directions gardés pour rejouer la prédiction après un snapshot. */
const HISTORY = 256;
/** Une correction de prédiction est répartie sur environ cette durée (provisoire). */
const SMOOTH_MS = 80;
/** Un écart plus grand est appliqué d'un coup (reconnexion, onglet resté en arrière-plan). */
const SNAP_DISTANCE = 2 * CELL;
/** Snapshots gardés pour l'interpolation et l'estimation de l'horloge de l'hôte. */
const KEPT_SNAPSHOTS = 40;
/** Un remplissage sans réponse de l'hôte après ce délai n'est plus affiché « en attente ». */
const PENDING_MS = 3000;

export interface ViewPlayer {
  readonly id: number;
  readonly name: string;
  readonly color: number;
  readonly you: boolean;
  readonly hp: number;
  readonly alive: boolean;
  readonly score: number;
  /** Position à afficher, en unités du moteur. */
  readonly x: number;
  readonly y: number;
}

/** Ce que l'affichage doit animer, dans l'ordre ; Phaser vide la liste à chaque image. */
export type Fx =
  | { readonly kind: "filled"; readonly cell: number; readonly player: number }
  | { readonly kind: "refused"; readonly cell: number; readonly player: number }
  | { readonly kind: "eliminated"; readonly player: number; readonly x: number; readonly y: number };

interface Snapshot {
  readonly tick: number;
  readonly players: ReadonlyMap<number, readonly [number, number]>;
}

type StartMessage = Extract<ServerMessage, { type: "start" }>;

export class PlaySession {
  readonly you: number;
  readonly level: Level;
  readonly players: readonly StartPlayer[];

  readonly givens = new Uint8Array(81);
  readonly digits = new Uint8Array(81);
  /** -1 : chiffre donné ; 0 : vide ; sinon le joueur qui l'a rempli. */
  readonly owner = new Int16Array(81);
  hpMax = 0;
  readonly hp = new Map<number, number>();
  readonly alive = new Map<number, boolean>();
  readonly score = new Map<number, number>();
  ranking: readonly RankEntry[] | null = null;
  /** Vrai dès le premier `state`. */
  ready = false;

  /** Remplissages envoyés, sans réponse de l'hôte : case → chiffre et heure d'envoi. */
  readonly pending = new Map<number, { readonly digit: number; readonly at: number }>();
  /** Cases refusées à faire clignoter : case → fin du clignotement. */
  readonly flash = new Map<number, number>();
  readonly fx: Fx[] = [];
  message = "";
  messageUntil = 0;
  /** Appelé quand PV, cases, éliminations ou classement changent (panneau HTML). */
  onChange: (() => void) | null = null;

  readonly #send: (msg: ClientMessage) => void;
  readonly #snaps: Snapshot[] = [];
  readonly #offsets: number[] = [];
  /** Heure locale (ms) moins l'heure de l'hôte (tick × TICK_MS), au plus petit des derniers snapshots. */
  #offset = 0;
  readonly #lastSeen = new Map<number, readonly [number, number]>();

  // Prédiction de son bonhomme.
  #localTick = 0;
  #pos: [number, number] = [0, 0];
  #prev: [number, number] = [0, 0];
  #acc = 0;
  #lastFrame = -1;
  readonly #dirAt = new Uint8Array(HISTORY);
  readonly #seqTick = new Map<number, number>();
  #seq = 0;
  #sentDir = 0;
  #smooth: [number, number] = [0, 0];

  constructor(start: StartMessage, send: (msg: ClientMessage) => void) {
    this.you = start.you;
    this.level = start.level;
    this.players = start.players;
    this.#send = send;
  }

  onMessage(msg: ServerMessage, now: number): void {
    if (msg.type === "state") this.#onState(msg);
    else if (msg.type === "snapshot") this.#onSnapshot(msg, now);
    else if (msg.type === "events") this.#onEvents(msg.events, now);
  }

  get youAlive(): boolean {
    return this.alive.get(this.you) === true;
  }

  // ---- messages de l'hôte ----

  #onState(s: Extract<ServerMessage, { type: "state" }>): void {
    for (let i = 0; i < 81; i++) {
      const d = Number(s.givens[i] ?? "0");
      this.givens[i] = d;
      this.digits[i] = d;
      this.owner[i] = d === 0 ? 0 : -1;
    }
    for (const [cell, digit, player] of s.cells) {
      this.digits[cell] = digit;
      this.owner[cell] = player;
    }
    this.hpMax = s.hpMax;
    const positions = new Map<number, readonly [number, number]>();
    for (const p of s.players) {
      this.hp.set(p.id, p.hp);
      this.alive.set(p.id, p.alive);
      this.score.set(p.id, p.score);
      this.#lastSeen.set(p.id, [p.x, p.y]);
      if (p.alive) positions.set(p.id, [p.x, p.y]);
      if (p.id === this.you) {
        this.#pos = [p.x, p.y];
        this.#prev = [p.x, p.y];
        this.#sentDir = p.dir;
      }
    }
    this.ranking = s.ranking;
    this.#snaps.length = 0;
    this.#snaps.push({ tick: s.tick, players: positions });
    this.#seqTick.clear();
    this.#seq = 0;
    this.#smooth = [0, 0];
    this.ready = true;
    this.onChange?.();
  }

  #onSnapshot(s: Extract<ServerMessage, { type: "snapshot" }>, now: number): void {
    this.#offsets.push(now - s.tick * TICK_MS);
    if (this.#offsets.length > KEPT_SNAPSHOTS) this.#offsets.shift();
    this.#offset = Math.min(...this.#offsets);

    const players = new Map<number, readonly [number, number]>();
    for (const [id, x, y] of s.players) {
      players.set(id, [x, y]);
      this.#lastSeen.set(id, [x, y]);
    }
    this.#snaps.push({ tick: s.tick, players });
    if (this.#snaps.length > KEPT_SNAPSHOTS) this.#snaps.shift();

    const me = players.get(this.you);
    if (me !== undefined) this.#reconcile(me, s.ack[0], s.ack[1]);
  }

  /**
   * L'hôte a appliqué l'entrée `seq` au tick local où le client l'a appliquée (`#seqTick`) ; `since` ticks
   * plus tard, il a mis le bonhomme en `host`. On repart de là et on rejoue les directions locales
   * suivantes : le résultat est où le bonhomme devrait être maintenant. L'écart avec la prédiction est
   * effacé à l'écran en quelques images (01-Architecture §3, Prédiction).
   */
  #reconcile(host: readonly [number, number], seq: number, since: number): void {
    let corrected: [number, number];
    if (seq === 0) {
      // Aucune entrée appliquée par l'hôte : si on en a envoyé, elles sont en route.
      if (this.#seq > 0) return;
      corrected = [host[0], host[1]];
    } else {
      const applied = this.#seqTick.get(seq);
      if (applied === undefined) return;
      for (const s of this.#seqTick.keys()) if (s < seq) this.#seqTick.delete(s);
      const hostTick = applied + since;
      corrected = [host[0], host[1]];
      if (hostTick < this.#localTick && this.#localTick - hostTick < HISTORY) {
        for (let t = hostTick + 1; t <= this.#localTick; t++) corrected = move(corrected[0], corrected[1], this.#dirAt[t % HISTORY]!);
      }
    }
    const ex = this.#pos[0] - corrected[0];
    const ey = this.#pos[1] - corrected[1];
    if (ex === 0 && ey === 0) return;
    if (Math.abs(ex) + Math.abs(ey) > SNAP_DISTANCE) this.#smooth = [0, 0];
    else this.#smooth = [this.#smooth[0] + ex, this.#smooth[1] + ey];
    this.#prev = [this.#prev[0] - ex, this.#prev[1] - ey];
    this.#pos = corrected;
  }

  #onEvents(events: readonly GameEvent[], now: number): void {
    for (const ev of events) {
      switch (ev.type) {
        case "filled":
          this.digits[ev.cell] = ev.digit;
          this.owner[ev.cell] = ev.player;
          this.score.set(ev.player, (this.score.get(ev.player) ?? 0) + 1);
          this.pending.delete(ev.cell);
          this.fx.push({ kind: "filled", cell: ev.cell, player: ev.player });
          if (ev.player === this.you) this.#say(`${ev.digit} : accepté.`, now);
          break;
        case "refused":
          this.hp.set(ev.player, ev.hp);
          this.fx.push({ kind: "refused", cell: ev.cell, player: ev.player });
          if (ev.player === this.you) {
            this.pending.delete(ev.cell);
            this.flash.set(ev.cell, now + 600);
            this.#say(`${ev.digit} refusé : un PV de moins.`, now);
          }
          break;
        case "ignored":
          if (ev.player === this.you) {
            this.pending.delete(ev.cell);
            this.#say("Remplissage ignoré : la case est déjà remplie, ou vous en êtes trop loin.", now);
          }
          break;
        case "eliminated": {
          this.alive.set(ev.player, false);
          const at = ev.player === this.you ? this.#pos : this.#lastSeen.get(ev.player) ?? [0, 0];
          this.fx.push({ kind: "eliminated", player: ev.player, x: at[0], y: at[1] });
          if (ev.player === this.you) this.#say("Vous êtes éliminé.", now);
          break;
        }
        case "ended":
          this.ranking = ev.ranking;
          break;
      }
    }
    this.onChange?.();
  }

  // ---- chaque image ----

  /** Avance la prédiction d'autant de ticks que le temps écoulé en contient ; `dir` : les touches appuyées. */
  frame(now: number, dir: number): void {
    if (!this.ready) return;
    if (this.#lastFrame < 0) this.#lastFrame = now;
    const dt = Math.min(250, now - this.#lastFrame);
    this.#lastFrame = now;
    this.#acc += dt;
    while (this.#acc >= TICK_MS) {
      this.#acc -= TICK_MS;
      this.#tick(dir);
    }
    const decay = Math.exp(-dt / SMOOTH_MS);
    this.#smooth = [this.#smooth[0] * decay, this.#smooth[1] * decay];
    for (const [cell, p] of this.pending) if (now - p.at > PENDING_MS) this.pending.delete(cell);
  }

  /** Un tick local : la direction est lue, envoyée si elle a changé, et appliquée tout de suite. */
  #tick(dir: number): void {
    const active = this.youAlive && this.ranking === null;
    const d = active ? dir : 0;
    if (active && d !== this.#sentDir) {
      this.#seq++;
      this.#send({ type: "input", seq: this.#seq, dirs: [d] });
      this.#seqTick.set(this.#seq, this.#localTick + 1);
      this.#sentDir = d;
    }
    this.#localTick++;
    this.#dirAt[this.#localTick % HISTORY] = d;
    this.#prev = this.#pos;
    if (active) this.#pos = move(this.#pos[0], this.#pos[1], d);
  }

  /** Les bonshommes à afficher maintenant : le sien prédit, les autres interpolés dans le passé. */
  view(now: number): ViewPlayer[] {
    const alpha = this.#acc / TICK_MS;
    const mine: [number, number] = [
      this.#prev[0] + (this.#pos[0] - this.#prev[0]) * alpha + this.#smooth[0],
      this.#prev[1] + (this.#pos[1] - this.#prev[1]) * alpha + this.#smooth[1],
    ];
    const renderTick = (now - this.#offset) / TICK_MS - INTERP_TICKS;
    return this.players.map((p) => {
      const at = p.id === this.you ? mine : this.#interpolated(p.id, renderTick);
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        you: p.id === this.you,
        hp: this.hp.get(p.id) ?? 0,
        alive: this.alive.get(p.id) === true,
        score: this.score.get(p.id) ?? 0,
        x: at[0],
        y: at[1],
      };
    });
  }

  #interpolated(id: number, renderTick: number): readonly [number, number] {
    const snaps = this.#snaps;
    let before: Snapshot | undefined;
    let after: Snapshot | undefined;
    for (const s of snaps) {
      if (!s.players.has(id)) continue;
      if (s.tick <= renderTick) before = s;
      else {
        after = s;
        break;
      }
    }
    const a = before?.players.get(id);
    const b = after?.players.get(id);
    if (a !== undefined && b !== undefined) {
      const t = (renderTick - before!.tick) / (after!.tick - before!.tick);
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    return a ?? b ?? this.#lastSeen.get(id) ?? [0, 0];
  }

  /** Case sous son bonhomme, d'après la prédiction ; -1 s'il est éliminé. */
  myCell(): number {
    return this.youAlive ? cellAt(this.#pos[0], this.#pos[1]) : -1;
  }

  /** Touche 1 à 9 ou bouton : écrire ce chiffre dans la case sous son bonhomme. L'hôte décide. */
  pressDigit(digit: number, now: number): void {
    if (!this.ready || this.ranking !== null || !this.youAlive) return;
    const cell = this.myCell();
    const where = `ligne ${Math.floor(cell / 9) + 1}, colonne ${(cell % 9) + 1}`;
    if (this.owner[cell] === -1) return this.#say(`Case ${where} : chiffre donné, elle ne se remplit pas.`, now);
    if (this.owner[cell]! > 0) return this.#say(`Case ${where} : déjà remplie.`, now);
    if (this.pending.has(cell)) return;
    this.pending.set(cell, { digit, at: now });
    this.#send({ type: "fill", cell, digit });
  }

  #say(text: string, now: number): void {
    this.message = text;
    this.messageUntil = now + 3000;
  }
}
