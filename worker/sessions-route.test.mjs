import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker, deviceLabel } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(await fs.readFile("worker/schema.sql", "utf8"));
const now = Date.now(), hash = (value) => nodeCrypto.createHash("sha256").update(value).digest("hex");
const sessions = { a1: nodeCrypto.randomUUID(), a2: nodeCrypto.randomUUID(), b1: nodeCrypto.randomUUID() };
for (const [uid, name] of [["user-a", "A"], ["user-b", "B"]]) sqlite.prepare("INSERT INTO users VALUES(?,?,0,NULL,?)").run(uid, JSON.stringify({ name, email: `${name}@example.invalid` }), now);
for (const [key, uid, age] of [["a1", "user-a", 0], ["a2", "user-a", 5000], ["b1", "user-b", 0]])
  sqlite.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run(sessions[key], uid, hash(`${key}-access`), hash(`${key}-refresh`), now + 600000, now + 86400000, now - age);
const prepared = (sql, values = []) => ({
  bind: (...args) => prepared(sql, args),
  first: async () => sqlite.prepare(sql).get(...values) ?? null,
  run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
});
const revoked = [];
const env = { DB: { prepare: prepared }, LIVE_UPDATES: { idFromName: (name) => name, get: () => ({ fetch: async (_url, init) => { revoked.push(JSON.parse(init.body).sessionId); return new Response(null, { status: 204 }); } }) } };
const asA = (path, method = "GET") => worker.fetch(new Request(`https://saku.example${path}`, { method, headers: { authorization: `Bearer ${sessions.a1}.a1-access`, "x-saku-user-id": "user-a" } }), env);
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
try {
  assert.equal(deviceLabel("android"), "Android app");
  assert.equal(deviceLabel("browser", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"), "Safari on macOS");
  assert.equal(deviceLabel("browser", "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0"), "Edge on Windows");

  const listed = await asA("/v1/sessions");
  assert.equal(listed.status, 200, await listed.clone().text());
  const { sessions: devices } = await listed.json();
  assert.deepEqual(devices.map((device) => device.id).sort(), [sessions.a1, sessions.a2].sort(), "A sees only A's sessions");
  assert.equal(devices.find((device) => device.id === sessions.a1).current, true);
  assert.equal(devices.find((device) => device.id === sessions.a2).label, "Earlier sign-in", "older sessions get a neutral label");
  assert.ok(devices.every((device) => !("access_hash" in device) && !("refresh_hash" in device) && Object.keys(device).length === 5), "no secrets or hashes are returned");

  assert.equal((await asA(`/v1/sessions/${sessions.b1}`, "DELETE")).status, 404, "A cannot delete B's session");
  assert.ok(sqlite.prepare("SELECT 1 FROM sessions WHERE id=?").get(sessions.b1));

  const removed = await asA(`/v1/sessions/${sessions.a2}`, "DELETE");
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { ok: true, current: false });
  assert.deepEqual(revoked, [sessions.a2], "the removed device's live connections are revoked");
  const refresh = await worker.fetch(new Request("https://saku.example/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: `${sessions.a2}.a2-refresh` }) }), env);
  assert.equal(refresh.status, 401, "a removed device can no longer refresh");
  console.log("Sessions route: own devices only, current marked, no secrets, foreign delete 404, revoke ends refresh");
} finally { delete crypto.subtle.timingSafeEqual; sqlite.close(); }
