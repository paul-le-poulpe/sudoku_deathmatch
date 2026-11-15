// L'écran de partie : la vue Phaser (scene.ts), et autour en HTML les boutons des chiffres et des pièges,
// le message, le panneau des joueurs et le classement de fin. Créé au message `start`, détruit en
// quittant la partie.

import type { ClientMessage, ServerMessage, TrapKind } from "@sudoku-deathmatch/shared";

import { playerColor } from "../colors.ts";
import { LEVEL_LABEL } from "../levels.ts";
import { Keyboard } from "./keyboard.ts";
import { createGameView, type GameView } from "./scene.ts";
import { PlaySession } from "./session.ts";

export interface PlayController {
  onMessage(msg: ServerMessage): void;
  destroy(): void;
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

  // Barre des pièges (03-Pieges §1), sous les chiffres. Grisée quand la pose est impossible.
  const myColor = playerColor(options.start.players.find((p) => p.id === options.start.you)?.color ?? 0).color;
  const trapButtons = (
    [
      ["mine", "Mine", "A", "Poser une mine (touche A, Q en QWERTY)"],
      ["turret", "Tourelle", "E", "Poser une tourelle (touche E)"],
    ] as const satisfies readonly (readonly [TrapKind, string, string, string])[]
  ).map(([kind, label, key, aria]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "trap";
    b.setAttribute("aria-label", aria);
    const icon = document.createElement("span");
    icon.className = `trap-icon trap-icon-${kind}`;
    icon.style.setProperty("--c", myColor);
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "trap-label";
    text.textContent = label;
    const chip = document.createElement("span");
    chip.className = "trap-key";
    chip.setAttribute("aria-hidden", "true");
    chip.textContent = key;
    b.append(icon, text, chip);
    // Le clic ne prend pas le focus : les flèches restent au jeu.
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => session.pressTrap(kind, performance.now()));
    return b;
  });
  $("game-traps").replaceChildren(...trapButtons);

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

  const renderPanel = (): void => {
    const remaining = session.owner.filter((o) => o === 0).length;
    $("game-level").textContent = `${LEVEL_LABEL[session.level]} · ${remaining} cases à remplir`;
    const rows = session.players.map((p) => {
      const c = playerColor(p.color);
      const row = document.createElement("div");
      row.className = "score-row";
      row.style.background = c.tint;
      row.style.color = c.ink;
      if (session.alive.get(p.id) === false) row.classList.add("out");
      const dot = document.createElement("span");
      dot.className = "swatch-dot";
      dot.style.background = c.color;
      const name = document.createElement("span");
      name.className = "score-name";
      name.textContent = p.id === session.you ? `${p.name} (vous)` : p.name;
      const hp = document.createElement("span");
      hp.className = "score-hp";
      hp.textContent = session.alive.get(p.id) === false ? "éliminé" : `${session.hp.get(p.id) ?? 0} PV`;
      const score = document.createElement("span");
      score.className = "score-cells";
      const n = session.score.get(p.id) ?? 0;
      score.textContent = `${n} ${n > 1 ? "cases" : "case"}`;
      row.append(dot, name, hp, score);
      return row;
    });
    $("game-scores").replaceChildren(...rows);

    if (session.ranking !== null) {
      const lines = session.ranking.map((r, k) => {
        const li = document.createElement("li");
        const p = session.players.find((q) => q.id === r.player);
        li.textContent = `${k + 1}. ${p?.name ?? "?"} — ${r.score} ${r.score > 1 ? "cases" : "case"}${r.alive ? "" : " (éliminé)"}`;
        return li;
      });
      $("game-ranking").replaceChildren(...lines);
      $("game-end").hidden = false;
    }
  };
  session.onChange = renderPanel;

  // Le message sous la grille s'efface tout seul, et les boutons des pièges suivent la case sous le
  // bonhomme : relus quelques fois par seconde.
  const message = $("game-message");
  const timer = setInterval(() => {
    const now = performance.now();
    message.textContent = now < session.messageUntil ? session.message : "";
    const blocked = !session.canPlace();
    for (const b of trapButtons) if (b.disabled !== blocked) b.disabled = blocked;
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
