# 01 — Architecture

Ce qui est décidé, comment les morceaux communiquent, et pourquoi. Écrit avant
toute ligne de code : le §9 dit ce qui existe réellement.

La base technique vient de Fronts of Iron (`Projets code/fronts_of_iron/fronts_of_iron`,
`Docs/Design/01-Architecture.md`) : même lobby, même salle d'attente, mêmes trois
façons d'héberger une partie. Le modèle réseau est différent (§3).

---

## 1. Les composants

### Trois façons de jouer

| Mode | Qui calcule la partie | Réseau |
| --- | --- | --- |
| **Solo** | `packages/room` compilé dans un Web Worker, dans le navigateur du joueur | aucun |
| **Hébergé par un joueur** (plus tard) | `server/` (Node) sur le PC de l'hôte, joint par un tunnel Cloudflare | WebSocket vers l'adresse du tunnel |
| **Hébergé par Cloudflare** | un Durable Object par partie, dans le Worker | WebSocket vers `/api/games/:id/ws`, même origine que la page |

Première version : solo et Cloudflare (décidé par l'auteur le 15 novembre
2026). `server/` vient ensuite ; rien de ce qui est écrit ici ne doit
l'empêcher.

### Modules

Dans les trois modes, le même code calcule la partie : il reçoit les entrées
des joueurs, avance la partie d'un tick, et renvoie les messages à envoyer et
à qui. Il est écrit une seule fois et n'appelle aucune API de plateforme ;
chaque mode l'entoure d'une enveloppe qui fournit la minuterie et le
transport.

| Module | Contenu | Dépend de |
| --- | --- | --- |
| `packages/shared` | formats des messages ; réglages communs (tick, nombre de joueurs, longueur des noms, couleurs) | rien |
| `packages/engine` | la partie : grille (cases données, cases remplies, propriétaire de chaque case), bonshommes (position, direction), fonction de déplacement `move`, remplissage, pièges et trajectoire des boules (`ballAt`), fin de partie | rien |
| `packages/room` | salle d'attente (reprise de `Room` de Fronts of Iron, §7) et partie lancée : file des entrées ; `step()` applique les entrées, avance le moteur d'un tick et renvoie un snapshot par joueur. Tire la grille du catalogue que lui passe l'enveloppe, la transforme (`02-Grilles.md`) et garde la solution | `shared`, `engine` |
| `packages/catalog` | catalogue des grilles des parties en ligne, avec leurs solutions, écrit par le script de `02-Grilles.md` §1. **Jamais importé par le client** | rien |
| `client/` | page : accueil et salle d'attente en HTML ; partie affichée par Phaser (grille, bonshommes, PV, effets), clavier, prédiction de son bonhomme, interpolation des autres (§6) | `shared`, `engine`, Phaser ; `room` en solo |
| `worker/` | page, lobby, et enveloppe Durable Object d'une partie : WebSocket, `setInterval` du tick, inscription et signaux au lobby | `room`, `shared`, `catalog` |
| `server/` | enveloppe Node : serveur WebSocket, `setInterval`, `cloudflared`, inscription et signaux au lobby (plus tard) | `room`, `shared`, `catalog` |

Le client importe `packages/engine` pour deux fonctions : `move`, qui déplace
son propre bonhomme avant que l'hôte réponde (§3, Prédiction), et `ballAt`, la
position d'une boule (§3, Pièges et projectiles).

### Où tourne chaque composant

| Composant | Où il tourne | Ce qu'il fait |
| --- | --- | --- |
| Worker | Cloudflare | sert la page du jeu (fichiers statiques de `client/` compilé) |
| Lobby | Cloudflare, un Durable Object unique | tient la liste des parties ouvertes |
| Partie Cloudflare | Cloudflare, un Durable Object par partie | calcule la partie (`packages/room`), envoie un snapshot à chaque tick |
| Tunnel | Cloudflare (`cloudflared` sur le PC de l'hôte) | donne une adresse `https://` publique au serveur de l'hôte (plus tard) |
| Serveur | Node, sur le PC de l'hôte | calcule la partie (`packages/room`) (plus tard) |
| Client | navigateur de chaque joueur | interface ; en solo, `packages/room` dans un Web Worker |

## 2. Déroulement

Identique à Fronts of Iron (son `01-Architecture.md` §2) :

1. **Déploiement.** Un push sur `main` lance la GitHub Action : build du
   client, puis `wrangler deploy` dans `worker/`. Un déploiement redémarre les
   Durable Objects, donc coupe les parties Cloudflare en cours.
2. **Création d'une partie.** Hébergée par Cloudflare : un joueur la crée
   depuis la page (`POST /api/games/cloudflare`, mot de passe de création) ; le
   Durable Object de la partie s'inscrit au lobby quand l'hôte entre dans la
   salle. Hébergée par un joueur (plus tard) : le serveur Node démarre, lance
   `cloudflared`, et s'inscrit au lobby avec le secret du lobby.
   Dans les deux cas, un signal environ toutes les 30 s ; sans signal pendant
   90 s, le lobby retire la partie.
3. **Arrivée d'un joueur.** La page demande au lobby la liste des parties.
4. **Partie.** La page ouvre un WebSocket vers l'adresse de la partie. Le
   lobby n'intervient plus.

## 3. Modèle réseau : l'hôte calcule, le client affiche

### Ce qui change par rapport à Fronts of Iron

| | Fronts of Iron | Sudoku Deathmatch |
| --- | --- | --- |
| Où tourne la simulation | chez chaque client | à un seul endroit, l'hôte : Durable Object, Node, ou Web Worker du solo |
| Ce qui circule | ordres (client → hôte), puis tours (hôte → clients) | entrées (client → hôte) ; positions et événements (hôte → clients) |
| Le client | recalcule tout l'état | affiche ; ne calcule que son propre bonhomme (prédiction) et son contact avec les boules des tourelles |
| Déterminisme entre navigateurs | obligatoire | inutile ; le moteur reste sans horloge et à hasard seedé (`CLAUDE.md`, règle 2) |
| Reconnexion | rejoue tous les tours depuis le début | reçoit l'état courant |
| Hashes, désynchronisation | oui | n'existent pas : il n'y a qu'une copie de la partie |

### Pourquoi pas le lockstep

1. **Latence d'entrée.** En lockstep, le client n'applique son ordre qu'au
   retour du tour qui le contient : aller-retour réseau plus jusqu'à un pas,
   soit 100 à 250 ms entre la touche et le mouvement. Supprimer ce délai
   demande du rollback (resimuler les tours passés à chaque ordre arrivé en
   retard), donc un moteur strictement déterministe et rejouable.
2. **La solution de la grille.** En lockstep chaque client a l'état complet,
   solution comprise : elle se lit dans les outils du navigateur. Ici elle
   reste sur l'hôte ; le client envoie un chiffre, l'hôte le compare à la
   solution.
3. **Deux joueurs qui remplissent la même case au même moment** : l'hôte garde
   la première entrée reçue ; aucun client n'a à trancher.

### Tick et unités (provisoires)

- **Tick de 50 ms (20 Hz).** Constante de `packages/shared`, la même pour
  l'hôte et pour la prédiction du client. Contrairement au pas de Fronts of
  Iron, ce n'est pas un réglage de l'enveloppe : les vitesses sont en unités
  par tick, donc changer le tick change la vitesse des bonshommes. L'enveloppe
  appelle `step()` toutes les `TICK_MS` ; le moteur ne lit aucune horloge.
- **Positions entières** : 1 case = 1 000 unités, grille de 9 000 × 9 000
  (9 × 9 cases, provisoire, `02-Grilles.md` §4). Messages courts, et mêmes calculs
  exacts chez l'hôte et chez le client.

### Ce que le client envoie : sa direction, pas sa position

Décidé par l'auteur le 15 novembre 2026.

- `input {seq, dirs}` : une direction tient sur 4 bits (haut, bas, gauche,
  droite ; deux bits pour une diagonale) ; `dirs` est la liste des dernières
  directions envoyées, la plus récente en dernier, et sur WebSocket n'en
  contient qu'une (§3, Transport) ; `seq` numérote les entrées du joueur à
  partir de 1 et désigne la dernière de `dirs`. Le
  client lit l'état des flèches **une fois par tick** et n'envoie un `input`
  que si cet état a changé depuis le tick précédent : au plus un par tick. Un
  bonhomme dont la flèche reste appuyée avance sans nouveau message.
- L'hôte range les `input` de chaque joueur dans une file et en applique **un
  par tick**, dans l'ordre d'arrivée ; sans `input` en attente, il garde la
  dernière direction appliquée. Plus de 2 en attente (provisoire) : il ne garde
  que le dernier, pour qu'un retard ne s'accumule pas.
- `fill {seq, cell, digit}` : remplir la case `cell` (0 à 80) avec `digit`.
  L'hôte vérifie que le bonhomme est sur cette case (avec une tolérance près
  des bords, provisoire, pour un client dont la position prédite est
  légèrement en avance), que la case est vide, puis compare le chiffre à la
  solution. Chiffre faux : refusé, PV perdus (`00-Game.md` §1).
- `place {cell, kind}` : poser une mine ou une tourelle sur la case `cell`.
  L'hôte vérifie, avec la tolérance de `fill`, que le bonhomme est sur la case,
  qu'elle a été remplie par ce joueur et qu'elle n'a pas de piège.
- `hit {ball}` : la boule `ball` touche son bonhomme sur son écran (§3, Pièges
  et projectiles).

### Changements de direction rapprochés

Exemple : gauche, puis haut 30 ms plus tard.
- **Dans le même tick du client** : un seul `input`, avec l'état des flèches à
  la fin du tick (gauche + haut si les deux sont appuyées, haut seulement si
  gauche a été relâchée). Le client et l'hôte appliquent cette direction à
  partir du même tick.
- **Dans deux ticks différents** : deux `input`, dont chacun a duré au moins un
  tick chez le client. Le réseau peut les livrer dans le même tick de l'hôte
  (gigue) ; la file les applique quand même un par tick, donc le premier dure
  au moins un tick chez l'hôte aussi. Sans cette file, l'hôte n'appliquerait
  que le second. La file ne règle que ce cas : une entrée qui arrive plus tard
  ou plus tôt que prévu change la durée de la précédente (§3, Prédiction).
- Le WebSocket garde l'ordre des messages : l'hôte ne reçoit jamais haut avant
  gauche.
- **Ce qui est perdu** : une touche appuyée puis relâchée dans le même tick
  (moins de 50 ms, moins de 0,15 case de déplacement) n'est pas envoyée.
- **Ce que ça coûte** : une touche prend effet au début du tick suivant chez
  le client, donc 0 à 50 ms après l'appui (25 ms en moyenne). Si c'est
  sensible, passer le tick à 30 Hz (33 ms).

Résultat : tant que chaque entrée met le même temps à arriver, le client et
l'hôte calculent la même trajectoire, tick par tick, et la prédiction n'a rien
à corriger. Sinon, l'écart et sa correction : §3, Prédiction.

### Ce que l'hôte envoie : des positions absolues

- `snapshot {tick, players, ack}`, à chaque tick, à chaque joueur connecté.
  **Remplaçable** : complet en lui-même, il peut être perdu sans dommage, le
  suivant le remplace (§3, Transport).
  - `players` : `[[id, x, y, dir], …]`, tous les bonshommes non éliminés ;
  - `ack` : `[seq, since]`, la dernière entrée du destinataire appliquée par
    l'hôte et le nombre de ticks écoulés depuis. Seul champ propre au
    destinataire : le reste du message est le même pour tous.
- `events {tick, events}`, seulement pour un tick où il s'est passé quelque
  chose qui ne se déduit pas des positions : case remplie (case, chiffre,
  joueur) ; chiffre refusé (joueur, case, PV restants) ; PV max d'un joueur
  changés, quand il passe en retard ou en sort (`hp_max`, avec ses PV,
  envoyé avant le `filled` qui l'a causé) ; bonhomme éliminé
  (joueur) ; fin de partie (classement) ; piège posé (`placed`), pose refusée
  (`not_placed`, au seul joueur), mine qui explose et se recharge
  (`exploded`), boule qui apparaît (`ball`), part (`launched`), touche
  (`ball_hit`) ou disparaît faute de cible (`ball_gone`) (§3, Pièges et
  projectiles).
  **Doit arriver** : un événement perdu ne se rattrape pas au message suivant.
- `state {…}` : état complet de la partie (grille sans la solution, joueurs,
  leurs PV et leurs PV max, cases remplies et leur propriétaire), au lancement et à chaque
  reconnexion.

### Pourquoi les positions ne dérivent pas

- Le WebSocket passe par TCP : un paquet perdu est renvoyé, tous les messages
  arrivent, dans l'ordre. Une perte ne produit qu'un retard (le temps du
  renvoi, de l'ordre d'un aller-retour). Si la connexion coupe, le WebSocket
  se ferme ; le client se reconnecte et reçoit `state`.
- Un snapshot porte des positions absolues, pas des déplacements : il ne
  s'ajoute à rien. Une position fausse à l'écran est remplacée au snapshot
  suivant, 50 ms plus tard. (En lockstep, une erreur se garde jusqu'à la fin
  de la partie, d'où les hashes de Fronts of Iron.)
- Exemple : un `input` « gauche » arrive 200 ms en retard. L'hôte fait avancer
  le bonhomme 200 ms de trop dans l'ancienne direction (0,6 case à 3 cases/s),
  alors que l'écran du joueur l'a déjà fait tourner. Au snapshot suivant, le
  client voit l'écart et ramène le bonhomme vers la position de l'hôte : un
  glissement visible, rare (une perte de paquet).

### Transport : WebSocket, protocole prêt pour les datagrammes

Décidé par l'auteur le 15 novembre 2026, après une recherche sur ce que font
les autres jeux.

- **Le modèle est celui des jeux de référence** (Quake 3, Source, jeux .io) :
  le serveur calcule à pas fixe et envoie des snapshots de positions ; les
  clients envoient leurs touches, prédisent leur propre joueur et affichent les
  autres dans le passé. Ce qui diffère, c'est le transport : ces jeux utilisent
  l'UDP, où un snapshot perdu est sauté au lieu de bloquer les suivants.
- **Dans un navigateur, deux API passent par l'UDP** : WebRTC DataChannel en
  mode non fiable (`ordered: false`, `maxRetransmits: 0`), et WebTransport
  (datagrammes sur HTTP/3, disponible dans tous les navigateurs depuis Safari
  26.4, mars 2026). Les deux demandent un serveur capable de les recevoir.
- **Un Durable Object n'accepte que des WebSockets** (recherche du 15 novembre
  2026) : pas de WebTransport documenté, pas de pair WebRTC. Cloudflare
  Realtime relaie des DataChannels non fiables, mais seulement entre clients
  WebRTC ; un Durable Object ne peut pas les lire.
- **Donc : WebSocket**, pour les trois modes. Coût accepté : quand un paquet
  est perdu, TCP le renvoie et retarde les messages suivants d'environ un
  aller-retour, en partie absorbé par le délai d'interpolation.
- **Le protocole est prêt pour des datagrammes**, pour qu'un passage à
  WebTransport (si Cloudflare l'ouvre aux Durable Objects, ou dans `server/`)
  ne touche ni `packages/engine` ni `packages/room`, seulement les enveloppes et
  la connexion du client :
  - `snapshot` est remplaçable, `events` et `state` doivent arriver : sur des
    datagrammes, le premier passerait en datagramme, les deux autres sur un
    flux fiable ;
  - un `input` peut porter les dernières directions envoyées, pas seulement la
    nouvelle (`input {seq, dirs}`, la plus récente en dernier), pour qu'un
    datagramme perdu soit compensé par le suivant ; l'hôte ignore celles qu'il
    a déjà appliquées. Sur WebSocket, une seule direction par message.
    Provisoire : combien en répéter ;
  - sur datagrammes, le client enverrait un `input` à chaque tick pendant
    qu'une flèche est appuyée, et non plus seulement au changement : un
    « relâché » perdu laisserait sinon le bonhomme avancer. Ce serait jusqu'à
    20 messages par seconde et par joueur ; sans effet sur les quotas tant que
    `server/` n'est pas sur Cloudflare.

### Prédiction de son propre bonhomme

- Le client applique sa propre entrée au tick où il l'envoie, avec la même
  fonction `move` que l'hôte, sans attendre la réponse, et garde sa position
  prédite à chaque tick local. L'affichage interpole entre les deux derniers
  ticks prédits pour rester fluide à 60 images par seconde.
- À chaque snapshot, il reprend sa position au tick où il a appliqué l'entrée
  `ack.seq`, l'avance de `ack.since` ticks dans la direction de cette entrée,
  et compare le résultat à la position envoyée par l'hôte. L'écart est ajouté à
  sa position actuelle, réparti sur quelques images (provisoire).
- L'écart vient d'une direction qui ne dure pas le même nombre de ticks chez
  le client et chez l'hôte. Le client compte la durée sur ses propres ticks ;
  l'hôte applique l'entrée suivante au tick où elle arrive. Si elle met un peu
  plus (ou moins) longtemps que la précédente à arriver et tombe ainsi dans un
  autre tick, ou si la minuterie de l'hôte ne bat pas exactement au rythme de
  celle du client, l'hôte garde la direction précédente un tick de plus (ou de
  moins) : 0,15 case d'écart. C'est régulier, pas seulement quand un paquet est
  perdu ; la correction l'efface en environ 80 ms. Un message très retardé
  donne un écart plus grand (exemple du paragraphe « Pourquoi les positions ne
  dérivent pas »).

### Affichage des autres bonshommes

Affichés 100 ms dans le passé (2 snapshots, provisoire) : leur position est
interpolée entre les deux snapshots qui encadrent cet instant. Le délai
absorbe un snapshot en retard sans que le bonhomme s'arrête. Conséquence
acceptée : à l'écran, son propre bonhomme est en avance sur ceux des autres
d'environ 100 ms plus un demi aller-retour. Les bonshommes ne se frappent pas
(`00-Game.md` §1) ; pour les pièges et les projectiles, voir ci-dessous.

### Pièges et projectiles : qui détecte le contact

Décidé par l'auteur le 15 novembre 2026, implémenté le même jour (règles :
`03-Pieges.md` ; choix d'implémentation : §9).

Ce qui doit être juste (`03-Pieges.md` §1) : sur l'écran d'un joueur, le
contact entre **son** bonhomme et les projectiles et les pièges qu'il voit.
Celui des autres bonshommes peut paraître faux.

Deux cas :
- **un piège visible par tous** (la tourelle) **et ses projectiles** : le client
  détecte le contact avec son bonhomme, l'hôte contrôle (ci-dessous) ;
- **la mine**, camouflée chez les autres la plupart du temps : l'hôte détecte
  (ci-dessous, Mines).

- **Trajectoires calculables par tous.** L'hôte annonce chaque tir par un
  événement : projectile, point de départ, direction, vitesse, tick du départ.
  Une fonction de `packages/engine`, en entiers comme `move`, donne la position
  d'un projectile à n'importe quel tick ; l'hôte et le client utilisent la
  même. Un projectile n'entre pas dans les snapshots. Un piège ne bouge pas.
- **Dessinés à l'instant de son bonhomme.** Le client sait à quel tick de
  l'hôte correspond sa position prédite (l'`ack` donne le tick de l'hôte où
  son entrée a été appliquée). Il dessine projectiles et pièges à ce tick, pas
  dans le passé comme les autres bonshommes : sur son écran, son bonhomme et
  les dangers sont au même instant de la partie. Conséquence acceptée : un tir
  vers un autre bonhomme peut sembler le traverser, ou le toucher avant de
  l'atteindre.
- **Le client détecte.** À chaque tick, il teste son bonhomme, à la position
  où il le dessine, contre les projectiles et les pièges visibles ; au contact, il
  envoie `hit {id}`, et l'hôte retire les PV. Un même danger ne touche un
  bonhomme qu'une fois. Pourquoi pas l'hôte : sa position du bonhomme s'écarte
  régulièrement d'un tick de celle du client (§3, Prédiction), il se tromperait
  sur les tirs évités de justesse.
- **L'hôte contrôle.** Un client modifié qui n'envoie jamais `hit` serait
  invincible. L'hôte teste donc aussi chaque bonhomme, avec une zone de contact
  réduite d'une marge (0,3 case, provisoire) ; un contact trouvé ainsi compte
  même sans `hit`. Un tricheur ne gagne que les frôlements. Un joueur honnête
  n'est touché sans l'avoir vu que si sa position chez l'hôte s'écarte de plus
  que la marge, ce qui demande un message très retardé (un paquet perdu).
- **Un faux `hit` n'est pas un risque** tant qu'un contact n'a d'effet que sur
  le bonhomme touché : il ne retire des PV qu'à celui qui l'envoie. Si un
  contact a un jour d'autres effets (des points pour le poseur, un projectile
  qui disparaît), l'hôte devra vérifier que le contact était possible.
- **Délai d'avertissement.** Un danger créé par l'hôte au tick T arrive chez
  le client un trajet aller plus tard, alors que la prédiction du client a
  déjà un trajet aller d'avance : le client l'apprend environ un ping trop
  tard pour son propre écran. Un danger visible ne doit donc pas pouvoir
  toucher avant un délai plus long que le ping (`03-Pieges.md` §4). Un client
  qui apprend un danger trop tard ne teste pas le contact déjà passé
  (provisoire) ; le contrôle de l'hôte s'applique.
- **La tourelle fixe sa direction au départ de la boule** (`03-Pieges.md` §3,
  décidé par l'auteur le 15 novembre 2026). L'hôte annonce deux événements :
  l'apparition de la boule (tourelle, tick du départ), puis le départ
  (direction). La seconde d'apparition avertit du tir, pas de sa direction :
  le client apprend la direction environ un ping trop tard pour son propre
  écran, et dessine la boule là où elle est déjà arrivée à son instant, un peu
  avancée (0,15 case pour 1,5 case/s et 100 ms de ping). Le contact sur le bout
  de trajet qu'il n'a pas dessiné relève du contrôle de l'hôte (ci-dessus).
  Le canon est dessiné par chaque client d'après les positions qu'il affiche :
  il est décoratif et ne donne jamais la direction du tir.
- **Danger qui disparaît en touchant** : chaque client apprend en retard qu'un
  autre bonhomme l'a pris. Deux joueurs peuvent alors chacun le voir toucher
  leur propre bonhomme (`03-Pieges.md` §4).

**Mines.** Décidé par l'auteur le 16 novembre 2026 (`03-Pieges.md` §2) : la mine
est toujours visible par tous ; à la pose, un grand cadre se resserre sur la
case ; une mine qui explose se recharge 20 s, puis sa pose se rejoue.
- **La pose est annoncée à tous** (`placed`, et `state` à la reconnexion, avec
  le tick de la pose).
- **Tout se calcule à partir du tick de la pose** et des constantes de
  `packages/engine/src/config.ts` (`MINE_SHRINK_TICKS`, `MINE_ARM_TICKS`,
  `MINE_REST_TICKS`), au tick de l'hôte où le client dessine les pièges : le
  cadre qui se resserre, la recharge. Les clients voient donc tous la même
  chose au même tick de l'hôte, sans message de plus.
- **L'hôte détecte** l'entrée d'un bonhomme adverse dans la case, à partir de
  `pose + MINE_ARM_TICKS` (le grand cadre a atteint la case), et annonce
  l'explosion à tous (`exploded` : case, joueur touché, PV restants ; une mine
  enlève `MINE_DAMAGE` PV). Effet visible : l'explosion arrive sur l'écran de
  la victime environ un ping après que son bonhomme est entré dans la case.
- **Recharge** : à l'explosion, l'hôte reporte la pose de la mine de
  `MINE_REST_TICKS` (20 s) ; chaque client fait de même à partir du tick du
  message `exploded`. Une pose dans le futur veut dire « en recharge » : la
  mine est dessinée à 35 % pour tous, et l'hôte ne la déclenche pas.

### Remplissage, côté client

La case reste « en attente » jusqu'à l'événement de l'hôte (un aller-retour) :
le client n'a pas la solution et ne peut pas afficher le résultat lui-même.

## 4. Lobby et salle d'attente

Repris de Fronts of Iron (son `01-Architecture.md` §4), sans changement de
fonctionnement :

- un Durable Object `Lobby` unique, stockage SQLite, table `games` ;
- `GET /api/games`, `POST /api/games` et `POST /api/games/:id/heartbeat`
  (secret du lobby, pour `server/`), `POST /api/games/cloudflare` (mot de passe
  de création, secret du Worker `CREATE_PASSWORD`), `GET /api/games/:id/ws` ;
- toute erreur du Worker est `{error, message}`, `message` étant le texte que la
  page affiche ;
- salle d'attente : un hôte par partie, jeton d'hôte, jeton de joueur gardé par
  le navigateur pour revenir, couleurs, aucune arrivée après le lancement.

Messages de la salle repris : `join`, `welcome`, `room`, `set_color`, `start`,
`error`. Différences :

| Fronts of Iron | Sudoku Deathmatch |
| --- | --- |
| jusqu'à 100 joueurs | 2 à 4 |
| `set_map {map, seed}` | choix de la grille (difficulté), défini avec `02-Grilles.md` |
| `start` puis tours | `start` puis `state` et snapshots |
| `order`, `hash`, `turn`, `turns`, `desync` | `input`, `fill`, `snapshot`, `state` |
| `pause`, `paused` | pas de pause tant que `00-Game.md` n'en parle pas |
| reconnexion : départ + tous les tours | reconnexion : `state` |
| (rien) | `restart` : l'hôte relance une partie finie (`00-Game.md` §1, Fin de partie) ; chaque joueur connecté reçoit un nouveau `start`, qui porte l'`id` de l'hôte (`host`), puis `state` |

## 5. Hébergement et quotas

- **Cloudflare, plan gratuit**, sur le même compte que vitrine et Fronts of
  Iron (`2808dbbc2de69c79fa846846b70c00ef`) : les quotas du jour sont
  **partagés entre les trois**.
- Worker : `sudoku-deathmatch`, adresse
  `https://sudoku-deathmatch.paul-raynaud.workers.dev` (une fois déployé).
- **Le PC d'un joueur** (plus tard) : ne consomme aucun quota pendant la
  partie, seulement les signaux au lobby.

### Coût d'une partie Cloudflare

Le Durable Object facture les messages qu'il reçoit (20 messages = 1 requête)
et l'ouverture de chaque WebSocket ; les messages qu'il envoie sont gratuits.
Il est facturé à la durée (128 Mo) tant qu'il est en mémoire, ce qui est le cas
pendant toute la partie (un `setInterval` tourne).

Partie de 10 min (provisoire) à 4 joueurs, environ 3 entrées par seconde et par
joueur (non mesuré) :

| | Par partie | Quota du jour | Parties par jour |
| --- | --- | --- | --- |
| Requêtes | 4 × 3 × 600 = 7 200 messages, soit 360 requêtes + 4 ouvertures de WebSocket | 100 000 | ≈ 270 |
| Durée | 600 s × 0,125 Go = 75 GB-s | 13 000 GB-s | ≈ 170 |

Débit par client : 20 snapshots par seconde × environ 150 octets, soit 3 Ko/s.

C'est ce coût qui a fait choisir d'envoyer la direction plutôt que la position
(§8) : recevoir des positions de chaque client à chaque tick multiplierait les
requêtes par 4 à 7.

## 6. Client

Mêmes règles que Fronts of Iron (son §6, Client), pour que la page fonctionne
en local et servie par Cloudflare sans modification :

1. Le lobby est appelé par un chemin relatif (`/api/games`). En développement,
   Vite redirige `/api/*` vers `wrangler dev`, **WebSocket compris**
   (`ws: true`) ; sur Cloudflare, `run_worker_first = [ "/api/*" ]`.
2. L'adresse d'une partie vient du lobby, jamais du code.
3. Le Web Worker du solo est créé par
   `new Worker(new URL("…", import.meta.url), { type: "module" })`.
4. `[assets] directory` de `worker/wrangler.toml` est `../client/dist`.

Propre à ce jeu :

- **Une seule interface de connexion** pour le solo et le jeu en ligne :
  envoyer un message, recevoir un message. En ligne, c'est le WebSocket ; en
  solo, `postMessage` vers le Web Worker qui contient `packages/room` et sa
  minuterie de `TICK_MS`. Le reste de la page ne sait pas quel mode tourne.
- **Accueil et salle d'attente en HTML** (formulaires, listes) ; **la partie
  est affichée par Phaser**, dans un canvas (WebGL, ou canvas 2D en repli).
  Choix de l'auteur le 15 novembre 2026, parce que viendront des effets
  visuels, des particules, peut-être des tirs et des zombies (`00-Game.md`
  §3) : Phaser fournit particules, interpolations d'animation, sprites animés,
  caméra et chargement des images. Version 4.2.1 (dernière stable le
  15 novembre 2026). Phaser pèse 1,4 Mo minifié (357 Ko compressé) ; il est
  dans son propre fichier, chargé au lancement d'une partie (import dynamique).
- **Phaser ne fait qu'afficher et lire le clavier.** Les positions viennent de
  la prédiction (son bonhomme) et des snapshots (les autres) ; les cases, PV et
  éléments viennent des événements de l'hôte. La physique de Phaser (Arcade,
  Matter) ne décide de rien : un chiffre accepté, un PV perdu sont décidés par
  l'hôte ; le contact entre son bonhomme et un projectile ou un piège visible
  est calculé par le client, celui avec une mine par l'hôte, avec les
  fonctions de `packages/engine` (§3, Pièges et projectiles). Elle peut servir à
  des effets purement visuels (particules qui rebondissent).
- **Boucle d'affichage** : celle de Phaser (une image par rafraîchissement de
  l'écran). À chaque image : son bonhomme interpolé entre ses deux derniers
  ticks prédits (corrigé progressivement), les autres interpolés entre deux
  snapshots (§3), la grille et ses couleurs, les PV en haut de la grille.
- **Clavier** : l'état des flèches est lu une fois par tick (§3) ; jamais un
  `input` par image ni par événement clavier.
- **Tirs** : annoncés une fois par un événement, leur trajectoire est calculée
  par chaque client (§3, Pièges et projectiles) ; ils n'entrent pas dans les
  snapshots. Des zombies (idée non décidée, `00-Game.md` §3), qui
  ne suivraient pas une trajectoire fixée d'avance, y entreraient : avec
  beaucoup d'objets, un format binaire deviendra peut-être utile.

## 7. Repris de Fronts of Iron

Le code de Fronts of Iron appartient à l'auteur (`CLAUDE.md`, règle 1). Il est
copié puis adapté ; les deux dépôts évoluent ensuite séparément.

| Fichier de Fronts of Iron | Ici |
| --- | --- |
| `worker/src/lobby.ts`, `worker/src/index.ts`, `worker/src/env.ts`, leurs tests | repris (noms changés) |
| `worker/wrangler.toml`, `.github/workflows/deploy.yml` | repris (nom du Worker changé) |
| `worker/src/game.ts` (Durable Object `Game`) | adapté : tick de 50 ms, sans liste de tours ni hashes |
| `packages/relay/src/room.ts` (`Room`) | la salle d'attente est reprise ; la partie lancée est remplacée |
| `packages/shared` : noms, couleurs, `LobbyEntry`, messages de la salle, `ROOM_ERROR_TEXT` | repris |
| `client/vite.config.ts`, `client/src/online.ts` (adresse du WebSocket, jetons), accueil et salle d'attente | repris |
| `packages/relay/src/match.ts` (`Match` : tours, hashes), le moteur, le solo par tours, le protocole page ↔ Web Worker | non repris |

## 8. Décisions écartées, et pourquoi

| Écarté | Raison |
| --- | --- |
| Lockstep (Fronts of Iron) | latence d'entrée, solution lisible chez chaque client (§3) |
| Le client envoie sa position (10 à 20 fois par seconde), l'hôte la recopie | 1 200 à 2 400 requêtes par partie (40 à 80 parties par jour) ; un client peut envoyer n'importe quelle position. Écarté par l'auteur le 15 novembre 2026 |
| Le client envoie une entrée à chaque tick (réconciliation exacte, modèle courant des jeux d'action) | 20 messages par seconde et par joueur ; un client qui en envoie plus avance plus vite si l'hôte ne les plafonne pas |
| WebRTC entre navigateurs | demande un serveur de mise en relation et des serveurs STUN/TURN ; un Durable Object ne peut pas être un pair ; il faut de toute façon un hôte qui garde la solution |
| Positions envoyées par chaque client aux autres par Cloudflare Realtime (DataChannels non fiables) | un vrai flux UDP sur Cloudflare, mais c'est le client qui décide de sa position (triche), et l'hôte ne la voit plus : il ne peut ni vérifier qu'un bonhomme est sur la case qu'il remplit, ni décider plus tard d'un tir ou d'un contact. Écarté par l'auteur le 15 novembre 2026 |
| WebTransport ou WebRTC vers l'hôte dès la v1 | impossible avec un Durable Object (§3, Transport) ; possible seulement dans `server/`, qui attend. Le protocole est prêt pour ce passage |
| Grille en HTML (comme la maquette) | suffit pour 81 cases et 4 bonshommes, pas pour les effets visuels, particules et tirs prévus. Écarté par l'auteur le 15 novembre 2026 |
| Appliquer chaque touche dès l'événement clavier, entre deux ticks | l'hôte, qui avance par ticks, ne peut pas reproduire la même durée : chaque changement de direction rapproché produirait une petite correction |
| L'hôte seul détecte le contact entre un bonhomme et un projectile ou un piège visible | sa position du bonhomme s'écarte régulièrement d'un tick de celle du client (§3, Prédiction) : un tir évité de justesse à l'écran toucherait chez l'hôte. Variante, entrées datées par le client et appliquées par l'hôte avec un délai fixe : exacte hors paquet perdu, mais le bonhomme est vu 100 ms plus tard par les autres, et le délai doit être recalé quand les minuteries du client et de l'hôte dérivent. Écarté par l'auteur le 15 novembre 2026, au profit de la détection par le client avec contrôle de l'hôte |
| UDP | un navigateur ne peut pas faire d'UDP brut. TCP retarde les messages qui suivent un paquet perdu ; à 2 à 4 joueurs et 20 snapshots par seconde, le délai d'interpolation l'absorbe en général |

## 9. À vérifier, à décider, état d'avancement

À vérifier :

- La régularité d'un `setInterval` de 50 ms dans un Durable Object : non
  mesurée (Fronts of Iron tourne à 100 ms).
- Le nombre réel d'entrées par seconde et par joueur (estimé à 3, §5).
- WebTransport dans les Workers et les Durable Objects : absent de la
  documentation de Cloudflare le 15 novembre 2026 ; à surveiller (§3,
  Transport).

Provisoire, à régler en jouant : tick, unités, vitesse, délai d'interpolation,
répartition de la correction de prédiction, tolérance de remplissage, taille de
la file d'entrées de l'hôte, marge du contrôle des contacts par l'hôte (§3,
Pièges et projectiles), et les réglages des pièges (`03-Pieges.md`).

À décider avec l'auteur : les points ouverts de `00-Game.md` §3, de
`02-Grilles.md` §4 (niveaux de difficulté, taille du catalogue) et de
`03-Pieges.md` §4.

État :

1. **Fait (15 novembre 2026)** : dépôt, conventions (`CLAUDE.md`),
   `00-Game.md`, ce document. Aucun code.
2. **En cours** : étape 2, les grilles (`02-Grilles.md`). Décidé le
   15 novembre 2026 : catalogue pré-généré, transformé au lancement. Reste :
   les niveaux.
3. **Fait (15 novembre 2026) : première version (solo + Cloudflare).** Existe :
   `packages/shared`, `packages/engine`, `packages/room`, `packages/catalog`
   (script et catalogue), `worker/` (lobby, routes, Durable Object `Game` à
   50 ms), `client/` (accueil, salle d'attente, partie avec Phaser, solo dans un
   Web Worker), `.github/workflows/deploy.yml`. Vérifié : typecheck, build du
   client, build du Worker (`wrangler deploy --dry-run`), absence du catalogue
   en ligne dans `client/dist`. Pas vérifié : une partie jouée (à faire par
   l'auteur), `wrangler dev`, le déploiement. Pas de tests.

   Avant le premier push sur `main` : l'auteur ajoute au dépôt GitHub les
   secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` ; sans eux, la
   GitHub Action échoue. Après le premier déploiement : le secret du Worker
   `CREATE_PASSWORD` (`npx wrangler secret put CREATE_PASSWORD` dans `worker/`),
   sans lequel la création de parties répond `503`. `LOBBY_SECRET` attend
   `server/`.
4. **Fait (15 novembre 2026) : pièges** (`03-Pieges.md`, §3 Pièges et
   projectiles). Moteur (`packages/engine/src/game.ts`, `ball.ts`), hôte
   (`Match.place`, `Match.hit`, événements par destinataire dans `Room.step`,
   `state` par joueur), client (barre des pièges, touches, dessin, détection
   des boules dans `session.ts`). Vérifié : typecheck, build du client et du
   Worker, absence du catalogue en ligne dans `client/dist`. Pas vérifié : une
   partie jouée. En solo, une tourelle ne tire jamais et une mine n'explose
   jamais : il n'y a pas d'adversaire.
5. **Fait (15 novembre 2026) : fin de partie et couleurs.** Classement
   (survivants, puis éliminés du dernier au premier), bouton de relance de
   l'hôte sur la fenêtre de fin (`restart`), palette « Classique »
   (`client/src/colors.ts`). Vérifié : typecheck, build du client et du
   Worker. Pas vérifié : une partie jouée jusqu'au bout, une relance.
6. **Fait (16 novembre 2026) : mine camouflée** (commit `3105e12`), remplacée
   le jour même par la suivante (`03-Pieges-History.md`).
7. **Fait (16 novembre 2026) : mine toujours visible, tourelle, PV.** Mine en
   cadre à pointes visible par tous, posée avec le grand cadre qui se resserre,
   2 PV, recharge de 20 s ; tourelle qui tire toutes les 6 s, sans boule
   dessinée avant le tir ; 4 PV (5 au premier essai), rendus par chaque chiffre juste. Vérifié :
   typecheck, build du client et du Worker. Pas vérifié : une partie jouée.
8. **Fait (16 novembre 2026) : tutoriel** (`00-Game.md` §1). `<dialog
   id="tutorial">` dans `client/index.html`, ouvert par `showModal()` ;
   `client/src/tutorial.ts` écrit les cinq images en HTML (cases, bonhomme,
   mine, tourelle, bandeau des PV refaits en CSS, classes `.tuto-*` de
   `style.css`), pas avec Phaser : la fenêtre s'ouvre sur l'accueil, où Phaser
   n'est pas lancé. Un changement du dessin d'un piège dans `scene.ts` n'atteint
   donc pas le tutoriel : le refaire dans `style.css`. Vérifié : typecheck,
   build du client, absence du catalogue en ligne dans `client/dist`. Pas
   vérifié : l'affichage dans un navigateur.
9. **Fait (16 novembre 2026) : tourelles limitées, joueurs en retard**
   (`03-Pieges.md` §3, `00-Game.md` §1). Moteur : `TURRET_CELLS` et
   `CATCH_UP_HP` (`config.ts`), refus de la tourelle en trop dans
   `applyPlace`, `catchUp` après chaque chiffre juste. Réseau : événement
   `hp_max`, `hpMax` dans chaque joueur de `state` (le `hpMax` commun de
   `state` est retiré). Vérifié : typecheck, build du client et du Worker.
   Pas vérifié : une partie jouée. Le tutoriel ne parle d'aucune des deux
   règles.

### Choix faits à l'implémentation (provisoires)

- **Prédiction** (`client/src/play/session.ts`) : le client garde la direction
  de chacun de ses 256 derniers ticks et le tick local de chaque `seq`. À un
  snapshot, il repart de la position de l'hôte au tick local `tick(seq) +
  since` et rejoue ses directions jusqu'au tick courant ; l'écart est effacé en
  environ 80 ms, ou d'un coup au-delà de 2 cases.
- **Horloge de l'hôte vue du client** : heure locale d'arrivée moins `tick ×
  TICK_MS`, au plus petit des 40 derniers snapshots ; les autres bonshommes sont
  affichés 2 ticks avant le tick estimé.
- **Reconnexion** : l'hôte oublie la file et les numéros d'entrée du joueur
  (`Match.resetInputs`) ; la nouvelle page repart de `seq` 1.
- **Un remplissage sans réponse** de l'hôte après 3 s n'est plus affiché en
  attente. L'hôte répond `ignored` (sans perte de PV) pour une case déjà remplie
  ou un bonhomme trop loin de la case.
- **Clavier** : écouté sur la fenêtre (`KeyboardEvent.code`, donc ZQSD sur un
  clavier AZERTY et WASD sur QWERTY) ; le clavier de Phaser est désactivé.
- **Après la fin**, l'hôte n'envoie plus de snapshots ; le Durable Object et
  le Web Worker du solo arrêtent leur minuterie de ticks, et la relancent dès
  qu'une partie non finie existe (`restart`). Le Web Worker remet sa minuterie
  à `undefined` en l'arrêtant : sans cela, il ne relancerait jamais les ticks.
- **Relance** (`Room.#restart`) : les joueurs déconnectés sont retirés de la
  salle (leur jeton ne sert plus), les autres gardent leur `id` et leur
  couleur ; nouvelle grille du même niveau. La page remplace l'écran de partie
  à chaque `start`.
- **Classement** (`packages/engine/src/game.ts`) : chaque joueur garde le tick
  de son élimination (`outTick`) ; survivants triés par cases, éliminés par
  `outTick` décroissant, puis par cases ; à égalité, l'ordre de la salle.
- **Accueil et salle** : écrits à neuf d'après celui de Fronts of Iron, sans sa
  reprise automatique au chargement (« Reprendre » dans la liste).
- **Instant des dangers** (`session.ts`) : à chaque snapshot dont l'`ack`
  désigne une entrée connue, le client calcule `tickOffset` = tick de l'hôte
  − tick local (le tick local où il a appliqué l'entrée, plus `since`). Pièges
  et boules sont dessinés au tick de l'hôte `tick local − 1 + fraction +
  tickOffset`, celui de son bonhomme dessiné. Pour l'avoir vite, la première
  entrée d'une partie (ou d'une reconnexion) est envoyée même si aucune touche
  n'a changé. Sans `tickOffset`, le client ne teste aucun contact, et dessine
  au tick estimé de l'hôte plus 2.
- **Trajectoire d'une boule** (`packages/engine/src/ball.ts`) : direction en
  millièmes calculée par l'hôte au départ, position `centre + direction ×
  BALL_SPEED × (tick − départ) / 1000` arrondie vers zéro ; une boule
  entièrement sortie de la grille disparaît chez chacun sans événement.
- **Contact** : centres à moins de 0,35 case (rayon de la boule 0,15, du
  bonhomme 0,2). Le client teste à chaque tick local sa position dessinée ;
  l'hôte compte lui-même un contact sous 0,05 case (marge de 0,3 case). Une
  boule ne touche qu'une fois : elle disparaît.
- **Ordre d'un tick de l'hôte** : déplacements, remplissages, poses, contacts
  signalés, départs puis apparitions des boules, contrôle des boules, mines,
  fin de partie.
- **Limites par tick et par joueur** : 2 poses, 4 contacts signalés (comme les
  4 remplissages).
- **Canon** : dessiné vers le bonhomme adverse le plus proche tel que ce client
  l'affiche, et dans la direction de la boule pendant les 6 ticks qui suivent
  son départ.
- **Barre des pièges** : boutons grisés quand la case sous le bonhomme n'est
  pas à lui ou a déjà un piège, et celui de la tourelle quand une de plus
  dépasserait le tiers de ses cases (les poses en attente de réponse ne
  comptent pas : l'hôte refuse l'excédent) ; relus toutes les 150 ms ; un clic
  ne prend pas le focus du clavier.
- **Dessin de la mine** (`scene.ts`, `PlaySession.hazards`) : la session donne
  pour chaque mine sa phase (`MineLook` : cadre de la pose, recharge, rebond),
  Phaser la dessine. Cadre à pointes : carré de 32 px au centre de la case,
  trait de 2,5 px, deux pointes de 8 × 5 px au milieu de chaque côté. Cadre de
  la pose : calque au-dessus de tout, du bord de la grille au cadre de la
  mine, trait de 6 à 2,5 px ; le cadre à pointes rebondit de 12 % quand il
  l'atteint. Une mine dont la pose est à plus de 5 ticks dans le futur est en
  recharge.
- **Chiffre juste** : l'événement `filled` porte les PV du joueur, remis à son
  maximum par l'hôte (`START_HP`, ou `START_HP + CATCH_UP_HP` en retard).
- **Joueurs en retard** (`catchUp` dans `packages/engine/src/game.ts`) : relus
  après chaque chiffre juste, seul moment où un nombre de cases change. Le
  client ne les calcule pas lui-même : il prend `hpMax` dans `state` et
  `hp_max`.
- **Pastilles des PV** (`scene.ts`, `drawHud`) : une par PV max ; à 6 dans la
  case d'un joueur parmi 4, elles se resserrent (pas et rayon réduits).

## 10. Pièges

- **Mettre la solution dans un message** (`start`, `state`, un événement) « pour
  afficher plus vite » : n'importe quel joueur la lit dans les outils du
  navigateur. Le client attend l'événement de l'hôte.
- **Importer `packages/catalog` dans le client** : même fuite, pour toutes les
  grilles des parties en ligne (`02-Grilles.md` §1 et §5).
- **Envoyer une entrée à chaque image** (`requestAnimationFrame`, 60 par
  seconde) : chaque message reçu par le Durable Object est facturé ; le quota
  du jour tomberait à quelques parties. Un `input` ne part que quand les flèches
  changent.
- **Laisser le client décider** d'une case remplie ou de sa position : toute la
  vérification se fait dans `packages/room` (`CLAUDE.md`, règle 3).
- **Utiliser la physique de Phaser pour une règle** (collision, tir, PV) : elle
  calcule en virgule flottante, avec son propre pas de temps ; le contrôle des
  contacts par l'hôte, qui utilise `packages/engine`, trouverait autre chose
  que l'écran. Phaser affiche ; `packages/engine` calcule.
- **Dessiner les projectiles comme les autres bonshommes**, interpolés dans le
  passé : sur l'écran du joueur, ils seraient en retard d'environ un ping plus
  125 ms sur son bonhomme, et il se verrait touché par des tirs qu'il a
  évités, ou l'inverse. Ils sont dessinés au tick de son bonhomme (§3, Pièges
  et projectiles).
- **Un projectile dont la trajectoire dépend de ce qui se passe après le tir**
  (il suit sa cible, rebondit sur un bonhomme, dévie au hasard à chaque tick) :
  le client ne peut plus la calculer, et le contact sur son écran n'est plus
  exact. Tout ce qui fixe la trajectoire est dans l'événement du tir, et le
  calcul est en entiers, comme `move`.
- **Retirer le contrôle de l'hôte** « puisque le client détecte » : un client
  modifié qui n'envoie jamais `hit` devient invincible.
- **Faire détecter les mines par le client** « puisqu'il connaît leur
  position » : un client modifié ne signalerait jamais de contact. L'hôte
  détecte les mines.
- **Calculer le cadre de la pose ou la recharge d'une mine avec l'horloge du
  navigateur** (`Date.now()`, `performance.now()`) : chaque écran montrerait
  la mine à un autre moment. Tout part du tick de la pose et du tick de l'hôte où le
  client dessine les pièges (§3, Mines).
- **Supprimer une mine qui explose** : elle se recharge et reste sur sa case
  (`03-Pieges.md` §2) ; l'hôte reporte sa pose, les clients aussi.
- **Croire que la position de l'hôte ne s'écarte de celle du client que si un
  paquet est perdu** : elle s'écarte d'un tick chaque fois qu'une entrée change
  de tick en arrivant (§3, Prédiction).
- **Importer Phaser dans `packages/engine` ou `packages/room`** : ils ne
  tourneraient plus dans un Durable Object ni sous Node (`CLAUDE.md`,
  règle 2).
- **Mettre un événement dans `snapshot`** « pour faire un message de moins » :
  sur WebSocket rien ne casse, mais le jour où `snapshot` passe en datagramme,
  une case remplie ou un PV perdu disparaîtrait avec le paquet.
- **Remplacer la file d'entrées de l'hôte par « la dernière direction reçue »**
  : deux `input` livrés dans le même tick feraient perdre un tick de
  déplacement au premier, et le client corrigerait sa position.
- **Écrire une règle de partie dans une enveloppe** (le Durable Object, plus
  tard `server/`) au lieu de `packages/room` : les modes se comporteraient
  différemment. L'enveloppe ne fait que la minuterie et le transport.
- **Lire l'horloge dans le moteur** (`Date.now()`) : le moteur avancerait selon
  le temps de calcul et non selon le nombre de ticks, et la prédiction du
  client ne correspondrait plus. Le temps est le numéro de tick.
- **Changer `TICK_MS` d'un seul côté** : la prédiction du client et l'hôte ne
  déplaceraient plus le bonhomme de la même distance par tick. La constante est
  dans `packages/shared`, importée par les deux.
- **Calculer le déplacement avec `Math.hypot`, `Math.sin`, `Math.pow`…** dans
  `move` : la spécification JavaScript ne fixe pas leur résultat au dernier
  bit, l'hôte (Node, Cloudflare) et le navigateur peuvent donner des positions
  différentes, et la prédiction serait corrigée en permanence. Entiers
  seulement (la vitesse en diagonale avec une constante entière, par exemple
  707/1000).
- Les pièges du lobby, des Durable Objects et du proxy de Vite sont ceux de
  Fronts of Iron (son `01-Architecture.md` §10) : chemins relatifs,
  `ws: true`, `client/dist` à compiler avant `wrangler dev`, colonnes ajoutées
  par `ADDED_COLUMNS`, pas d'API d'hibernation pour `Game`.
