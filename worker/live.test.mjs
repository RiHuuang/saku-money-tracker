import assert from "node:assert/strict";
import { UserLiveUpdates } from "./live.js";

const records = new Map(), sockets = [];
const ctx = {
  storage: {
    put: async (key, value) => records.set(key, value),
    get: async (key) => records.get(key),
    delete: async (key) => records.delete(key),
    setAlarm: async () => {},
    list: async () => new Map([...records].filter(([key]) => key.startsWith("ticket:"))),
  },
  acceptWebSocket: (socket) => sockets.push(socket),
  getWebSockets: () => sockets.filter((socket) => !socket.closed),
};
const env = { DB: { prepare: () => ({ bind: (id) => ({ first: async () => id === "active" ? { id } : null }) }) } };
const nativeResponse = globalThis.Response, nativePair = globalThis.WebSocketPair;
globalThis.Response = class extends nativeResponse {
  constructor(body, options) { if (options?.status === 101) return { status: 101, webSocket: options.webSocket }; super(body, options); }
};
globalThis.WebSocketPair = class {
  constructor() {
    const server = { sent: [], closed: false, send(value) { this.sent.push(value); }, close() { this.closed = true; }, serializeAttachment(value) { this.attachment = value; }, deserializeAttachment() { return this.attachment; } };
    return [{}, server];
  }
};
try {
  const room = new UserLiveUpdates(ctx, env);
  const ticket = async (hash, sessionId = "active", expiresAt = Date.now() + 30_000) => room.fetch(new Request("https://live/ticket", { method: "POST", body: JSON.stringify({ hash, sessionId, expiresAt }) }));
  const connect = (hash) => room.fetch(new Request(`https://live/connect?hash=${hash}`));
  await ticket("valid");
  assert.equal((await connect("valid")).status, 101);
  assert.equal((await connect("valid")).status, 401, "ticket must be single use");
  await ticket("expired", "active", Date.now() - 1);
  assert.equal((await connect("expired")).status, 401);
  await ticket("revoked", "revoked-session");
  assert.equal((await connect("revoked")).status, 401);
  await room.fetch(new Request("https://live/notify", { method: "POST", body: '{"type":"profile-changed"}' }));
  assert.deepEqual(sockets[0].sent, ['{"type":"profile-changed"}']);
  await room.fetch(new Request("https://live/revoke", { method: "POST", body: '{"sessionId":"active"}' }));
  assert.equal(sockets[0].closed, true);
  await ticket("stale", "active", Date.now() - 1);
  await room.alarm();
  assert.equal(records.has("ticket:stale"), false);
  console.log("Live updates: single-use and expired tickets, session checks, notices, revocation, and cleanup passed");
} finally { globalThis.Response = nativeResponse; globalThis.WebSocketPair = nativePair; }
