// La partie, côté hôte : grille, bonshommes, remplissage, PV, élimination, fin (00-Game §1 et §2), pièges
// (03-Pieges). Aucune API de plateforme, aucune horloge : le temps est le numéro de tick (CLAUDE.md,
// règle 2). La solution est dans l'état : cet état n'existe que chez l'hôte et n'est jamais envoyé tel quel.

import { ballAt, ballOut, cellCenter, directionPerMille, within } from "./ball.ts";
import {
  BALL_CHARGE_TICKS,
  BALL_CONTACT,
  CELL,
  FILL_TOLERANCE,
  HIT_CONTROL_MARGIN,
  MINE_ARM_TICKS,
  MINE_DAMAGE,
  MINE_REST_TICKS,
  SPAWNS,
  START_HP,
  TURRET_FIRST_TICKS,
  TURRET_INTERVAL_TICKS,
} from "./config.ts";
import { DIR_MASK, cellAt, move } from "./move.ts";

export type TrapKind = "mine" | "turret";

export interface Player {
  readonly id: number;
  x: number;
  y: number;
  dir: number;
  hp: number;
  alive: boolean;
  score: number;
  /** Tick de son élimination ; 0 tant qu'il est en vie. */
  outTick: number;
}

export interface RankEntry {
  readonly player: number;
  readonly score: number;
  readonly alive: boolean;
}

/** Un piège posé sur une case remplie par son poseur (03-Pieges). */
export interface Trap {
  readonly cell: number;
  readonly kind: TrapKind;
  readonly owner: number;
  /**
   * Tick de la pose. Une mine ne peut exploser qu'à partir de `placed + MINE_ARM_TICKS`. Quand elle
   * explose, `placed` passe 20 s dans le futur : elle se recharge, puis sa pose se rejoue.
   */
  placed: number;
  /** Tourelle : tick où sa prochaine boule apparaît. Mine : inutilisé. */
  nextBall: number;
}

/** Une boule de tourelle, visible depuis son apparition ; elle part au tick `launch`. */
export interface Ball {
  readonly id: number;
  /** Case de la tourelle. */
  readonly cell: number;
  readonly owner: number;
  readonly launch: number;
  /** Direction en millièmes, fixée au départ ; (0, 0) avant. */
  dx: number;
  dy: number;
}

export type EngineEvent =
  | { readonly type: "filled"; readonly cell: number; readonly digit: number; readonly player: number; readonly hp: number }
  | { readonly type: "refused"; readonly cell: number; readonly digit: number; readonly player: number; readonly hp: number }
  | { readonly type: "ignored"; readonly cell: number; readonly player: number }
  | { readonly type: "eliminated"; readonly player: number }
  | { readonly type: "ended"; readonly ranking: readonly RankEntry[] }
  | { readonly type: "placed"; readonly cell: number; readonly kind: TrapKind; readonly player: number }
  | { readonly type: "not_placed"; readonly cell: number; readonly player: number }
  | { readonly type: "exploded"; readonly cell: number; readonly player: number; readonly hp: number }
  | { readonly type: "ball"; readonly ball: number; readonly cell: number; readonly player: number; readonly launch: number }
  | { readonly type: "launched"; readonly ball: number; readonly dx: number; readonly dy: number }
  | { readonly type: "ball_hit"; readonly ball: number; readonly player: number; readonly hp: number }
  | { readonly type: "ball_gone"; readonly ball: number };

export interface Game {
  /** Numéro du dernier tick appliqué ; 0 avant le premier. */
  tick: number;
  readonly solution: Uint8Array;
  /** Chiffre de chaque case, 0 si vide. */
  readonly digits: Uint8Array;
  /** -1 : chiffre donné ; 0 : vide ; sinon l'identifiant du joueur qui l'a rempli. */
  readonly owner: Int16Array;
  readonly players: Player[];
  /** Pièges, dans l'ordre de pose ; au plus un par case. */
  readonly traps: Trap[];
  /** Boules apparues et pas encore disparues, dans l'ordre d'apparition. */
  readonly balls: Ball[];
  /** Identifiant de la dernière boule créée ; 0 avant la première. */
  lastBall: number;
  /** Classement, une fois la partie finie. */
  ranking: RankEntry[] | null;
}

/** Un remplissage demandé, dans l'ordre d'arrivée chez l'hôte. */
export interface FillRequest {
  readonly player: number;
  readonly cell: number;
  readonly digit: number;
}

/** Une pose de piège demandée. */
export interface PlaceRequest {
  readonly player: number;
  readonly cell: number;
  readonly kind: TrapKind;
}

/** Un contact signalé par le client du joueur touché. */
export interface HitRequest {
  readonly player: number;
  readonly ball: number;
}

/** Ce que l'hôte applique pendant un tick. */
export interface TickInput {
  /** Nouvelle direction des joueurs qui en ont une ; les autres gardent la leur. */
  readonly dirs: ReadonlyMap<number, number>;
  readonly fills: readonly FillRequest[];
  readonly places: readonly PlaceRequest[];
  readonly hits: readonly HitRequest[];
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
    return { id, x, y, dir: 0, hp: START_HP, alive: true, score: 0, outTick: 0 };
  });
  return { tick: 0, solution: Uint8Array.from(solution), digits, owner, players, traps: [], balls: [], lastBall: 0, ranking: null };
}

/**
 * Applique un tick et renvoie ses événements. Une partie finie ne bouge plus. Ordre : déplacements,
 * remplissages, poses, contacts signalés, tourelles (départs puis apparitions), contrôle des boules,
 * mines, fin de partie.
 */
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
  for (const place of input.places) applyPlace(game, place, events);
  for (const hit of input.hits) applyHit(game, hit, events);
  stepTurrets(game, events);
  controlBalls(game, events);
  stepMines(game, events);

  const ranking = finalRanking(game);
  if (ranking !== null) {
    game.ranking = ranking;
    events.push({ type: "ended", ranking });
  }
  return events;
}

function alivePlayer(game: Game, id: number): Player | undefined {
  const p = game.players.find((q) => q.id === id);
  return p !== undefined && p.alive ? p : undefined;
}

/** Retire un PV à `p`, annonce `event(hp)`, puis l'élimination si c'était le dernier. */
function damage(game: Game, p: Player, events: EngineEvent[], event: (hp: number) => EngineEvent, amount = 1): void {
  p.hp = Math.max(0, p.hp - amount);
  events.push(event(p.hp));
  if (p.hp <= 0) {
    p.alive = false;
    p.dir = 0;
    p.outTick = game.tick;
    events.push({ type: "eliminated", player: p.id });
  }
}

function applyFill(game: Game, fill: FillRequest, events: EngineEvent[]): void {
  const p = alivePlayer(game, fill.player);
  if (p === undefined) return;
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
    // Un chiffre juste rend tous les PV (00-Game §1).
    p.hp = START_HP;
    events.push({ type: "filled", cell: fill.cell, digit: fill.digit, player: p.id, hp: p.hp });
    return;
  }
  // Chiffre faux (00-Game §1) : il ne reste qu'un PV ; s'il n'en restait qu'un, il est perdu.
  const loss = p.hp > 1 ? p.hp - 1 : 1;
  damage(game, p, events, (hp) => ({ type: "refused", cell: fill.cell, digit: fill.digit, player: p.id, hp }), loss);
}

/** Pose : case remplie par ce joueur, sans piège, bonhomme dessus (même tolérance qu'un remplissage). */
function applyPlace(game: Game, place: PlaceRequest, events: EngineEvent[]): void {
  const p = alivePlayer(game, place.player);
  if (p === undefined) return;
  if (!Number.isInteger(place.cell) || place.cell < 0 || place.cell > 80) return;
  if (place.kind !== "mine" && place.kind !== "turret") return;
  if (game.owner[place.cell] !== p.id || game.traps.some((t) => t.cell === place.cell) || !near(p, place.cell)) {
    events.push({ type: "not_placed", cell: place.cell, player: p.id });
    return;
  }
  game.traps.push({
    cell: place.cell,
    kind: place.kind,
    owner: p.id,
    placed: game.tick,
    nextBall: place.kind === "turret" ? game.tick + TURRET_FIRST_TICKS : 0,
  });
  events.push({ type: "placed", cell: place.cell, kind: place.kind, player: p.id });
}

function launched(ball: Ball, tick: number): boolean {
  return ball.launch <= tick && (ball.dx !== 0 || ball.dy !== 0);
}

function removeBall(game: Game, ball: Ball): void {
  const i = game.balls.indexOf(ball);
  if (i >= 0) game.balls.splice(i, 1);
}

/** Contact signalé par le client : la boule existe, est partie, et n'est pas de ce joueur. */
function applyHit(game: Game, hit: HitRequest, events: EngineEvent[]): void {
  const p = alivePlayer(game, hit.player);
  const ball = game.balls.find((b) => b.id === hit.ball);
  if (p === undefined || ball === undefined || ball.owner === p.id || !launched(ball, game.tick)) return;
  removeBall(game, ball);
  damage(game, p, events, (hp) => ({ type: "ball_hit", ball: ball.id, player: p.id, hp }));
}

/** Le bonhomme adverse non éliminé le plus proche de (x, y) ; à égalité, le premier dans l'ordre des joueurs. */
function nearestAdversary(game: Game, owner: number, x: number, y: number): Player | null {
  let best: Player | null = null;
  let bestD = Infinity;
  for (const p of game.players) {
    if (!p.alive || p.id === owner) continue;
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/**
 * Départs : une boule dont c'est le tick part vers l'adversaire le plus proche à cet instant (direction
 * fixée au départ, 03-Pieges §3) ; sans adversaire, elle disparaît. Apparitions : une tourelle dont c'est
 * le tick fait apparaître une boule, s'il y a un adversaire.
 */
function stepTurrets(game: Game, events: EngineEvent[]): void {
  for (const ball of game.balls.slice()) {
    if (ball.launch !== game.tick) continue;
    const [cx, cy] = cellCenter(ball.cell);
    const target = nearestAdversary(game, ball.owner, cx, cy);
    if (target === null) {
      removeBall(game, ball);
      events.push({ type: "ball_gone", ball: ball.id });
      continue;
    }
    [ball.dx, ball.dy] = directionPerMille(target.x - cx, target.y - cy);
    events.push({ type: "launched", ball: ball.id, dx: ball.dx, dy: ball.dy });
  }
  for (const trap of game.traps) {
    if (trap.kind !== "turret" || trap.nextBall !== game.tick) continue;
    trap.nextBall = game.tick + TURRET_INTERVAL_TICKS;
    const [cx, cy] = cellCenter(trap.cell);
    if (nearestAdversary(game, trap.owner, cx, cy) === null) continue;
    const ball: Ball = { id: ++game.lastBall, cell: trap.cell, owner: trap.owner, launch: game.tick + BALL_CHARGE_TICKS, dx: 0, dy: 0 };
    game.balls.push(ball);
    events.push({ type: "ball", ball: ball.id, cell: ball.cell, player: ball.owner, launch: ball.launch });
  }
}

/**
 * Boules parties : sortie de la grille (disparition, sans événement : chaque client la calcule), et
 * contrôle de l'hôte, qui compte un contact évident même si le client ne l'a pas signalé.
 */
function controlBalls(game: Game, events: EngineEvent[]): void {
  const reach = BALL_CONTACT - HIT_CONTROL_MARGIN;
  for (const ball of game.balls.slice()) {
    if (!launched(ball, game.tick)) continue;
    const [x, y] = ballAt(ball.cell, ball.dx, ball.dy, ball.launch, game.tick);
    if (ballOut(x, y)) {
      removeBall(game, ball);
      continue;
    }
    for (const p of game.players) {
      if (!p.alive || p.id === ball.owner || !within(x, y, p.x, p.y, reach)) continue;
      removeBall(game, ball);
      damage(game, p, events, (hp) => ({ type: "ball_hit", ball: ball.id, player: p.id, hp }));
      break;
    }
  }
}

/**
 * Mines : un bonhomme adverse dont le centre entre dans la case la fait exploser (03-Pieges §2), mais
 * seulement quand le cadre de la pose a atteint la case (MINE_ARM_TICKS). Elle enlève MINE_DAMAGE PV. Elle
 * ne disparaît pas : elle se recharge pendant MINE_REST_TICKS (sa pose est reportée d'autant), puis sa
 * pose se rejoue.
 */
function stepMines(game: Game, events: EngineEvent[]): void {
  for (const p of game.players) {
    if (!p.alive) continue;
    const cell = cellAt(p.x, p.y);
    const mine = game.traps.find(
      (t) => t.kind === "mine" && t.cell === cell && t.owner !== p.id && game.tick >= t.placed + MINE_ARM_TICKS,
    );
    if (mine === undefined) continue;
    mine.placed = game.tick + MINE_REST_TICKS;
    damage(game, p, events, (hp) => ({ type: "exploded", cell, player: p.id, hp }), MINE_DAMAGE);
  }
}

/** Le bonhomme est sur la case, ou à moins de FILL_TOLERANCE de ses bords. */
function near(p: Player, cell: number): boolean {
  const x0 = (cell % 9) * CELL;
  const y0 = Math.floor(cell / 9) * CELL;
  return p.x >= x0 - FILL_TOLERANCE && p.x < x0 + CELL + FILL_TOLERANCE && p.y >= y0 - FILL_TOLERANCE && p.y < y0 + CELL + FILL_TOLERANCE;
}

/**
 * Le classement si la partie est finie, sinon `null` (00-Game §1, Fin de partie). Finie : grille pleine, ou
 * il ne reste qu'un bonhomme (aucun en solo). D'abord les survivants, au nombre de cases remplies ; puis les
 * éliminés, du dernier éliminé au premier. Provisoire : à égalité de cases, ou pour deux éliminations du
 * même tick, celui qui a rempli le plus de cases, puis l'ordre des joueurs (`sort` est stable).
 */
function finalRanking(game: Game): RankEntry[] | null {
  const alive = game.players.filter((p) => p.alive).length;
  const full = !game.owner.includes(0);
  const solo = game.players.length === 1;
  if (!full && !(solo ? alive === 0 : alive <= 1)) return null;
  const survivors = game.players.filter((p) => p.alive).sort((a, b) => b.score - a.score);
  const out = game.players.filter((p) => !p.alive).sort((a, b) => b.outTick - a.outTick || b.score - a.score);
  return survivors.concat(out).map((p) => ({ player: p.id, score: p.score, alive: p.alive }));
}
