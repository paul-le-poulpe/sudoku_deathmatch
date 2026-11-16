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
- **Remplir une case.** Un bonhomme qui se trouve sur une case vide peut y
  écrire un chiffre.
  - Chiffre juste : la case prend la couleur du joueur, et il retrouve tous
    ses PV (décidé le 16 novembre 2026).
  - Chiffre faux : il est refusé, la case reste vide, et le joueur perd 1 PV.
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
  l'auteur le 15 novembre 2026).

  Provisoire :
  - deux survivants avec autant de cases, ou deux joueurs éliminés au même
    tick : le premier est celui qui a rempli le plus de cases, puis l'ordre de
    la salle ;
  - la relance tire une nouvelle grille du même niveau et garde les joueurs
    connectés ; un joueur déconnecté à ce moment quitte la partie ;
  - les autres joueurs voient sur la fenêtre que l'hôte peut relancer.
- **Couleurs des joueurs** : palette « Classique » (bleu, rouge, vert, jaune,
  violet, charbon), choisie par l'auteur le 15 novembre 2026 dans la maquette
  « Sudoku Deathmatch — couleurs ». Valeurs : `client/src/colors.ts`.
- **Bots.** Il pourra y en avoir à terme, pas avant que les fonctionnalités du
  jeu soient en place.

## 2. Version 1

Règles acceptées par l'auteur le 15 novembre 2026 pour la première version ;
elles pourront changer ensuite.

- **Modes** : solo et partie hébergée par Cloudflare ; partie hébergée sur le PC
  d'un joueur plus tard (`01-Architecture.md` §1).
- **Écrire un chiffre** : touches 1 à 9, ou boutons à l'écran, dans la case où
  se trouve le bonhomme.
- **Chiffre faux** : refusé, 1 PV perdu (§1). Pas d'autre pénalité.
- **Traversées** : les cases des chiffres donnés se traversent, les bonshommes
  se traversent.
- **Élimination** (provisoire) : le bonhomme éliminé disparaît de la grille et
  ne peut plus rien faire ; ses cases gardent sa couleur ; le joueur continue de
  voir la partie.
- **Fin** : la grille est pleine, ou il ne reste qu'un bonhomme (§1). En solo,
  la partie finit aussi quand le joueur est éliminé.
- **Classement et relance** : §1, Fin de partie.
- **Difficulté** : trois niveaux, choisis par l'hôte dans la salle d'attente
  (`02-Grilles.md` §3).
- **Solo** : le joueur seul sur la grille, sans bots.
- **Pas de pause.** L'hôte peut lancer la partie sans attendre d'autres
  joueurs.
- **Pas dans la version 1** : pièges (ajoutés ensuite, `03-Pieges.md`), bots.

Maquette jouable (15 novembre 2026) : artifact « Sudoku Deathmatch —
maquette » (accueil, création, salle d'attente, partie). Elle n'a pas encore
les PV. Les règles qu'elle applique sont listées sur sa page ; seules celles
de ce document font foi.

## 3. Points ouverts

- **Pièges** : `03-Pieges.md` §4.
- **Couleurs et signaux rouges** : la palette a un rouge, et le chiffre refusé
  clignote en rouge, la mine explose en rouge et orange ; le gris de la case
  d'un joueur « Charbon » ressemble à celui des chiffres donnés.
- **Collisions entre bonshommes** : la version 1 les laisse se traverser (§2) ;
  à décider plus tard.
- **Regagner des PV** : possible ou non.
- **Durée d'une partie** : 10 minutes supposées pour les estimations de
  quotas (`01-Architecture.md` §5, provisoire).
- **Vitesse** du bonhomme : à régler en jouant.
- **Idée de l'auteur, non décidée** : des bonshommes armés, qui tirent sur des
  zombies générés par les cases des adversaires.
