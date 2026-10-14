import { Client } from "@colyseus/sdk";
import { api, ApiError } from "./api.js";
import { getAccessToken } from "./auth.js";
import { config } from "./config.js";
import { t } from "./i18n.js";

const ROOM = "pishpirik";
const STORAGE_KEY = "ls_reconnect";

/**
 * Client-side session for the one active room. The server is authoritative: this object only ever
 * stores what the server last told us, and sends *requests* (ready / play / resign).
 */
export const session = {
  room: null,
  status: "idle", // idle | joining | lobby | playing | finished
  mode: null,
  welcome: null,
  lobby: null,
  view: null,
  events: [],
  turnDeadline: null,
  clockSkew: 0,
  presence: {}, // userId -> { connected, reconnectDeadline }
  matchEnd: null,
  connection: "ok", // ok | reconnecting
  notice: null,
};

const subs = new Set();
export const subscribe = (fn) => (subs.add(fn), () => subs.delete(fn));
const emit = () => subs.forEach((fn) => fn(session));

function resetSession() {
  Object.assign(session, {
    room: null, status: "idle", mode: null, welcome: null, lobby: null, view: null, events: [],
    turnDeadline: null, clockSkew: 0, presence: {}, matchEnd: null, connection: "ok", notice: null,
  });
}

function remember(token) {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token }));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: reconnect-after-reload simply isn't offered */
  }
}

async function newClient() {
  const token = await getAccessToken();
  const client = new Client(config.apiUrl);
  if (token) client.auth.token = token;
  return client;
}

export function describeError(err) {
  const raw = String(err?.message ?? "");
  const key = Object.keys(t("play.errors")).find((k) => raw.includes(k));
  if (key) return t(`play.errors.${key}`);
  if (err instanceof ApiError && err.code && t(`play.errors.${err.code}`) !== `play.errors.${err.code}`) return t(`play.errors.${err.code}`);
  return t("play.errors.unknown");
}

function bind(room) {
  session.room = room;
  remember(room.reconnectionToken);

  room.onMessage("welcome", (p) => {
    session.welcome = p;
    session.mode = p.mode;
    if (session.status === "joining") session.status = "lobby";
    emit();
  });
  room.onMessage("lobby", (p) => {
    session.lobby = p;
    if (p.phase === "playing" || p.phase === "starting") session.status = session.view ? "playing" : session.status;
    emit();
  });
  room.onMessage("state", (p) => {
    session.view = p.view;
    session.turnDeadline = p.turnDeadline;
    session.clockSkew = p.serverTime - Date.now();
    session.events = [...session.events, ...(p.events ?? [])].slice(-60);
    if (session.status !== "finished") session.status = "playing";
    emit();
  });
  room.onMessage("rejected", (p) => {
    if (p.view) session.view = p.view;
    session.notice = { kind: "rejected", code: p.code, at: Date.now() };
    emit();
  });
  room.onMessage("presence", (p) => {
    session.presence[p.userId] = { connected: p.connected, reconnectDeadline: p.reconnectDeadline };
    emit();
  });
  room.onMessage("match_end", (p) => {
    session.matchEnd = p;
    session.status = "finished";
    remember(null);
    emit();
  });
  room.onMessage("error", () => {
    session.notice = { kind: "server_error", at: Date.now() };
    emit();
  });
  room.onDrop(() => {
    session.connection = "reconnecting";
    emit();
  });
  room.onReconnect(() => {
    session.connection = "ok";
    remember(room.reconnectionToken);
    emit();
  });
  room.onLeave(() => {
    // Final departure (reconnect attempts exhausted or room closed).
    if (session.status !== "finished") session.status = session.matchEnd ? "finished" : "idle";
    session.connection = "ok";
    session.room = null;
    remember(null);
    emit();
  });
  emit();
}

async function join(promiseFactory) {
  if (session.room) throw new Error("already_in_room");
  resetSession();
  session.status = "joining";
  emit();
  try {
    bind(await promiseFactory());
  } catch (err) {
    resetSession();
    emit();
    throw err;
  }
}

export const startPublic = async () => join(async () => (await newClient()).joinOrCreate(ROOM, { mode: "public" }));

export async function createPrivate() {
  const { code, roomId } = await api("/api/rooms/private", { method: "POST" });
  await join(async () => (await newClient()).joinById(roomId, { code }));
  return code;
}

export async function joinPrivate(code) {
  const { roomId } = await api("/api/rooms/resolve", { method: "POST", body: { code: code.trim().toUpperCase() } });
  await join(async () => (await newClient()).joinById(roomId, { code: code.trim().toUpperCase() }));
}

/** After a page reload: rejoin the match the server is still holding for us (within its grace period). */
export async function resumeIfPossible() {
  if (session.room) return true;
  let token = null;
  try {
    token = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null")?.token ?? null;
  } catch {
    token = null;
  }
  if (!token) return false;
  try {
    resetSession();
    session.status = "joining";
    bind(await (await newClient()).reconnect(token));
    return true;
  } catch {
    resetSession();
    remember(null);
    emit();
    return false;
  }
}

export const ready = () => session.room?.send("ready");
export const resign = () => session.room?.send("resign");
export function play(card) {
  if (!session.room || !session.view) return;
  session.room.send("play", { card, moveCount: session.view.moveCount });
}

export async function leave() {
  const room = session.room;
  remember(null);
  if (room) await room.leave(true).catch(() => undefined);
  resetSession();
  emit();
}

/** Clear a finished match so the user can queue again. */
export function dismissResult() {
  resetSession();
  remember(null);
  emit();
}
