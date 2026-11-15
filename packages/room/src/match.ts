// La partie lancée, côté hôte (Docs/Design/01-Architecture.md §3) : file des entrées de chaque joueur,
// une direction appliquée par tick, remplissages dans l'ordre d'arrivée, moteur, snapshots et événements.
// Comme `Room`, elle ne connaît ni horloge ni réseau : l'enveloppe appelle `step` à chaque tick.

import { START_HP, createGame, step, type FillRequest, type Game } from "@sudoku-deathmatch/engine";
import type { GameEvent, PlayerState, ServerMessage } from "@sudoku-deathmatch/shared";

/** Entrées en attente au-delà desquelles l'hôte ne garde que la dernière (01-Architecture §3, provisoire). */
export const MAX_QUEUED_INPUTS = 2;
/** Remplissages d'un joueur acceptés dans un même tick ; les suivants sont ignorés. */
export const MAX_FILLS_PER_TICK = 4;

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
}

export class Match {
  readonly game: Game;
  readonly #tracks = new Map<number, Track>();
  #fills: FillRequest[] = [];

  constructor(puzzle: readonly number[], solution: readonly number[], playerIds: readonly number[]) {
    this.game = createGame(puzzle, solution, playerIds);
    for (const id of playerIds) this.#tracks.set(id, { queue: [], received: 0, appliedSeq: 0, appliedTick: 0, fillsThisTick: 0 });
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

  /** Un tick : une entrée par joueur sortie de sa file, les remplissages reçus, puis le moteur. */
  step(): GameEvent[] {
    const dirs = new Map<number, number>();
    const tick = this.game.tick + 1;
    for (const [player, track] of this.#tracks) {
      track.fillsThisTick = 0;
      const next = track.queue.shift();
      if (next === undefined) continue;
      dirs.set(player, next.dir);
      track.appliedSeq = next.seq;
      track.appliedTick = tick;
    }
    const fills = this.#fills;
    this.#fills = [];
    return step(this.game, { dirs, fills });
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

  /** L'état complet, sans la solution (message `state`). */
  state(): Extract<ServerMessage, { type: "state" }> {
    const g = this.game;
    const givens = Array.from(g.owner, (o, i) => (o === -1 ? g.digits[i]! : 0)).join("");
    const cells: [number, number, number][] = [];
    for (let i = 0; i < 81; i++) if (g.owner[i]! > 0) cells.push([i, g.digits[i]!, g.owner[i]!]);
    const players: PlayerState[] = g.players.map((p) => ({ id: p.id, x: p.x, y: p.y, dir: p.dir, hp: p.hp, alive: p.alive, score: p.score }));
    return { type: "state", tick: g.tick, givens, cells, players, hpMax: START_HP, ranking: g.ranking };
  }
}
