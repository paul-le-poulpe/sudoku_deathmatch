// La partie lancée, côté hôte (Docs/Design/01-Architecture.md §3) : file des entrées de chaque joueur,
// une direction appliquée par tick, remplissages dans l'ordre d'arrivée, moteur, snapshots et événements.
// Comme `Room`, elle ne connaît ni horloge ni réseau : l'enveloppe appelle `step` à chaque tick.

import { createGame, step, type BlockRequest, type FillRequest, type Game, type HitRequest, type PlaceRequest } from "@sudoku-deathmatch/engine";
import type { BotLevel, GameEvent, PlayerState, ServerMessage, TrapKind } from "@sudoku-deathmatch/shared";

import { Bot } from "./bot.ts";
import { makeRng } from "./grid.ts";

/** Un joueur de la partie : `bot` est la difficulté d'un bot joué par l'hôte, `null` pour un joueur. */
export interface MatchPlayer {
  readonly id: number;
  readonly bot: BotLevel | null;
}

/** Entrées en attente au-delà desquelles l'hôte ne garde que la dernière (01-Architecture §3, provisoire). */
export const MAX_QUEUED_INPUTS = 2;
/** Remplissages d'un joueur acceptés dans un même tick ; les suivants sont ignorés. */
export const MAX_FILLS_PER_TICK = 4;
/** Poses de piège et contacts signalés (boules arrêtées comprises) d'un joueur acceptés dans un même tick. */
export const MAX_PLACES_PER_TICK = 2;
export const MAX_HITS_PER_TICK = 4;

interface Queued {
  readonly seq: number;
  readonly dir: number;
}

interface Track {
  /** Entrées reçues, pas encore appliquées. */
  queue: Queued[];
  /** Plus grand `seq` reçu : une direction répétée n'entre pas deux fois. */
  received: number;
  /** Dernière entrée appliquée, et tick où elle l'a été. */
  appliedSeq: number;
  appliedTick: number;
  fillsThisTick: number;
  placesThisTick: number;
  hitsThisTick: number;
}

export class Match {
  readonly game: Game;
  readonly #tracks = new Map<number, Track>();
  #fills: FillRequest[] = [];
  #places: PlaceRequest[] = [];
  #hits: HitRequest[] = [];
  #blocks: BlockRequest[] = [];
  readonly #bots: Bot[];

  /** `seed` : le hasard des bots (cases visées, instant de leur première décision). */
  constructor(puzzle: readonly number[], solution: readonly number[], players: readonly MatchPlayer[], seed: number) {
    const ids = players.map((p) => p.id);
    this.game = createGame(puzzle, solution, ids, new Set(players.filter((p) => p.bot !== null).map((p) => p.id)));
    for (const id of ids) {
      this.#tracks.set(id, { queue: [], received: 0, appliedSeq: 0, appliedTick: 0, fillsThisTick: 0, placesThisTick: 0, hitsThisTick: 0 });
    }
    const rnd = makeRng(seed);
    this.#bots = players.flatMap((p) => (p.bot === null ? [] : [new Bot(p.id, p.bot, rnd)]));
  }

  get ended(): boolean {
    return this.game.ranking !== null;
  }

  /**
   * Les dernières directions du joueur, la plus récente en dernier, `seq` étant le numéro de la dernière.
   * Celles déjà reçues sont ignorées ; au-delà de MAX_QUEUED_INPUTS en attente, seule la dernière reste.
   */
  input(player: number, seq: number, dirs: readonly number[]): void {
    const track = this.#tracks.get(player);
    if (track === undefined) return;
    const first = seq - dirs.length + 1;
    dirs.forEach((dir, k) => {
      const s = first + k;
      if (s <= track.received) return;
      track.received = s;
      track.queue.push({ seq: s, dir });
    });
    if (track.queue.length > MAX_QUEUED_INPUTS) track.queue = track.queue.slice(-1);
  }

  /**
   * Le joueur revient sur une nouvelle connexion : sa page repart de `seq` 1. Sa file et ses numéros sont
   * oubliés ; son bonhomme garde sa direction jusqu'à la prochaine entrée.
   */
  resetInputs(player: number): void {
    const track = this.#tracks.get(player);
    if (track === undefined) return;
    track.queue = [];
    track.received = 0;
    track.appliedSeq = 0;
    track.appliedTick = 0;
  }

  fill(player: number, cell: number, digit: number): void {
    const track = this.#tracks.get(player);
    if (track === undefined || track.fillsThisTick >= MAX_FILLS_PER_TICK) return;
    track.fillsThisTick++;
    this.#fills.push({ player, cell, digit });
  }

  place(player: number, cell: number, kind: TrapKind): void {
    const track = this.#tracks.get(player);
    if (track === undefined || track.placesThisTick >= MAX_PLACES_PER_TICK) return;
    track.placesThisTick++;
    this.#places.push({ player, cell, kind });
  }

  hit(player: number, ball: number): void {
    const track = this.#tracks.get(player);
    if (track === undefined || track.hitsThisTick >= MAX_HITS_PER_TICK) return;
    track.hitsThisTick++;
    this.#hits.push({ player, ball });
  }

  /** Boule arrêtée par la bulle du joueur, d'après son écran ; le moteur vérifie (`applyBlock`). */
  block(player: number, ball: number): void {
    const track = this.#tracks.get(player);
    if (track === undefined || track.hitsThisTick >= MAX_HITS_PER_TICK) return;
    track.hitsThisTick++;
    this.#blocks.push({ player, ball });
  }

  /**
   * Un tick : une entrée par joueur sortie de sa file, ce que chaque bot envoie (04-Bots), les remplissages,
   * poses et contacts reçus, puis le moteur. Les bots passent par les mêmes méthodes que les messages des
   * joueurs, sans file : leur direction s'applique à ce tick.
   */
  step(): GameEvent[] {
    const dirs = new Map<number, number>();
    const tick = this.game.tick + 1;
    for (const [player, track] of this.#tracks) {
      track.fillsThisTick = 0;
      track.placesThisTick = 0;
      track.hitsThisTick = 0;
      const next = track.queue.shift();
      if (next === undefined) continue;
      dirs.set(player, next.dir);
      track.appliedSeq = next.seq;
      track.appliedTick = tick;
    }
    for (const bot of this.#bots) {
      const act = bot.think(this.game);
      if (act === null) continue;
      dirs.set(bot.id, act.dir);
      if (act.fill !== null) this.fill(bot.id, act.fill.cell, act.fill.digit);
      if (act.place !== null) this.place(bot.id, act.place.cell, act.place.kind);
      for (const ball of act.hits) this.hit(bot.id, ball);
      for (const ball of act.blocks) this.block(bot.id, ball);
    }
    const fills = this.#fills;
    const places = this.#places;
    const hits = this.#hits;
    const blocks = this.#blocks;
    this.#fills = [];
    this.#places = [];
    this.#hits = [];
    this.#blocks = [];
    return step(this.game, { dirs, fills, places, hits, blocks });
  }

  /** Positions des bonshommes non éliminés, communes à tous les destinataires. */
  positions(): [number, number, number, number][] {
    return this.game.players.filter((p) => p.alive).map((p) => [p.id, p.x, p.y, p.dir]);
  }

  /** `[seq, since]` du joueur : dernière entrée appliquée et ticks écoulés depuis. */
  ack(player: number): [number, number] {
    const track = this.#tracks.get(player);
    if (track === undefined || track.appliedSeq === 0) return [0, 0];
    return [track.appliedSeq, this.game.tick - track.appliedTick];
  }

  /** L'état complet pour le joueur `recipient`, sans la solution (message `state`). */
  state(recipient: number): Extract<ServerMessage, { type: "state" }> {
    const g = this.game;
    const givens = Array.from(g.owner, (o, i) => (o === -1 ? g.digits[i]! : 0)).join("");
    const cells: [number, number, number][] = [];
    for (let i = 0; i < 81; i++) if (g.owner[i]! > 0) cells.push([i, g.digits[i]!, g.owner[i]!]);
    const players: PlayerState[] = g.players.map((p) => ({ id: p.id, x: p.x, y: p.y, dir: p.dir, hp: p.hp, hpMax: p.hpMax, alive: p.alive, score: p.score }));
    // Toutes les mines vont à tous : chacun a vu leur pose (03-Pieges §2). `recipient` reste pour un
    // état propre à chaque joueur.
    void recipient;
    const traps = g.traps.map((t): [number, TrapKind, number, number, number] => [t.cell, t.kind, t.owner, t.placed, t.kind === "shield" ? t.full : 0]);
    const balls = g.balls.map((b): [number, number, number, number, number, number] => [b.id, b.cell, b.owner, b.launch, b.dx, b.dy]);
    return { type: "state", tick: g.tick, givens, cells, players, ranking: g.ranking, traps, balls };
  }
}
