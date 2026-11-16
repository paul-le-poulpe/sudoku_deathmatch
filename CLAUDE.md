# Sudoku Deathmatch — conventions du projet

Jeu multijoueur dans le navigateur, 2 à 4 joueurs : chaque joueur déplace un
bonhomme sur une grille de Sudoku et remplit des cases. La base technique
(lobby Cloudflare, partie hébergeable sur Cloudflare, sur Node ou dans le
navigateur) vient de Fronts of Iron (`Projets code/fronts_of_iron/fronts_of_iron`),
mais le modèle réseau est différent : **l'hôte calcule la partie et envoie les
positions** ; il n'y a pas de lockstep (`Docs/Design/01-Architecture.md` §3).

**Les règles du jeu sont écrites avec l'auteur**, dans `Docs/Design/00-Game.md`
et dans les documents thématiques que 00-Game liste en tête. Tant qu'aucun de
ces documents ne tranche un point, aucune règle de jeu n'est implémentée ni
inventée.

**Où écrire une règle** :
- 00-Game est le point d'entrée : ce que le jeu est dans les grandes lignes,
  les règles qui n'ont pas de document à elles, et la liste des documents
  thématiques. Un domaine qui grossit a son propre document, qui fait foi pour
  ce domaine.
- **Une règle n'est écrite qu'à un seul endroit.** 00-Game garde au plus un
  résumé du domaine et renvoie au document thématique.
- Un document thématique ne contient que l'état actuel des règles, sans
  historique. Les discussions et les règles remplacées vont dans un fichier
  `-History` (par exemple `00-Game-History.md`), qui **ne fait jamais foi** :
  ne jamais implémenter à partir de lui.
- Ce que l'auteur n'a pas tranché mais qu'il faut choisir pour implémenter est
  marqué « provisoire » dans le document et listé à part.

À lire avant de toucher au code :
- `Docs/Design/00-Game.md` — ce que le jeu est, et ses points ouverts ;
- `Docs/Design/01-Architecture.md` — réseau, lobby, hôte, moteur : ce qui est
  décidé, pourquoi, et ce qu'une modification bien intentionnée casserait sans
  bruit ;
- `Docs/Design/02-Grilles.md` — grilles : catalogue pré-généré, transformé au
  lancement, mesure de la difficulté ; fait foi pour ce domaine.
- `Docs/Design/03-Pieges.md` — pièges posés sur ses cases : pose, mine,
  tourelle ; fait foi pour ce domaine.

---

## Structure

La racine du dépôt est ce dossier (`sudoku_deathmatch/sudoku_deathmatch/`,
celui qui contient `.git`), pas le dossier parent.

Tout existe (première version, 15 novembre 2026), sauf `server/` :

```
packages/
  shared/    formats des messages et réglages communs (tick, joueurs, noms, couleurs)
  engine/    la partie : grille, bonshommes, déplacement, remplissage, pièges, fin de partie
  room/      salle d'attente et partie côté hôte : entrées → moteur → snapshots ;
             tire la grille du catalogue, la transforme, garde la solution
  catalog/   grilles des parties en ligne et leurs solutions (02-Grilles.md) ;
             jamais importé par client/
client/      page du jeu (Vite + TypeScript) : accueil et salle d'attente en HTML,
             partie affichée par Phaser (affichage seulement, jamais une règle),
             prédiction de son bonhomme, interpolation des autres ; en solo,
             room + engine dans un Web Worker
worker/      Worker Cloudflare : sert client/dist + lobby (Durable Object) +
             parties hébergées par Cloudflare (un Durable Object `Game` par partie)
server/      Node : parties hébergées par un joueur (plus tard)
.github/workflows/deploy.yml   build, puis wrangler deploy dans worker/
Docs/Design/                   documents de conception
README.md                      lancer et jouer en local ; héberger une partie
```

`README.md` s'adresse à quelqu'un qui veut jouer ou héberger, pas au
développement. Quand une commande de lancement change, il est mis à jour dans
le même tour (règle 8).

Trois façons de jouer : solo, hébergé par un joueur, hébergé par Cloudflare
(`01-Architecture.md` §1). La logique de l'hôte n'est écrite que dans
`packages/room` ; `server/`, le Durable Object de partie et le solo n'en sont
que des enveloppes (minuterie, transport).

---

## Vérifier

Depuis la racine du dépôt, après `npm install` :

- `npm run typecheck` — typecheck TypeScript de tous les workspaces. Pas encore
  de tests.
- `npm run dev -w client` — le client sur `http://localhost:5173` (solo sans
  serveur ; `/api/*`, WebSocket compris, redirigé vers `wrangler dev`).
  `npm run build -w client` le compile dans `client/dist/`.
- `cd worker && npx wrangler dev` — Worker, lobby et parties Cloudflare en local
  sur `http://127.0.0.1:8787`, qui sert aussi la page : **compiler le client
  d'abord**. Secrets locaux dans `worker/.dev.vars` (copier
  `worker/.dev.vars.example`, ignoré par git).
- `npm run catalog` — régénère les deux catalogues de grilles
  (`packages/catalog/src/grids.ts` et `client/src/solo-grids.ts`, 02-Grilles
  §1). Réglages : `node packages/catalog/scripts/make-catalog.ts --online=100
  --solo=10 --seed=1`.
- Le catalogue en ligne ne doit jamais être dans la page : après un build,
  chercher une solution de `packages/catalog/src/grids.ts` dans `client/dist`
  ne doit rien trouver.
- Après une modification de `worker/wrangler.toml` :
  `cd worker && npm run types` (régénère `worker-configuration.d.ts`).

wrangler n'est pas installé globalement : toujours `npx wrangler`.

---

## Règles

### 1. Rien n'est copié d'un autre jeu

On ne reprend ni code, ni image, ni texte, ni grille d'un autre jeu. Le code
de Fronts of Iron appartient à l'auteur et peut être repris
(`01-Architecture.md` §7) ; ce que Fronts of Iron interdit (rien d'OpenFront)
reste interdit ici.

### 2. Le moteur et l'hôte n'utilisent aucune API de plateforme

`packages/engine` et `packages/room` tournent tels quels dans un Durable
Object, sous Node et dans un Web Worker du navigateur. Dans ces deux paquets :

- rien n'est importé de Node, de Cloudflare ni du navigateur (pas de
  `setInterval`, `WebSocket`, `process.env`, DOM) ;
- pas de `Date.now()` ni de `performance.now()` : le temps est le numéro de
  tick, et l'enveloppe appelle `step()` une fois par tick ;
- pas de `Math.random()` : le hasard vient d'un générateur seedé, ou de
  l'enveloppe (jetons).

Le déterminisme entre navigateurs n'est pas exigé (une seule copie de la
partie fait foi, celle de l'hôte). Mais la fonction de déplacement est
partagée par l'hôte et par la prédiction du client : elle calcule en entiers.

### 3. L'hôte fait autorité

Le client n'envoie que des entrées (direction, case et chiffre à remplir).
L'hôte calcule les positions, accepte ou refuse les remplissages, et envoie le
résultat. Un client ne décide jamais de sa position ni d'une case remplie.
Seule exception : le client signale lui-même qu'un projectile ou
un piège visible touche son propre bonhomme (un signalement ne fait du tort
qu'à lui), et l'hôte détecte aussi les contacts évidents, pour qu'un client qui
ne signale rien ne soit pas invincible. Le contact avec une mine est détecté
par l'hôte (`01-Architecture.md` §3, Pièges et projectiles).
**La solution de la grille ne quitte jamais l'hôte** : elle n'entre dans aucun
message, et `packages/catalog` (les grilles des parties en ligne) n'est jamais
importé par `client/`, ni directement ni par un autre paquet : le code de la
page est public.

### 4. L'hôte écrit l'expéditeur

L'identifiant du joueur d'une entrée est celui de la connexion qui l'a
envoyée. Un champ `player` envoyé par le client est ignoré.

### 5. Le serveur est autonome

`server/` lit ses réglages dans des variables d'environnement (`PORT`, adresse
du lobby, secret du lobby) et ne lit aucun fichier en dehors de `server/`.

### 6. Aucun secret dans le dépôt

Jetons Cloudflare dans les secrets GitHub (`CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`), secret du lobby dans un secret du Worker et dans un
`.env` ignoré par git côté serveur, mot de passe de création des parties
Cloudflare dans le secret du Worker `CREATE_PASSWORD`. Un `account_id` dans
`wrangler.toml` n'est pas un secret.

### 7. Déploiement : comme Fronts of Iron

Même workflow que `fronts_of_iron/.github/workflows/deploy.yml` (lui-même
calqué sur vitrine) : à chaque push sur `main`, installer Node et wrangler,
`npm ci`, compiler le client, puis `wrangler deploy` dans `worker/`. Ne rien
ajouter d'autre.

### 8. Mettre à jour la doc dans le même tour que le code

Quand une modification ajoute un système, change une règle écrite ici ou dans
`Docs/Design/`, ou corrige un bug qu'un retour en arrière réintroduirait, le
document concerné est mis à jour avant de terminer la tâche.
