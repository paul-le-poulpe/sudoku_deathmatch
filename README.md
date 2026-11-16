# Sudoku Deathmatch

Jeu multijoueur dans le navigateur, de 2 à 4 joueurs. L'arène est une grille de
Sudoku : chaque joueur déplace un bonhomme sur la grille et écrit des chiffres
dans les cases. Un chiffre juste colore la case de sa couleur ; un chiffre faux
coûte un point de vie, et à 0 le bonhomme est éliminé. Sur une case qu'il a
remplie, un joueur peut poser un piège : une mine, que tout le monde voit
2 s avant qu'elle se camoufle (elle se montre 1,5 s toutes les 10 s), ou une
tourelle, qui tire des boules lentes sur l'adversaire le plus proche. La partie finit quand la grille est pleine ou qu'il ne reste qu'un
bonhomme : le classement met d'abord les survivants (au nombre de cases
remplies), puis les éliminés, du dernier au premier, et l'hôte peut relancer
une partie.

En développement : les règles sont dans `Docs/Design/00-Game.md`, et les
valeurs de réglage (vitesse, niveaux…) sont des valeurs d'essai.

Ce qui se joue aujourd'hui : le **solo** (seul sur la grille, dans le
navigateur) et les **parties hébergées par Cloudflare** (on crée une partie, on
la rejoint, l'hôte la lance depuis la salle d'attente).

---

## Jouer en local

Prérequis : [Node.js](https://nodejs.org/) 24 ou plus récent, et le dépôt
cloné :

```bash
git clone https://github.com/paul-le-poulpe/sudoku_deathmatch.git
cd sudoku_deathmatch
npm install
```

### Solo

```bash
npm run dev -w client
```

Ouvrir `http://localhost:5173`, puis « Lancer le solo ». La liste des parties
affiche une erreur tant que le Worker ne tourne pas (ci-dessous) : c'est normal,
le solo n'en a pas besoin.

### Parties en ligne, sur le PC

1. Copier `worker/.dev.vars.example` en `worker/.dev.vars` (mot de passe de
   création : `dev-password`).
2. Compiler le client, puis lancer le Worker :
   ```bash
   npm run build -w client
   ```
   ```bash
   cd worker && npx wrangler dev
   ```
3. Ouvrir `http://127.0.0.1:8787` dans deux onglets ou deux navigateurs : l'un
   crée une partie, l'autre la rejoint.

Pour modifier le client sans le recompiler, garder `wrangler dev` lancé et
utiliser `npm run dev -w client` (`http://localhost:5173`), qui envoie `/api/*`
au Worker.

## Commandes

| Touche | Effet |
| --- | --- |
| Flèches, ou ZQSD | se déplacer (deux touches : en diagonale) |
| 1 à 9 | écrire ce chiffre dans la case sous le bonhomme |
| A (Q en QWERTY) | poser une mine sur la case sous le bonhomme, s'il l'a remplie |
| E | poser une tourelle sur la case sous le bonhomme, s'il l'a remplie |

En solo, les pièges se posent mais ne font rien : il n'y a pas d'adversaire.

## Mise en ligne

Chaque push sur `main` compile le client et déploie le Worker
(`.github/workflows/deploy.yml`). Il faut, une fois :

- les secrets GitHub du dépôt `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`
  (Settings › Secrets and variables › Actions) ;
- après le premier déploiement, le mot de passe de création des parties :
  `cd worker && npx wrangler secret put CREATE_PASSWORD`.

Adresse une fois déployé : `https://sudoku-deathmatch.paul-raynaud.workers.dev`.
