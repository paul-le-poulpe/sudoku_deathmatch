// Trajectoire d'une boule de tourelle (03-Pieges §3). Utilisée par l'hôte (contrôle des contacts) et par
// le client (dessin, détection du contact avec son bonhomme, 01-Architecture §3, Pièges et projectiles) :
// tout ce qui fixe la trajectoire est dans les événements `ball` et `launched`, et le calcul est en
// entiers pour un tick entier.

import { BALL_RADIUS, BALL_SPEED, CELL, GRID } from "./config.ts";

/** Centre de la case `cell`, en unités. */
export function cellCenter(cell: number): [number, number] {
  return [(cell % 9) * CELL + CELL / 2, Math.floor(cell / 9) * CELL + CELL / 2];
}

/**
 * Position au tick `tick` d'une boule tirée par la tourelle de la case `cell`, partie au tick `launch` dans
 * la direction (`dx`, `dy`) en millièmes. Avant le départ : le centre de la tourelle. Un `tick` fractionnaire
 * (affichage entre deux ticks) donne une position intermédiaire.
 */
export function ballAt(cell: number, dx: number, dy: number, launch: number, tick: number): [number, number] {
  const [cx, cy] = cellCenter(cell);
  const t = tick > launch ? tick - launch : 0;
  return [cx + Math.trunc((dx * BALL_SPEED * t) / 1000), cy + Math.trunc((dy * BALL_SPEED * t) / 1000)];
}

/** La boule est entièrement sortie de la grille : elle disparaît. */
export function ballOut(x: number, y: number): boolean {
  return x < -BALL_RADIUS || x > GRID + BALL_RADIUS || y < -BALL_RADIUS || y > GRID + BALL_RADIUS;
}

/** Les points (ax, ay) et (bx, by) sont à moins de `reach` l'un de l'autre. */
export function within(ax: number, ay: number, bx: number, by: number, reach: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy < reach * reach;
}

/**
 * Direction de (vx, vy) en millièmes, arrondie vers zéro. Calculée par l'hôte seul, puis envoyée : le client
 * ne la recalcule jamais. Vecteur nul : vers le bas.
 */
export function directionPerMille(vx: number, vy: number): [number, number] {
  const len = Math.floor(Math.sqrt(vx * vx + vy * vy));
  if (len === 0) return [0, 1000];
  return [Math.trunc((vx * 1000) / len), Math.trunc((vy * 1000) / len)];
}
