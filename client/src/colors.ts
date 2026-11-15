// Couleurs des joueurs (indices de 0 à PLAYER_COLOR_COUNT − 1, `packages/shared`), reprises de la maquette.
// `color` : le bonhomme et ses PV ; `tint` : le fond d'une case remplie ; `ink` : le chiffre sur ce fond.

export interface PlayerColor {
  readonly name: string;
  readonly color: string;
  readonly tint: string;
  readonly ink: string;
}

export const PLAYER_COLORS: readonly PlayerColor[] = [
  { name: "Bleu", color: "#2563EB", tint: "#DBEAFE", ink: "#1D4ED8" },
  { name: "Orange", color: "#EA580C", tint: "#FFEDD5", ink: "#C2410C" },
  { name: "Vert", color: "#0D9488", tint: "#CCFBF1", ink: "#0F766E" },
  { name: "Violet", color: "#7C3AED", tint: "#EDE9FE", ink: "#6D28D9" },
  { name: "Rose", color: "#DB2777", tint: "#FCE7F3", ink: "#BE185D" },
  { name: "Ardoise", color: "#475569", tint: "#E2E8F0", ink: "#334155" },
];

export function playerColor(index: number): PlayerColor {
  return PLAYER_COLORS[index] ?? PLAYER_COLORS[0]!;
}

/** `#RRGGBB` → entier, pour Phaser. */
export function hexToInt(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}
