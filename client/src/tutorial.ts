// Tutoriel de l'accueil : une fenêtre modale (`<dialog id="tutorial">`) en sept étapes, peu de mots,
// surtout des images, d'après la maquette « Sudoku Deathmatch — tutoriel » (et, pour le bouclier et le coût
// des pièges, la maquette « Sudoku Deathmatch — bouclier »). Les images reprennent les dessins du jeu
// (cases, bonhomme, mine, tourelle, bouclier, bandeau des PV, boutons des pièges) en HTML et CSS
// (style.css, .tuto-* et .trap-*). Rien ici ne vient d'un joueur : le contenu est fixe, d'où l'usage de
// `innerHTML`.

import { playerColor, rgba } from "./colors.ts";

const BLUE = playerColor(0);
const RED = playerColor(1);

function cell(bg: string, inner = "", extra = ""): string {
  return `<div class="tuto-cell${extra}" style="background:${bg}">${inner}</div>`;
}

function digit(d: number, opts: { color?: string; weight?: number } = {}): string {
  return `<span class="tuto-digit" style="color:${opts.color ?? "var(--ink)"};font-weight:${opts.weight ?? 700}">${d}</span>`;
}

/**
 * La case `center` (une case de 112 px) au milieu de ses 8 voisines, pour qu'on la voie dans une grille de
 * Sudoku : `around` donne les chiffres donnés des voisines, ligne par ligne sans la case du milieu (`null` :
 * case vide). Deux traits épais font de la case du milieu le coin bas-droit d'un carré de 3 × 3. Le tout est
 * réduit à 216 px, et les bords s'effacent : la grille continue au-delà.
 */
function inGrid(center: string, around: readonly (number | null)[]): string {
  const cells = around.map((d) => (d === null ? cell("#FFFFFF") : cell("#F5F5F4", digit(d, { weight: 600 }))));
  cells.splice(4, 0, center);
  return `<div class="tuto-grid"><div class="tuto-grid-in">${cells.join("")}<span class="tuto-grid-v"></span><span class="tuto-grid-h"></span></div></div>`;
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

/**
 * Bouton d'un piège, comme dans le jeu (screen.ts) : `done` cases remplies sur les `per` qu'il demande (0 :
 * la mine, toujours disponible) ; le fond se remplit d'une part par case, sans séparateur, plein quand le
 * piège est prêt.
 */
function trapButton(kind: "mine" | "turret" | "shield", label: string, keyLabel: string, done = 0, per = 0): string {
  const ready = per === 0 || done >= per;
  const pct = ready ? 100 : (done * 100) / per;
  const vars = `--c:${BLUE.color};--tint:${BLUE.tint};--ink2:${BLUE.ink}`;
  return `<span class="trap tuto-trap ${ready ? "ready" : "unearned"}" style="${vars}"><span class="trap-fill" style="width:${pct}%"></span><span class="trap-icon trap-icon-${kind}"></span><span class="trap-label">${label}</span><span class="trap-key">${keyLabel}</span></span>`;
}

/** Badge du bouclier (scene.ts, BADGE_PATH), réduit à 90 %, trait de 3 px à l'échelle du jeu (6 px ici). */
const BADGE_PATH = "M28 6C34 9.5 40 10.5 47 10V27C47 40 38 47 28 51C18 47 9 40 9 27V10C16 10.5 22 9.5 28 6Z";

function badge(color: string): string {
  return `<svg class="tuto-badge" width="112" height="112" viewBox="0 0 56 56" aria-hidden="true"><path d="${BADGE_PATH}" transform="translate(28 28.5) scale(0.9) translate(-28 -28.5)" fill="none" stroke="${color}" stroke-width="3.33" stroke-linejoin="round"/></svg>`;
}

/**
 * Jauge du bouclier, deux fois celle du jeu : 3 unités de 28 px et 2 interstices de 6 px ; une unité
 * entamée se remplit sur ses 28 px.
 */
function gauge(charge: number): string {
  const units = 3;
  const seg = 28;
  const gap = 6;
  const h = units * seg + (units - 1) * gap;
  const whole = Math.floor(charge);
  const fill = charge >= units ? h : whole * (seg + gap) + (charge - whole) * seg;
  let seps = "";
  for (let k = 1; k < units; k++) seps += `<span class="sep" style="top:${h - k * (seg + gap)}px"></span>`;
  return `<span class="tuto-gauge" style="--c:${BLUE.color};--tint:${BLUE.tint};background:${rgba(BLUE.color, 0.2)}"><span class="fill" style="height:${fill}px"></span>${seps}</span>`;
}

function shieldCell(charge: number, d = 4): string {
  return cell(BLUE.tint, badge(BLUE.color) + gauge(charge) + digit(d));
}

/**
 * Bulle en anneau autour du bonhomme dessiné par `avatar(…, 18)` : rayon 0,4 case, anneau de 8 px à 75 %,
 * complet (bouclier plein ; scene.ts le dessine en pointillé quand il ne l'est pas).
 */
function bubble(color: string): string {
  return `<span class="tuto-bubble" style="background:${rgba(color, 0.08)};box-shadow:inset 0 0 0 8px ${rgba(color, 0.75)}"></span>`;
}

/** Éclats de la boule arrêtée par la bulle, autour de (x, y). */
function sparks(x: number, y: number, color: string): string {
  let out = "";
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + 0.3;
    out += `<span class="tuto-spark" style="left:${(x + Math.cos(a) * 26 - 4).toFixed(1)}px;top:${(y + Math.sin(a) * 26 - 4).toFixed(1)}px;width:8px;height:8px;background:${color}"></span>`;
  }
  return out;
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

/**
 * Voisines des cases des étapes 1 (le 7 juste) et 2 (le 5 faux) : aucun chiffre en double sur une ligne,
 * une colonne ou un carré, ni avec celui de la case du milieu.
 */
const AROUND_FILL = [3, null, 5, 8, 1, null, 6, 2] as const;
const AROUND_WRONG = [9, 2, null, null, 4, 1, null, 8] as const;

interface Step {
  readonly title: string;
  readonly text: string;
  /** Lien ajouté à la ligne sous `text`, ouvert dans un nouvel onglet. */
  readonly link?: { readonly label: string; readonly href: string };
  /** Écart vertical entre le haut de l'image et les PV. */
  readonly gap: number;
  readonly html: () => string;
}

const STEPS: readonly Step[] = [
  {
    title: "Remplissez une case",
    text: "Remplissez une case correctement pour la gagner.\nVos PV remonteront au maximum.",
    link: { label: "Règles du sudoku", href: "https://sudoku.com/fr/comment-jouer/regles-de-sudoku-pour-les-debutants-complets/" },
    gap: 104,
    html: () =>
      `<div class="tuto-row">${inGrid(cell("#FFFFFF", `<span class="tuto-frame" style="--c:${BLUE.color}"></span>${avatar(BLUE.color)}`), AROUND_FILL)}${key("7")}${ARROW}${inGrid(cell(BLUE.tint, digit(7)), AROUND_FILL)}</div>` +
      pv(slot("Paul", 1), slot("Paul", 4)),
  },
  {
    title: "Attention aux erreurs",
    text: "Un chiffre faux ne vous laisse qu’un PV. S’il ne vous en restait qu’un, vous êtes éliminé.",
    gap: 56,
    html: () =>
      `<div class="tuto-row">${inGrid(cell("#FECACA", digit(5, { color: "#78716C", weight: 500 })), AROUND_WRONG)}<span class="tuto-refused"><svg width="28" height="28" viewBox="0 0 28 28"><path d="M6 6 L22 22 M22 6 L6 22" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" fill="none"/></svg></span></div>` +
      pv(slot("Maxime", 4), slot("Maxime", 1)) +
      pv(slot("Philémon", 1), slot("Philémon", 0, true)),
  },
  {
    title: "Améliorez vos cases",
    text: "Sur une case que vous avez remplie, posez une mine (A), une tourelle (E) ou un bouclier (R).",
    gap: 0,
    html: () =>
      `<div class="tuto-row tuto-row-wide">${cell(BLUE.tint, digit(7))}<div class="tuto-col">` +
      `<div class="tuto-row">${trapButton("mine", "Mine", "A")}${ARROW}${cell(BLUE.tint, mine(BLUE.color) + digit(7))}</div>` +
      `<div class="tuto-row">${trapButton("turret", "Tourelle", "E")}${ARROW}${cell(BLUE.tint, turret(BLUE.color) + digit(7))}</div>` +
      `<div class="tuto-row">${trapButton("shield", "Bouclier", "R")}${ARROW}${shieldCell(3, 7)}</div>` +
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
    text: "Elle tire sur l’adversaire le plus proche et lui retire un PV.",
    gap: 64,
    html: () =>
      `<div class="tuto-strip">${cell(RED.tint, turret(RED.color, 90) + digit(8))}${cell("#FFFFFF")}${cell("#FFFFFF")}${cell("#FFFFFF", avatar(BLUE.color))}` +
      `<span class="tuto-ball" style="--c:${RED.color};left:136px;top:46px;width:18px;height:18px;opacity:0.2"></span>` +
      `<span class="tuto-ball" style="--c:${RED.color};left:166px;top:44px;width:22px;height:22px;opacity:0.4"></span>` +
      `<span class="tuto-ball tuto-ball-main" style="--c:${RED.color};left:198px;top:39px;width:34px;height:34px"></span></div>` +
      pv(slot("Meimei", 4), slot("Meimei", 3), "−1"),
  },
  {
    title: "Le bouclier",
    text: "Il vous protège, mais doit se recharger.",
    // Le cercle de la zone dépasse de 112 px au-dessus et au-dessous de la bande de cases.
    gap: 130,
    html: () =>
      `<div class="tuto-strip">${shieldCell(3)}${cell("#FFFFFF", bubble(BLUE.color) + avatar(BLUE.color))}${cell("#FFFFFF")}${cell(RED.tint, turret(RED.color, -90) + digit(8))}` +
      `<span class="tuto-zone" style="border-color:${rgba(BLUE.color, 0.55)}"></span>` +
      `<span class="tuto-ball" style="--c:${RED.color};left:290px;top:47px;width:18px;height:18px;opacity:0.2"></span>` +
      `<span class="tuto-ball" style="--c:${RED.color};left:250px;top:45px;width:22px;height:22px;opacity:0.4"></span>` +
      sparks(213, 58, RED.color) +
      `</div>` +
      `<div class="tuto-row">${shieldCell(3)}${ARROW}${shieldCell(2)}<span class="tuto-tag">1 boule arrêtée :<br>un cran de moins</span></div>`,
  },
  {
    title: "Le coût des pièges",
    // Retours à la ligne : `.tuto-desc` est en `white-space: pre-line`.
    text: "Mine : gratuite.\nTourelle : 3 cases remplies.\nBouclier : 5 cases remplies.\n\nLe bouton se remplit pour chaque case trouvée.\nBouton plein : le piège est prêt.",
    gap: 0,
    html: () =>
      `<div class="tuto-col">` +
      `<div class="tuto-row">${trapButton("mine", "Mine", "A")}<span class="tuto-tag">Gratuite, sur chacune de vos cases</span></div>` +
      `<div class="tuto-row">${trapButton("turret", "Tourelle", "E", 1, 3)}<div class="tuto-stack">${SMALL_ARROW}<span class="tuto-tag">3 cases remplies</span></div>${trapButton("turret", "Tourelle", "E", 3, 3)}</div>` +
      `<div class="tuto-row">${trapButton("shield", "Bouclier", "R", 1, 5)}<div class="tuto-stack">${SMALL_ARROW}<span class="tuto-tag">5 cases remplies</span></div>${trapButton("shield", "Bouclier", "R", 5, 5)}</div>` +
      `</div>`,
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
    const desc = $("tuto-desc");
    desc.textContent = s.text;
    if (s.link !== undefined) {
      const a = document.createElement("a");
      a.href = s.link.href;
      a.textContent = s.link.label;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      desc.append("\n", a);
    }
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
