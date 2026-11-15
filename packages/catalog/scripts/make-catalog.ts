// Écrit les deux catalogues de grilles (Docs/Design/02-Grilles.md §1) :
// - packages/catalog/src/grids.ts : parties en ligne, jamais importé par le client ;
// - client/src/solo-grids.ts : solo seulement, lisible dans la page.
//
// À lancer à la main depuis la racine du dépôt : `npm run catalog`, ou avec des réglages :
// `node packages/catalog/scripts/make-catalog.ts --online=100 --solo=10 --seed=1`.
// Le même `seed` redonne les mêmes catalogues.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { makeGrid, makeRng, type Grid, type Level } from "./sudoku.ts";

const LEVELS: readonly Level[] = ["facile", "moyen", "difficile"];

function arg(name: string, fallback: number): number {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  const value = found === undefined ? fallback : Number(found.slice(name.length + 3));
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} : entier positif attendu`);
  return value;
}

/** Grilles par niveau : provisoire (02-Grilles §4). */
const ONLINE_PER_LEVEL = arg("online", 100);
const SOLO_PER_LEVEL = arg("solo", 10);
const SEED = arg("seed", 1);

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");

function make(count: number, rnd: () => number): Grid[] {
  const out: Grid[] = [];
  for (const level of LEVELS) {
    for (let k = 0; k < count; k++) out.push(makeGrid(level, rnd));
  }
  return out;
}

function source(grids: readonly Grid[], note: string): string {
  const lines = grids.map((g) => `  { level: "${g.level}", puzzle: "${g.puzzle.join("")}", solution: "${g.solution.join("")}" },`);
  return [
    "// Généré par packages/catalog/scripts/make-catalog.ts : ne pas modifier à la main (Docs/Design/02-Grilles.md).",
    `// ${note}`,
    "",
    "export const GRIDS: readonly { readonly level: \"facile\" | \"moyen\" | \"difficile\"; readonly puzzle: string; readonly solution: string }[] = [",
    ...lines,
    "];",
    "",
  ].join("\n");
}

function summary(grids: readonly Grid[]): string {
  return LEVELS.map((level) => {
    const clues = grids.filter((g) => g.level === level).map((g) => g.clues);
    if (clues.length === 0) return `${level} : 0`;
    return `${level} : ${clues.length} grilles, ${Math.min(...clues)} à ${Math.max(...clues)} chiffres donnés`;
  }).join(" ; ");
}

const rnd = makeRng(SEED);
const online = make(ONLINE_PER_LEVEL, rnd);
const solo = make(SOLO_PER_LEVEL, rnd);

writeFileSync(join(root, "packages", "catalog", "src", "grids.ts"), source(online, `Parties en ligne. Graine ${SEED}. ${summary(online)}.`));
writeFileSync(join(root, "client", "src", "solo-grids.ts"), source(solo, `Solo seulement. Graine ${SEED}. ${summary(solo)}.`));

console.log(`En ligne — ${summary(online)}`);
console.log(`Solo — ${summary(solo)}`);
