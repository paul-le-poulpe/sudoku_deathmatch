# 02 — Grilles

Comment l'hôte obtient la grille d'une partie, et comment la difficulté est
mesurée. Fait foi pour ce domaine (`00-Game.md` renvoie ici).

---

## 1. Catalogue pré-généré, transformé au lancement

Décidé par l'auteur le 15 novembre 2026.

- **Le catalogue.** Un script, lancé à la main en développement (pas pendant
  une partie), génère des grilles, vérifie que chacune a une seule solution,
  note sa difficulté (§3), et écrit le catalogue : un module TypeScript,
  importé à la compilation, donc embarqué dans le code de l'hôte. Jamais un
  fichier lu ou téléchargé au lancement.
- **Au lancement**, `Room` (`packages/room`) tire une grille du niveau choisi
  dans le catalogue que lui donne l'enveloppe, et lui applique des
  transformations tirées au hasard (§2). Le hasard vient de l'enveloppe
  (`CLAUDE.md`, règle 2), comme les jetons de la salle.
- **Toutes les grilles du catalogue sont générées par ce script** : aucune
  n'est reprise d'ailleurs (`CLAUDE.md`, règle 1).

### Où est le catalogue (provisoire)

Le code du client est public : n'importe qui télécharge la page et ses
scripts depuis Cloudflare. Un catalogue compilé dans le client donnerait toutes
les solutions ; un joueur pourrait retrouver la grille d'origine d'une grille
transformée (en ramenant les deux à une même forme par les transformations du
§2) et lire sa solution. D'où deux catalogues produits par le même script :

| Catalogue | Paquet | Importé par | Utilisé |
| --- | --- | --- | --- |
| en ligne | `packages/catalog` | `worker/`, plus tard `server/` ; **jamais** `client/` | parties hébergées |
| solo | `client/` | le Web Worker du solo | solo seulement |

`packages/room` n'importe aucun des deux : l'enveloppe lui passe le sien. Les
grilles du solo sont lisibles dans la page, ce qui ne compte pas en solo.

Pourquoi un catalogue plutôt qu'une génération au lancement :

1. **Calcul.** Une grille difficile demande souvent des dizaines d'essais
   (générer, noter, recommencer). Un Worker du plan gratuit est limité à
   10 ms de calcul par requête ; la limite d'un Durable Object n'est pas
   vérifiée. Tirer et transformer une grille du catalogue ne coûte presque
   rien.
2. **Difficulté garantie.** La note est calculée une fois par le script, et
   les transformations ne la changent pas (§2).
3. **Taille.** 81 caractères pour la grille et 81 pour la solution : 1 000
   grilles font environ 160 Ko.

### Format (provisoire)

Une entrée par grille : `{ level, puzzle, solution }`, `puzzle` et `solution`
en chaînes de 81 chiffres lues ligne par ligne, `0` pour une case vide.

## 2. Les transformations

Elles changent l'apparence de la grille sans changer sa structure. Une grille
transformée a donc toujours une seule solution, demande exactement les mêmes
techniques, et garde sa difficulté :

- permuter les 9 chiffres (remplacer partout 1 par 7, 2 par 4…) ;
- échanger deux lignes d'une même bande (les lignes 1 à 3, 4 à 6 ou 7 à 9) ;
- échanger deux bandes entières ;
- la même chose pour les colonnes et les piles de colonnes ;
- transposer (lignes ↔ colonnes).

Une grille du catalogue donne environ 10¹² variantes
(9! × 6⁸ × 2 ≈ 1,2 × 10¹²). Les mêmes transformations s'appliquent à la grille
et à sa solution.

## 3. Mesurer la difficulté

Le nombre de chiffres donnés est un indice faible : une grille à 24 chiffres
donnés peut être facile, une à 30 très difficile (17 est le minimum pour une
solution unique). La note vient des techniques nécessaires.

Le script résout chaque grille avec un solveur qui n'applique que des règles de
déduction, de la plus simple à la plus fine, et garde la plus fine qu'il a dû
utiliser :

| Technique | Ce qu'elle fait |
| --- | --- |
| Singleton nu | une case où un seul chiffre est possible |
| Singleton caché | un chiffre qui n'a qu'une place dans une ligne, une colonne ou un carré |
| Paires, triplets, interactions carré-ligne | éliminer des candidats à partir de groupes de cases |
| X-Wing, Swordfish, XY-Wing | éliminer à partir de motifs sur plusieurs lignes ou colonnes |
| Chaînes, essais | suivre des implications sur de longues séries de cases |

Une grille que ce solveur ne termine pas demande de deviner : à exclure, ou à
classer à part (§4).

**Provisoire (première version, 15 novembre 2026)** : trois niveaux. Le script
(`packages/catalog/scripts/sudoku.ts`) connaît deux niveaux de techniques : 1,
les singletons ; 2, en plus, les candidats verrouillés (pointage, réclamation)
et les paires nues et cachées.
- Facile : résolue au niveau 1, au moins 36 chiffres donnés.
- Moyen : résolue au niveau 1, le moins de chiffres donnés possible (24 à 31
  dans le catalogue actuel).
- Difficile : pas résolue au niveau 1, résolue au niveau 2 (23 à 30 chiffres
  donnés). Une grille qui demanderait davantage n'entre pas au catalogue.

Le script retire les chiffres par paires symétriques (case `i` et case
`80 − i`) tant que la grille reste résoluble au niveau voulu ; une grille
résolue par déduction seule a une seule solution.

**Taille (provisoire)** : 100 grilles par niveau en ligne, 10 par niveau en
solo, graine 1 (`npm run catalog`).

## 4. Points ouverts

- **Niveaux** : combien, et quelles techniques pour chacun.
- **Taille du catalogue** par niveau (première version : §3).
- **Choix de la grille** : l'hôte choisit le niveau dans la salle d'attente
  (`01-Architecture.md` §4) ; peut-il aussi rejouer une grille précise ?
- **Taille de la grille** : 9 × 9 supposé par `01-Architecture.md` §3.

## 5. Pièges

- **Échanger deux lignes de bandes différentes** (la ligne 2 avec la ligne 5)
  : les carrés ne contiennent plus chacun les chiffres 1 à 9, la grille n'est
  plus un Sudoku valide. Seules les transformations du §2 sont permises.
- **Transformer la grille sans transformer la solution de la même façon** :
  l'hôte refuserait des chiffres justes.
- **Lire le catalogue depuis un fichier au lancement** : le Web Worker du solo
  n'a pas accès aux fichiers, et `packages/room` n'utilise aucune API de
  plateforme (`CLAUDE.md`, règle 2). Le catalogue est un module importé.
- **Importer `packages/catalog` depuis le client**, directement ou par
  `packages/shared` ou `packages/room` : Vite le compilerait dans la page, et
  les solutions des parties en ligne seraient lisibles par tous. Rien ne
  l'empêche à la compilation ; une recherche dans `client/dist` le détecte.
