# 03 — Pièges

Ce qu'un joueur pose sur les cases qu'il a remplies pour gêner les autres.
Fait foi pour ce domaine (`00-Game.md` renvoie ici). Qui détecte un contact,
et ce qui passe par le réseau : `01-Architecture.md` §3, Pièges et projectiles.

Implémenté le 15 novembre 2026, après la version 1, avec les dessins par
défaut de la maquette : mine « carré », tourelle « anneau ». Réglages :
`packages/engine/src/config.ts`.

Maquette (15 novembre 2026) : artifact « Sudoku Deathmatch — pièges » (démo
jouable, trois dessins de mine, trois dessins de tourelle). Seules les règles
de ce document font foi.

---

## 1. Principe

Décidé par l'auteur le 15 novembre 2026.

- **« Piège » est le mot générique** : les tourelles sont des pièges.
- **Poser.** Sous les boutons des chiffres, une ligne montre tous les pièges
  disponibles. Un clic sur l'un d'eux le pose sur la case où se trouve le
  bonhomme, à deux conditions : la case a été remplie par ce joueur (son
  chiffre est de sa couleur), et elle n'a pas encore de piège.
- **Aspect.** Le chiffre reste au centre de la case ; le piège est dessiné dans
  l'espace qui reste. Chaque piège a un dessin distinct.
- **Éviter les pièges demande de l'adresse.** Sur l'écran d'un joueur, le
  contact entre son bonhomme et un piège qu'il voit, ou un projectile, est
  exact : touché à l'écran, touché dans la partie ; évité à l'écran, évité.
  Le contact entre un autre bonhomme et un projectile peut y paraître faux.

Provisoire :
- Un piège n'a aucun effet sur son poseur, et une tourelle ne vise jamais son
  poseur.
- Les pièges d'un joueur éliminé restent actifs.
- En solo, il n'y a pas d'adversaire : une tourelle ne fait apparaître aucune
  boule, une mine n'explose jamais.
- Pas d'autre limite qu'un piège par case, pas de coût.
- Touches : en plus des boutons, la touche à gauche de Z (A en AZERTY, Q en
  QWERTY, `KeyQ`) pose une mine, celle à droite de Z (E, `KeyE`) une tourelle.
- Les boutons des pièges sont grisés quand la pose est impossible ; une
  tentative affiche pourquoi.

## 2. La mine

Décidé par l'auteur le 15 novembre 2026 :

- **Le poseur la voit** : un carré inscrit dans le carré de la case, autour du
  chiffre.
- **Les autres ne la voient pas** : la case garde son aspect, avec la couleur
  du poseur, comme une case remplie sans piège.
- **Un adversaire qui marche dessus** déclenche une petite explosion et perd
  1 PV.
- **Usage unique**, pour l'instant : la mine disparaît en explosant.

Provisoire :
- La mine explose quand le centre d'un bonhomme adverse entre dans la case.
- Après l'explosion, la case peut recevoir un autre piège.
- Dessin : le carré de la maquette (implémenté), parmi trois (carré, losange,
  coins). Le carré se confond avec le cadre qui marque la case de son propre
  bonhomme (même couleur, 2 px du bord), le losange et les coins non.

## 3. La tourelle

Décidé par l'auteur le 15 novembre 2026 :

- **Dessin** : un rond inscrit dans le carré de la case, et un petit carré sur
  le rond, qui sert de canon.
- **Tir** : à intervalles réguliers, elle tire une boule en ligne droite vers
  le joueur le plus proche.
- **La boule va lentement** : un joueur doit pouvoir l'éviter facilement.
- **Avertissement** : environ une seconde avant le tir, la boule apparaît au
  centre de la tourelle, par-dessus le chiffre ; une seconde après son
  apparition, elle part.
- **La direction est fixée au départ de la boule**, vers la cible à cet
  instant ; jusque-là, le canon suit la cible. Conséquence : sur chaque écran,
  la boule apparaît déjà un peu avancée sur sa trajectoire, d'environ sa
  vitesse multipliée par le ping (`01-Architecture.md` §3, Pièges et
  projectiles).

Provisoire :
- La cible est le bonhomme adverse non éliminé le plus proche du centre de la
  tourelle.
- Boule : 1,5 case par seconde (le bonhomme : 3), diamètre 0,3 case ; une
  boule toutes les 3 s, la première 1 s après la pose.
- Une boule qui touche un bonhomme adverse lui enlève 1 PV et disparaît. Elle
  disparaît aussi au bord de la grille ; elle passe par-dessus les cases et
  les autres pièges.
- Une tourelle sans adversaire non éliminé ne fait pas apparaître de boule ;
  une boule qui n'a plus de cible au moment de partir disparaît.
- Dessin : l'anneau de la maquette (implémenté), parmi trois (anneau, socle,
  plein).

## 4. Points ouverts

- **Autres pièges** : lesquels ; ce qui rend un piège « disponible » (coût,
  nombre par joueur, délai entre deux poses).
- **Délai d'avertissement** pour un futur piège visible : il doit être plus
  long que le ping des joueurs, sinon un joueur peut être touché par un piège
  que son écran ne montre pas encore. Pour la tourelle, la seconde
  d'apparition de la boule annonce le tir, mais pas sa direction (§3).
- **Une boule qui disparaît en touchant** : chaque client apprend en retard
  qu'un autre bonhomme l'a prise. Deux joueurs peuvent donc chacun la voir
  toucher leur propre bonhomme, et perdre chacun 1 PV.
- **Dessins** de la mine et de la tourelle (§2, §3).
