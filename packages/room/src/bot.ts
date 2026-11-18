// Les bots (Docs/Design/04-Bots.md) : des bonshommes joués par l'hôte. À chaque tick, `Match` demande à
// chaque bot ce qu'il envoie, comme le ferait le client d'un joueur : une direction, un remplissage, une
// pose, et les boules qui touchent son bonhomme ou sa bulle (01-Architecture §3, Bots). Le moteur les
// traite comme les entrées des joueurs. Pas d'horloge ni de `Math.random` (CLAUDE.md, règle 2) : le temps
// est le numéro de tick, le hasard un générateur seedé.

import {
  BALL_CONTACT,
  BUBBLE_CONTACT,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  DIR_UP,
  SPEED,
  TRAP_CELLS,
  activeShield,
  ballAt,
  cellAt,
  cellCenter,
  move,
  within,
  type Ball,
  type Game,
  type Player,
  type TrapKind,
} from "@sudoku-deathmatch/engine";
import { TICK_MS, type BotLevel } from "@sudoku-deathmatch/shared";

/** Secondes entre deux décisions d'un bot (une case à remplir), par difficulté (décidé, 04-Bots §2). */
export const BOT_FILL_SECONDS: Readonly<Record<BotLevel, number>> = { facile: 30, normal: 20, difficile: 10 };
/**
 * Entre deux chiffres, le bot va vers une case tirée au hasard à intervalles réguliers (décidé, 04-Bots
 * §2) : toutes les 3 s (provisoire).
 */
export const BOT_ROAM_SECONDS = 3;
/** À ce nombre de PV ou moins, le bot évite les mines adverses (décidé : un seul PV, 04-Bots §2). */
export const BOT_MINE_CAUTION_HP = 1;
/** Le bot s'écarte d'une boule à moins de cette distance devant lui (2,5 cases, provisoire)… */
export const BOT_SIGHT = 2500;
/** … et dont la trajectoire passe à moins de cette distance de son centre (0,55 case, provisoire). */
export const BOT_DODGE_WIDTH = 550;
/** Ordre dans lequel le bot pose ses pièges quand plusieurs sont disponibles (décidé, 04-Bots §2). */
const TRAP_PRIORITY: readonly TrapKind[] = ["shield", "turret", "mine"];
/** tan(22,5°) : au-delà, la composante la plus faible d'un écart compte dans la direction (8 directions). */
const OCTANT = 0.414;

/** Ce qu'un bot envoie pour le tick suivant. */
export interface BotActions {
  readonly dir: number;
  readonly fill: { readonly cell: number; readonly digit: number } | null;
  readonly place: { readonly cell: number; readonly kind: TrapKind } | null;
  /** Boules qui touchent son bonhomme (comme `hit`), ou sa bulle (comme `block`). */
  readonly hits: readonly number[];
  readonly blocks: readonly number[];
}

export class Bot {
  readonly id: number;
  readonly level: BotLevel;
  readonly #rnd: () => number;
  readonly #period: number;
  /** Tick de la prochaine décision. */
  #next: number;
  /** Case vide visée, ou -1. */
  #target = -1;
  /** Case visée prise par un autre, ou plus atteignable : il en choisit une autre sans attendre. */
  #retarget = false;
  /** Case qu'il vient de remplir, où poser un piège ; -1 sinon. */
  #trapCell = -1;
  readonly #roamPeriod: number;
  /** Tick où il choisit la prochaine case où se promener. */
  #nextRoam: number;
  /** Case où il se promène quand il n'a pas de case à remplir, ou -1. */
  #roam = -1;

  constructor(id: number, level: BotLevel, rnd: () => number) {
    this.id = id;
    this.level = level;
    this.#rnd = rnd;
    this.#period = Math.round((BOT_FILL_SECONDS[level] * 1000) / TICK_MS);
    this.#roamPeriod = Math.round((BOT_ROAM_SECONDS * 1000) / TICK_MS);
    // Premières décisions à un instant tiré dans la première période (provisoire).
    this.#next = 1 + Math.floor(rnd() * this.#period);
    this.#nextRoam = 1 + Math.floor(rnd() * this.#roamPeriod);
  }

  /** Ce que le bot envoie, d'après l'état de la partie après le tick `game.tick` ; `null` s'il est éliminé. */
  think(game: Game): BotActions | null {
    const me = game.players.find((p) => p.id === this.id);
    if (me === undefined || !me.alive) return null;
    const tick = game.tick;
    const { hits, blocks } = contacts(game, me, tick);

    // Piège sur la case qu'il vient de remplir, au tick qui suit le chiffre accepté.
    let place: BotActions["place"] = null;
    if (this.#trapCell >= 0) {
      const cell = this.#trapCell;
      if (game.owner[cell] === me.id) {
        this.#trapCell = -1;
        if (!game.traps.some((t) => t.cell === cell)) place = { cell, kind: bestTrap(game, me) };
      } else if (game.owner[cell] !== 0) {
        // Un autre l'a remplie au même tick : le bot n'a pas eu son chiffre, il vise une autre case.
        this.#trapCell = -1;
        this.#retarget = true;
      }
    }

    // À 1 PV : les mines adverses sont des obstacles.
    const mines = me.hp <= BOT_MINE_CAUTION_HP ? enemyMines(game, me.id) : null;

    if (this.#target >= 0 && game.owner[this.#target] !== 0) {
      this.#target = -1;
      this.#retarget = true;
    }
    if (this.#target < 0 && (this.#retarget || tick >= this.#next)) {
      if (!this.#retarget) this.#next = tick + this.#period;
      this.#retarget = false;
      this.#trapCell = -1;
      this.#target = this.#pick(me, mines, (c) => game.owner[c] === 0);
    }

    let fill: BotActions["fill"] = null;
    let dir = 0;
    if (this.#target >= 0) {
      // Une case à remplir passe avant la promenade.
      this.#roam = -1;
      const target = this.#target;
      if (cellAt(me.x, me.y) === target) {
        fill = { cell: target, digit: game.solution[target]! };
        this.#trapCell = target;
        this.#target = -1;
      } else {
        const d = this.#walk(me, target, mines);
        if (d < 0) {
          this.#target = -1;
          this.#retarget = true;
        } else {
          dir = d;
        }
      }
    } else {
      // Promenade : toutes les BOT_ROAM_SECONDS, une case tirée au hasard, sauf pendant la pose d'un piège.
      if (this.#trapCell < 0 && tick >= this.#nextRoam) {
        this.#nextRoam = tick + this.#roamPeriod;
        const here = cellAt(me.x, me.y);
        this.#roam = this.#pick(me, mines, (c) => c !== here);
      }
      if (this.#roam >= 0) {
        const d = this.#walk(me, this.#roam, mines);
        // 0 : arrivé au centre de la case ; -1 : plus atteignable.
        if (d <= 0) this.#roam = -1;
        else dir = d;
      }
    }

    const dodge = dodgeDirs(game, me, tick);
    if (dodge !== null) {
      dir = safe(me, dodge[0], mines) ? dodge[0] : safe(me, dodge[1], mines) ? dodge[1] : 0;
    } else if (!safe(me, dir, mines)) {
      dir = 0;
    }
    return { dir, fill, place, hits, blocks };
  }

  /**
   * Une case tirée au hasard parmi celles qu'accepte `accept` ; à 1 PV, parmi celles qu'il atteint sans
   * passer par une mine adverse. -1 s'il n'y en a aucune.
   */
  #pick(me: Player, mines: ReadonlySet<number> | null, accept: (cell: number) => boolean): number {
    const reach = mines === null ? null : distances(cellAt(me.x, me.y), mines);
    const cells: number[] = [];
    for (let c = 0; c < 81; c++) if (accept(c) && (reach === null || reach[c]! >= 0)) cells.push(c);
    if (cells.length === 0) return -1;
    return cells[Math.floor(this.#rnd() * cells.length)]!;
  }

  /**
   * Direction vers la case `goal` : tout droit vers son centre ; à 1 PV, vers le centre de la case voisine
   * (haut, bas, gauche, droite) du plus court chemin qui évite les mines adverses. Depuis une case, aller au
   * centre d'une case voisine ne traverse que ces deux cases. 0 au centre de `goal` ; -1 si `goal` n'est
   * plus atteignable à 1 PV.
   */
  #walk(me: Player, goal: number, mines: ReadonlySet<number> | null): number {
    const here = cellAt(me.x, me.y);
    let cell = goal;
    if (mines !== null && here !== goal) {
      if (mines.has(goal)) return -1;
      const dist = distances(goal, mines);
      cell = -1;
      let best = Infinity;
      for (const n of neighbours(here)) {
        const d = dist[n]!;
        if (d >= 0 && d < best) {
          best = d;
          cell = n;
        }
      }
      if (cell < 0) return -1;
    }
    const [x, y] = cellCenter(cell);
    return toward(me.x, me.y, x, y);
  }
}

function launched(ball: Ball, tick: number): boolean {
  return ball.launch <= tick && (ball.dx !== 0 || ball.dy !== 0);
}

/**
 * Boules adverses au contact, à la position exacte du bot : sa bulle si un de ses boucliers le protège,
 * sinon son bonhomme. Sans ce signalement, seul le contrôle de l'hôte, avec sa marge, le toucherait.
 */
function contacts(game: Game, me: Player, tick: number): { hits: number[]; blocks: number[] } {
  const hits: number[] = [];
  const blocks: number[] = [];
  const shields = game.traps.filter((t) => t.kind === "shield");
  const protectedBy = shields.length > 0 ? activeShield(shields, me.id, me.x, me.y, tick) : null;
  for (const ball of game.balls) {
    if (ball.owner === me.id || !launched(ball, tick)) continue;
    const [x, y] = ballAt(ball.cell, ball.dx, ball.dy, ball.launch, tick);
    if (protectedBy !== null) {
      if (within(x, y, me.x, me.y, BUBBLE_CONTACT)) blocks.push(ball.id);
    } else if (within(x, y, me.x, me.y, BALL_CONTACT)) {
      hits.push(ball.id);
    }
  }
  return { hits, blocks };
}

/** Le premier piège disponible dans l'ordre bouclier, tourelle, mine (la mine l'est toujours). */
function bestTrap(game: Game, me: Player): TrapKind {
  for (const kind of TRAP_PRIORITY) {
    const per = TRAP_CELLS[kind];
    if (per === 0) return kind;
    const same = game.traps.filter((t) => t.kind === kind && t.owner === me.id).length;
    if (per * (same + 1) <= me.score) return kind;
  }
  return "mine";
}

function enemyMines(game: Game, me: number): Set<number> {
  return new Set(game.traps.filter((t) => t.kind === "mine" && t.owner !== me).map((t) => t.cell));
}

function neighbours(cell: number): number[] {
  const row = Math.floor(cell / 9);
  const col = cell % 9;
  const out: number[] = [];
  if (row > 0) out.push(cell - 9);
  if (row < 8) out.push(cell + 9);
  if (col > 0) out.push(cell - 1);
  if (col < 8) out.push(cell + 1);
  return out;
}

/** Distance en cases depuis `from`, par voisins sans mine adverse ; -1 pour une case qu'on n'atteint pas. */
function distances(from: number, mines: ReadonlySet<number>): Int8Array {
  const dist = new Int8Array(81).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let k = 0; k < queue.length; k++) {
    const c = queue[k]!;
    for (const n of neighbours(c)) {
      if (dist[n] !== -1 || mines.has(n)) continue;
      dist[n] = dist[c]! + 1;
      queue.push(n);
    }
  }
  return dist;
}

/** Direction vers (tx, ty) ; un axe à moins d'un demi-pas compte comme atteint. */
function toward(x: number, y: number, tx: number, ty: number): number {
  const half = SPEED / 2;
  let dir = 0;
  if (tx - x > half) dir |= DIR_RIGHT;
  else if (x - tx > half) dir |= DIR_LEFT;
  if (ty - y > half) dir |= DIR_DOWN;
  else if (y - ty > half) dir |= DIR_UP;
  return dir;
}

/** La direction parmi 8 la plus proche du vecteur (vx, vy). */
function octant(vx: number, vy: number): number {
  const t = Math.max(Math.abs(vx), Math.abs(vy)) * OCTANT;
  let dir = 0;
  if (vx > t) dir |= DIR_RIGHT;
  else if (vx < -t) dir |= DIR_LEFT;
  if (vy > t) dir |= DIR_DOWN;
  else if (vy < -t) dir |= DIR_UP;
  return dir;
}

/**
 * Écart devant les boules adverses parties qui viennent vers lui (moins de BOT_SIGHT devant, trajectoire à
 * moins de BOT_DODGE_WIDTH) : la perpendiculaire à chaque trajectoire, du côté où il est déjà (côté fixé par
 * la parité de la boule s'il est pile dessus), sommée sur toutes ; plusieurs boules peuvent s'annuler.
 * Renvoie la direction et son opposée, la seconde en premier si un bord de la grille bloque la première ;
 * `null` sans écart.
 */
function dodgeDirs(game: Game, me: Player, tick: number): [number, number] | null {
  let ax = 0;
  let ay = 0;
  for (const ball of game.balls) {
    if (ball.owner === me.id || !launched(ball, tick)) continue;
    const [bx, by] = ballAt(ball.cell, ball.dx, ball.dy, ball.launch, tick);
    const rx = me.x - bx;
    const ry = me.y - by;
    // (dx, dy) est en millièmes : `ahead` et `side` sont en unités.
    const ahead = (rx * ball.dx + ry * ball.dy) / 1000;
    if (ahead < -BALL_CONTACT || ahead > BOT_SIGHT) continue;
    const side = (rx * ball.dy - ry * ball.dx) / 1000;
    if (Math.abs(side) >= BOT_DODGE_WIDTH) continue;
    // Normale (dy, −dx) : s'y déplacer augmente `side`.
    const s = side > 0 || (side === 0 && ball.id % 2 === 0) ? 1 : -1;
    ax += s * ball.dy;
    ay -= s * ball.dx;
  }
  if (ax === 0 && ay === 0) return null;
  const there = octant(ax, ay);
  const back = octant(-ax, -ay);
  const [nx, ny] = move(me.x, me.y, there);
  return (nx - me.x) * ax + (ny - me.y) * ay > 0 ? [there, back] : [back, there];
}

/** À 1 PV (`mines` non nul), le pas suivant dans `dir` n'entre pas dans une case minée par un adversaire. */
function safe(me: Player, dir: number, mines: ReadonlySet<number> | null): boolean {
  if (mines === null || dir === 0) return true;
  const [x, y] = move(me.x, me.y, dir);
  const cell = cellAt(x, y);
  return cell === cellAt(me.x, me.y) || !mines.has(cell);
}
