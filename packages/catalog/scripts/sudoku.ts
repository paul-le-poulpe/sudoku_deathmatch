// Génération et notation des grilles, pour le script du catalogue (Docs/Design/02-Grilles.md §1 et §3).
// Ce code ne tourne qu'en développement : il n'est importé ni par l'hôte ni par le client.

export type Level = "facile" | "moyen" | "difficile";

export interface Grid {
  readonly level: Level;
  /** 81 chiffres, ligne par ligne, 0 pour une case vide. */
  readonly puzzle: number[];
  readonly solution: number[];
  readonly clues: number;
}

/** Générateur seedé (mulberry32) : le même `seed` redonne le même catalogue. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(a: T[], rnd: () => number): T[] {
  for (let k = a.length - 1; k > 0; k--) {
    const j = Math.floor(rnd() * (k + 1));
    [a[k], a[j]] = [a[j]!, a[k]!];
  }
  return a;
}

// ---- cases, unités, voisines ----

const ROWS: number[][] = [];
const COLS: number[][] = [];
const BOXES: number[][] = [];
for (let k = 0; k < 9; k++) {
  ROWS.push(Array.from({ length: 9 }, (_, c) => k * 9 + c));
  COLS.push(Array.from({ length: 9 }, (_, r) => r * 9 + k));
  const br = Math.floor(k / 3) * 3, bc = (k % 3) * 3;
  BOXES.push(Array.from({ length: 9 }, (_, j) => (br + Math.floor(j / 3)) * 9 + bc + (j % 3)));
}
const UNITS = [...ROWS, ...COLS, ...BOXES];
const ROW_OF = (i: number) => Math.floor(i / 9);
const COL_OF = (i: number) => i % 9;
const BOX_OF = (i: number) => Math.floor(ROW_OF(i) / 3) * 3 + Math.floor(COL_OF(i) / 3);
const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const set = new Set([...ROWS[ROW_OF(i)]!, ...COLS[COL_OF(i)]!, ...BOXES[BOX_OF(i)]!]);
  set.delete(i);
  return [...set];
});

const ALL = 0x3fe; // bits 1 à 9

function bits(m: number): number {
  let n = 0;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
}

function lowestDigit(m: number): number {
  for (let d = 1; d <= 9; d++) if (m & (1 << d)) return d;
  return 0;
}

/** Chiffres encore possibles dans la case `i` : un bit par chiffre. */
function candidates(g: readonly number[], i: number): number {
  let used = 0;
  for (const p of PEERS[i]!) used |= 1 << g[p]!;
  return ALL & ~used;
}

// ---- solution complète ----

/** Remplit `g` au hasard, case la plus contrainte d'abord, avec retour en arrière. */
function fill(g: number[], rnd: () => number): boolean {
  let best = -1, bestMask = 0, bestCount = 10;
  for (let i = 0; i < 81; i++) {
    if (g[i] !== 0) continue;
    const m = candidates(g, i), n = bits(m);
    if (n === 0) return false;
    if (n < bestCount) {
      best = i;
      bestMask = m;
      bestCount = n;
    }
  }
  if (best < 0) return true;
  const digits: number[] = [];
  for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
  for (const d of shuffle(digits, rnd)) {
    g[best] = d;
    if (fill(g, rnd)) return true;
  }
  g[best] = 0;
  return false;
}

export function randomSolution(rnd: () => number): number[] {
  const g = new Array<number>(81).fill(0);
  if (!fill(g, rnd)) throw new Error("grille impossible à remplir");
  return g;
}

// ---- résolution par techniques (02-Grilles §3) ----

/** 1 : singletons nus et cachés. 2 : en plus, candidats verrouillés (pointage, réclamation), paires nues et cachées. */
export type Technique = 1 | 2;

/**
 * Résout `puzzle` en n'utilisant que des déductions jusqu'au niveau `max`. Renvoie `solved` et le niveau le
 * plus fin qui a servi. Une grille résolue ainsi n'a qu'une solution.
 */
export function solveLogically(puzzle: readonly number[], max: Technique): { solved: boolean; hardest: Technique } {
  const g = puzzle.slice();
  const cand = new Array<number>(81).fill(0);
  for (let i = 0; i < 81; i++) if (g[i] === 0) cand[i] = candidates(g, i);
  let hardest: Technique = 1;

  const place = (i: number, d: number): void => {
    g[i] = d;
    cand[i] = 0;
    for (const p of PEERS[i]!) cand[p] &=~(1 << d);
  };

  for (;;) {
    let empty = 0;
    let progress = false;
    // Singletons nus.
    for (let i = 0; i < 81; i++) {
      if (g[i] !== 0) continue;
      empty++;
      if (cand[i] === 0) return { solved: false, hardest };
      if (bits(cand[i]!) === 1) {
        place(i, lowestDigit(cand[i]!));
        progress = true;
      }
    }
    if (empty === 0) return { solved: true, hardest };
    if (progress) continue;
    // Singletons cachés.
    for (const unit of UNITS) {
      for (let d = 1; d <= 9 && !progress; d++) {
        if (unit.some((i) => g[i] === d)) continue;
        const where = unit.filter((i) => g[i] === 0 && cand[i]! & (1 << d));
        if (where.length === 1) {
          place(where[0]!, d);
          progress = true;
        }
      }
      if (progress) break;
    }
    if (progress) continue;
    if (max < 2) return { solved: false, hardest };
    if (lockedCandidates(g, cand) || nakedPairs(g, cand) || hiddenPairs(g, cand)) {
      hardest = 2;
      continue;
    }
    return { solved: false, hardest };
  }
}

/** Pointage et réclamation : un chiffre confiné à une ligne (ou colonne) dans un carré, ou l'inverse. */
function lockedCandidates(g: readonly number[], cand: number[]): boolean {
  let changed = false;
  for (let d = 1; d <= 9; d++) {
    const bit = 1 << d;
    const has = (i: number) => g[i] === 0 && (cand[i]! & bit) !== 0;
    for (const box of BOXES) {
      const where = box.filter(has);
      if (where.length < 2) continue;
      for (const lines of [ROWS, COLS]) {
        const lineOf = lines === ROWS ? ROW_OF : COL_OF;
        const line = lineOf(where[0]!);
        if (!where.every((i) => lineOf(i) === line)) continue;
        for (const i of lines[line]!) {
          if (!box.includes(i) && has(i)) {
            cand[i] &=~bit;
            changed = true;
          }
        }
      }
    }
    for (const line of [...ROWS, ...COLS]) {
      const where = line.filter(has);
      if (where.length < 2) continue;
      const box = BOX_OF(where[0]!);
      if (!where.every((i) => BOX_OF(i) === box)) continue;
      for (const i of BOXES[box]!) {
        if (!line.includes(i) && has(i)) {
          cand[i] &=~bit;
          changed = true;
        }
      }
    }
  }
  return changed;
}

/** Deux cases d'une unité qui n'ont que les deux mêmes candidats : ces chiffres sortent des autres cases. */
function nakedPairs(g: readonly number[], cand: number[]): boolean {
  let changed = false;
  for (const unit of UNITS) {
    const pairs = unit.filter((i) => g[i] === 0 && bits(cand[i]!) === 2);
    for (let a = 0; a < pairs.length; a++) {
      for (let b = a + 1; b < pairs.length; b++) {
        const m = cand[pairs[a]!]!;
        if (cand[pairs[b]!] !== m) continue;
        for (const i of unit) {
          if (i === pairs[a] || i === pairs[b] || g[i] !== 0) continue;
          if (cand[i]! & m) {
            cand[i] &=~m;
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

/** Deux chiffres qui n'ont que les deux mêmes cases dans une unité : ces cases perdent leurs autres candidats. */
function hiddenPairs(g: readonly number[], cand: number[]): boolean {
  let changed = false;
  for (const unit of UNITS) {
    const placesOf: number[][] = [];
    for (let d = 1; d <= 9; d++) placesOf[d] = unit.filter((i) => g[i] === 0 && cand[i]! & (1 << d));
    for (let d1 = 1; d1 <= 9; d1++) {
      for (let d2 = d1 + 1; d2 <= 9; d2++) {
        const p1 = placesOf[d1]!, p2 = placesOf[d2]!;
        if (p1.length !== 2 || p2.length !== 2 || p1[0] !== p2[0] || p1[1] !== p2[1]) continue;
        const keep = (1 << d1) | (1 << d2);
        for (const i of p1) {
          if (cand[i]! & ~keep) {
            cand[i] &=keep;
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}

// ---- grilles d'un niveau ----

/**
 * Niveaux provisoires (02-Grilles §3) :
 * - facile : singletons seulement, au moins 36 chiffres donnés ;
 * - moyen : singletons seulement, le moins de chiffres donnés possible ;
 * - difficile : les singletons ne suffisent pas, les techniques de niveau 2 si.
 */
const MIN_CLUES: Readonly<Record<Level, number>> = { facile: 36, moyen: 0, difficile: 0 };

/** Une grille du niveau demandé. On retire les chiffres par paires symétriques tant que la grille reste résoluble au niveau voulu. */
export function makeGrid(level: Level, rnd: () => number): Grid {
  const max: Technique = level === "difficile" ? 2 : 1;
  for (let attempt = 0; attempt < 500; attempt++) {
    const solution = randomSolution(rnd);
    const g = solution.slice();
    const order = shuffle(Array.from({ length: 41 }, (_, i) => i), rnd);
    let clues = 81;
    for (const i of order) {
      const j = 80 - i;
      const n = i === j ? 1 : 2;
      if (clues - n < MIN_CLUES[level]) continue;
      const a = g[i]!, b = g[j]!;
      g[i] = 0;
      g[j] = 0;
      if (solveLogically(g, max).solved) clues -= n;
      else {
        g[i] = a;
        g[j] = b;
      }
    }
    if (level === "difficile" && solveLogically(g, 1).solved) continue;
    return { level, puzzle: g, solution, clues };
  }
  throw new Error(`aucune grille ${level} trouvée en 500 essais`);
}
