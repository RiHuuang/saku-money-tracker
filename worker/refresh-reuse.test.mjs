import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const sqlite = new DatabaseSync(":memory:");
// The schema has no rotation columns, so the lazy migration is exercised too.
sqlite.exec(await fs.readFile("worker/schema.sql", "utf8"));
const uid = "synthetic-refresh-user", id = "synthetic-refresh-session", secret = "synthetic-refresh-secret", now = Date.now();
const hash = (value) => nodeCrypto.createHash("sha256").update(value).digest("hex");
sqlite.prepare("INSERT INTO users VALUES(?,?,0,NULL,?)").run(uid, JSON.stringify({ name: "Synthetic", email: "synthetic@example.invalid" }), now);
sqlite.prepare("INSERT INTO sessions (id,uid,access_hash,refresh_hash,access_expires_at,refresh_expires_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(id, uid, hash("access"), hash(secret), now + 600000, now + 86400000, now);
const prepared = (sql, values = []) => ({
  bind: (...args) => prepared(sql, args),
  first: async () => sqlite.prepare(sql).get(...values) ?? null,
  run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
});
const revoked = [];
const env = { DB: { prepare: prepared }, LIVE_UPDATES: { idFromName: (name) => name, get: () => ({ fetch: async (_url, init) => { revoked.push(JSON.parse(init.body).sessionId); return new Response(null, { status: 204 }); } }) } };
const refresh = (token) => worker.fetch(new Request("https://saku.example/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: token }) }), env);
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
try {
  const first = await refresh(`${id}.${secret}`);
  assert.equal(first.status, 200, await first.clone().text());
  const rotated = await first.json();
  const columns = sqlite.prepare("PRAGMA table_info(sessions)").all().map((column) => column.name);
  assert.ok(columns.includes("previous_refresh_hash") && columns.includes("rotated_at"), "older databases gain the rotation columns");

  const race = await refresh(`${id}.${secret}`);
  assert.equal(race.status, 401);
  assert.match((await race.json()).error, /retry with the current session/, "a replay within the race window is treated as a race");
  assert.ok(sqlite.prepare("SELECT 1 FROM sessions WHERE id=?").get(id), "the session survives a benign race");
  assert.deepEqual(revoked, []);

  const second = await refresh(rotated.refreshToken);
  assert.equal(second.status, 200, "the newest token still works after a race");
  const latest = await second.json();

  sqlite.prepare("UPDATE sessions SET rotated_at=? WHERE id=?").run(Date.now() - 61_000, id);
  const reuse = await refresh(rotated.refreshToken);
  assert.equal(reuse.status, 401, "a rotated token replayed after the window is rejected");
  assert.equal(sqlite.prepare("SELECT 1 FROM sessions WHERE id=?").get(id), undefined, "reuse ends the session");
  assert.deepEqual(revoked, [id], "reuse revokes live connections for that session");
  assert.equal((await refresh(latest.refreshToken)).status, 401, "the newest token dies with the session");
  console.log("Refresh reuse: race window keeps the session; later reuse deletes it and revokes live connections");
} finally { delete crypto.subtle.timingSafeEqual; sqlite.close(); }
