import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { avatar } from "./avatar.test.mjs";

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(await fs.readFile("worker/schema.sql", "utf8"));
const uid = "live-route-user", id = "live-route-session", secret = "fixture-secret";
const hash = nodeCrypto.createHash("sha256").update(secret).digest("hex"), now = Date.now();
sqlite.prepare("INSERT INTO users VALUES(?,?,0,NULL,?)").run(uid, JSON.stringify({ name: "Fixture", email: "fixture@example.invalid" }), now);
sqlite.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run(id, uid, hash, hash, now + 600000, now + 600000, now);
const prepared = (sql, values = []) => ({
  bind: (...args) => prepared(sql, args),
  first: async () => sqlite.prepare(sql).get(...values) ?? null,
  run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
});
const rooms = new Map();
const env = {
  WRITE_ENABLED: "true",
  DB: { prepare: prepared },
  BUCKET: { put: async (_key, body) => ({ size: (await new Response(body).arrayBuffer()).byteLength }), delete: async () => {} },
  LIVE_UPDATES: {
    idFromName: (name) => name,
    get: (name) => ({ fetch: async (request, options) => {
      const url = new URL(request.url || request);
      if (!rooms.has(name)) rooms.set(name, { tickets: [], notices: [], revoked: [] });
      const room = rooms.get(name);
      const body = request instanceof Request ? await request.text() : options?.body;
      if (url.pathname === "/ticket") room.tickets.push(JSON.parse(body));
      if (url.pathname === "/notify") room.notices.push(JSON.parse(body));
      if (url.pathname === "/revoke") room.revoked.push(JSON.parse(body));
      return new Response(null, { status: 204 });
    } }),
  },
};
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
try {
  const authorization = `Bearer ${id}.${secret}`;
  const request = (path, method, body) => worker.fetch(new Request(`https://saku.example${path}`, { method, headers: { authorization, "content-type": "application/json" }, body }), env);
  const ticketResponse = await request("/v1/live-ticket", "POST", "{}");
  assert.equal(ticketResponse.status, 200);
  const ticket = await ticketResponse.json();
  assert.equal(rooms.get(ticket.room).tickets.length, 1);
  assert.equal(rooms.get(ticket.room).tickets[0].sessionId, id);
  const changed = await request("/v1/me", "PUT", JSON.stringify({ name: "Updated" }));
  assert.equal(changed.status, 200);
  assert.deepEqual(rooms.get(ticket.room).notices, [{ type: "profile-changed" }], "writes must notify the ticket's room");
  const photo = await worker.fetch(new Request("https://saku.example/v2/me/avatar?name=Updated", { method: "PUT", headers: { authorization, "content-type": "image/webp", "content-length": String(avatar.length) }, body: avatar }), env);
  assert.equal(photo.status, 200, await photo.clone().text());
  assert.deepEqual(rooms.get(ticket.room).notices.at(-1), { type: "profile-changed" }, "photo writes must notify other clients");
  const ledger = await worker.fetch(new Request("https://saku.example/v2/sync?baseRevision=0", { method: "PUT", headers: { authorization, "content-type": "application/json", "content-length": "2", "x-saku-version": "3" }, body: "{}" }), env);
  assert.equal(ledger.status, 200, await ledger.clone().text());
  assert.deepEqual(rooms.get(ticket.room).notices.at(-1), { type: "ledger-changed", revision: 1 });
  const otherSecret = "other-fixture-secret", otherHash = nodeCrypto.createHash("sha256").update(otherSecret).digest("hex");
  sqlite.prepare("INSERT INTO users VALUES(?,?,0,NULL,?)").run("other-user", JSON.stringify({ name: "Other", email: "other@example.invalid" }), now);
  sqlite.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run("other-session", "other-user", otherHash, otherHash, now + 600000, now + 600000, now);
  const other = await worker.fetch(new Request("https://saku.example/v1/live-ticket", { method: "POST", headers: { authorization: `Bearer other-session.${otherSecret}` }, body: "{}" }), env);
  assert.equal(other.status, 200);
  const otherRoom = (await other.json()).room;
  assert.notEqual(otherRoom, ticket.room);
  assert.deepEqual(rooms.get(otherRoom).notices, [], "other users must not receive this account's notices");
  const browserWithoutCsrf = await worker.fetch(new Request("https://saku.example/v1/live-ticket", { method: "POST", headers: { cookie: `saku_access=${id}.${secret}` }, body: "{}" }), env);
  assert.equal(browserWithoutCsrf.status, 403);
  const signedOut = await request("/v1/auth/logout", "POST", "{}");
  assert.equal(signedOut.status, 200);
  assert.deepEqual(rooms.get(ticket.room).revoked, [{ sessionId: id }]);
  console.log("Live route: ticket, profile, photo and ledger notices share a room; browser CSRF and logout revocation passed");
} finally { delete crypto.subtle.timingSafeEqual; sqlite.close(); }
