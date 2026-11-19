// Croix tactile de l'écran de téléphone (00-Game §1, Écran de jeu sur téléphone) : une pièce en forme de
// plus, dessinée en SVG dans #game-cross. Un doigt posé dessus donne une direction, lue une fois par tick
// par la session comme celle du clavier (bits de `move`) ; il peut glisser d'une direction à l'autre sans
// se lever, et sortir de la croix. Les autres doigts restent libres pour le pavé et les pièges.
//
// Direction, d'après le point touché par rapport au centre, `a` étant la largeur d'une branche :
// - à moins de a/4 du centre : aucune ;
// - plus de a/2 à côté de l'axe horizontal et de l'axe vertical à la fois (les coins entre deux branches) :
//   la diagonale ;
// - ailleurs : la direction de l'axe le plus éloigné du centre (la branche sous le doigt).

import { DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP } from "@sudoku-deathmatch/engine";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Dessin : branches de A unités, coins extérieurs arrondis de R, ombre de 3 unités dessous. */
const A = 40;
const R = 6;

const SIDES = [
  ["up", DIR_UP],
  ["down", DIR_DOWN],
  ["left", DIR_LEFT],
  ["right", DIR_RIGHT],
] as const;

function svgEl(tag: string, attrs: Readonly<Record<string, string | number>>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Contour du plus, dans le sens des aiguilles d'une montre depuis le haut de la branche du haut. */
function crossPath(): string {
  const a = A;
  const arc = (x: number, y: number): string => `A${R} ${R} 0 0 1 ${x} ${y}`;
  return [
    `M${a + R} 0`, `H${2 * a - R}`, arc(2 * a, R), `V${a}`, `H${3 * a - R}`, arc(3 * a, a + R),
    `V${2 * a - R}`, arc(3 * a - R, 2 * a), `H${2 * a}`, `V${3 * a - R}`, arc(2 * a - R, 3 * a),
    `H${a + R}`, arc(a, 3 * a - R), `V${2 * a}`, `H${R}`, arc(0, 2 * a - R),
    `V${a + R}`, arc(R, a), `H${a}`, `V${R}`, arc(a + R, 0), "Z",
  ].join(" ");
}

function drawCross(): SVGElement {
  const a = A;
  const m = 1.5 * a;
  const svg = svgEl("svg", { viewBox: `-0.5 -0.5 ${3 * a + 1} ${3 * a + 4}` });
  const d = crossPath();
  svg.append(
    svgEl("path", { d, fill: "#D6D3D1", transform: "translate(0 3)" }),
    svgEl("path", { d, fill: "#FFFFFF", stroke: "#A8A29E", "stroke-width": 1 }),
  );
  // Fond de chaque branche, grisé quand elle est appuyée (style.css).
  const arms = { up: [a, 0], down: [a, 2 * a], left: [0, a], right: [2 * a, a] } as const;
  for (const [side] of SIDES) {
    const [x, y] = arms[side];
    svg.append(svgEl("rect", { class: `cross-arm cross-${side}`, x: x + 3, y: y + 3, width: a - 6, height: a - 6, rx: 4 }));
  }
  svg.append(svgEl("circle", { cx: m, cy: m, r: 0.18 * a, fill: "none", stroke: "#D6D3D1", "stroke-width": 1.5 }));
  const t1 = 0.35 * a;
  const t2 = 0.6 * a;
  const hw = 0.16 * a;
  const arrows = {
    up: [[m, t1], [m + hw, t2], [m - hw, t2]],
    down: [[m, 3 * a - t1], [m + hw, 3 * a - t2], [m - hw, 3 * a - t2]],
    left: [[t1, m], [t2, m - hw], [t2, m + hw]],
    right: [[3 * a - t1, m], [3 * a - t2, m - hw], [3 * a - t2, m + hw]],
  } as const;
  for (const [side] of SIDES) {
    const points = arrows[side].map(([x, y]) => `${x},${y}`).join(" ");
    svg.append(svgEl("polygon", { class: `cross-arrow cross-${side}`, points }));
  }
  return svg;
}

/** Direction (bits de `move`) du point (dx, dy) par rapport au centre de la croix, branches de `a` px. */
export function crossDir(dx: number, dy: number, a: number): number {
  if (Math.hypot(dx, dy) < a / 4) return 0;
  const h = dx > 0 ? DIR_RIGHT : DIR_LEFT;
  const v = dy > 0 ? DIR_DOWN : DIR_UP;
  if (Math.abs(dx) > a / 2 && Math.abs(dy) > a / 2) return h | v;
  return Math.abs(dx) >= Math.abs(dy) ? h : v;
}

export class TouchPad {
  readonly #el: HTMLElement;
  /** Le doigt qui tient la croix ; un second doigt posé dessus est ignoré. */
  #pointer: number | null = null;
  #dir = 0;

  constructor(el: HTMLElement) {
    this.#el = el;
    el.replaceChildren(drawCross());
  }

  readonly #down = (e: PointerEvent): void => {
    if (this.#pointer !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    this.#pointer = e.pointerId;
    this.#el.setPointerCapture(e.pointerId);
    this.#aim(e);
  };

  readonly #move = (e: PointerEvent): void => {
    if (e.pointerId === this.#pointer) this.#aim(e);
  };

  readonly #up = (e: PointerEvent): void => {
    if (e.pointerId !== this.#pointer) return;
    this.#pointer = null;
    this.#set(0);
  };

  /** La fenêtre perd le focus : le doigt levé ailleurs n'arriverait jamais. */
  readonly #blur = (): void => {
    this.#pointer = null;
    this.#set(0);
  };

  #aim(e: PointerEvent): void {
    const r = this.#el.getBoundingClientRect();
    const a = r.width / 3;
    this.#set(crossDir(e.clientX - (r.left + 1.5 * a), e.clientY - (r.top + 1.5 * a), a));
  }

  #set(dir: number): void {
    if (dir === this.#dir) return;
    this.#dir = dir;
    for (const [side, bit] of SIDES) this.#el.classList.toggle(side, (dir & bit) !== 0);
  }

  attach(): void {
    this.#el.addEventListener("pointerdown", this.#down);
    this.#el.addEventListener("pointermove", this.#move);
    this.#el.addEventListener("pointerup", this.#up);
    this.#el.addEventListener("pointercancel", this.#up);
    this.#el.addEventListener("lostpointercapture", this.#up);
    window.addEventListener("blur", this.#blur);
  }

  detach(): void {
    this.#el.removeEventListener("pointerdown", this.#down);
    this.#el.removeEventListener("pointermove", this.#move);
    this.#el.removeEventListener("pointerup", this.#up);
    this.#el.removeEventListener("pointercancel", this.#up);
    this.#el.removeEventListener("lostpointercapture", this.#up);
    window.removeEventListener("blur", this.#blur);
    this.#blur();
  }

  /** Direction du doigt posé en ce moment (bits de `move`). */
  dir(): number {
    return this.#dir;
  }
}
