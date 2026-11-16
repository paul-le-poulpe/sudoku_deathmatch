# 03 — Pièges : historique

**Ne fait jamais foi** (`CLAUDE.md`, Où écrire une règle) : règles remplacées,
gardées pour savoir d'où vient l'état actuel. Ne jamais implémenter à partir de
ce document ; les règles en vigueur sont dans `03-Pieges.md`.

---

## Mine camouflée (15 et 16 novembre 2026, remplacée le 16 novembre 2026)

Implémentée dans le commit `3105e12`, remplacée par la mine toujours visible
(`03-Pieges.md` §2).

- Dessin : un carré inscrit dans la case, autour du chiffre.
- La pose se voyait par tous : un cadre de la taille de la grille se resserrait
  sur la case, puis la mine restait visible et inoffensive 2 s.
- Puis la case se retournait comme une carte (0,45 s) : les autres voyaient un
  chiffre donné (fond gris, chiffre noir), le poseur sa mine en pointillés.
- Révélation : 1,5 s toutes les 10 s, sur un cycle commun (ticks 170 à 199
  sur 200), les mines adverses se montraient en pointillés, dans la couleur de
  leur poseur, avec un fondu de 0,15 s.
- Une explosion coûtait 1 PV ; la mine se rechargeait 20 s (visible à 50 %),
  puis sa pose se rejouait avec le retournement.

Version d'avant (15 novembre 2026) : la mine n'était vue que de son poseur ; sa
position n'était envoyée qu'à lui ; elle disparaissait en explosant.

Raison du remplacement (l'auteur, 16 novembre 2026) : trop compliqué quand on
ne sait pas où sont les mines.

## Tourelle (15 novembre 2026, revue le 16 novembre 2026)

- La boule apparaissait au centre de la tourelle, par-dessus le chiffre, 1 s
  avant de partir. Remplacé : elle cachait le chiffre ; le cercle qui se
  resserre suffit à annoncer le tir.
- Une boule toutes les 3 s. Remplacé : 6 s, la tourelle tirait trop vite.
