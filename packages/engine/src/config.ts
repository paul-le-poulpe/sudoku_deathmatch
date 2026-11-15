// Réglages du moteur. Valeurs provisoires (01-Architecture §3, 00-Game §3), à régler en jouant,
// sauf START_HP (00-Game §1). Importés à la compilation : jamais lus d'un fichier au lancement.

/** Une case fait CELL unités de côté ; la grille 9 × 9 fait GRID unités. */
export const CELL = 1000;
export const GRID = 9 * CELL;

/** Déplacement par tick, en unités : 150 à 20 ticks par seconde = 3 cases par seconde. Provisoire. */
export const SPEED = 150;
/** Facteur de la vitesse en diagonale, en millièmes (≈ 1/√2). Entier : `move` ne calcule qu'en entiers. */
export const DIAGONAL_PER_MILLE = 707;

/** Le centre d'un bonhomme reste à au moins cette distance du bord de la grille. Provisoire. */
export const BODY_MARGIN = 150;

/**
 * Un remplissage est accepté si le bonhomme est sur la case ou à moins de cette distance de ses bords :
 * la position prédite du client peut avoir un peu d'avance sur celle de l'hôte. Provisoire.
 */
export const FILL_TOLERANCE = 200;

/** Points de vie au départ (00-Game §1). */
export const START_HP = 3;

/** Positions de départ, dans l'ordre des joueurs : les quatre coins. Provisoire. */
export const SPAWNS: readonly (readonly [number, number])[] = [
  [CELL / 2, CELL / 2],
  [GRID - CELL / 2, GRID - CELL / 2],
  [GRID - CELL / 2, CELL / 2],
  [CELL / 2, GRID - CELL / 2],
];
