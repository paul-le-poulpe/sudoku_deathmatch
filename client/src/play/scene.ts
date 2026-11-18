// Affichage de la partie avec Phaser (01-Architecture §6) : PV en haut, grille, pièges, boules,
// bonshommes, effets. Phaser ne fait qu'afficher : positions, cases, pièges et PV viennent de la session
// (session.ts), qui les tient de l'hôte et de la prédiction. Phaser n'est chargé qu'au lancement d'une
// partie (import dynamique).
//
// Dessins des pièges (maquette « Sudoku Deathmatch — pièges », 03-Pieges §2 et §3) : mine en « cadre à
// pointes », toujours visible, posée avec un grand cadre qui se resserre sur la case ; tourelle en anneau
// avec un canon carré, et un cercle qui se resserre la seconde avant le tir (planche « Nouvelles mines et
// tourelles »). Bouclier (maquette « Sudoku Deathmatch — bouclier », 03-Pieges §4) : contour « badge »,
// jauge de charge à droite, cercle de sa zone pour son poseur, bulle en anneau autour du bonhomme protégé.

import {
  BALL_RADIUS,
  BUBBLE_RADIUS,
  CATCH_UP_HP,
  GRID,
  SHIELD_UNITS,
  SHIELD_ZONE,
  START_HP,
} from "@sudoku-deathmatch/engine";

import { PLAYER_COLORS, hexToInt, playerColor, type PlayerColor } from "../colors.ts";
import type { PlaySession, ViewBall, ViewBubble, ViewTrap } from "./session.ts";

export const CELL_PX = 56;
export const BOARD_PX = 9 * CELL_PX;
export const VIEW_W = BOARD_PX;
/**
 * Bandeau des PV, au-dessus de la grille (00-Game §1) : deux joueurs par ligne, donc une ligne jusqu'à 2
 * joueurs et deux à 3 ou 4. Une ligne : 58 px (case de 50 px, 8 px d'écart), plus 6 px en haut.
 */
const HUD_COLS = 2;
const HUD_ROW = 58;

export function hudHeight(players: number): number {
  return 6 + HUD_ROW * Math.max(1, Math.ceil(players / HUD_COLS));
}

/** Hauteur de la vue : bandeau et grille. `screen.ts` en donne la même au conteneur avant que Phaser charge. */
export function viewHeight(players: number): number {
  return hudHeight(players) + BOARD_PX;
}

const INK = 0x1c1917;
const LINE = 0xd6d3d1;
const GIVEN_BG = 0xf5f5f4;
const EMPTY_BG = 0xffffff;
const FLASH_BG = 0xfecaca;
const PENDING_BG = 0xfef3c7;
/** Contour d'une pastille de PV perdu. */
const EMPTY_PIP = 0xa8a29e;
const REFUSED = "#DC2626";
const BLAST = "#F59E0B";

/** Unités du moteur → pixels de la grille. */
function px(u: number): number {
  return (u / GRID) * BOARD_PX;
}

/**
 * Bouclier (planches « Dessins » et « Jauge de charge ») : le badge, dessiné dans une case de 56 px puis
 * réduit à 90 % autour de (28, 28,5), trait de 3 px à l'écran ; la jauge, barre de 3 × 48 px à 49 px du bord
 * gauche et 4 px du haut, 3 unités de 14 px séparées par 2 interstices de 3 px de la couleur du fond de la
 * case, tous sur des pixels entiers (sinon les interstices paraissent inégaux).
 */
const BADGE_PATH = "M28 6C34 9.5 40 10.5 47 10V27C47 40 38 47 28 51C18 47 9 40 9 27V10C16 10.5 22 9.5 28 6Z";
const BADGE_SCALE = 0.9;
const BADGE_STROKE = 3;
const GAUGE_X = 49;
const GAUGE_Y = 4;
const GAUGE_W = 3;
const GAUGE_SEG = 14;
const GAUGE_GAP = 3;
const GAUGE_H = SHIELD_UNITS * GAUGE_SEG + (SHIELD_UNITS - 1) * GAUGE_GAP;
/** Cercle de la zone (planche « Zone du bouclier », C) : trait de 2 px à 55 %, fondu de 0,2 s. */
const ZONE_WIDTH = 2;
const ZONE_ALPHA = 0.55;
const ZONE_FADE_MS = 200;
/**
 * Contour des chiffres, de la couleur du fond de leur case : il coupe le cercle de la zone autour d'eux
 * (4 px de trait, donc 2 px autour du chiffre).
 */
const DIGIT_HALO = 4;
/**
 * Bulle (variante B de la maquette « charge du bouclier ») : anneau de 4 px à 75 %, en BUBBLE_DASHES traits
 * centrés sur des angles réguliers (le premier en haut) ; chaque trait couvre une part de son intervalle
 * égale à la charge sur SHIELD_UNITS, cercle complet quand le bouclier est plein. Fond à 8 %, anneau opaque
 * au moment d'arrêter une boule ; grossit en 220 ms, rapetisse en 180.
 */
const BUBBLE_RING = 4;
const BUBBLE_ALPHA = 0.75;
const BUBBLE_DASHES = 12;
const BUBBLE_IN_MS = 220;
const BUBBLE_OUT_MS = 180;
const BUBBLE_FLASH_MS = 220;
/** Ses propres boules (03-Pieges §3) : 15 % d'opacité, pour se concentrer sur celles des autres. */
const OWN_BALL_ALPHA = 0.15;

function hexOf(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Cadre de la mine : carré de 32 px au centre de la case (12 px du bord), trait de 2,5 px vers l'intérieur. */
const MINE_FRAME = 32;
/** Opacité du cadre à pointes d'une mine en recharge (03-Pieges §2, essai de l'auteur : 35 %). */
const RESTING_ALPHA = 0.35;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOut(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** De 0 à 1 en dépassant 1 d'environ 10 % avant d'y revenir. */
function easeOutBack(x: number): number {
  return 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
}

/** De 0 à 1 en passant d'abord un peu sous 0. */
function easeInBack(x: number): number {
  return 2.70158 * x ** 3 - 1.70158 * x ** 2;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

type ViewPlayer = ReturnType<PlaySession["view"]>[number];

/**
 * PV du retard (00-Game §1, maquette « PV de rattrapage », A) : losanges qui grossissent en 260 ms à
 * l'arrivée, rapetissent en 220 ms au départ ; « rattrapage » apparaît en 300 ms après 150 ms, disparaît
 * en 150 ms.
 */
const BONUS_IN_MS = 260;
const BONUS_OUT_MS = 220;
const LABEL_DELAY_MS = 150;
const LABEL_IN_MS = 300;
const LABEL_OUT_MS = 150;

/**
 * Cadre à pointes centré en (cx, cy), agrandi de `k` : le carré, et deux pointes de 8 px de large sur 5 de
 * haut au milieu de chaque côté, vers l'extérieur (planche « Mine toujours visible »).
 */
function spikedFrame(g: Phaser.GameObjects.Graphics, cx: number, cy: number, color: number, alpha: number, k: number): void {
  const h = (MINE_FRAME / 2) * k;
  const w = 2.5 * k;
  g.lineStyle(w, color, alpha);
  g.strokeRoundedRect(cx - h + w / 2, cy - h + w / 2, 2 * h - w, 2 * h - w, 2 * k);
  g.fillStyle(color, alpha);
  const half = 4 * k;
  const tip = 5 * k;
  for (const o of [-8 * k, 8 * k]) {
    g.fillTriangle(cx + o - half, cy - h, cx + o + half, cy - h, cx + o, cy - h - tip);
    g.fillTriangle(cx + o - half, cy + h, cx + o + half, cy + h, cx + o, cy + h + tip);
    g.fillTriangle(cx - h, cy + o - half, cx - h, cy + o + half, cx - h - tip, cy + o);
    g.fillTriangle(cx + h, cy + o - half, cx + h, cy + o + half, cx + h + tip, cy + o);
  }
}

export interface GameView {
  destroy(): void;
}

export async function createGameView(parent: HTMLElement, session: PlaySession, dir: () => number): Promise<GameView> {
  const P = (await import("phaser")) as unknown as typeof Phaser;
  await document.fonts.ready;

  const colorOf = (player: number): PlayerColor => playerColor(session.players.find((p) => p.id === player)?.color ?? 0);
  /** Haut de la grille : sous le bandeau des PV, d'une ou deux lignes. Les joueurs ne changent pas en partie. */
  const TOP = hudHeight(session.players.length);
  const cellCenter = (cell: number): [number, number] => [
    (cell % 9) * CELL_PX + CELL_PX / 2,
    TOP + Math.floor(cell / 9) * CELL_PX + CELL_PX / 2,
  ];

  class BoardScene extends P.Scene {
    board!: Phaser.GameObjects.Graphics;
    hud!: Phaser.GameObjects.Graphics;
    /** Boules : au-dessus des chiffres, sous les bonshommes. */
    balls!: Phaser.GameObjects.Graphics;
    /** Cadre de la pose d'une mine : au-dessus de tout. */
    overlay!: Phaser.GameObjects.Graphics;
    /** Bulles des boucliers : au-dessus des boules, sous les bonshommes. */
    bubbles!: Phaser.GameObjects.Graphics;
    /** Badge de chaque bouclier, par case : au-dessus du fond de la grille, sous les chiffres. */
    readonly badges = new Map<number, Phaser.GameObjects.Image>();
    /** Opacité du cercle de la zone de chacun de ses boucliers, par case, de 0 à 1. */
    readonly zoneFade = new Map<number, number>();
    /** Par joueur : bulle affichée ou non, depuis quand, où, et jusqu'à quand elle s'éclaire. */
    readonly bubbleLook = new Map<number, { shown: boolean; since: number; x: number; y: number; flash: number; charge: number }>();
    lastBoard = -1;
    readonly cellTexts: Phaser.GameObjects.Text[] = [];
    readonly cellCache: string[] = [];
    readonly nameTexts = new Map<number, Phaser.GameObjects.Text>();
    readonly bonusTexts = new Map<number, Phaser.GameObjects.Text>();
    /** Par joueur : losanges affichés ou non, depuis quand, et ses PV au dernier dessin affiché. */
    readonly bonus = new Map<number, { shown: boolean; since: number; hp: number }>();
    readonly sprites = new Map<number, Phaser.GameObjects.Image>();
    readonly emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>();

    constructor() {
      super("board");
    }

    create(): void {
      const g = this.make.graphics({}, false);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(5, 5, 5);
      g.generateTexture("dot", 10, 10);
      PLAYER_COLORS.forEach((c, i) => {
        g.clear();
        const color = hexToInt(c.color);
        g.fillStyle(INK, 0.25);
        g.fillEllipse(15, 34, 18, 6);
        g.fillStyle(color, 1);
        g.fillRoundedRect(7, 15, 16, 17, 6);
        g.lineStyle(2, 0xffffff, 1);
        g.strokeRoundedRect(7, 15, 16, 17, 6);
        g.fillCircle(15, 9, 6);
        g.strokeCircle(15, 9, 6);
        g.generateTexture(`avatar-${i}`, 30, 38);
      });
      g.destroy();
      // Badge du bouclier, une texture par couleur : dessiné par le canvas 2D, qui suit le chemin de la
      // maquette (courbes, angles arrondis), ce que les Graphics de Phaser ne font pas.
      const badge = new Path2D(BADGE_PATH);
      PLAYER_COLORS.forEach((c, i) => {
        const canvas = document.createElement("canvas");
        canvas.width = CELL_PX;
        canvas.height = CELL_PX;
        const ctx = canvas.getContext("2d");
        if (ctx === null) return;
        ctx.translate(28, 28.5);
        ctx.scale(BADGE_SCALE, BADGE_SCALE);
        ctx.translate(-28, -28.5);
        ctx.lineWidth = BADGE_STROKE / BADGE_SCALE;
        ctx.lineJoin = "round";
        ctx.strokeStyle = c.color;
        ctx.stroke(badge);
        this.textures.addCanvas(`badge-${i}`, canvas);
      });

      this.board = this.add.graphics();
      this.hud = this.add.graphics();
      this.balls = this.add.graphics().setDepth(8);
      this.bubbles = this.add.graphics().setDepth(9);
      this.overlay = this.add.graphics().setDepth(12);
      for (let i = 0; i < 81; i++) {
        const [cx, cy] = cellCenter(i);
        const t = this.add.text(cx, cy, "", { fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: "28px", color: "#1C1917" });
        t.setOrigin(0.5).setDepth(5);
        this.cellTexts.push(t);
        this.cellCache.push("");
      }
    }

    update(): void {
      const now = performance.now();
      session.frame(now, dir());
      const view = session.view(now);
      const hazards = session.hazards(now, view);
      this.drawBoard(now, hazards.traps);
      this.drawBalls(hazards.balls);
      this.drawBubbles(now, view, hazards.bubbles);
      this.drawHud(now, view);
      this.drawPlayers(view);
      this.playFx();
    }

    drawBoard(now: number, traps: readonly ViewTrap[]): void {
      const b = this.board;
      b.clear();
      for (let i = 0; i < 81; i++) {
        const own = session.owner[i]!;
        let bg = own === -1 ? GIVEN_BG : EMPTY_BG;
        let ink = "#1C1917";
        const weight = own === -1 ? "600" : own > 0 ? "700" : "500";
        let text = session.digits[i] ? String(session.digits[i]) : "";
        if (own > 0) {
          // Case remplie : fond clair du joueur, chiffre noir en gras (essai de l'auteur, 16 novembre 2026 ;
          // avant : chiffre dans la couleur `ink` du joueur).
          const c = playerColor(session.players.find((p) => p.id === own)?.color ?? 0);
          bg = hexToInt(c.tint);
        }
        const pending = session.pending.get(i);
        if (own === 0 && pending !== undefined) {
          bg = PENDING_BG;
          ink = "#78716C";
          text = String(pending.digit);
        }
        const flashUntil = session.flash.get(i);
        if (flashUntil !== undefined) {
          if (now < flashUntil) {
            bg = FLASH_BG;
          } else session.flash.delete(i);
        }
        b.fillStyle(bg, 1);
        b.fillRect((i % 9) * CELL_PX, TOP + Math.floor(i / 9) * CELL_PX, CELL_PX, CELL_PX);
        const key = `${text}|${ink}|${weight}|${bg}`;
        if (this.cellCache[i] !== key) {
          this.cellCache[i] = key;
          const t = this.cellTexts[i]!;
          t.setText(text);
          t.setColor(ink);
          t.setFontStyle(weight);
          t.setStroke(hexOf(bg), DIGIT_HALO);
        }
      }
      b.lineStyle(1, LINE, 1);
      for (let k = 1; k < 9; k++) {
        if (k % 3 === 0) continue;
        b.lineBetween(k * CELL_PX, TOP, k * CELL_PX, TOP + BOARD_PX);
        b.lineBetween(0, TOP + k * CELL_PX, BOARD_PX, TOP + k * CELL_PX);
      }
      b.lineStyle(3, INK, 1);
      for (const k of [3, 6]) {
        b.lineBetween(k * CELL_PX, TOP, k * CELL_PX, TOP + BOARD_PX);
        b.lineBetween(0, TOP + k * CELL_PX, BOARD_PX, TOP + k * CELL_PX);
      }
      b.strokeRect(1.5, TOP + 1.5, BOARD_PX - 3, BOARD_PX - 3);
      for (const t of traps) {
        if (t.kind === "shield") this.drawShield(b, t);
        else if (t.mine === null) this.drawTrap(b, t);
        else this.drawMine(b, t);
      }
      this.drawZones(b, now, traps);
      this.drawMinePoses(traps);
      const mine = session.myCell();
      if (mine >= 0) {
        const me = session.players.find((p) => p.id === session.you);
        b.lineStyle(3, hexToInt(playerColor(me?.color ?? 0).color), 1);
        b.strokeRect((mine % 9) * CELL_PX + 3.5, TOP + Math.floor(mine / 9) * CELL_PX + 3.5, CELL_PX - 7, CELL_PX - 7);
      }
    }

    /**
     * Mine (03-Pieges §2), vue de la même façon par tous : cadre à pointes de la couleur du poseur, avec un
     * rebond quand le grand cadre l'atteint ; à 35 % pendant la recharge ; rien tant que le grand cadre se
     * resserre (drawMinePoses).
     */
    drawMine(b: Phaser.GameObjects.Graphics, t: ViewTrap): void {
      const m = t.mine!;
      if (m.shrink !== null) return;
      const [cx, cy] = cellCenter(t.cell);
      spikedFrame(b, cx, cy, hexToInt(colorOf(t.owner).color), m.resting ? RESTING_ALPHA : 1, 1 + 0.12 * m.pulse);
    }

    /** Pose d'une mine : un cadre de la taille de la grille qui se resserre jusqu'au cadre de la mine. */
    drawMinePoses(traps: readonly ViewTrap[]): void {
      const o = this.overlay;
      o.clear();
      for (const t of traps) {
        if (t.mine === null || t.mine.shrink === null) continue;
        const color = hexToInt(colorOf(t.owner).color);
        const p = easeInOut(Math.min(1, t.mine.shrink));
        const x0 = (t.cell % 9) * CELL_PX + (CELL_PX - MINE_FRAME) / 2;
        const y0 = TOP + Math.floor(t.cell / 9) * CELL_PX + (CELL_PX - MINE_FRAME) / 2;
        const x = lerp(0, x0, p);
        const y = lerp(TOP, y0, p);
        const size = lerp(BOARD_PX, MINE_FRAME, p);
        const bw = lerp(6, 2.5, p);
        const radius = lerp(10, 3, p);
        o.fillStyle(color, 0.08 * (1 - p));
        o.fillRoundedRect(x, y, size, size, radius);
        o.lineStyle(bw + 2 * lerp(8, 0, p), color, 0.18);
        o.strokeRoundedRect(x + bw / 2, y + bw / 2, size - bw, size - bw, radius);
        o.lineStyle(bw, color, 1);
        o.strokeRoundedRect(x + bw / 2, y + bw / 2, size - bw, size - bw, radius);
      }
    }

    /**
     * Bouclier (03-Pieges §4), vu de la même façon par tous : le badge (une image par case, créée à la
     * première image où il apparaît) et la jauge de charge, remplie du bas vers le haut ; une unité entamée
     * se remplit sur ses 8 px, sans l'interstice au-dessus.
     */
    drawShield(b: Phaser.GameObjects.Graphics, t: ViewTrap): void {
      const c = colorOf(t.owner);
      const color = hexToInt(c.color);
      const x0 = (t.cell % 9) * CELL_PX;
      const y0 = TOP + Math.floor(t.cell / 9) * CELL_PX;
      if (!this.badges.has(t.cell)) {
        const index = session.players.find((p) => p.id === t.owner)?.color ?? 0;
        this.badges.set(t.cell, this.add.image(x0 + CELL_PX / 2, y0 + CELL_PX / 2, `badge-${index}`).setDepth(1));
      }
      const x = x0 + GAUGE_X;
      const y = y0 + GAUGE_Y;
      b.fillStyle(color, 0.2);
      b.fillRect(x, y, GAUGE_W, GAUGE_H);
      const charge = Math.max(0, Math.min(SHIELD_UNITS, t.charge));
      const whole = Math.floor(charge);
      const h = charge >= SHIELD_UNITS ? GAUGE_H : whole * (GAUGE_SEG + GAUGE_GAP) + (charge - whole) * GAUGE_SEG;
      b.fillStyle(color, 1);
      b.fillRect(x, y + GAUGE_H - h, GAUGE_W, h);
      b.fillStyle(hexToInt(c.tint), 1);
      for (let k = 1; k < SHIELD_UNITS; k++) b.fillRect(x, y + GAUGE_H - k * (GAUGE_SEG + GAUGE_GAP), GAUGE_W, GAUGE_GAP);
    }

    /**
     * Cercle de la zone de chacun de ses boucliers dont son bonhomme est dans la zone ou juste à côté
     * (session.ts, `zone`) : rayon de 1,5 case, en fondu. Dessiné sous les chiffres, dont le contour le coupe.
     */
    drawZones(b: Phaser.GameObjects.Graphics, now: number, traps: readonly ViewTrap[]): void {
      const dt = this.lastBoard < 0 ? 0 : now - this.lastBoard;
      this.lastBoard = now;
      for (const t of traps) {
        if (t.kind !== "shield") continue;
        const before = this.zoneFade.get(t.cell) ?? 0;
        const step = dt / ZONE_FADE_MS;
        const fade = t.zone ? Math.min(1, before + step) : Math.max(0, before - step);
        this.zoneFade.set(t.cell, fade);
        if (fade <= 0) continue;
        const [cx, cy] = cellCenter(t.cell);
        b.lineStyle(ZONE_WIDTH, hexToInt(colorOf(t.owner).color), ZONE_ALPHA * fade);
        b.strokeCircle(cx, cy, px(SHIELD_ZONE));
      }
    }

    /**
     * Bulles (03-Pieges §4), vues par tous : un anneau en pointillé de la couleur du joueur autour de son
     * bonhomme protégé, dont les traits montrent la charge du bouclier. Elle grossit quand il entre dans la
     * zone d'un bouclier chargé, rapetisse quand il en sort ou que la charge manque (avec la dernière charge
     * vue), et s'éclaire quand elle arrête une boule.
     */
    drawBubbles(now: number, view: readonly ViewPlayer[], bubbles: readonly ViewBubble[]): void {
      const g = this.bubbles;
      g.clear();
      const r = px(BUBBLE_RADIUS);
      for (const p of view) {
        const on = bubbles.find((q) => q.player === p.id);
        let look = this.bubbleLook.get(p.id);
        if (look === undefined) {
          look = { shown: false, since: -Infinity, x: p.x, y: p.y, flash: 0, charge: SHIELD_UNITS };
          this.bubbleLook.set(p.id, look);
        }
        const shown = on !== undefined && p.alive;
        if (shown !== look.shown) {
          look.shown = shown;
          look.since = now;
        }
        if (on !== undefined) look.charge = on.charge;
        if (p.alive) {
          look.x = p.x;
          look.y = p.y;
        }
        const t = now - look.since;
        const scale = shown ? easeOutBack(Math.min(1, t / BUBBLE_IN_MS)) : 1 - easeInBack(Math.min(1, t / BUBBLE_OUT_MS));
        if (scale <= 0.001 || !p.alive) continue;
        const color = hexToInt(playerColor(p.color).color);
        const x = px(look.x);
        const y = TOP + px(look.y) - 5;
        g.fillStyle(color, 0.08);
        g.fillCircle(x, y, r * scale);
        g.lineStyle(BUBBLE_RING, color, now < look.flash ? 1 : BUBBLE_ALPHA);
        const ring = Math.max(0, r * scale - BUBBLE_RING / 2);
        const part = clamp01(look.charge / SHIELD_UNITS);
        if (part >= 1) {
          g.strokeCircle(x, y, ring);
          continue;
        }
        const step = (2 * Math.PI) / BUBBLE_DASHES;
        const half = (step * part) / 2;
        for (let k = 0; k < BUBBLE_DASHES; k++) {
          const mid = -Math.PI / 2 + k * step;
          g.beginPath();
          g.arc(x, y, ring, mid - half, mid + half);
          g.strokePath();
        }
      }
    }

    /**
     * Le chiffre reste au centre ; le piège occupe l'espace autour (03-Pieges §1). Tourelle : anneau de
     * 44 px, canon carré de 10 px posé sur l'anneau, vers (ux, uy).
     */
    drawTrap(b: Phaser.GameObjects.Graphics, t: ViewTrap): void {
      const color = hexToInt(colorOf(t.owner).color);
      const x0 = (t.cell % 9) * CELL_PX;
      const y0 = TOP + Math.floor(t.cell / 9) * CELL_PX;
      const cx = x0 + CELL_PX / 2;
      const cy = y0 + CELL_PX / 2;
      b.lineStyle(2.5, color, 1);
      b.strokeCircle(cx, cy, 20.75);
      const mx = cx + t.ux * 21;
      const my = cy + t.uy * 21;
      const ax = t.ux * 5;
      const ay = t.uy * 5;
      const bx = -t.uy * 5;
      const by = t.ux * 5;
      b.fillStyle(color, 1);
      b.fillTriangle(mx + ax + bx, my + ay + by, mx + ax - bx, my + ay - by, mx - ax - bx, my - ay - by);
      b.fillTriangle(mx + ax + bx, my + ay + by, mx - ax - bx, my - ay - by, mx - ax + bx, my - ay + by);
    }

    /**
     * Boules : un cercle qui se resserre au centre de la tourelle la seconde avant le tir, puis la boule en
     * vol ; celles de ses propres tourelles à 15 % (le cercle d'avant le tir reste opaque).
     */
    drawBalls(balls: readonly ViewBall[]): void {
      const g = this.balls;
      g.clear();
      const r = px(BALL_RADIUS);
      for (const ball of balls) {
        const color = hexToInt(colorOf(ball.owner).color);
        const x = px(ball.x);
        const y = TOP + px(ball.y);
        if (ball.charging) {
          // La seconde avant le tir : seul un cercle qui se resserre ; la boule cacherait le chiffre
          // (03-Pieges §3).
          g.lineStyle(2, color, 0.25 + 0.6 * ball.progress);
          g.strokeCircle(x, y, r * (1 + 1.2 * (1 - ball.progress)) - 1);
          continue;
        }
        const a = ball.owner === session.you ? OWN_BALL_ALPHA : 1;
        g.fillStyle(INK, 0.25 * a);
        g.fillCircle(x, y + 1.5, r);
        g.fillStyle(color, a);
        g.fillCircle(x, y, r);
        g.lineStyle(2, 0xffffff, a);
        g.strokeCircle(x, y, r - 1);
      }
    }

    /**
     * Taille des losanges du retard (0 à 1, un peu plus pendant le rebond), opacité de « rattrapage », et
     * PV à montrer dans les losanges : pendant qu'ils rapetissent, ceux d'avant le retour à 4 (l'événement
     * `hp_max` a déjà retiré les PV au-dessus de 4).
     */
    bonusLook(now: number, p: ViewPlayer): { scale: number; label: number; hp: number } {
      const shown = p.hpMax > START_HP;
      let b = this.bonus.get(p.id);
      if (b === undefined) {
        // Premier dessin (début de partie, reconnexion) : pas d'animation.
        b = { shown, since: -Infinity, hp: p.hp };
        this.bonus.set(p.id, b);
      } else if (b.shown !== shown) {
        b.shown = shown;
        b.since = now;
      }
      if (shown) b.hp = p.hp;
      const t = now - b.since;
      if (shown) {
        return {
          scale: easeOutBack(Math.min(1, t / BONUS_IN_MS)),
          label: clamp01((t - LABEL_DELAY_MS) / LABEL_IN_MS),
          hp: b.hp,
        };
      }
      return { scale: 1 - easeInBack(Math.min(1, t / BONUS_OUT_MS)), label: 1 - clamp01(t / LABEL_OUT_MS), hp: b.hp };
    }

    drawHud(now: number, view: readonly ViewPlayer[]): void {
      const h = this.hud;
      h.clear();
      // Deux cases par ligne, dans l'ordre de la salle : les joueurs 3 et 4 sont sur la seconde.
      const slot = VIEW_W / Math.max(1, Math.min(HUD_COLS, view.length));
      view.forEach((p, k) => {
        const c = playerColor(p.color);
        const x0 = (k % HUD_COLS) * slot;
        const y0 = Math.floor(k / HUD_COLS) * HUD_ROW;
        const alpha = p.alive ? 1 : 0.45;
        h.fillStyle(p.you ? hexToInt(c.tint) : 0xffffff, alpha);
        h.fillRoundedRect(x0 + 4, y0 + 6, slot - 8, HUD_ROW - 8, 10);
        h.lineStyle(p.you ? 2 : 1, p.you ? hexToInt(c.color) : LINE, alpha);
        h.strokeRoundedRect(x0 + 4, y0 + 6, slot - 8, HUD_ROW - 8, 10);
        // Pastilles des PV (00-Game §1) : 4 ronds ; en retard, 2 losanges 8 px plus loin, puis « rattrapage ».
        // Pleines de gauche à droite : un joueur en retard perd d'abord les losanges.
        const color = hexToInt(c.color);
        const cy = y0 + 41;
        for (let k2 = 0; k2 < START_HP; k2++) {
          const cx = x0 + 22 + k2 * 22;
          if (k2 < p.hp) {
            h.fillStyle(color, alpha);
            h.fillCircle(cx, cy, 7);
          } else {
            h.lineStyle(2, EMPTY_PIP, alpha);
            h.strokeCircle(cx, cy, 7);
          }
        }
        const bonus = this.bonusLook(now, p);
        if (bonus.scale > 0) {
          for (let k2 = START_HP; k2 < START_HP + CATCH_UP_HP; k2++) {
            const cx = x0 + 30 + k2 * 22;
            // Demi-diagonale de 7 px : un carré de 10 px tourné de 45°.
            const d = 7 * bonus.scale;
            h.beginPath();
            h.moveTo(cx, cy - d);
            h.lineTo(cx + d, cy);
            h.lineTo(cx, cy + d);
            h.lineTo(cx - d, cy);
            h.closePath();
            if (k2 < bonus.hp) {
              h.fillStyle(color, alpha);
              h.fillPath();
            } else {
              h.lineStyle(2 * Math.min(1, bonus.scale), EMPTY_PIP, alpha);
              h.strokePath();
            }
          }
        }
        let tag = this.bonusTexts.get(p.id);
        if (tag === undefined) {
          tag = this.add.text(0, 0, "rattrapage", { fontFamily: "Inter, sans-serif", fontSize: "11px", color: "#57534E", fontStyle: "500" });
          tag.setOrigin(0, 0.5);
          this.bonusTexts.set(p.id, tag);
        }
        tag.setPosition(x0 + 30 + (START_HP + CATCH_UP_HP - 1) * 22 + 17, cy).setAlpha(alpha * bonus.label).setVisible(bonus.label > 0);
        let name = this.nameTexts.get(p.id);
        if (name === undefined) {
          name = this.add.text(x0 + 14, y0 + 11, "", { fontFamily: "Inter, sans-serif", fontSize: "14px", color: c.ink, fontStyle: "600" });
          this.nameTexts.set(p.id, name);
        }
        const label = p.alive ? p.name : `${p.name} · éliminé`;
        if (name.text !== label) name.setText(label);
        name.setPosition(x0 + 14, y0 + 11).setAlpha(alpha);
      });
    }

    drawPlayers(view: ReturnType<PlaySession["view"]>): void {
      for (const p of view) {
        let s = this.sprites.get(p.id);
        if (s === undefined) {
          s = this.add.image(0, 0, `avatar-${p.color}`).setDepth(p.you ? 11 : 10);
          this.sprites.set(p.id, s);
        }
        s.setVisible(p.alive);
        s.setPosition(px(p.x), TOP + px(p.y) - 6);
      }
    }

    emitter(hex: string): Phaser.GameObjects.Particles.ParticleEmitter {
      let e = this.emitters.get(hex);
      if (e === undefined) {
        e = this.add.particles(0, 0, "dot", {
          speed: { min: 60, max: 240 },
          lifespan: 650,
          scale: { start: 0.9, end: 0 },
          alpha: { start: 1, end: 0 },
          tint: hexToInt(hex),
          emitting: false,
        });
        e.setDepth(20);
        this.emitters.set(hex, e);
      }
      return e;
    }

    playFx(): void {
      for (const fx of session.fx.splice(0)) {
        const color = colorOf(fx.player).color;
        switch (fx.kind) {
          case "filled": {
            const [cx, cy] = cellCenter(fx.cell);
            this.emitter(color).explode(18, cx, cy);
            const t = this.cellTexts[fx.cell]!;
            this.tweens.add({ targets: t, scale: { from: 1.6, to: 1 }, duration: 260, ease: "Back.easeOut" });
            break;
          }
          case "refused": {
            const [cx, cy] = cellCenter(fx.cell);
            this.emitter(REFUSED).explode(12, cx, cy);
            if (fx.player === session.you) this.cameras.main.shake(160, 0.006);
            break;
          }
          case "eliminated":
            this.emitter(color).explode(48, px(fx.x), TOP + px(fx.y));
            break;
          case "placed": {
            const [cx, cy] = cellCenter(fx.cell);
            this.emitter(color).explode(10, cx, cy);
            break;
          }
          case "exploded": {
            // Petite explosion de la mine (03-Pieges §2).
            const [cx, cy] = cellCenter(fx.cell);
            this.emitter(BLAST).explode(36, cx, cy);
            this.emitter(REFUSED).explode(18, cx, cy);
            if (fx.player === session.you) this.cameras.main.shake(220, 0.01);
            break;
          }
          case "pop":
            this.emitter(color).explode(14, px(fx.x), TOP + px(fx.y));
            if (fx.victim === session.you) this.cameras.main.shake(140, 0.006);
            break;
          case "blocked": {
            // La boule éclate sur la bulle, qui s'éclaire un instant ; pas de secousse : rien n'est perdu.
            this.emitter(color).explode(10, px(fx.x), TOP + px(fx.y));
            const look = this.bubbleLook.get(fx.victim);
            if (look !== undefined) look.flash = performance.now() + BUBBLE_FLASH_MS;
            break;
          }
        }
      }
    }
  }

  const game = new P.Game({
    type: P.AUTO,
    parent,
    width: VIEW_W,
    height: viewHeight(session.players.length),
    backgroundColor: "#F5F5F4",
    banner: false,
    input: { keyboard: false },
    scene: BoardScene,
  });
  return { destroy: () => game.destroy(true) };
}
