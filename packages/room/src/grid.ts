// Choix et transformation de la grille au lancement (Docs/Design/02-Grilles.md §1 et §2).
// Le hasard vient d'une graine donnée par l'enveloppe (CLAUDE.md, règle 2).

import type { Level } from "@sudoku-deathmatch/shared";

/** Une grille d'un catalogue : 81 chiffres ligne par ligne, `0` pour une case vide de `puzzle`. */
export interface CatalogGrid {
  readonly level: Level;
  readonly puzzle: string;
  readonly solution: string;
}

export type Catalog = readonly CatalogGrid[];

export interface PickedGrid {
  readonly puzzle: number[];
  readonly solution: number[];
}

/** Générateur seedé (mulberry32). */
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

function permutation(n: number, rnd: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let k = n - 1; k > 0; k--) {
    const j = Math.floor(rnd() * (k + 1));
    [a[k], a[j]] = [a[j]!, a[k]!];
  }
  return a;
}

/**
 * Ordre des 9 lignes (ou colonnes) : les bandes dans un ordre tiré, et dans chaque bande ses trois lignes
 * dans un ordre tiré. Une ligne ne change jamais de bande : les carrés restent des carrés (02-Grilles §5).
 */
function lineOrder(rnd: () => number): number[] {
  const out: number[] = [];
  for (const band of permutation(3, rnd)) for (const k of permutation(3, rnd)) out.push(band * 3 + k);
  return out;
}

/**
 * Une grille du niveau demandé, tirée du catalogue puis transformée (02-Grilles §2) : chiffres permutés,
 * lignes et bandes réordonnées, colonnes et piles réordonnées, transposée une fois sur deux. La même
 * transformation s'applique à la grille et à sa solution.
 */
export function pickGrid(catalog: Catalog, level: Level, seed: number): PickedGrid {
  const rnd = makeRng(seed);
  const pool = catalog.filter((g) => g.level === level);
  const source = (pool.length > 0 ? pool : catalog)[Math.floor(rnd() * (pool.length > 0 ? pool.length : catalog.length))];
  if (source === undefined) throw new Error("catalogue vide");

  const digitMap = [0, ...permutation(9, rnd).map((d) => d + 1)];
  const rows = lineOrder(rnd);
  const cols = lineOrder(rnd);
  const transpose = rnd() < 0.5;

  const puzzle = new Array<number>(81);
  const solution = new Array<number>(81);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      let sr = rows[r]!, sc = cols[c]!;
      if (transpose) [sr, sc] = [sc, sr];
      const from = sr * 9 + sc;
      puzzle[r * 9 + c] = digitMap[Number(source.puzzle[from])]!;
      solution[r * 9 + c] = digitMap[Number(source.solution[from])]!;
    }
  }
  return { puzzle, solution };
}
