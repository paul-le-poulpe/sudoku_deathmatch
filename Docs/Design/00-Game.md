# 00 — Le jeu

Point d'entrée des règles. Ne contient que ce que l'auteur a décidé ; le reste
est dans les points ouverts (§3). Une règle n'est écrite qu'à un seul endroit
(`CLAUDE.md`).

Documents thématiques :
- `02-Grilles.md` — d'où vient la grille d'une partie (catalogue pré-généré,
  transformé au lancement) et comment sa difficulté est mesurée ; niveaux à
  décider.

---

## 1. Principe

Décidé par l'auteur le 15 novembre 2026.

- **Arène.** Un carré qui est une grille de Sudoku.
- **Joueurs.** 2 à 4 par partie. Chaque joueur contrôle un bonhomme.
- **Déplacement.** Le bonhomme se déplace en continu sur la grille (pas case
  par case).
- **Remplir une case.** Un bonhomme qui se trouve sur une case à remplir peut
  la remplir. Une case remplie prend la couleur du joueur qui l'a remplie, et
  lui octroie des bonus, ou des malus pour ses adversaires.
- **Fin de partie.** Quand toutes les cases sont remplies, ou quand tous les
  bonshommes sauf un ont été éliminés. On détermine alors le vainqueur.

## 2. Première version

Une grille de Sudoku sur laquelle des bonshommes se déplacent et remplissent
des cases. Modes : solo et partie hébergée par Cloudflare ; partie hébergée sur
le PC d'un joueur plus tard (`01-Architecture.md` §1).

Maquette jouable (15 novembre 2026) : artifact « Sudoku Deathmatch —
maquette » (accueil, création, salle d'attente, partie). Les règles qu'elle
applique sont provisoires et listées sur sa page ; elles ne font pas foi.

## 3. Points ouverts

- **Choisir le chiffre** : comment le joueur indique le chiffre qu'il écrit.
- **Mauvais chiffre** : refusé, accepté puis faux, pénalité ?
- **Bonus et malus** : lesquels, quand ils s'appliquent, combien de temps.
- **Élimination** : comment un bonhomme est éliminé.
- **Vainqueur** : comment il est déterminé quand la grille est pleine.
- **Cases données** (chiffres de départ) : traversables ou non.
- **Collisions** entre bonshommes.
- **Durée d'une partie** : 10 minutes supposées pour les estimations de
  quotas (`01-Architecture.md` §5, provisoire).
- **Pause** : existe-t-elle, qui la commande.
- **Solo** : seul sur la grille, ou contre des bots.
- **Vitesse** du bonhomme : à régler en jouant.
