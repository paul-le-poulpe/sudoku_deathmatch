// Couleurs des joueurs (indices de 0 à PLAYER_COLOR_COUNT − 1, `packages/shared`) : palette « Classique »
// de la maquette « Sudoku Deathmatch — couleurs », choisie par l'auteur le 15 novembre 2026.
// `color` : le bonhomme, ses PV et ses pièges (au moins 3:1 sur le blanc) ; `tint` : le fond d'une case
// remplie (20 % de la couleur) ; `ink` : le texte de sa couleur (nom dans le bandeau, panneau), au moins
// 4,6:1 sur `tint`. Le chiffre d'une case remplie est noir (essai, scene.ts).

export interface PlayerColor {
  readonly name: string;
  readonly color: string;
  readonly tint: string;
  readonly ink: string;
}

export const PLAYER_COLORS: readonly PlayerColor[] = [
  { name: "Bleu", color: "#2563EB", tint: "#D3E0FB", ink: "#2158D1" },
  { name: "Rouge", color: "#C62828", tint: "#F4D4D4", ink: "#B62525" },
  { name: "Vert", color: "#2E7D32", tint: "#D5E5D6", ink: "#29712D" },
  { name: "Jaune", color: "#B7860B", tint: "#F1E7CE", ink: "#846008" },
  { name: "Violet", color: "#6A3FA0", tint: "#E1D9EC", ink: "#6A3FA0" },
  { name: "Charbon", color: "#3D3D3D", tint: "#D8D8D8", ink: "#3D3D3D" },
];

export function playerColor(index: number): PlayerColor {
  return PLAYER_COLORS[index] ?? PLAYER_COLORS[0]!;
}

/** `#RRGGBB` → entier, pour Phaser. */
export function hexToInt(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

/** `#RRGGBB` et une opacité → `rgba(…)`, pour le CSS. */
export function rgba(hex: string, alpha: number): string {
  const n = hexToInt(hex);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
