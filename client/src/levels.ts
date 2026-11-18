// Noms et descriptions des niveaux affichés dans la salle d'attente (02-Grilles §3, provisoire).

import type { BotLevel, Level } from "@sudoku-deathmatch/shared";

/** Difficultés d'un bot (04-Bots §1) : seul le rythme des chiffres change. */
export const BOT_LEVEL_LABEL: Readonly<Record<BotLevel, string>> = {
  facile: "Facile",
  normal: "Normal",
  difficile: "Difficile",
};

export const LEVEL_LABEL: Readonly<Record<Level, string>> = {
  facile: "Facile",
  moyen: "Moyen",
  difficile: "Difficile",
};

export const LEVEL_TEXT: Readonly<Record<Level, string>> = {
  facile: "Chaque case se déduit par élimination simple (singletons), et au moins 36 chiffres sont donnés.",
  moyen: "Singletons seulement, mais avec le moins de chiffres donnés possible : il faut chercher où ils servent.",
  difficile: "Les singletons ne suffisent pas : il faut des paires ou des candidats verrouillés.",
};
