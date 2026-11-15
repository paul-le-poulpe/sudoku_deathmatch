// L'hôte du solo (01-Architecture §1) : `packages/room` dans un Web Worker, avec le catalogue du solo
// (02-Grilles §1 : jamais celui des parties en ligne), et une minuterie de TICK_MS une fois la partie
// lancée. La page lui parle par `postMessage`, avec les mêmes messages qu'en ligne (connection.ts).

import { Room, type Outgoing, type RoomEnv } from "@sudoku-deathmatch/room";
import { TICK_MS } from "@sudoku-deathmatch/shared";

import { GRIDS } from "./solo-grids.ts";

/** La seule connexion de la salle : celle du joueur, qui en est l'hôte. */
const CONN = "solo";

let tokens = 0;
const env: RoomEnv = {
  newToken: () => `solo-${++tokens}`,
  randomSeed: () => crypto.getRandomValues(new Uint32Array(1))[0]!,
};

let room: Room | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

function post(out: readonly Outgoing[]): void {
  for (const o of out) self.postMessage(o.message);
}

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data as { type?: unknown; name?: unknown; color?: unknown } | null;
  if (data !== null && typeof data === "object" && data.type === "init") {
    room = new Room(env, GRIDS);
    post(room.handle(CONN, { type: "join", name: data.name, token: room.hostToken, color: data.color }));
    return;
  }
  const r = room;
  if (r === null) return;
  post(r.handle(CONN, data));
  // Partie lancée ou relancée (`restart`) : les ticks reprennent ; une partie finie les arrête.
  if (timer === undefined && r.summary().state === "started" && !r.ended) {
    timer = setInterval(() => {
      post(r.step());
      if (r.ended) {
        clearInterval(timer);
        timer = undefined;
      }
    }, TICK_MS);
  }
});
