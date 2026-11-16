# 03 — Pièges

Ce qu'un joueur pose sur les cases qu'il a remplies pour gêner les autres.
Fait foi pour ce domaine (`00-Game.md` renvoie ici). Qui détecte un contact,
et ce qui passe par le réseau : `01-Architecture.md` §3, Pièges et projectiles.

Implémenté le 15 novembre 2026, après la version 1 ; revu le 16 novembre 2026
(mine « cadre à pointes » toujours visible, tourelle « anneau » toutes les
6 s). Réglages : `packages/engine/src/config.ts`.

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

Décidé par l'auteur le 16 novembre 2026 (les règles remplacées sont dans
`03-Pieges-History.md`, qui ne fait pas foi) :

- **Toujours visible**, par tous les joueurs.
- **Dessin** : le « cadre à pointes » de la maquette (planche « Mine toujours
  visible ») : un cadre carré qui prend toute la case, autour du chiffre,
  hérissé de pointes vers l'extérieur, dans la couleur du poseur. Il doit se
  voir de loin ; le chiffre reste au centre et lisible.
- **Fond de la case** : le fond clair du poseur, comme toute case qu'il a
  remplie.
- **Pose** : un grand cadre de la taille de la grille se resserre jusqu'au
  cadre de la mine, sur la case. Ensuite la mine est posée, sans autre
  animation : pas de retournement, pas de camouflage.
- **Un adversaire qui marche dessus** déclenche une petite explosion et perd
  2 PV.
- **Recharge** : une mine qui explose reste sur sa case et devient inactive
  pendant 20 s. Elle est visible pour tous, plus transparente (cadre à 35 %, essai du 16 novembre 2026 ; 50 % avant), et ne
  blesse personne. Après ces 20 s, sa pose se rejoue : le cadre se resserre.

Implémenté le 16 novembre 2026 (réseau : `01-Architecture.md` §3, Mines).
Maquette : planche « Nouvelles mines et tourelles » de l'artifact « Sudoku
Deathmatch — pièges ».

Provisoire :
- Le cadre qui se resserre dure 0,6 s ; la mine peut exploser dès qu'il a
  atteint la case (aussi après une recharge).
- Pendant la recharge, le cadre à pointes est à 35 % d'opacité.
- La case minée compte toujours dans les cases du poseur (classement, panneau
  des joueurs).
- La mine explose quand le centre d'un bonhomme adverse entre dans la case.
- Le cadre à pointes peut se confondre avec le cadre épais qui marque la case
  de son propre bonhomme (même couleur, 2 px du bord).

## 3. La tourelle

Décidé par l'auteur le 15 novembre 2026 :

- **Dessin** : un rond inscrit dans le carré de la case, et un petit carré sur
  le rond, qui sert de canon. Fond de la case : le fond clair du poseur, comme
  pour la mine (décidé le 16 novembre 2026).
- **Tir** : à intervalles réguliers, elle tire une boule en ligne droite vers
  le joueur le plus proche.
- **La boule va lentement** : un joueur doit pouvoir l'éviter facilement.
- **Cadence** : un tir toutes les 6 s (décidé le 16 novembre 2026).
- **Avertissement** : environ une seconde avant le tir, un cercle se resserre
  au centre de la tourelle. La boule n'est pas dessinée avant de partir : elle
  cacherait le chiffre (décidé le 16 novembre 2026).
- **La direction est fixée au départ de la boule**, vers la cible à cet
  instant ; jusque-là, le canon suit la cible. Conséquence : sur chaque écran,
  la boule apparaît déjà un peu avancée sur sa trajectoire, d'environ sa
  vitesse multipliée par le ping (`01-Architecture.md` §3, Pièges et
  projectiles).

Provisoire :
- La cible est le bonhomme adverse non éliminé le plus proche du centre de la
  tourelle.
- Boule : 1,5 case par seconde (le bonhomme : 3), diamètre 0,3 case ; le
  cercle de la première apparaît 1 s après la pose, elle part 1 s plus tard.
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
  que son écran ne montre pas encore. Pour la tourelle, la seconde du cercle
  annonce le tir, mais pas sa direction (§3).
- **Une boule qui disparaît en touchant** : chaque client apprend en retard
  qu'un autre bonhomme l'a prise. Deux joueurs peuvent donc chacun la voir
  toucher leur propre bonhomme, et perdre chacun 1 PV.
- **Dessin de la tourelle** (§3).
