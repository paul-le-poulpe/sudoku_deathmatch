// L'écran de partie : la vue Phaser (scene.ts), et autour en HTML les boutons des chiffres et des pièges,
// le message, le panneau des joueurs et le classement de fin. Créé au message `start`, détruit en
// quittant la partie.

import type { ClientMessage, ServerMessage, TrapKind } from "@sudoku-deathmatch/shared";

import { playerColor } from "../colors.ts";
import { LEVEL_LABEL } from "../levels.ts";
import { Keyboard } from "./keyboard.ts";
import { createGameView, viewHeight, type GameView } from "./scene.ts";
import { PlaySession } from "./session.ts";

export interface PlayController {
  onMessage(msg: ServerMessage): void;
  destroy(): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Couronne du gagnant : un seul polygone jaune, bandeau à coins carrés, deux pointes en triangle rectangle
 * sur les côtés et une au milieu (d'un seul tenant : deux formes accolées laisseraient un trait de fond).
 */
function crown(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "crown");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "13");
  svg.setAttribute("viewBox", "0 0 40 24");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Gagnant");
  const shape = document.createElementNS(SVG_NS, "polygon");
  shape.setAttribute("points", "4,21 4,3 14,14 20,3 26,14 36,3 36,21");
  shape.setAttribute("fill", "#FFC107");
  svg.append(shape);
  return svg;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`élément #${id} absent`);
  return el;
}

export function startPlay(options: {
  readonly start: Extract<ServerMessage, { type: "start" }>;
  readonly title: string;
  readonly send: (msg: ClientMessage) => void;
  readonly onQuit: () => void;
}): PlayController {
  const session = new PlaySession(options.start, options.send);
  const keyboard = new Keyboard();
  keyboard.onDigit = (d) => session.pressDigit(d, performance.now());
  keyboard.onTrap = (kind) => session.pressTrap(kind, performance.now());
  keyboard.attach();

  const canvas = $("game-canvas");
  canvas.replaceChildren();
  // Hauteur de la vue Phaser (bandeau des PV d'une ou deux lignes), posée avant qu'elle charge.
  canvas.style.height = `${viewHeight(options.start.players.length)}px`;
  $("game-title").textContent = options.title;
  $("game-end").hidden = true;

  const digits = $("game-digits");
  digits.replaceChildren(
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "digit";
      b.textContent = String(d);
      b.addEventListener("click", () => {
        session.pressDigit(d, performance.now());
        b.blur();
      });
      return b;
    }),
  );

  // Barre des pièges (03-Pieges §1), sous les chiffres. Le fond d'un bouton se remplit de la couleur claire
  // du joueur, d'une part par case remplie, sans séparateur (variante A ter de la planche « Barre des
  // pièges ») : plein, le piège est disponible. Le bouton est grisé quand la case sous le bonhomme n'en
  // accepte pas.
  const me = playerColor(options.start.players.find((p) => p.id === options.start.you)?.color ?? 0);
  const trapButtons = (
    [
      ["mine", "Mine", "A", "Poser une mine (touche A, Q en QWERTY)"],
      ["turret", "Tourelle", "E", "Poser une tourelle (touche E)"],
      ["shield", "Bouclier", "R", "Poser un bouclier (touche R)"],
    ] as const satisfies readonly (readonly [TrapKind, string, string, string])[]
  ).map(([kind, label, key, aria]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "trap";
    b.setAttribute("aria-label", aria);
    b.style.setProperty("--c", me.color);
    b.style.setProperty("--tint", me.tint);
    b.style.setProperty("--ink2", me.ink);
    const fill = document.createElement("span");
    fill.className = "trap-fill";
    b.append(fill);
    const icon = document.createElement("span");
    icon.className = `trap-icon trap-icon-${kind}`;
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "trap-label";
    text.textContent = label;
    const count = document.createElement("span");
    count.className = "trap-count";
    count.hidden = true;
    text.append(count);
    const chip = document.createElement("span");
    chip.className = "trap-key";
    chip.setAttribute("aria-hidden", "true");
    chip.textContent = key;
    b.append(icon, text, chip);
    // Le clic ne prend pas le focus : les flèches restent au jeu.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => session.pressTrap(kind, performance.now()));
    return { kind, aria, button: b, fill, count, look: "" };
  });
  $("game-traps").replaceChildren(...trapButtons.map((t) => t.button));

  const quit = (): void => options.onQuit();
  $("game-quit").onclick = quit;
  $("game-end-home").onclick = quit;

  // Fin de partie : l'hôte seul peut relancer (00-Game §1) ; le nouveau `start` remplace cet écran.
  const isHost = options.start.you === options.start.host;
  const restart = $("game-end-restart") as HTMLButtonElement;
  restart.hidden = !isHost;
  restart.disabled = false;
  $("game-end-wait").hidden = isHost;
  restart.onclick = () => {
    restart.disabled = true;
    options.send({ type: "restart" });
  };

  let view: GameView | null = null;
  let destroyed = false;
  void createGameView(canvas, session, () => keyboard.dir()).then((v) => {
    if (destroyed) v.destroy();
    else view = v;
  });

  /**
   * Panneau des joueurs (00-Game §1, Fin de partie) : pendant la partie, classés par cases remplies (à
   * égalité, l'ordre de la salle) ; une fois la partie finie, dans l'ordre du classement final, avec la
   * couronne du gagnant à droite de son nom. Le fond gris de la fin ne répète pas ce classement.
   */
  const renderPanel = (): void => {
    const remaining = session.owner.filter((o) => o === 0).length;
    $("game-level").textContent = `${LEVEL_LABEL[session.level]} · ${remaining} cases à remplir`;
    const ranking = session.ranking;
    const ordered =
      ranking !== null
        ? ranking.map((r) => session.players.find((p) => p.id === r.player)).filter((p) => p !== undefined)
        : session.players.slice().sort((a, b) => (session.score.get(b.id) ?? 0) - (session.score.get(a.id) ?? 0));
    // Provisoire : en solo, pas de couronne pour un joueur éliminé.
    const winner = ranking !== null && ranking.length > 0 && (ranking[0]!.alive || ranking.length > 1) ? ranking[0]!.player : null;
    const rows = ordered.map((p, k) => {
      const c = playerColor(p.color);
      const row = document.createElement("div");
      row.className = "score-row";
      row.style.background = c.tint;
      row.style.color = c.ink;
      if (session.alive.get(p.id) === false) row.classList.add("out");
      const rank = document.createElement("span");
      rank.className = "score-rank";
      rank.textContent = String(k + 1);
      const dot = document.createElement("span");
      dot.className = "swatch-dot";
      dot.style.background = c.color;
      const name = document.createElement("span");
      name.className = "score-name";
      const text = document.createElement("span");
      text.className = "score-name-text";
      text.textContent = p.id === session.you ? `${p.name} (vous)` : p.name;
      name.append(text);
      if (p.id === winner) name.append(crown());
      // Pas de PV ici : ils sont dans le bandeau au-dessus de la grille. Un joueur éliminé est atténué.
      const score = document.createElement("span");
      score.className = "score-cells";
      const n = session.score.get(p.id) ?? 0;
      score.textContent = `${n} ${n > 1 ? "cases" : "case"}`;
      row.append(rank, dot, name, score);
      return row;
    });
    $("game-scores").replaceChildren(...rows);
    if (ranking !== null) $("game-end").hidden = false;
  };
  session.onChange = renderPanel;

  // Le message sous la grille s'efface tout seul, et les boutons des pièges suivent la case sous le
  // bonhomme et les cases remplies : relus quelques fois par seconde ; le DOM ne change que si l'état change.
  const message = $("game-message");
  const timer = setInterval(() => {
    const now = performance.now();
    message.textContent = now < session.messageUntil ? session.message : "";
    const here = session.canPlaceHere();
    for (const t of trapButtons) {
      const { per, done, avail } = session.trapProgress(t.kind);
      const look = `${here}|${per}|${done}|${avail}`;
      if (t.look === look) continue;
      t.look = look;
      const ready = avail > 0;
      t.fill.style.width = `${per === 0 || ready ? 100 : (done * 100) / per}%`;
      t.button.classList.toggle("ready", ready);
      t.button.classList.toggle("unearned", !ready);
      t.button.classList.toggle("away", !here);
      t.button.disabled = !(here && ready);
      t.count.hidden = avail < 2;
      t.count.textContent = `×${avail}`;
      t.button.setAttribute("aria-label", ready ? t.aria : `${t.aria} : ${done} case${done > 1 ? "s" : ""} remplie${done > 1 ? "s" : ""} sur ${per}`);
    }
  }, 150);

  return {
    onMessage(msg) {
      session.onMessage(msg, performance.now());
    },
    destroy() {
      destroyed = true;
      clearInterval(timer);
      keyboard.detach();
      view?.destroy();
      view = null;
      canvas.replaceChildren();
    },
  };
}
