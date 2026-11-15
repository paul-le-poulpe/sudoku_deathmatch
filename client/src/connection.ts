// Une seule interface de connexion pour le solo et le jeu en ligne (01-Architecture §6) : envoyer un
// message, recevoir des messages, être prévenu de la fermeture. En ligne : un WebSocket. En solo : un
// Web Worker qui contient `packages/room` et sa minuterie (solo.worker.ts).

import type { ClientMessage, ServerMessage } from "@sudoku-deathmatch/shared";

export interface Connection {
  send(msg: ClientMessage): void;
  close(): void;
  onMessage: ((msg: ServerMessage) => void) | null;
  /** Fermeture qui n'a pas été demandée par `close()`. */
  onClose: (() => void) | null;
}

export function webSocketConnection(url: string): Connection {
  const ws = new WebSocket(url);
  const waiting: string[] = [];
  let closedByUs = false;
  const conn: Connection = {
    onMessage: null,
    onClose: null,
    send(msg) {
      const text = JSON.stringify(msg);
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
      else if (ws.readyState === WebSocket.CONNECTING) waiting.push(text);
    },
    close() {
      closedByUs = true;
      ws.close(1000);
    },
  };
  ws.addEventListener("open", () => {
    for (const text of waiting.splice(0)) ws.send(text);
  });
  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data) as ServerMessage;
    } catch {
      return;
    }
    conn.onMessage?.(msg);
  });
  ws.addEventListener("close", () => {
    if (!closedByUs) conn.onClose?.();
  });
  return conn;
}

/** Le solo : la salle tourne dans un Web Worker ; le joueur y entre comme hôte avec ce nom et cette couleur. */
export function soloConnection(name: string, color: number): Connection {
  const worker = new Worker(new URL("./solo.worker.ts", import.meta.url), { type: "module" });
  const conn: Connection = {
    onMessage: null,
    onClose: null,
    send(msg) {
      worker.postMessage(msg);
    },
    close() {
      worker.terminate();
    },
  };
  worker.addEventListener("message", (event: MessageEvent<ServerMessage>) => conn.onMessage?.(event.data));
  worker.addEventListener("error", () => conn.onClose?.());
  worker.postMessage({ type: "init", name, color });
  return conn;
}
