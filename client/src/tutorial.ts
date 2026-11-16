// Tutoriel de l'accueil : une fenêtre modale (`<dialog id="tutorial">`) en cinq étapes, peu de mots,
// surtout des images, d'après la maquette « Sudoku Deathmatch — tutoriel ». Les images reprennent les
// dessins du jeu (cases, bonhomme, mine, tourelle, bandeau des PV) en HTML et CSS (style.css, .tuto-*).
// Rien ici ne vient d'un joueur : le contenu est fixe, d'où l'usage de `innerHTML`.

import { playerColor } from "./colors.ts";

const BLUE = playerColor(0);
const RED = playerColor(1);

function cell(bg: string, inner = "", extra = ""): string {
  return `<div class="tuto-cell${extra}" style="background:${bg}">${inner}</div>`;
}

function digit(d: number, opts: { color?: string; weight?: number } = {}): string {
  return `<span class="tuto-digit" style="color:${opts.color ?? "var(--ink)"};font-weight:${opts.weight ?? 700}">${d}</span>`;
}

function avatar(color: string, top = 18): string {
  return `<span class="tuto-avatar" style="--c:${color};top:${top}px"><span class="sh"></span><span class="bd"></span><span class="hd"></span></span>`;
}

function mine(color: string, alpha = 1): string {
  const spikes = ["t1", "t2", "b1", "b2", "l1", "l2", "r1", "r2"].map((k) => `<span class="sp ${k}"></span>`).join("");
  return `<span class="tuto-mine" style="--c:${color};opacity:${alpha}"><span class="sq"></span>${spikes}</span>`;
}

function turret(color: string, angle = 0): string {
  return `<span class="tuto-turret" style="--c:${color}"><span class="ring"></span><span class="cannon" style="transform:rotate(${angle}deg)"></span></span>`;
}

const ARROW = `<svg class="tuto-arrow" width="48" height="24" viewBox="0 0 48 24"><path d="M2 12 H42 M32 3 L44 12 L32 21" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SMALL_ARROW = `<svg class="tuto-arrow" width="40" height="20" viewBox="0 0 40 20"><path d="M2 10 H34 M26 3 L36 10 L26 17" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function key(label: string): string {
  return `<span class="tuto-key">${label}</span>`;
}

/** Case du joueur dans le bandeau des PV, comme dans le jeu : son nom et ses 4 pastilles. */
function slot(name: string, hp: number, out = false): string {
  const pips = [0, 1, 2, 3].map((n) => `<span class="tuto-pip${n < hp ? " on" : ""}"></span>`).join("");
  return `<div class="tuto-slot${out ? " out" : ""}" style="--c:${BLUE.color};--tint:${BLUE.tint};--ink2:${BLUE.ink}"><span class="tuto-slot-name">${out ? `${name} · éliminé` : name}</span><span class="tuto-pips">${pips}</span></div>`;
}

function pv(before: string, after: string, delta = ""): string {
  return `<div class="tuto-row tuto-pv">${before}${SMALL_ARROW}${after}<span class="tuto-delta">${delta}</span></div>`;
}

function trapButton(kind: "mine" | "turret", label: string, keyLabel: string): string {
  return `<span class="trap tuto-trap"><span class="trap-icon trap-icon-${kind}" style="--c:${BLUE.color}"></span><span class="trap-label">${label}</span><span class="trap-key">${keyLabel}</span></span>`;
}

/** Étoile à `n` branches autour de (cx, cy), rayons extérieur `ro` et intérieur `ri`. */
function star(cx: number, cy: number, ro: number, ri: number, n: number, rot: number): string {
  const pts: string[] = [];
  for (let k = 0; k < 2 * n; k++) {
    const r = k % 2 === 0 ? ro : ri;
    const a = rot + (Math.PI * k) / n;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function explosion(): string {
  const burst = `<svg class="tuto-burst" width="160" height="160" viewBox="0 0 160 160"><polygon points="${star(80, 80, 64, 30, 12, 0.1)}" fill="#F59E0B" opacity="0.95"/><polygon points="${star(80, 80, 40, 20, 10, 0.4)}" fill="#DC2626"/><circle cx="80" cy="80" r="12" fill="#FEF3C7"/></svg>`;
  const colors = ["#F59E0B", "#DC2626", "#FBBF24"];
  let sparks = "";
  for (let k = 0; k < 14; k++) {
    const a = (k * Math.PI * 2) / 14 + 0.15;
    const d = 74 + (k % 3) * 10;
    const s = 10 - (k % 3) * 2;
    sparks += `<span class="tuto-spark" style="left:${(56 + Math.cos(a) * d - s / 2).toFixed(1)}px;top:${(56 + Math.sin(a) * d - s / 2).toFixed(1)}px;width:${s}px;height:${s}px;background:${colors[k % 3]}"></span>`;
  }
  return burst + sparks;
}

interface Step {
  readonly title: string;
  readonly text: string;
  /** Écart vertical entre le haut de l'image et les PV. */
  readonly gap: number;
  readonly html: () => string;
}

const STEPS: readonly Step[] = [
  {
    title: "Remplissez une case",
    text: "Sur une case vide, tapez son chiffre. Juste : la case est à vous, et vos PV remontent au maximum.",
    gap: 104,
    html: () =>
      `<div class="tuto-row">${cell("#FFFFFF", `<span class="tuto-frame" style="--c:${BLUE.color}"></span>${avatar(BLUE.color)}`)}${key("7")}${ARROW}${cell(BLUE.tint, digit(7))}</div>` +
      pv(slot("Paul", 1), slot("Paul", 4)),
  },
  {
    title: "Attention aux erreurs",
    text: "Un chiffre faux ne vous laisse qu’un PV. S’il ne vous en restait qu’un, vous êtes éliminé.",
    gap: 56,
    html: () =>
      `<div class="tuto-row">${cell("#FECACA", digit(5, { color: "#78716C", weight: 500 }))}<span class="tuto-refused"><svg width="28" height="28" viewBox="0 0 28 28"><path d="M6 6 L22 22 M22 6 L6 22" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" fill="none"/></svg></span></div>` +
      pv(slot("Maxime", 4), slot("Maxime", 1)) +
      pv(slot("Philémon", 1), slot("Philémon", 0, true)),
  },
  {
    title: "Piégez vos cases",
    text: "Sur une case que vous avez remplie, posez une mine (A) ou une tourelle (E).",
    gap: 0,
    html: () =>
      `<div class="tuto-row tuto-row-wide">${cell(BLUE.tint, digit(7))}<div class="tuto-col">` +
      `<div class="tuto-row">${trapButton("mine", "Mine", "A")}${ARROW}${cell(BLUE.tint, mine(BLUE.color) + digit(7))}</div>` +
      `<div class="tuto-row">${trapButton("turret", "Tourelle", "E")}${ARROW}${cell(BLUE.tint, turret(BLUE.color) + digit(7))}</div>` +
      `</div></div>`,
  },
  {
    title: "La mine",
    text: "Un adversaire qui marche dessus perd 2 PV. Elle se recharge ensuite pendant 20 s.",
    gap: 64,
    html: () =>
      `<div class="tuto-row">${cell(RED.tint, mine(RED.color) + digit(3))}${ARROW}` +
      cell(RED.tint, explosion() + avatar(BLUE.color, 14), " tuto-boom") +
      `${ARROW}<div class="tuto-stack">${cell(RED.tint, mine(RED.color, 0.35) + digit(3))}<span class="tuto-tag">20 s</span></div></div>` +
      pv(slot("Maiko", 4), slot("Maiko", 2), "−2"),
  },
  {
    title: "La tourelle",
    text: "Toutes les 6 s, elle tire sur l’adversaire le plus proche : 1 PV. Un cercle annonce le tir : esquivez.",
    gap: 64,
    html: () =>
      `<div class="tuto-strip">${cell(RED.tint, turret(RED.color, 90) + digit(8))}${cell("#FFFFFF")}${cell("#FFFFFF")}${cell("#FFFFFF", avatar(BLUE.color))}` +
      `<span class="tuto-ball" style="--c:${RED.color};left:136px;top:46px;width:18px;height:18px;opacity:0.2"></span>` +
      `<span class="tuto-ball" style="--c:${RED.color};left:166px;top:44px;width:22px;height:22px;opacity:0.4"></span>` +
      `<span class="tuto-ball tuto-ball-main" style="--c:${RED.color};left:198px;top:39px;width:34px;height:34px"></span></div>` +
      pv(slot("Meimei", 4), slot("Meimei", 3), "−1"),
  },
];

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`élément #${id} absent`);
  return el;
}

/** Branche le bouton « Voir le tutoriel » de l'accueil et la fenêtre. */
export function setupTutorial(): void {
  const dialog = $("tutorial") as HTMLDialogElement;
  const illus = $("tuto-illus");
  const prev = $("tuto-prev") as HTMLButtonElement;
  const next = $("tuto-next") as HTMLButtonElement;
  const dots = STEPS.map((s, k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tuto-dot";
    b.setAttribute("aria-label", `Étape ${k + 1} : ${s.title}`);
    b.addEventListener("click", () => show(k));
    return b;
  });
  $("tuto-dots").replaceChildren(...dots);
  let step = 0;

  function show(k: number): void {
    step = Math.max(0, Math.min(STEPS.length - 1, k));
    const s = STEPS[step]!;
    $("tuto-count").textContent = `Comment jouer · ${step + 1} / ${STEPS.length}`;
    $("tuto-title").textContent = s.title;
    $("tuto-desc").textContent = s.text;
    illus.style.gap = `${s.gap}px`;
    illus.innerHTML = s.html();
    dots.forEach((d, i) => {
      if (i === step) d.setAttribute("aria-current", "step");
      else d.removeAttribute("aria-current");
    });
    prev.hidden = step === 0;
    next.textContent = step === STEPS.length - 1 ? "Jouer" : "Suivant";
  }

  $("home-tutorial").addEventListener("click", () => {
    show(0);
    dialog.showModal();
  });
  $("tuto-close").addEventListener("click", () => dialog.close());
  prev.addEventListener("click", () => show(step - 1));
  next.addEventListener("click", () => (step === STEPS.length - 1 ? dialog.close() : show(step + 1)));
  // Un clic sur le fond assombri, hors de la fenêtre, la ferme aussi ; Échap la ferme (dialog natif).
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
}
