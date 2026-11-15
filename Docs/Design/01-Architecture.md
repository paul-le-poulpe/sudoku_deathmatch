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
| `packages/engine` | la partie : grille (cases données, cases remplies, propriétaire de chaque case), bonshommes (position, direction), fonction de déplacement `move`, remplissage, fin de partie | rien |
| `packages/room` | salle d'attente (reprise de `Room` de Fronts of Iron, §7) et partie lancée : file des entrées ; `step()` applique les entrées, avance le moteur d'un tick et renvoie un snapshot par joueur. Crée la grille (`02-Grilles.md`, à écrire) et garde la solution | `shared`, `engine` |
| `client/` | page : accueil, salle d'attente, grille en canvas 2D, clavier, prédiction de son bonhomme, interpolation des autres (§6) | `shared`, `engine` ; `room` en solo |
| `worker/` | page, lobby, et enveloppe Durable Object d'une partie : WebSocket, `setInterval` du tick, inscription et signaux au lobby | `room`, `shared` |
| `server/` | enveloppe Node : serveur WebSocket, `setInterval`, `cloudflared`, inscription et signaux au lobby (plus tard) | `room`, `shared` |

Le client importe `packages/engine` pour une seule raison : la fonction `move`,
qui déplace son propre bonhomme avant que l'hôte réponde (§3, Prédiction).

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
| Le client | recalcule tout l'état | affiche ; ne calcule que son propre bonhomme (prédiction) |
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
  (9 × 9 cases, provisoire, `00-Game.md` §3). Messages courts, et mêmes calculs
  exacts chez l'hôte et chez le client.

### Ce que le client envoie : sa direction, pas sa position

Décidé par l'auteur le 15 novembre 2026.

- `input {seq, dir}` : envoyé seulement quand l'ensemble des flèches appuyées
  change. `dir` sur 4 bits (haut, bas, gauche, droite) ; `seq` numérote les
  entrées du joueur à partir de 1. L'hôte garde la dernière direction reçue de
  chaque joueur et l'applique à chaque tick : un bonhomme dont la flèche reste
  appuyée avance sans nouveau message.
- `fill {seq, cell, digit}` : remplir la case `cell` (0 à 80) avec `digit`.
  L'hôte vérifie que le bonhomme est sur cette case (avec une tolérance près
  des bords, provisoire, pour un client dont la position prédite est
  légèrement en avance), que la case est vide, puis compare le chiffre à la
  solution. Ce que produit un mauvais chiffre : `00-Game.md` §3.

### Ce que l'hôte envoie : des positions absolues

- `snapshot {tick, players, ack, events}`, à chaque tick, à chaque joueur
  connecté :
  - `players` : `[[id, x, y, dir], …]`, tous les bonshommes ;
  - `ack` : `[seq, since]`, la dernière entrée du destinataire appliquée par
    l'hôte et le nombre de ticks écoulés depuis. Seul champ propre au
    destinataire : le reste du message est le même pour tous ;
  - `events` : ce qui s'est passé pendant ce tick et ne se déduit pas des
    positions : case remplie (case, chiffre, joueur), remplissage refusé ; plus
    tard éliminations et bonus.
- `state {…}` : état complet de la partie (grille sans la solution, joueurs,
  cases remplies et leur propriétaire), au lancement et à chaque reconnexion.

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

### Prédiction de son propre bonhomme

- Le client applique sa propre entrée tout de suite, avec la même fonction
  `move` que l'hôte et le même tick, et garde sa position prédite à chaque tick
  local.
- À chaque snapshot, il reprend sa position au tick où il a appliqué l'entrée
  `ack.seq`, l'avance de `ack.since` ticks dans la direction de cette entrée,
  et compare le résultat à la position envoyée par l'hôte. L'écart est ajouté à
  sa position actuelle, réparti sur quelques images (provisoire).
- L'écart vient de la différence entre la durée d'un appui vue par le client
  et vue par l'hôte (gigue du réseau) : de l'ordre d'un tick de déplacement.
  Il grandit seulement quand un message est retardé (exemple ci-dessus).

### Affichage des autres bonshommes

Affichés 100 ms dans le passé (2 snapshots, provisoire) : leur position est
interpolée entre les deux snapshots qui encadrent cet instant. Le délai
absorbe un snapshot en retard sans que le bonhomme s'arrête. Conséquence
acceptée : à l'écran, son propre bonhomme est en avance sur ceux des autres
d'environ 100 ms plus un demi aller-retour. Pour les collisions ou les attaques
entre bonshommes (`00-Game.md` §3), ce décalage devra être pris en compte par
l'hôte.

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
- **Boucle d'affichage** : `requestAnimationFrame`. À chaque image : son
  bonhomme à sa position prédite (corrigée progressivement), les autres
  interpolés (§3), la grille et ses couleurs d'après les événements reçus.
- **Clavier** : un `input` part à chaque changement de l'ensemble des flèches
  appuyées, jamais à chaque image.

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
| UDP | un navigateur ne peut pas faire d'UDP brut. TCP retarde les messages qui suivent un paquet perdu ; à 2 à 4 joueurs et 20 snapshots par seconde, le délai d'interpolation l'absorbe en général |

## 9. À vérifier, à décider, état d'avancement

À vérifier :

- La régularité d'un `setInterval` de 50 ms dans un Durable Object : non
  mesurée (Fronts of Iron tourne à 100 ms).
- Le nombre réel d'entrées par seconde et par joueur (estimé à 3, §5).

Provisoire, à régler en jouant : tick, unités, vitesse, délai d'interpolation,
répartition de la correction de prédiction, tolérance de remplissage.

À décider avec l'auteur : les points ouverts de `00-Game.md` §3 ; la génération
des grilles et les niveaux de difficulté (`02-Grilles.md`, étape 2).

État :

1. **Fait (15 novembre 2026)** : dépôt, conventions (`CLAUDE.md`),
   `00-Game.md`, ce document. Aucun code.
2. Étape 2 : génération des grilles et niveaux de difficulté.
3. Étape 3 : première version (solo + Cloudflare). Avant son premier push sur
   `main` : l'auteur ajoute au dépôt GitHub les secrets `CLOUDFLARE_API_TOKEN`
   et `CLOUDFLARE_ACCOUNT_ID`, puis crée les secrets du Worker `LOBBY_SECRET` et
   `CREATE_PASSWORD` (`npx wrangler secret put …` dans `worker/`). Sans eux, la
   GitHub Action et la création de parties échouent.

Pas de `deploy.yml` avant l'étape 3 : un push sur `main` lancerait
`wrangler deploy` sans Worker.

## 10. Pièges

- **Mettre la solution dans un message** (`start`, `state`, un événement) « pour
  afficher plus vite » : n'importe quel joueur la lit dans les outils du
  navigateur. Le client attend l'événement de l'hôte.
- **Envoyer une entrée à chaque image** (`requestAnimationFrame`, 60 par
  seconde) : chaque message reçu par le Durable Object est facturé ; le quota
  du jour tomberait à quelques parties. Un `input` ne part que quand les flèches
  changent.
- **Laisser le client décider** d'une case remplie ou de sa position : toute la
  vérification se fait dans `packages/room` (`CLAUDE.md`, règle 3).
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
