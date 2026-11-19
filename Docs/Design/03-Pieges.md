# 03 — Pièges

Ce qu'un joueur pose sur les cases qu'il a remplies pour gêner les autres.
Fait foi pour ce domaine (`00-Game.md` renvoie ici). Qui détecte un contact,
et ce qui passe par le réseau : `01-Architecture.md` §3, Pièges et projectiles.

Implémenté le 15 novembre 2026, après la version 1 ; revu le 16 novembre 2026
(mine « cadre à pointes » toujours visible, tourelle « anneau » toutes les
6 s) ; bouclier et disponibilité des pièges le 18 novembre 2026. Réglages :
`packages/engine/src/config.ts`.

Maquette (15 novembre 2026) : artifact « Sudoku Deathmatch — pièges »,
https://claude.ai/artifact/S7N3PdpvxYNjbKvih3pT2K (démo
jouable, trois dessins de mine, trois dessins de tourelle). Seules les règles
de ce document font foi.

---

## 1. Principe

Décidé par l'auteur le 15 novembre 2026.

- **« Piège » est le mot générique** : les tourelles sont des pièges.
- **Poser.** Sous les boutons des chiffres, une ligne montre tous les pièges
  disponibles (sur téléphone, empilés à gauche du pavé des chiffres :
  `00-Game.md` §1, Écran de jeu sur téléphone). Un clic sur l'un d'eux le
  pose sur la case où se trouve le bonhomme, à deux conditions : la case a été remplie par ce joueur (son
  chiffre est de sa couleur), et elle n'a pas encore de piège.
- **Disponibilité** (décidé le 18 novembre 2026). Le bouton d'un piège en
  nombre limité (tourelle, bouclier) montre combien de cases il reste à
  remplir avant le prochain : son fond se remplit de la couleur claire du
  joueur, d'une part par case remplie (un tiers pour la tourelle, un cinquième
  pour le bouclier), sans séparateur ; plein, le piège est disponible et le
  bord du bouton prend la couleur du joueur (variante A ter de la planche
  « Barre des pièges » de la maquette du bouclier, §4). La mine, sans limite,
  a toujours son bouton plein.

  Provisoire : « ×2 » à côté du nom quand plusieurs sont disponibles (sur
  téléphone, en pastille sur le coin de l'icône) ; tant
  que le piège n'est pas disponible, nom en gris et icône à 55 %.
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
- En solo sans bot (`04-Bots.md`), il n'y a pas d'adversaire : une tourelle
  ne fait apparaître aucune boule, une mine n'explose jamais.
- Limites : un piège par case, et le nombre de tourelles et de boucliers (§3,
  §4). Pas d'autre coût.
- Touches : en plus des boutons, la touche à gauche de Z (A en AZERTY, Q en
  QWERTY, `KeyQ`) pose une mine, celle à droite de Z (E, `KeyE`) une tourelle,
  la suivante (R, `KeyR`) un bouclier.
- Les boutons des pièges sont à 45 % quand la case sous le bonhomme n'accepte
  pas de piège ; une tentative affiche pourquoi.

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
- **Nombre** : un joueur ne peut mettre une tourelle que sur un tiers de ses
  cases (décidé le 16 novembre 2026) : sa n-ième tourelle demande 3 n cases
  remplies (la première à 3 cases, la deuxième à 6). Le bouton de la tourelle
  montre où en est le joueur (§1, Disponibilité), et une tentative trop tôt
  affiche pourquoi.
- **Avertissement** : environ une seconde avant le tir, un cercle se resserre
  au centre de la tourelle. La boule n'est pas dessinée avant de partir : elle
  cacherait le chiffre (décidé le 16 novembre 2026).
- **La direction est fixée au départ de la boule**, vers la cible à cet
  instant ; jusque-là, le canon suit la cible. Conséquence : sur chaque écran,
  la boule apparaît déjà un peu avancée sur sa trajectoire, d'environ sa
  vitesse multipliée par le ping (`01-Architecture.md` §3, Pièges et
  projectiles).
- **Ses propres boules** (décidé le 18 novembre 2026) : chaque joueur voit les
  boules de ses tourelles en transparence (15 % d'opacité), pour se
  concentrer sur celles des autres (planche « Vos boules » de la maquette du
  bouclier, §4). Provisoire : le cercle qui annonce le tir reste opaque.

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

## 4. Le bouclier

Idée de l'auteur du 17 novembre 2026, précisée le 18 novembre 2026, et
implémentée le même jour. Maquette : artifact « Sudoku Deathmatch —
bouclier », https://claude.ai/artifact/3dD18nanHaAZLqkaUGCKe2 (démo jouable,
dessins, jauge, zone, boules du joueur, barre des pièges). Qui détecte qu'une
boule est arrêtée : `01-Architecture.md` §3, Pièges et projectiles.

- **Pose** : comme les autres pièges (§1).
- **Nombre** (décidé le 18 novembre 2026) : comme la tourelle (§3), mais
  toutes les 5 cases : le n-ième bouclier d'un joueur demande 5 n cases
  remplies (le premier à 5 cases, le deuxième à 10).
- **Dessin** : le contour « badge » de la maquette (planche « Dessins »)
  autour du chiffre, réduit à 90 %, dans la couleur du poseur, d'un trait un
  peu plus épais que celui de la mine et de la tourelle (3 px au lieu de
  2,5, décidé le 18 novembre 2026), et sa jauge de charge.
- **Protection** : quand son poseur est à moins d'une case et demie du
  bouclier, une bulle en anneau, de sa couleur plus claire, l'entoure, et les
  boules qui la touchent sont détruites. Les autres joueurs n'en profitent
  pas.
- **La bulle montre la charge** (décidé le 18 novembre 2026 : variante B de la
  maquette « Sudoku Deathmatch — charge du bouclier »,
  https://claude.ai/artifact/WRdRgK6TUN94Hh6R4epVKV) : son anneau, plus marqué
  qu'avant, est en pointillé. Plus le bouclier est chargé, plus les traits
  sont longs et les espaces courts ; plein, c'est un cercle complet.
- **Zone visible** (18 novembre 2026) : un cercle léger, sans remplissage,
  montre la zone d'effet (1,5 case autour de la case du bouclier). Seul le
  poseur le voit : il voit le cercle de chacun de ses boucliers dont son
  bonhomme est dans la zone ou juste à côté, à environ une largeur de
  bonhomme du cercle, pas de loin (décidé le 18 novembre 2026), et qui peut
  encore arrêter une boule (décidé le 18 novembre 2026 : déchargé, son
  cercle disparaît, comme la bulle). Les
  autres joueurs ne voient aucun cercle, seulement la bulle autour du
  bonhomme protégé. Il ne doit cacher aucun chiffre :
  trait de 2 px dans la couleur du poseur à 55 %, coupé autour des chiffres
  (variante C de la planche « Zone du bouclier », décidé le 18 novembre
  2026) ; chaque chiffre a pour cela un contour de 2 px de la couleur du
  fond de sa case.
- **Plusieurs boucliers** (18 novembre 2026) : si le bonhomme est dans la
  zone de plusieurs de ses boucliers, une boule arrêtée retire une unité au
  plus proche.
- **Charge** (décidé le 18 novembre 2026 ; avant : 5 unités, pleine en 30 s) :
  pleine, elle arrête 3 boules ; chaque boule arrêtée en retire un tiers.
  Elle se recharge en continu, une unité en 15 s, donc de vide à pleine en
  45 s. Un bouclier en partie chargé arrête quand même des boules.
- **Jauge** : une barre verticale continue à droite du badge, sur presque
  toute la hauteur de la case, partagée en 3 unités égales par des
  interstices tous de la même taille ; une unité peut être en partie remplie.
  Elle doit se lire d'un coup d'œil (planche « Jauge de charge »). Elle a
  3 px de large, de 49 à 52 px du bord gauche de la case : plus à droite, le
  contour du bonhomme qui se tient sur la case la cache (décidé le
  18 novembre 2026, planche « Largeur de la jauge » de la maquette « charge
  du bouclier »).

Provisoire (choix de la maquette) :
- la distance se mesure du centre du bonhomme au centre de la case du
  bouclier ;
- le cercle de la zone se voit tant que cette distance est d'au plus 1,9 case :
  1,5 case de zone plus une largeur de bonhomme (2 × `BODY_RADIUS`,
  0,4 case), en distance réelle ;
- une boule est arrêtée au contact de la bulle (rayon d'environ 0,4 case) ;
- une boule n'est arrêtée que s'il reste au moins une unité de charge ; en
  dessous, la bulle et le cercle de la zone disparaissent ;
- plusieurs boucliers : « le plus proche » se compte parmi ceux qui ont au
  moins une unité (un bouclier vide plus proche ne laisse pas passer la
  boule) ; à égalité de distance, le premier posé ;
- la jauge est visible par tous ;
- un bouclier est plein dès sa pose ;
- anneau de la bulle (maquette, variante B) : 4 px à 75 % (avant : 3 px à
  40 %), 12 traits centrés sur des angles réguliers, le premier en haut ;
  chacun couvre une part de son intervalle égale à la charge sur 3. La bulle
  qui rapetisse garde les traits de la dernière charge vue ;
- la bulle grossit en 0,22 s et rapetisse en 0,18 s, son anneau devient opaque
  0,22 s quand elle arrête une boule, qui éclate en particules de sa couleur ;
- le cercle de la zone apparaît et disparaît en fondu de 0,2 s ;
- jauge : 48 px de haut (4 px du haut de la case), unités de
  14 px et interstices de 3 px, tous sur des pixels entiers ; une unité
  entamée se remplit sur ses 14 px, sans compter l'interstice ;
- touche : R (`KeyR`), à droite de celle de la tourelle.

## 5. Points ouverts

- **Bouclier et mines** : le bouclier protège-t-il aussi des mines d'un
  adversaire posées dans sa zone (§4) ? Pour l'instant, non : il n'arrête que
  les boules.
- **Autres pièges** : lesquels ; ce qui rend un piège « disponible » (coût,
  nombre par joueur, délai entre deux poses). La tourelle et le bouclier ont
  une limite (§3, §4), la mine aucune.
- **Délai d'avertissement** pour un futur piège visible : il doit être plus
  long que le ping des joueurs, sinon un joueur peut être touché par un piège
  que son écran ne montre pas encore. Pour la tourelle, la seconde du cercle
  annonce le tir, mais pas sa direction (§3).
- **Une boule qui disparaît en touchant** : chaque client apprend en retard
  qu'un autre bonhomme l'a prise. Deux joueurs peuvent donc chacun la voir
  toucher leur propre bonhomme, et perdre chacun 1 PV.
- **Dessin de la tourelle** (§3).
