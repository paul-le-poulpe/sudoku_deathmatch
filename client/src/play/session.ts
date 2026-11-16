// La partie côté client, sans affichage (01-Architecture §3 et §6) : ce que l'hôte a envoyé (`state`,
// `snapshot`, `events`), la prédiction de son propre bonhomme, l'interpolation des autres, les pièges et
// les boules (03-Pieges). Phaser lit ce module à chaque image (scene.ts) ; il ne décide d'aucune règle :
// cases, PV et éliminations viennent des événements de l'hôte. Seule exception : le contact entre son
// bonhomme et une boule, que le client détecte et signale (01-Architecture §3, Pièges et projectiles).

import {
  BALL_CHARGE_TICKS,
  BALL_CONTACT,
  CELL,
  MINE_REST_TICKS,
  MINE_SHRINK_TICKS,
  ballAt,
  ballOut,
  cellAt,
  cellCenter,
  move,
  within,
} from "@sudoku-deathmatch/engine";
import {
  TICK_MS,
  type ClientMessage,
  type GameEvent,
  type Level,
  type RankEntry,
  type ServerMessage,
  type StartPlayer,
  type TrapKind,
} from "@sudoku-deathmatch/shared";

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
/** Un remplissage ou une pose sans réponse de l'hôte après ce délai n'est plus attendu. */
const PENDING_MS = 3000;
/** Après un tir, le canon dessiné reste dans la direction de la boule pendant ce nombre de ticks. */
const CANNON_HOLD_TICKS = 6;
/** Rebond du cadre de la mine quand le grand cadre l'atteint (0,18 s). */
const MINE_PULSE_TICKS = 3.6;

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

/** Un piège posé, et le tick de l'hôte où il l'a été. */
export interface ClientTrap {
  readonly kind: TrapKind;
  readonly owner: number;
  readonly placed: number;
}

/**
 * Ce que montre une mine à cet instant (03-Pieges §2), pour tous les joueurs : `shrink`, avancement de 0 à
 * 1 du grand cadre qui se resserre à la pose (`null` ensuite) ; `resting`, mine qui se recharge après une
 * explosion (dessinée à 35 %) ; `pulse`, rebond du cadre à pointes quand le grand cadre l'atteint, de 1 à 0.
 */
export interface MineLook {
  readonly shrink: number | null;
  readonly resting: boolean;
  readonly pulse: number;
}

/** Un piège à dessiner ; (`ux`, `uy`) : direction du canon d'une tourelle, vecteur de longueur 1. */
export interface ViewTrap {
  readonly cell: number;
  readonly kind: TrapKind;
  readonly owner: number;
  readonly ux: number;
  readonly uy: number;
  /** Mine seulement. */
  readonly mine: MineLook | null;
}

/** Une boule à dessiner, en unités ; `progress` : avancement de la seconde d'attente, de 0 à 1. */
export interface ViewBall {
  readonly x: number;
  readonly y: number;
  readonly owner: number;
  readonly charging: boolean;
  readonly progress: number;
}

/** Ce que l'affichage doit animer, dans l'ordre ; Phaser vide la liste à chaque image. */
export type Fx =
  | { readonly kind: "filled"; readonly cell: number; readonly player: number }
  | { readonly kind: "refused"; readonly cell: number; readonly player: number }
  | { readonly kind: "eliminated"; readonly player: number; readonly x: number; readonly y: number }
  | { readonly kind: "placed"; readonly cell: number; readonly player: number }
  /** Une mine explose sous `player`. */
  | { readonly kind: "exploded"; readonly cell: number; readonly player: number }
  /** Une boule de `player` touche `victim` en (x, y), en unités. */
  | { readonly kind: "pop"; readonly x: number; readonly y: number; readonly player: number; readonly victim: number };

interface Snapshot {
  readonly tick: number;
  readonly players: ReadonlyMap<number, readonly [number, number]>;
}

interface ClientBall {
  readonly cell: number;
  readonly owner: number;
  readonly launch: number;
  dx: number;
  dy: number;
  launched: boolean;
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
  /** Pièges connus, par case. */
  readonly traps = new Map<number, ClientTrap>();

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
  readonly #balls = new Map<number, ClientBall>();
  /** Poses envoyées, sans réponse de l'hôte : case → heure d'envoi. */
  readonly #placing = new Map<number, number>();

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
  /**
   * Tick de l'hôte moins tick local : la position prédite au tick local L est celle que l'hôte donnera au
   * bonhomme à son tick L + #tickOffset. Connu dès que l'hôte a appliqué une entrée (`ack`).
   */
  #tickOffset: number | null = null;

  constructor(start: StartMessage, send: (msg: ClientMessage) => void) {
    this.you = start.you;
    this.level = start.level;
    this.players = start.players;
    this.#send = send;
  }

  onMessage(msg: ServerMessage, now: number): void {
    if (msg.type === "state") this.#onState(msg);
    else if (msg.type === "snapshot") this.#onSnapshot(msg, now);
    else if (msg.type === "events") this.#onEvents(msg.events, msg.tick, now);
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
    this.traps.clear();
    for (const [cell, kind, player, placed] of s.traps) this.traps.set(cell, { kind, owner: player, placed });
    this.#balls.clear();
    for (const [ball, cell, player, launch, dx, dy] of s.balls) {
      this.#balls.set(ball, { cell, owner: player, launch, dx, dy, launched: dx !== 0 || dy !== 0 });
    }
    this.#placing.clear();
    this.ranking = s.ranking;
    this.#snaps.length = 0;
    this.#snaps.push({ tick: s.tick, players: positions });
    this.#seqTick.clear();
    this.#seq = 0;
    this.#tickOffset = null;
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
    if (me !== undefined) this.#reconcile(me, s.ack[0], s.ack[1], s.tick);
  }

  /**
   * L'hôte a appliqué l'entrée `seq` au tick local où le client l'a appliquée (`#seqTick`) ; `since` ticks
   * plus tard, à son tick `tick`, il a mis le bonhomme en `host`. On repart de là et on rejoue les
   * directions locales suivantes : le résultat est où le bonhomme devrait être maintenant. L'écart avec la
   * prédiction est effacé à l'écran en quelques images (01-Architecture §3, Prédiction).
   */
  #reconcile(host: readonly [number, number], seq: number, since: number, tick: number): void {
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
      this.#tickOffset = tick - hostTick;
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

  #onEvents(events: readonly GameEvent[], tick: number, now: number): void {
    for (const ev of events) {
      switch (ev.type) {
        case "filled":
          this.digits[ev.cell] = ev.digit;
          this.owner[ev.cell] = ev.player;
          this.score.set(ev.player, (this.score.get(ev.player) ?? 0) + 1);
          this.hp.set(ev.player, ev.hp);
          this.pending.delete(ev.cell);
          this.fx.push({ kind: "filled", cell: ev.cell, player: ev.player });
          if (ev.player === this.you) this.#say(`${ev.digit} : accepté, PV au maximum.`, now);
          break;
        case "refused":
          this.hp.set(ev.player, ev.hp);
          this.fx.push({ kind: "refused", cell: ev.cell, player: ev.player });
          if (ev.player === this.you) {
            this.pending.delete(ev.cell);
            this.flash.set(ev.cell, now + 600);
            this.#say(ev.hp > 0 ? `${ev.digit} refusé : il ne vous reste qu'un PV.` : `${ev.digit} refusé : plus aucun PV.`, now);
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
        case "placed":
          this.traps.set(ev.cell, { kind: ev.kind, owner: ev.player, placed: tick });
          // La mine a sa propre animation (le cadre qui se resserre) ; pas de particules.
          if (ev.kind === "turret") this.fx.push({ kind: "placed", cell: ev.cell, player: ev.player });
          if (ev.player === this.you) {
            this.#placing.delete(ev.cell);
            this.#say(
              ev.kind === "mine" ? "Mine posée : tout le monde la voit." : "Tourelle posée : premier tir dans 2 s, puis toutes les 6 s.",
              now,
            );
          }
          break;
        case "not_placed":
          if (ev.player === this.you) {
            this.#placing.delete(ev.cell);
            this.#say("Piège refusé : votre bonhomme n'est plus sur la case.", now);
          }
          break;
        case "exploded": {
          // La mine reste : elle se recharge 20 s, puis sa pose se rejoue (03-Pieges §2).
          const trap = this.traps.get(ev.cell);
          if (trap !== undefined) this.traps.set(ev.cell, { ...trap, placed: tick + MINE_REST_TICKS });
          this.hp.set(ev.player, ev.hp);
          this.fx.push({ kind: "exploded", cell: ev.cell, player: ev.player });
          if (ev.player === this.you) this.#say("Une mine : deux PV de moins.", now);
          else if (trap?.owner === this.you) this.#say("Votre mine a explosé : elle se recharge pendant 20 s.", now);
          break;
        }
        case "ball":
          this.#balls.set(ev.ball, { cell: ev.cell, owner: ev.player, launch: ev.launch, dx: 0, dy: 0, launched: false });
          break;
        case "launched": {
          const b = this.#balls.get(ev.ball);
          if (b !== undefined) {
            b.dx = ev.dx;
            b.dy = ev.dy;
            b.launched = true;
          }
          break;
        }
        case "ball_hit": {
          this.hp.set(ev.player, ev.hp);
          const b = this.#balls.get(ev.ball);
          if (b !== undefined) {
            // Encore là : pas détecté par ce client (autre bonhomme, ou contrôle de l'hôte).
            this.#balls.delete(ev.ball);
            const at = ev.player === this.you ? this.#pos : ballAt(b.cell, b.dx, b.dy, b.launch, this.#hazardTick(now));
            this.fx.push({ kind: "pop", x: at[0], y: at[1], player: b.owner, victim: ev.player });
          }
          if (ev.player === this.you) this.#say("Touché par une boule : un PV de moins.", now);
          break;
        }
        case "ball_gone":
          this.#balls.delete(ev.ball);
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
    for (const [cell, at] of this.#placing) if (now - at > PENDING_MS) this.#placing.delete(cell);
    // Une boule sortie de la grille disparaît : chaque client le calcule, l'hôte n'envoie rien.
    const t = this.#hazardTick(now);
    for (const [id, b] of this.#balls) {
      if (!b.launched) continue;
      const [x, y] = ballAt(b.cell, b.dx, b.dy, b.launch, t);
      if (ballOut(x, y)) this.#balls.delete(id);
    }
  }

  /**
   * Un tick local : la direction est lue, envoyée si elle a changé, et appliquée tout de suite. La première
   * est envoyée même sans changement, pour que l'`ack` de l'hôte donne vite #tickOffset.
   */
  #tick(dir: number): void {
    const active = this.youAlive && this.ranking === null;
    const d = active ? dir : 0;
    if (active && (d !== this.#sentDir || this.#seq === 0)) {
      this.#seq++;
      this.#send({ type: "input", seq: this.#seq, dirs: [d] });
      this.#seqTick.set(this.#seq, this.#localTick + 1);
      this.#sentDir = d;
    }
    this.#localTick++;
    this.#dirAt[this.#localTick % HISTORY] = d;
    this.#prev = this.#pos;
    if (active) {
      this.#pos = move(this.#pos[0], this.#pos[1], d);
      this.#detectHits();
    }
  }

  /**
   * Contact entre son bonhomme, à la position dessinée, et les boules adverses parties, au même instant de
   * la partie (01-Architecture §3, Pièges et projectiles) : la boule disparaît de l'écran et `hit` part.
   * Sans #tickOffset, rien n'est testé ; le contrôle de l'hôte s'applique.
   */
  #detectHits(): void {
    if (this.#tickOffset === null) return;
    const t = this.#localTick + this.#tickOffset;
    const x = this.#pos[0] + this.#smooth[0];
    const y = this.#pos[1] + this.#smooth[1];
    for (const [id, b] of this.#balls) {
      if (!b.launched || b.owner === this.you || t <= b.launch) continue;
      const [bx, by] = ballAt(b.cell, b.dx, b.dy, b.launch, t);
      if (!within(bx, by, x, y, BALL_CONTACT)) continue;
      this.#balls.delete(id);
      this.#send({ type: "hit", ball: id });
      this.fx.push({ kind: "pop", x: bx, y: by, player: b.owner, victim: this.you });
    }
  }

  /**
   * Tick de l'hôte, fractionnaire, où en est son bonhomme tel qu'il est dessiné : pièges et boules sont
   * dessinés à cet instant, pas dans le passé comme les autres bonshommes. Avant le premier `ack` : tick
   * estimé de l'hôte plus l'avance habituelle de la prédiction (provisoire).
   */
  #hazardTick(now: number): number {
    if (this.#tickOffset === null) return (now - this.#offset) / TICK_MS + 2;
    return this.#localTick - 1 + this.#acc / TICK_MS + this.#tickOffset;
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

  /**
   * Pièges et boules à dessiner maintenant. Le canon d'une tourelle est décoratif : il vise le bonhomme
   * adverse le plus proche tel que ce client le dessine (`players`), et suit la boule qui vient de partir.
   */
  hazards(now: number, players: readonly ViewPlayer[]): { traps: ViewTrap[]; balls: ViewBall[] } {
    const t = this.#hazardTick(now);
    const balls: ViewBall[] = [];
    const shots = new Map<number, ClientBall>();
    for (const b of this.#balls.values()) {
      const [x, y] = b.launched ? ballAt(b.cell, b.dx, b.dy, b.launch, t) : cellCenter(b.cell);
      const progress = b.launched ? 1 : Math.min(1, Math.max(0, (t - (b.launch - BALL_CHARGE_TICKS)) / BALL_CHARGE_TICKS));
      balls.push({ x, y, owner: b.owner, charging: !b.launched, progress });
      if (b.launched && t - b.launch < CANNON_HOLD_TICKS) shots.set(b.cell, b);
    }
    const traps: ViewTrap[] = [];
    for (const [cell, trap] of this.traps) {
      let ux = 0;
      let uy = -1;
      if (trap.kind === "mine") {
        traps.push({ cell, kind: trap.kind, owner: trap.owner, ux, uy, mine: this.#mineLook(trap, t) });
        continue;
      }
      const shot = shots.get(cell);
      if (shot !== undefined) {
        ux = shot.dx / 1000;
        uy = shot.dy / 1000;
      } else {
        const [cx, cy] = cellCenter(cell);
        let best = Infinity;
        for (const p of players) {
          if (!p.alive || p.id === trap.owner) continue;
          const d = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy);
          if (d === 0 || d >= best) continue;
          best = d;
          const len = Math.sqrt(d);
          ux = (p.x - cx) / len;
          uy = (p.y - cy) / len;
        }
      }
      traps.push({ cell, kind: trap.kind, owner: trap.owner, ux, uy, mine: null });
    }
    return { traps, balls };
  }

  /**
   * Phase d'une mine au tick `t` de l'hôte (celui où les pièges sont dessinés), la même pour tous : grand
   * cadre qui se resserre, puis mine posée ; recharge après une explosion (03-Pieges §2).
   */
  #mineLook(trap: ClientTrap, t: number): MineLook {
    // Pose plus loin dans le futur que l'avance possible de ce client : la mine se recharge après une
    // explosion. Ses derniers ticks de recharge ouvrent déjà le cadre, qui commence alors un peu tôt.
    if (trap.placed - t > 5) return { shrink: null, resting: true, pulse: 0 };
    const e = Math.max(0, t - trap.placed);
    if (e < MINE_SHRINK_TICKS) return { shrink: e / MINE_SHRINK_TICKS, resting: false, pulse: 0 };
    return { shrink: null, resting: false, pulse: Math.max(0, 1 - (e - MINE_SHRINK_TICKS) / MINE_PULSE_TICKS) };
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

  /** Un piège peut être demandé sur la case sous son bonhomme : remplie par lui, sans piège (03-Pieges §1). */
  canPlace(): boolean {
    if (!this.ready || this.ranking !== null || !this.youAlive) return false;
    const cell = this.myCell();
    return this.owner[cell] === this.you && !this.traps.has(cell) && !this.#placing.has(cell);
  }

  /** Touche ou bouton d'un piège : le poser sur la case sous son bonhomme. L'hôte décide. */
  pressTrap(kind: TrapKind, now: number): void {
    if (!this.ready || this.ranking !== null || !this.youAlive) return;
    const cell = this.myCell();
    if (this.owner[cell] !== this.you) return this.#say("Un piège se pose sur une case que vous avez remplie.", now);
    if (this.traps.has(cell)) return this.#say("Cette case a déjà un piège.", now);
    if (this.#placing.has(cell)) return;
    this.#placing.set(cell, now);
    this.#send({ type: "place", cell, kind });
  }

  #say(text: string, now: number): void {
    this.message = text;
    this.messageUntil = now + 3000;
  }
}
