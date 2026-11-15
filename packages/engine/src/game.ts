// La partie, côté hôte : grille, bonshommes, remplissage, PV, élimination, fin (00-Game §1 et §2).
// Aucune API de plateforme, aucune horloge : le temps est le numéro de tick (CLAUDE.md, règle 2).
// La solution est dans l'état : cet état n'existe que chez l'hôte et n'est jamais envoyé.

import { CELL, FILL_TOLERANCE, SPAWNS, START_HP } from "./config.ts";
import { DIR_MASK, move } from "./move.ts";

export interface Player {
  readonly id: number;
  x: number;
  y: number;
  dir: number;
  hp: number;
  alive: boolean;
  score: number;
}

export interface RankEntry {
  readonly player: number;
  readonly score: number;
  readonly alive: boolean;
}

export type EngineEvent =
  | { readonly type: "filled"; readonly cell: number; readonly digit: number; readonly player: number }
  | { readonly type: "refused"; readonly cell: number; readonly digit: number; readonly player: number; readonly hp: number }
  | { readonly type: "ignored"; readonly cell: number; readonly player: number }
  | { readonly type: "eliminated"; readonly player: number }
  | { readonly type: "ended"; readonly ranking: readonly RankEntry[] };

export interface Game {
  /** Numéro du dernier tick appliqué ; 0 avant le premier. */
  tick: number;
  readonly solution: Uint8Array;
  /** Chiffre de chaque case, 0 si vide. */
  readonly digits: Uint8Array;
  /** -1 : chiffre donné ; 0 : vide ; sinon l'identifiant du joueur qui l'a rempli. */
  readonly owner: Int16Array;
  readonly players: Player[];
  /** Classement, une fois la partie finie. */
  ranking: RankEntry[] | null;
}

/** Un remplissage demandé, dans l'ordre d'arrivée chez l'hôte. */
export interface FillRequest {
  readonly player: number;
  readonly cell: number;
  readonly digit: number;
}

/** Ce que l'hôte applique pendant un tick. */
export interface TickInput {
  /** Nouvelle direction des joueurs qui en ont une ; les autres gardent la leur. */
  readonly dirs: ReadonlyMap<number, number>;
  readonly fills: readonly FillRequest[];
}

/**
 * `puzzle` et `solution` : 81 chiffres, ligne par ligne (0 pour une case vide de `puzzle`). `playerIds` :
 * les joueurs dans l'ordre, qui fixe leur position de départ (au plus 4).
 */
export function createGame(puzzle: ArrayLike<number>, solution: ArrayLike<number>, playerIds: readonly number[]): Game {
  if (puzzle.length !== 81 || solution.length !== 81) throw new Error("grille de 81 cases attendue");
  if (playerIds.length < 1 || playerIds.length > SPAWNS.length) throw new Error("1 à 4 joueurs");
  const digits = new Uint8Array(81);
  const owner = new Int16Array(81);
  for (let i = 0; i < 81; i++) {
    digits[i] = puzzle[i]!;
    owner[i] = puzzle[i]! === 0 ? 0 : -1;
  }
  const players = playerIds.map((id, k): Player => {
    const [x, y] = SPAWNS[k]!;
    return { id, x, y, dir: 0, hp: START_HP, alive: true, score: 0 };
  });
  return { tick: 0, solution: Uint8Array.from(solution), digits, owner, players, ranking: null };
}

/** Applique un tick et renvoie ses événements. Une partie finie ne bouge plus. */
export function step(game: Game, input: TickInput): EngineEvent[] {
  if (game.ranking !== null) return [];
  game.tick++;
  const events: EngineEvent[] = [];

  for (const p of game.players) {
    if (!p.alive) continue;
    const dir = input.dirs.get(p.id);
    if (dir !== undefined) p.dir = dir & DIR_MASK;
    [p.x, p.y] = move(p.x, p.y, p.dir);
  }

  for (const fill of input.fills) applyFill(game, fill, events);

  const ranking = finalRanking(game);
  if (ranking !== null) {
    game.ranking = ranking;
    events.push({ type: "ended", ranking });
  }
  return events;
}

function applyFill(game: Game, fill: FillRequest, events: EngineEvent[]): void {
  const p = game.players.find((q) => q.id === fill.player);
  if (p === undefined || !p.alive) return;
  if (!Number.isInteger(fill.cell) || fill.cell < 0 || fill.cell > 80) return;
  if (!Number.isInteger(fill.digit) || fill.digit < 1 || fill.digit > 9) return;
  if (game.owner[fill.cell] !== 0 || !near(p, fill.cell)) {
    events.push({ type: "ignored", cell: fill.cell, player: p.id });
    return;
  }
  if (game.solution[fill.cell] === fill.digit) {
    game.digits[fill.cell] = fill.digit;
    game.owner[fill.cell] = p.id;
    p.score++;
    events.push({ type: "filled", cell: fill.cell, digit: fill.digit, player: p.id });
    return;
  }
  p.hp--;
  events.push({ type: "refused", cell: fill.cell, digit: fill.digit, player: p.id, hp: p.hp });
  if (p.hp <= 0) {
    p.alive = false;
    p.dir = 0;
    events.push({ type: "eliminated", player: p.id });
  }
}

/** Le bonhomme est sur la case, ou à moins de FILL_TOLERANCE de ses bords. */
function near(p: Player, cell: number): boolean {
  const x0 = (cell % 9) * CELL;
  const y0 = Math.floor(cell / 9) * CELL;
  return p.x >= x0 - FILL_TOLERANCE && p.x < x0 + CELL + FILL_TOLERANCE && p.y >= y0 - FILL_TOLERANCE && p.y < y0 + CELL + FILL_TOLERANCE;
}

/**
 * Le classement si la partie est finie, sinon `null` (00-Game §2). Finie : grille pleine, ou il ne reste
 * qu'un bonhomme (aucun en solo). Classement au nombre de cases ; quand il ne reste qu'un bonhomme, il
 * est premier (provisoire). À égalité, l'ordre des joueurs.
 */
function finalRanking(game: Game): RankEntry[] | null {
  const alive = game.players.filter((p) => p.alive).length;
  const full = !game.owner.includes(0);
  const solo = game.players.length === 1;
  const lastStanding = !solo && alive <= 1;
  if (!full && !lastStanding && !(solo && alive === 0)) return null;
  const order = game.players.slice().sort((a, b) => {
    if (lastStanding && a.alive !== b.alive) return a.alive ? -1 : 1;
    return b.score - a.score;
  });
  return order.map((p) => ({ player: p.id, score: p.score, alive: p.alive }));
}
