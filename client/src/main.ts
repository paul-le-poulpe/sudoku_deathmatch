// La page : accueil (parties ouvertes, créer, solo), formulaires, salle d'attente, puis l'écran de partie
// (play/screen.ts). Une seule connexion à la fois, WebSocket en ligne ou Web Worker en solo
// (connection.ts) : elle reste ouverte de la salle d'attente à la fin de la partie.

import { BOT_LEVELS, LEVELS, MAX_PLAYERS, cloudflareGamePath, type LobbyEntry, type RoomPlayer, type ServerMessage } from "@sudoku-deathmatch/shared";

import { PLAYER_COLORS } from "./colors.ts";
import { soloConnection, webSocketConnection, type Connection } from "./connection.ts";
import { BOT_LEVEL_LABEL, LEVEL_LABEL, LEVEL_TEXT } from "./levels.ts";
import {
  NETWORK_ERROR_TEXT,
  gameAction,
  httpErrorText,
  loadCreatePassword,
  loadPlayerColor,
  loadPlayerName,
  loadToken,
  parseLobbyList,
  saveCreatePassword,
  savePlayerColor,
  savePlayerName,
  saveToken,
  wsUrl,
} from "./online.ts";
import { startPlay, type PlayController } from "./play/screen.ts";
import { setupTutorial } from "./tutorial.ts";

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`élément #${id} absent`);
  return el as T;
}

type Screen = "home" | "create" | "join" | "room" | "game";

const SUBTITLES: Readonly<Record<Screen, string>> = {
  home: "2 à 4 joueurs",
  create: "Nouvelle partie",
  join: "Rejoindre une partie",
  room: "Salle d'attente",
  game: "Partie en cours",
};

// Au rechargement, le navigateur ne remet pas la page à sa position d'avant : elle s'ouvre en haut.
history.scrollRestoration = "manual";

let shown: Screen | null = null;

/**
 * Montre un écran. Un autre écran que celui affiché, ou une partie qui commence (`start`, relance
 * comprise), s'ouvre en haut de la page : sans cela, la page garde la position de l'écran d'avant (par
 * exemple la salle d'attente défilée jusqu'à « Lancer la partie »), et sur téléphone le haut de la partie
 * est hors de l'écran. Les messages `room`, qui réaffichent la salle à chaque changement, ne font pas
 * défiler.
 */
function show(screen: Screen): void {
  for (const s of ["home", "create", "join", "room", "game"] as const) $(`screen-${s}`).hidden = s !== screen;
  $("subtitle").textContent = SUBTITLES[screen];
  // Lu par style.css : sur téléphone, l'en-tête disparaît pendant une partie.
  document.body.dataset.screen = screen;
  if (screen !== shown || screen === "game") window.scrollTo(0, 0);
  shown = screen;
}

function notice(text: string | null): void {
  const el = $("notice");
  el.hidden = text === null;
  el.textContent = text ?? "";
}

function showError(id: string, text: string | null): void {
  const el = $(id);
  el.hidden = text === null;
  el.textContent = text ?? "";
}

// ---- la connexion en cours ----

interface Session {
  readonly conn: Connection;
  /** `null` en solo. */
  readonly gameId: string | null;
  readonly title: string;
  play: PlayController | null;
}

let current: Session | null = null;

function leave(message: string | null = null): void {
  const s = current;
  current = null;
  if (s !== null) {
    s.play?.destroy();
    s.conn.close();
  }
  show("home");
  notice(message);
  void refreshList();
}

/** `join` : le message d'entrée dans la salle ; `null` en solo, où le Web Worker fait entrer le joueur lui-même. */
function connect(conn: Connection, gameId: string | null, title: string, join: { name: string; token?: string } | null): void {
  const session: Session = { conn, gameId, title, play: null };
  current = session;
  conn.onMessage = (msg) => {
    if (current === session) onServerMessage(session, msg);
  };
  conn.onClose = () => {
    if (current === session) leave("Connexion perdue. La partie apparaît dans la liste : « Reprendre » pour revenir.");
  };
  notice(null);
  if (join !== null) conn.send({ type: "join", name: join.name, color: loadPlayerColor(), ...(join.token !== undefined ? { token: join.token } : {}) });
}

function onServerMessage(session: Session, msg: ServerMessage): void {
  switch (msg.type) {
    case "welcome":
      if (session.gameId !== null) saveToken(session.gameId, msg.token);
      break;
    case "room":
      renderRoom(session, msg);
      show("room");
      break;
    case "start":
      session.play?.destroy();
      session.play = startPlay({
        start: msg,
        title: session.title,
        send: (m) => session.conn.send(m),
        onQuit: () => leave(),
      });
      show("game");
      break;
    case "state":
    case "snapshot":
    case "events":
      session.play?.onMessage(msg);
      break;
    case "error":
      if (msg.code === "replaced") leave(msg.message);
      else if (!$("screen-room").hidden) showError("room-error", msg.message);
      else if (!$("screen-game").hidden) return;
      else leave(msg.message);
      break;
  }
}

// ---- salle d'attente ----

function renderRoom(session: Session, msg: Extract<ServerMessage, { type: "room" }>): void {
  const solo = session.gameId === null;
  const me = msg.players.find((p) => p.id === msg.you);
  const host = msg.players.find((p) => p.host);
  const isHost = me?.host === true;
  const max = MAX_PLAYERS;

  $("room-title").textContent = session.title;
  $("room-sub").textContent = solo
    ? "Solo, dans votre navigateur"
    : isHost
      ? "Hébergée par Cloudflare · vous êtes l'hôte"
      : `Hébergée par Cloudflare · hôte : ${host?.name ?? "absent"}`;
  $("room-count").textContent = `Joueurs (${msg.players.length}/${max})`;

  const slots: HTMLElement[] = [];
  let addOffered = false;
  for (let k = 0; k < max; k++) {
    const p = msg.players[k];
    if (p === undefined && solo && isHost && !addOffered) {
      // En solo, la première place libre est un bouton qui ajoute un bot (04-Bots §1).
      addOffered = true;
      const add = document.createElement("button");
      add.type = "button";
      add.className = "slot slot-empty slot-add";
      add.textContent = "+ Ajouter un bot";
      add.addEventListener("click", () => session.conn.send({ type: "add_bot" }));
      slots.push(add);
      continue;
    }
    if (p !== undefined && p.bot !== null) {
      slots.push(botSlot(session, msg.players, p, isHost));
      continue;
    }
    const slot = document.createElement("div");
    if (p === undefined) {
      slot.className = "slot slot-empty";
      slot.textContent = "Place libre";
    } else {
      slot.className = "slot";
      const dot = document.createElement("span");
      dot.className = "swatch-dot";
      dot.style.background = PLAYER_COLORS[p.color]?.color ?? "#000";
      const name = document.createElement("span");
      name.className = "slot-name";
      name.textContent = p.name;
      const tag = document.createElement("span");
      tag.className = "slot-tag";
      tag.textContent = [p.host && !solo ? "hôte" : "", p.id === msg.you ? "vous" : ""].filter((t) => t !== "").join(" · ");
      slot.append(dot, name, tag);
    }
    slots.push(slot);
  }
  $("room-players").replaceChildren(...slots);

  const taken = msg.players.filter((p) => p.id !== msg.you).map((p) => p.color);
  $("room-colors").replaceChildren(
    ...PLAYER_COLORS.map((c, index) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.style.background = c.color;
      b.disabled = taken.includes(index);
      b.setAttribute("aria-pressed", String(me?.color === index));
      b.setAttribute("aria-label", c.name + (b.disabled ? " (prise)" : ""));
      b.addEventListener("click", () => {
        savePlayerColor(index);
        session.conn.send({ type: "set_color", color: index });
      });
      return b;
    }),
  );

  $("room-levels").replaceChildren(
    ...LEVELS.map((level) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pill";
      b.textContent = LEVEL_LABEL[level];
      b.disabled = !isHost;
      b.setAttribute("aria-pressed", String(msg.level === level));
      b.addEventListener("click", () => session.conn.send({ type: "set_level", level }));
      return b;
    }),
  );
  $("room-level-text").textContent = LEVEL_TEXT[msg.level];
  $("room-host").hidden = !isHost;
  $("room-guest").hidden = isHost;
  showError("room-error", null);
}

/**
 * La place d'un bot (04-Bots §1). Pour l'hôte : sa difficulté (liste), un bouton pour le retirer, et ses
 * couleurs, celles des autres joueurs grisées. Pour les autres : son nom et sa difficulté.
 */
function botSlot(session: Session, players: readonly RoomPlayer[], bot: RoomPlayer, isHost: boolean): HTMLElement {
  const slot = document.createElement("div");
  slot.className = "slot slot-bot";
  const line = document.createElement("div");
  line.className = "slot-line";
  const dot = document.createElement("span");
  dot.className = "swatch-dot";
  dot.style.background = PLAYER_COLORS[bot.color]?.color ?? "#000";
  const name = document.createElement("span");
  name.className = "slot-name";
  name.textContent = bot.name;
  line.append(dot, name);
  slot.append(line);
  const level = bot.bot ?? "normal";
  if (!isHost) {
    const tag = document.createElement("span");
    tag.className = "slot-tag";
    tag.textContent = `bot · ${BOT_LEVEL_LABEL[level]}`;
    line.append(tag);
    return slot;
  }

  const select = document.createElement("select");
  select.className = "bot-level";
  select.setAttribute("aria-label", `Difficulté de ${bot.name}`);
  for (const l of BOT_LEVELS) {
    const option = document.createElement("option");
    option.value = l;
    option.textContent = BOT_LEVEL_LABEL[l];
    option.selected = l === level;
    select.append(option);
  }
  select.addEventListener("change", () => {
    const value = BOT_LEVELS.find((l) => l === select.value);
    if (value !== undefined) session.conn.send({ type: "set_bot", bot: bot.id, level: value });
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "slot-remove";
  remove.textContent = "Retirer";
  remove.setAttribute("aria-label", `Retirer ${bot.name}`);
  remove.addEventListener("click", () => session.conn.send({ type: "remove_bot", bot: bot.id }));
  line.append(select, remove);

  const taken = players.filter((p) => p.id !== bot.id).map((p) => p.color);
  const colors = document.createElement("div");
  colors.className = "bot-colors";
  colors.setAttribute("role", "group");
  colors.setAttribute("aria-label", `Couleur de ${bot.name}`);
  colors.append(
    ...PLAYER_COLORS.map((c, index) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch swatch-small";
      b.style.background = c.color;
      b.disabled = taken.includes(index);
      b.setAttribute("aria-pressed", String(bot.color === index));
      b.setAttribute("aria-label", c.name + (b.disabled ? " (prise)" : ""));
      b.addEventListener("click", () => session.conn.send({ type: "set_bot", bot: bot.id, color: index }));
      return b;
    }),
  );
  slot.append(colors);
  return slot;
}

$("room-start").addEventListener("click", () => current?.conn.send({ type: "start" }));
$("room-leave").addEventListener("click", () => leave());

// ---- accueil ----

let listing = false;

async function refreshList(): Promise<void> {
  if (listing) return;
  listing = true;
  const note = $("home-list-note");
  note.textContent = "Chargement…";
  try {
    const response = await fetch("/api/games");
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      renderList([]);
      note.textContent = httpErrorText(response.status, body);
      return;
    }
    const entries = parseLobbyList(body);
    renderList(entries);
    note.textContent = entries.length === 0 ? "Aucune partie ouverte. Créez-en une, ou lancez le solo." : "La liste se charge à l'ouverture de la page et à chaque clic sur « Actualiser ».";
  } catch {
    renderList([]);
    note.textContent = NETWORK_ERROR_TEXT;
  } finally {
    listing = false;
  }
}

function renderList(entries: readonly LobbyEntry[]): void {
  $("home-list").replaceChildren(
    ...entries.map((e) => {
      const row = document.createElement("div");
      row.className = "game-row";
      const text = document.createElement("div");
      text.className = "game-row-text";
      const name = document.createElement("span");
      name.className = "game-row-name";
      name.textContent = e.name;
      const info = document.createElement("span");
      info.className = "muted small";
      info.textContent = `Hôte : ${e.hostName || "—"} · ${LEVEL_LABEL[e.level]} · ${e.players}/${e.maxPlayers} joueurs`;
      text.append(name, info);
      const chip = document.createElement("span");
      chip.className = e.state === "waiting" ? "chip chip-open" : "chip chip-started";
      chip.textContent = e.state === "waiting" ? "En attente" : "En cours";
      row.append(text, chip);

      const token = loadToken(e.id);
      const action = gameAction(e, token !== undefined);
      if (action === "join" || action === "resume") {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-primary";
        b.textContent = action === "join" ? "Rejoindre" : "Reprendre";
        b.addEventListener("click", () => (action === "join" ? openJoin(e) : resume(e, token!)));
        row.append(b);
      } else if (action === "full") {
        const span = document.createElement("span");
        span.className = "muted small";
        span.textContent = "Pleine";
        row.append(span);
      }
      return row;
    }),
  );
}

function openOnline(entry: { id: string; name: string; address: string }, join: { name: string; token?: string }): void {
  const url = wsUrl(entry.address, window.location);
  if (url === null) {
    notice("Adresse de partie inconnue.");
    return;
  }
  connect(webSocketConnection(url), entry.id, entry.name, join);
}

function resume(entry: LobbyEntry, token: string): void {
  openOnline(entry, { name: loadPlayerName() || "Joueur", token });
}

let joining: LobbyEntry | null = null;

function openJoin(entry: LobbyEntry): void {
  joining = entry;
  $("join-title").textContent = `Rejoindre « ${entry.name} »`;
  $<HTMLInputElement>("join-name").value = loadPlayerName();
  showError("join-error", null);
  notice(null);
  show("join");
  $<HTMLInputElement>("join-name").focus();
}

$("join-cancel").addEventListener("click", () => leave());
$("join-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const entry = joining;
  if (entry === null) return;
  const name = $<HTMLInputElement>("join-name").value.trim();
  if (name === "") return showError("join-error", "Donnez un nom de 1 à 24 caractères.");
  savePlayerName(name);
  openOnline(entry, { name });
});

$("home-refresh").addEventListener("click", () => void refreshList());
setupTutorial();

$("home-create").addEventListener("click", () => {
  $<HTMLInputElement>("create-name").value = loadPlayerName();
  $<HTMLInputElement>("create-password").value = loadCreatePassword();
  showError("create-error", null);
  notice(null);
  show("create");
  $<HTMLInputElement>("create-game").focus();
});

$("create-cancel").addEventListener("click", () => leave());

$("create-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void createGame();
});

async function createGame(): Promise<void> {
  const gameName = $<HTMLInputElement>("create-game").value.trim();
  const name = $<HTMLInputElement>("create-name").value.trim();
  const password = $<HTMLInputElement>("create-password").value;
  const submit = $<HTMLButtonElement>("create-submit");
  submit.disabled = true;
  submit.textContent = "Création…";
  try {
    const response = await fetch("/api/games/cloudflare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: gameName, password }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return showError("create-error", httpErrorText(response.status, body));
    const { id, hostToken } = body as { id: string; hostToken: string };
    saveCreatePassword(password);
    savePlayerName(name);
    saveToken(id, hostToken);
    openOnline({ id, name: gameName, address: cloudflareGamePath(id) }, { name, token: hostToken });
  } catch {
    showError("create-error", NETWORK_ERROR_TEXT);
  } finally {
    submit.disabled = false;
    submit.textContent = "Créer la partie";
  }
}

$("home-solo").addEventListener("click", () => {
  const name = loadPlayerName() || "Joueur";
  connect(soloConnection(name, loadPlayerColor()), null, "Solo", null);
});

show("home");
void refreshList();
