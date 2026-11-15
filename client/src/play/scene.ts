// Affichage de la partie avec Phaser (01-Architecture §6) : PV en haut, grille, pièges, boules,
// bonshommes, effets. Phaser ne fait qu'afficher : positions, cases, pièges et PV viennent de la session
// (session.ts), qui les tient de l'hôte et de la prédiction. Phaser n'est chargé qu'au lancement d'une
// partie (import dynamique).
//
// Dessins des pièges : ceux retenus par défaut dans la maquette « Sudoku Deathmatch — pièges »
// (03-Pieges §2 et §3, provisoire) : mine en carré inscrit, tourelle en anneau avec un canon carré.

import { BALL_RADIUS, GRID } from "@sudoku-deathmatch/engine";

import { PLAYER_COLORS, hexToInt, playerColor, type PlayerColor } from "../colors.ts";
import type { PlaySession, ViewBall, ViewTrap } from "./session.ts";

export const CELL_PX = 56;
export const BOARD_PX = 9 * CELL_PX;
/** Bandeau des PV, au-dessus de la grille (00-Game §1). */
export const HUD_PX = 64;
export const VIEW_W = BOARD_PX;
export const VIEW_H = HUD_PX + BOARD_PX;

const INK = 0x1c1917;
const LINE = 0xd6d3d1;
const GIVEN_BG = 0xf5f5f4;
const EMPTY_BG = 0xffffff;
const FLASH_BG = 0xfecaca;
const PENDING_BG = 0xfef3c7;
const REFUSED = "#DC2626";
const BLAST = "#F59E0B";

/** Unités du moteur → pixels de la grille. */
function px(u: number): number {
  return (u / GRID) * BOARD_PX;
}

function cellCenter(cell: number): [number, number] {
  return [(cell % 9) * CELL_PX + CELL_PX / 2, HUD_PX + Math.floor(cell / 9) * CELL_PX + CELL_PX / 2];
}

export interface GameView {
  destroy(): void;
}

export async function createGameView(parent: HTMLElement, session: PlaySession, dir: () => number): Promise<GameView> {
  const P = (await import("phaser")) as unknown as typeof Phaser;
  await document.fonts.ready;

  const colorOf = (player: number): PlayerColor => playerColor(session.players.find((p) => p.id === player)?.color ?? 0);

  class BoardScene extends P.Scene {
    board!: Phaser.GameObjects.Graphics;
    hud!: Phaser.GameObjects.Graphics;
    /** Boules : au-dessus des chiffres, sous les bonshommes. */
    balls!: Phaser.GameObjects.Graphics;
    readonly cellTexts: Phaser.GameObjects.Text[] = [];
    readonly cellCache: string[] = [];
    readonly nameTexts = new Map<number, Phaser.GameObjects.Text>();
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

      this.board = this.add.graphics();
      this.hud = this.add.graphics();
      this.balls = this.add.graphics().setDepth(8);
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
      this.drawHud(view);
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
        let text = session.digits[i] ? String(session.digits[i]) : "";
        if (own > 0) {
          const c = playerColor(session.players.find((p) => p.id === own)?.color ?? 0);
          bg = hexToInt(c.tint);
          ink = c.ink;
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
        b.fillRect((i % 9) * CELL_PX, HUD_PX + Math.floor(i / 9) * CELL_PX, CELL_PX, CELL_PX);
        const key = `${text}|${ink}|${own === -1 ? 1 : 0}`;
        if (this.cellCache[i] !== key) {
          this.cellCache[i] = key;
          const t = this.cellTexts[i]!;
          t.setText(text);
          t.setColor(ink);
          t.setFontStyle(own === -1 ? "600" : own > 0 ? "700" : "500");
        }
      }
      b.lineStyle(1, LINE, 1);
      for (let k = 1; k < 9; k++) {
        if (k % 3 === 0) continue;
        b.lineBetween(k * CELL_PX, HUD_PX, k * CELL_PX, HUD_PX + BOARD_PX);
        b.lineBetween(0, HUD_PX + k * CELL_PX, BOARD_PX, HUD_PX + k * CELL_PX);
      }
      b.lineStyle(3, INK, 1);
      for (const k of [3, 6]) {
        b.lineBetween(k * CELL_PX, HUD_PX, k * CELL_PX, HUD_PX + BOARD_PX);
        b.lineBetween(0, HUD_PX + k * CELL_PX, BOARD_PX, HUD_PX + k * CELL_PX);
      }
      b.strokeRect(1.5, HUD_PX + 1.5, BOARD_PX - 3, BOARD_PX - 3);
      for (const t of traps) this.drawTrap(b, t);
      const mine = session.myCell();
      if (mine >= 0) {
        const me = session.players.find((p) => p.id === session.you);
        b.lineStyle(3, hexToInt(playerColor(me?.color ?? 0).color), 1);
        b.strokeRect((mine % 9) * CELL_PX + 3.5, HUD_PX + Math.floor(mine / 9) * CELL_PX + 3.5, CELL_PX - 7, CELL_PX - 7);
      }
    }

    /**
     * Le chiffre reste au centre ; le piège occupe l'espace autour (03-Pieges §1). Mine : carré inscrit à
     * 10 px du bord. Tourelle : anneau de 44 px, canon carré de 10 px posé sur l'anneau, vers (ux, uy).
     */
    drawTrap(b: Phaser.GameObjects.Graphics, t: ViewTrap): void {
      const color = hexToInt(colorOf(t.owner).color);
      const x0 = (t.cell % 9) * CELL_PX;
      const y0 = HUD_PX + Math.floor(t.cell / 9) * CELL_PX;
      if (t.kind === "mine") {
        b.lineStyle(2.5, color, 1);
        b.strokeRoundedRect(x0 + 10.25, y0 + 10.25, 35.5, 35.5, 2);
        return;
      }
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

    /** Boules : en attente au centre de la tourelle avec un cercle qui se resserre, puis en vol. */
    drawBalls(balls: readonly ViewBall[]): void {
      const g = this.balls;
      g.clear();
      const r = px(BALL_RADIUS);
      for (const ball of balls) {
        const color = hexToInt(colorOf(ball.owner).color);
        const x = px(ball.x);
        const y = HUD_PX + px(ball.y);
        if (ball.charging) {
          g.lineStyle(2, color, 0.25 + 0.6 * ball.progress);
          g.strokeCircle(x, y, r * (1 + 1.2 * (1 - ball.progress)) - 1);
        }
        g.fillStyle(INK, 0.25);
        g.fillCircle(x, y + 1.5, r);
        g.fillStyle(color, 1);
        g.fillCircle(x, y, r);
        g.lineStyle(2, 0xffffff, 1);
        g.strokeCircle(x, y, r - 1);
      }
    }

    drawHud(view: ReturnType<PlaySession["view"]>): void {
      const h = this.hud;
      h.clear();
      const slot = VIEW_W / Math.max(1, view.length);
      view.forEach((p, k) => {
        const c = playerColor(p.color);
        const x0 = k * slot;
        const alpha = p.alive ? 1 : 0.45;
        h.fillStyle(p.you ? hexToInt(c.tint) : 0xffffff, alpha);
        h.fillRoundedRect(x0 + 4, 6, slot - 8, HUD_PX - 14, 10);
        h.lineStyle(p.you ? 2 : 1, p.you ? hexToInt(c.color) : LINE, alpha);
        h.strokeRoundedRect(x0 + 4, 6, slot - 8, HUD_PX - 14, 10);
        for (let k2 = 0; k2 < session.hpMax; k2++) {
          const cx = x0 + 22 + k2 * 22;
          if (k2 < p.hp) {
            h.fillStyle(hexToInt(c.color), alpha);
            h.fillCircle(cx, 41, 7);
          } else {
            h.lineStyle(2, 0xa8a29e, alpha);
            h.strokeCircle(cx, 41, 7);
          }
        }
        let name = this.nameTexts.get(p.id);
        if (name === undefined) {
          name = this.add.text(x0 + 14, 11, "", { fontFamily: "Inter, sans-serif", fontSize: "14px", color: c.ink, fontStyle: "600" });
          this.nameTexts.set(p.id, name);
        }
        const label = p.alive ? p.name : `${p.name} · éliminé`;
        if (name.text !== label) name.setText(label);
        name.setPosition(x0 + 14, 11).setAlpha(alpha);
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
        s.setPosition(px(p.x), HUD_PX + px(p.y) - 6);
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
            this.emitter(color).explode(48, px(fx.x), HUD_PX + px(fx.y));
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
            this.emitter(color).explode(14, px(fx.x), HUD_PX + px(fx.y));
            if (fx.victim === session.you) this.cameras.main.shake(140, 0.006);
            break;
        }
      }
    }
  }

  const game = new P.Game({
    type: P.AUTO,
    parent,
    width: VIEW_W,
    height: VIEW_H,
    backgroundColor: "#F5F5F4",
    banner: false,
    input: { keyboard: false },
    scene: BoardScene,
  });
  return { destroy: () => game.destroy(true) };
}
