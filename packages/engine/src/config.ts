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

// ---- pièges (03-Pieges, valeurs provisoires) ----

/** Rayon de contact d'un bonhomme avec une boule : 0,2 case. */
export const BODY_RADIUS = 200;
/** Boule : déplacement par tick (75 à 20 ticks par seconde = 1,5 case par seconde), rayon (diamètre 0,3 case). */
export const BALL_SPEED = 75;
export const BALL_RADIUS = 150;
/** Distance entre les centres d'une boule et d'un bonhomme en dessous de laquelle ils se touchent. */
export const BALL_CONTACT = BALL_RADIUS + BODY_RADIUS;
/** Tourelle : première boule 1 s après la pose, puis une toutes les 3 s ; chacune visible 1 s avant de partir. */
export const TURRET_FIRST_TICKS = 20;
export const TURRET_INTERVAL_TICKS = 60;
export const BALL_CHARGE_TICKS = 20;
/**
 * Mine (03-Pieges §2), en ticks depuis la pose : le cadre se resserre (0,6 s), la mine reste visible pour
 * tous (2 s, décidé), la case se retourne (0,45 s). Elle ne peut exploser qu'à la fin du retournement.
 */
export const MINE_SHRINK_TICKS = 12;
export const MINE_SHOWN_TICKS = 40;
export const MINE_FLIP_TICKS = 9;
export const MINE_ARM_TICKS = MINE_SHRINK_TICKS + MINE_SHOWN_TICKS + MINE_FLIP_TICKS;
/**
 * Une mine qui explose se recharge pendant 20 s (décidé) : visible à moitié transparente pour tous,
 * inoffensive, puis sa pose se rejoue (cadre, 2 s visible, retournement).
 */
export const MINE_REST_TICKS = 400;
/**
 * Révélation des mines adverses (03-Pieges §2, décidé : 1,5 s toutes les 10 s, un seul cycle pour toute la
 * partie) : visibles quand le tick, modulo MINE_CYCLE_TICKS, est au moins MINE_REVEAL_FROM.
 */
export const MINE_CYCLE_TICKS = 200;
export const MINE_REVEAL_FROM = 170;

/**
 * Contrôle de l'hôte (01-Architecture §3, Pièges et projectiles) : il compte lui-même un contact quand les
 * centres sont à moins de BALL_CONTACT − HIT_CONTROL_MARGIN, même si le client ne l'a pas signalé.
 */
export const HIT_CONTROL_MARGIN = 300;

/** Positions de départ, dans l'ordre des joueurs : les quatre coins. Provisoire. */
export const SPAWNS: readonly (readonly [number, number])[] = [
  [CELL / 2, CELL / 2],
  [GRID - CELL / 2, GRID - CELL / 2],
  [GRID - CELL / 2, CELL / 2],
  [CELL / 2, GRID - CELL / 2],
];
