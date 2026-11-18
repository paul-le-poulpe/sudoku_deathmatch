// Le clavier pendant une partie. Les flèches (et ZQSD/WASD par la position physique des touches,
// `KeyboardEvent.code`) donnent une direction, lue une fois par tick par la session (01-Architecture §3) ;
// les chiffres 1 à 9 (rangée du haut ou pavé numérique) appellent `onDigit` à l'appui ; les touches à
// gauche et à droite de Z (A et E en AZERTY, Q et E en QWERTY), puis R, appellent `onTrap` (03-Pieges §1
// et §4).

import { DIR_DOWN, DIR_LEFT, DIR_RIGHT, DIR_UP } from "@sudoku-deathmatch/engine";
import type { TrapKind } from "@sudoku-deathmatch/shared";

const TRAP: Readonly<Record<string, TrapKind>> = {
  KeyQ: "mine",
  KeyE: "turret",
  KeyR: "shield",
};

const DIRECTION: Readonly<Record<string, number>> = {
  ArrowUp: DIR_UP,
  KeyW: DIR_UP,
  ArrowDown: DIR_DOWN,
  KeyS: DIR_DOWN,
  ArrowLeft: DIR_LEFT,
  KeyA: DIR_LEFT,
  ArrowRight: DIR_RIGHT,
  KeyD: DIR_RIGHT,
};

export class Keyboard {
  readonly #down = new Set<string>();
  onDigit: ((digit: number) => void) | null = null;
  onTrap: ((kind: TrapKind) => void) | null = null;

  readonly #keydown = (e: KeyboardEvent): void => {
    if (isTyping(e.target)) return;
    if (e.code in DIRECTION) {
      this.#down.add(e.code);
      e.preventDefault();
      return;
    }
    const trap = TRAP[e.code];
    if (trap !== undefined && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (!e.repeat) this.onTrap?.(trap);
      return;
    }
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (digit !== null) {
      e.preventDefault();
      if (!e.repeat) this.onDigit?.(Number(digit[1]));
    }
  };

  readonly #keyup = (e: KeyboardEvent): void => {
    if (this.#down.delete(e.code)) e.preventDefault();
  };

  /** La fenêtre perd le focus : les touches relâchées ailleurs n'arriveraient jamais. */
  readonly #blur = (): void => this.#down.clear();

  attach(): void {
    window.addEventListener("keydown", this.#keydown);
    window.addEventListener("keyup", this.#keyup);
    window.addEventListener("blur", this.#blur);
  }

  detach(): void {
    window.removeEventListener("keydown", this.#keydown);
    window.removeEventListener("keyup", this.#keyup);
    window.removeEventListener("blur", this.#blur);
    this.#down.clear();
  }

  /** Direction des touches appuyées en ce moment (bits de `move`). */
  dir(): number {
    let dir = 0;
    for (const code of this.#down) dir |= DIRECTION[code] ?? 0;
    return dir;
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
