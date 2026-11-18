# 04 — Bots

Des bonshommes joués par l'hôte, pour remplir une partie pendant le
développement. Fait foi pour ce domaine (`00-Game.md` renvoie ici). Où ils
tournent et ce qu'ils envoient : `01-Architecture.md` §3, Bots.

Décidé par l'auteur le 18 novembre 2026, implémenté le même jour. Ils servent
de remplaçants, pas d'adversaires sérieux : leur comportement reste simple.

---

## 1. Ajouter des bots

- **Dans la salle d'attente du solo**, l'hôte ajoute des bots et choisit la
  couleur de chacun. Un bot occupe une place de joueur (4 au plus, bots
  compris).
- **Seulement en solo** (décidé le 18 novembre 2026) : pas de bots dans une
  partie hébergée par Cloudflare, ni plus tard par un joueur.
- **Difficulté** : un sélecteur par bot, trois niveaux (§2). Seul le rythme
  des chiffres change d'un niveau à l'autre.

Provisoire :
- les bots s'appellent « Bot 1 », « Bot 2 »… ; un bot ajouté prend la première
  couleur libre, au niveau Normal ;
- un bot se retire de la salle par un bouton ; une relance garde les bots.

## 2. Comportement

- **Un chiffre toutes les n secondes** : à chaque décision, le bot choisit une
  case vide au hasard sur la grille, y va et y écrit le chiffre juste. n vaut
  30 s en Facile, 20 s en Normal, 10 s en Difficile.
- **Promenade** (décidé le 18 novembre 2026, pour qu'il ne reste pas dans son
  coin) : entre deux chiffres, à intervalles réguliers, il choisit une case au
  hasard et s'y déplace, en évitant toujours les boules.
- **Pièges** : dès qu'un piège est disponible, le bot le pose, avec la
  priorité bouclier, puis tourelle, puis mine.
- **Boules** : il les évite autant qu'il peut, en s'écartant de leur
  trajectoire ; quand plusieurs boules arrivent en même temps, il peut ne pas
  y arriver.
- **Mines** : il marche dessus sans s'en soucier, sauf quand il ne lui reste
  qu'un PV.

Provisoire :
- la case visée est tirée au hasard parmi les cases vides ; prise par un autre
  avant que le bot l'atteigne, il en tire une autre tout de suite ;
- la première décision tombe à un instant tiré au hasard dans les n premières
  secondes, les suivantes toutes les n secondes ;
- promenade : une nouvelle case toutes les 3 s (la première à un instant tiré
  dans les 3 premières secondes), n'importe laquelle sauf la sienne ; il
  s'arrête au centre de la case, ou plus tôt si l'intervalle suivant tombe
  avant ; une case à remplir l'interrompt, et il attend d'avoir posé son
  piège pour repartir ;
- le bot ne se trompe jamais de chiffre ;
- le piège est posé sur la case qu'il vient de remplir, juste après ; la mine,
  sans limite, est donc posée sur chaque case qui n'a ni bouclier ni tourelle ;
- il s'écarte d'une boule partie qui vient vers lui, à moins de 2,5 cases
  devant lui et à moins de 0,55 case de sa trajectoire ; il s'écarte du côté
  où il est déjà (pour une boule qui vise son centre, un côté fixé par la
  boule), et de l'autre côté si un bord de la grille l'arrête ; plusieurs
  boules : il suit la somme des écarts, qui peuvent s'annuler ;
- à 1 PV, il ne prend que des chemins case par case qui évitent les mines
  adverses (en recharge comprises), ne vise que les cases qu'il peut atteindre
  ainsi (pour un chiffre comme pour la promenade), et ne s'écarte pas d'une
  boule vers une mine adverse. À 2 PV, une
  mine l'élimine aussi (2 PV, `03-Pieges.md` §2), mais il marche dessus,
  comme l'auteur l'a demandé.

## 3. Fin de partie

Provisoire : une partie finit aussi quand plus aucun joueur humain n'est en
vie, même s'il reste plusieurs bots (sans cela, le joueur seul éliminé
regarderait les bots finir la grille). Le classement est celui de `00-Game.md`
§1, bots compris.

## 4. Points ouverts

- Des bots qui se trompent de chiffre, ou des niveaux qui diffèrent par autre
  chose que le rythme.
- Le seuil des mines : 1 PV (demandé) ou 2 PV (là où une mine élimine).
