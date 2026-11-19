# 00 — Le jeu

Point d'entrée des règles. Ne contient que ce que l'auteur a décidé ; le reste
est dans les points ouverts (§3). Une règle n'est écrite qu'à un seul endroit
(`CLAUDE.md`).

Documents thématiques :
- `02-Grilles.md` — d'où vient la grille d'une partie (catalogue pré-généré,
  transformé au lancement) et comment sa difficulté est mesurée ; niveaux à
  décider.
- `03-Pieges.md` — ce qu'un joueur pose sur ses cases pour gêner les autres :
  pose, mine, tourelle ; ajoutés après la version 1. Règles remplacées, qui ne
  font pas foi : `03-Pieges-History.md`.
- `04-Bots.md` — bonshommes joués par l'hôte, ajoutés dans la salle d'attente :
  ajout, difficulté, comportement, fin de partie avec des bots.

---

## 1. Principe

Décidé par l'auteur le 15 novembre 2026.

- **Arène.** Un carré qui est une grille de Sudoku.
- **Joueurs.** 2 à 4 par partie. Chaque joueur contrôle un bonhomme.
- **Déplacement.** Le bonhomme se déplace en continu sur la grille (pas case
  par case).
- **Points de vie.** Chaque bonhomme a des points de vie (PV), 4 au départ
  (décidé le 16 novembre 2026, après un essai à 5 ; 3 avant). Les PV de chaque
  joueur sont affichés en haut de la grille. À 0 PV, le bonhomme est éliminé.
  Bandeau des PV : deux joueurs par ligne ; à 3 ou 4 joueurs, les joueurs 3
  et 4 sont sur une seconde ligne, en grille 2 × 2 (décidé le 16 novembre 2026).
- **Joueur en retard** (décidé le 16 novembre 2026). Un joueur qui a moins de
  la moitié des cases du premier a 6 PV au maximum au lieu de 4 : il reçoit
  2 PV quand il passe sous la moitié, et un chiffre juste le remet à 6. Quand
  il revient à la moitié ou plus, son maximum redevient 4 et les PV au-dessus
  de 4 lui sont retirés. Dans le bandeau des PV, ces 2 PV sont deux losanges
  de sa couleur, un peu séparés des 4 ronds et suivis du mot « rattrapage » en
  petit gris ; ils apparaissent en grossissant et disparaissent en
  rapetissant (décidé le 17 novembre 2026 : variante A de la maquette
  « Sudoku Deathmatch — PV de rattrapage »,
  https://claude.ai/artifact/MBSxyjWbMDJEDqLXmiLp9M).

  Provisoire :
  - le premier est celui qui a le plus de cases, éliminés compris ; un joueur
    éliminé ne change plus ;
  - « moins de la moitié » est strict : 3 cases contre 6 n'est pas en retard.
    Dès que le premier a 1 case, ceux qui en ont 0 sont en retard.
- **Remplir une case.** Un bonhomme qui se trouve sur une case vide peut y
  écrire un chiffre.
  - Chiffre juste : la case prend la couleur du joueur, et il retrouve tous
    ses PV (décidé le 16 novembre 2026).
  - Chiffre faux : il est refusé, la case reste vide, et le joueur perd tous
    ses PV sauf un ; s'il ne lui en restait qu'un, il le perd et il est
    éliminé (décidé le 16 novembre 2026 ; avant : 1 PV).
- **Pas de coups.** Les bonshommes ne peuvent pas se frapper.
- **Pièges** (ajoutés après la version 1). Une case remplie octroie au joueur des
  bonus, ou des malus pour ses adversaires : après avoir rempli une case
  correctement, le joueur peut y poser un piège (mot générique, les tourelles
  en sont), qui gêne les autres joueurs et peut leur enlever des PV. Ils
  doivent les éviter : c'est une épreuve d'adresse. Premiers pièges : la mine
  et la tourelle. Règles : `03-Pieges.md`.
- **Fin de partie.** Quand toutes les cases sont remplies, ou quand tous les
  bonshommes sauf un ont été éliminés. La partie affiche alors un classement :
  d'abord les joueurs qui ont survécu, classés par nombre de cases remplies,
  du plus au moins ; puis les joueurs éliminés, du dernier éliminé au premier.
  Sur cette fenêtre, l'hôte a un bouton pour relancer une partie (décidé par
  l'auteur le 15 novembre 2026). Chez les autres joueurs, à la même place, une
  étiquette du même aspect que ce bouton dit « L'hôte peut relancer » (décidé
  le 16 novembre 2026).

  Panneau des joueurs, à droite de la grille (décidé le 16 novembre 2026 ; sur
  téléphone, en bas de la page, voir Écran de jeu sur téléphone) :
  pendant la partie, les joueurs y sont classés par nombre de cases remplies ;
  une fois la partie finie, c'est lui qui montre le classement (le fond gris
  ne le répète pas), avec les couleurs des joueurs, et une couronne jaune à
  droite du nom du gagnant, qui grossit et rapetisse en boucle. La couronne
  n'apparaît qu'en fin de partie.

  Provisoire :
  - le rang s'affiche aussi pendant la partie ; à égalité de cases, l'ordre de
    la salle ;
  - en solo, un joueur éliminé n'a pas de couronne ;
  - couronne : un seul polygone `#FFC107` (bandeau à coins carrés, deux pointes
    en triangle rectangle sur les côtés, une au milieu), de 100 % à 140 % en
    0,9 s, avec accélération et décélération douces ;
  - deux survivants avec autant de cases, ou deux joueurs éliminés au même
    tick : le premier est celui qui a rempli le plus de cases, puis l'ordre de
    la salle ;
  - la relance tire une nouvelle grille du même niveau et garde les joueurs
    connectés ; un joueur déconnecté à ce moment quitte la partie.
- **Couleurs des joueurs** : sept couleurs (bleu, rouge, vert, jaune, violet,
  rose, cyan). Les cinq premières viennent de la palette « Classique », choisie
  par l'auteur le 15 novembre 2026 dans la maquette « Sudoku Deathmatch —
  couleurs » (https://claude.ai/artifact/Dg6n4JoXYZULWhgUf1D61n) ; rose et cyan
  ont été choisis par l'auteur le 18 novembre 2026. Pas de gris foncé ni de
  noir : un bonhomme de cette couleur se confond avec l'encre de la grille
  (traits des blocs, chiffres). Valeurs :
  `client/src/colors.ts`. Une case remplie par un joueur a le fond clair de
  sa couleur et un chiffre noir (essai demandé par l'auteur le 16 novembre
  2026 ; avant : chiffre dans la couleur du joueur).
- **Tutoriel** (décidé le 16 novembre 2026, maquette « Sudoku Deathmatch —
  tutoriel », https://claude.ai/artifact/J8HJtARyKi5uGQLh3Xnf1r) : sur l'accueil, un bouton sous le solo ouvre une fenêtre
  par-dessus la page, sur un fond assombri. Sept étapes, peu de texte, surtout
  des images : remplir une case, chiffre faux, « Améliorez vos cases » (poser
  un piège), la mine, la tourelle, le bouclier, le coût des pièges (ajoutées
  le 18 novembre 2026, à la demande de l'auteur, qui a aussi écrit les textes
  des étapes 1, 3, 5 et 6). Le texte de l'étape 1 finit par un lien « Règles du
  sudoku » vers
  https://sudoku.com/fr/comment-jouer/regles-de-sudoku-pour-les-debutants-complets/,
  ouvert dans un nouvel onglet. « Jouer », à la dernière étape, ferme la fenêtre ;
  la croix, un clic sur le fond ou Échap aussi. Textes et images :
  `client/src/tutorial.ts`. Ses textes et ses images répètent des valeurs des
  règles (4 PV, 2 PV de la mine, 20 s de recharge, 1 PV par boule, une
  tourelle pour 3 cases et un bouclier pour 5, 3 unités de charge) : quand
  l'une change, le tutoriel change avec elle.
- **Écran de jeu sur téléphone** (décidé le 19 novembre 2026 : variante C de
  la maquette « Sudoku Deathmatch — téléphone »,
  https://claude.ai/artifact/5VWGTbwfkeJNXzF7nmNntm, sans son bandeau du
  haut). Avant, sur un téléphone, la grille dépassait de l'écran à droite.
  Pendant une partie, sur un écran étroit :
  - pas d'en-tête (logo, nom du jeu, « Partie en cours ») ;
  - en haut, les boîtes des joueurs en 2 × 2, plus petites, avec à droite le
    nombre de cases remplies par chacun ;
  - la grille, de la largeur de l'écran ;
  - dessous, sur une ligne : à gauche une croix d'une seule pièce pour se
    déplacer, au milieu les chiffres en pavé 3 × 3 (1 2 3 en haut), à droite
    les trois boutons des pièges empilés, sans la lettre de leur touche, avec
    « ×2 » en pastille sur le coin de l'icône ;
  - en bas de la page, en faisant défiler : le panneau des joueurs (qui montre
    le classement de fin), puis le bouton Quitter. Le niveau et les cases à
    remplir n'apparaissent que dans ce panneau. Le fond sombre de la fin dit
    « Classement en bas de la page ».

  Provisoire :
  - écran étroit : moins de 700 px de large. Le téléphone tenu en largeur
    n'est pas traité ;
  - croix : un doigt posé sur une branche donne sa direction ; dans un coin
    entre deux branches, la diagonale ; près du centre (moins d'un quart de
    branche), rien. Le doigt glisse d'une direction à l'autre sans se lever ;
    les autres doigts restent libres pour les chiffres et les pièges ;
  - un bouton de chiffre ou de piège agit dès l'appui, pas au relâchement
    (sur ordinateur aussi) ;
  - le message (« Touché par une boule… ») s'affiche par-dessus le bas de la
    grille, sur fond sombre ;
  - écran trop court pour une grille de toute la largeur (iPhone SE) : la
    grille rapetisse, pour que la croix, les chiffres et les pièges restent
    visibles sans faire défiler.
- **Bots** (décidé le 18 novembre 2026). Dans la salle d'attente du solo,
  l'hôte ajoute des bots, qui remplissent une case toutes les n secondes selon
  leur difficulté et posent des pièges. Simples, ils servent de remplaçants
  pendant le développement. Règles : `04-Bots.md`.

## 2. Version 1

Règles acceptées par l'auteur le 15 novembre 2026 pour la première version ;
elles pourront changer ensuite.

- **Modes** : solo et partie hébergée par Cloudflare ; partie hébergée sur le PC
  d'un joueur plus tard (`01-Architecture.md` §1).
- **Écrire un chiffre** : touches 1 à 9, ou boutons à l'écran, dans la case où
  se trouve le bonhomme.
- **Chiffre faux** : refusé, PV perdus (§1). Pas d'autre pénalité.
- **Traversées** : les cases des chiffres donnés se traversent, les bonshommes
  se traversent.
- **Élimination** (provisoire) : le bonhomme éliminé disparaît de la grille et
  ne peut plus rien faire ; ses cases gardent sa couleur ; le joueur continue de
  voir la partie.
- **Fin** : la grille est pleine, ou il ne reste qu'un bonhomme (§1). En solo,
  la partie finit aussi quand le joueur est éliminé ; avec des bots :
  `04-Bots.md` §3.
- **Classement et relance** : §1, Fin de partie.
- **Difficulté** : trois niveaux, choisis par l'hôte dans la salle d'attente
  (`02-Grilles.md` §3).
- **Solo** : le joueur seul sur la grille, sans bots (bots ajoutés ensuite,
  `04-Bots.md`).
- **Pas de pause.** L'hôte peut lancer la partie sans attendre d'autres
  joueurs.
- **Pas dans la version 1** : pièges (ajoutés ensuite, `03-Pieges.md`), bots
  (ajoutés ensuite, `04-Bots.md`).

Maquette jouable (15 novembre 2026) : artifact « Sudoku Deathmatch —
maquette » (accueil, création, salle d'attente, partie). Elle n'a pas encore
les PV. Les règles qu'elle applique sont listées sur sa page ; seules celles
de ce document font foi.

## 3. Points ouverts

- **Pièges** : `03-Pieges.md` §5.
- **Bots** : `04-Bots.md` §4.
- **Couleurs et signaux rouges** : la palette a un rouge, et le chiffre refusé
  clignote en rouge, la mine explose en rouge et orange.
- **Collisions entre bonshommes** : la version 1 les laisse se traverser (§2) ;
  à décider plus tard.
- **Regagner des PV** : possible ou non.
- **Durée d'une partie** : 10 minutes supposées pour les estimations de
  quotas (`01-Architecture.md` §5, provisoire).
- **Vitesse** du bonhomme : à régler en jouant.
- **Idée de l'auteur, non décidée** : des bonshommes armés, qui tirent sur des
  zombies générés par les cases des adversaires.
