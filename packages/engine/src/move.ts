// Déplacement d'un bonhomme pendant un tick. Utilisé par l'hôte (`step`) et par la prédiction du
// client (01-Architecture §3) : il ne calcule qu'en entiers, pour donner exactement le même résultat
// sous Node, dans un Durable Object et dans chaque navigateur.

import { BODY_MARGIN, DIAGONAL_PER_MILLE, GRID, SPEED } from "./config.ts";

/** Bits d'une direction : plusieurs à la fois pour une diagonale. */
export const DIR_UP = 1;
export const DIR_DOWN = 2;
export const DIR_LEFT = 4;
export const DIR_RIGHT = 8;
export const DIR_MASK = 15;

const MIN = BODY_MARGIN;
const MAX = GRID - BODY_MARGIN;

/** Position après un tick dans la direction `dir`. Deux flèches opposées s'annulent. */
export function move(x: number, y: number, dir: number): [number, number] {
  const dx = (dir & DIR_RIGHT ? 1 : 0) - (dir & DIR_LEFT ? 1 : 0);
  const dy = (dir & DIR_DOWN ? 1 : 0) - (dir & DIR_UP ? 1 : 0);
  if (dx === 0 && dy === 0) return [x, y];
  const step = dx !== 0 && dy !== 0 ? Math.trunc((SPEED * DIAGONAL_PER_MILLE) / 1000) : SPEED;
  return [clamp(x + dx * step), clamp(y + dy * step)];
}

function clamp(v: number): number {
  return v < MIN ? MIN : v > MAX ? MAX : v;
}

/** Case (0 à 80, ligne par ligne) qui contient le point (x, y). */
export function cellAt(x: number, y: number): number {
  const col = Math.min(8, Math.max(0, Math.floor(x / (GRID / 9))));
  const row = Math.min(8, Math.max(0, Math.floor(y / (GRID / 9))));
  return row * 9 + col;
}
