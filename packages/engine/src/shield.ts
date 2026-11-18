// Bouclier (03-Pieges §4) : charge et bouclier actif. Utilisé par l'hôte (boules arrêtées) et par le client
// (jauge, bulle, détection du contact de sa bulle) : tout se calcule à partir du tick où le bouclier est
// plein, `full`, envoyé à la pose (`placed`), à chaque boule arrêtée (`blocked`) et dans `state`.

import { cellCenter } from "./ball.ts";
import { SHIELD_FULL_TICKS, SHIELD_UNIT_TICKS, SHIELD_ZONE } from "./config.ts";

/** Un bouclier : sa case, son poseur, le tick où il est plein (dans le passé : il l'est). */
export interface ShieldLike {
  readonly cell: number;
  readonly owner: number;
  readonly full: number;
}

/**
 * Charge au tick `tick`, en ticks de recharge, de 0 à SHIELD_FULL_TICKS : elle remonte d'un par tick
 * jusqu'à `full`. Un `tick` fractionnaire (affichage) donne une charge fractionnaire.
 */
export function shieldCharge(full: number, tick: number): number {
  return Math.max(0, SHIELD_FULL_TICKS - Math.max(0, full - tick));
}

/** Nouveau `full` après une boule arrêtée au tick `tick` : une unité de moins, la recharge continue. */
export function spendShield(full: number, tick: number): number {
  const left = shieldCharge(full, tick) - SHIELD_UNIT_TICKS;
  return tick + SHIELD_FULL_TICKS - left;
}

/**
 * Le bouclier qui protège le bonhomme de `owner` en (x, y) au tick `tick`, ou `null` : un des siens dont le
 * centre de la case est à moins de SHIELD_ZONE (+ `margin`) et qui a encore au moins une unité. Plusieurs :
 * le plus proche ; à égalité, le premier de `shields` (l'ordre de pose). Décidé le 18 novembre 2026 ; « au
 * moins une unité » et l'égalité sont provisoires.
 */
export function activeShield<T extends ShieldLike>(
  shields: Iterable<T>,
  owner: number,
  x: number,
  y: number,
  tick: number,
  margin = 0,
): T | null {
  const reach = (SHIELD_ZONE + margin) * (SHIELD_ZONE + margin);
  let best: T | null = null;
  let bestD = Infinity;
  for (const s of shields) {
    if (s.owner !== owner || shieldCharge(s.full, tick) < SHIELD_UNIT_TICKS) continue;
    const [cx, cy] = cellCenter(s.cell);
    const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (d < reach && d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
