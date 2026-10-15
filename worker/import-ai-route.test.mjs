import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(await fs.readFile("worker/schema.sql", "utf8"));
const uid = "synthetic-import-route-user", id = "synthetic-import-route-session", secret = "synthetic-route-secret", now = Date.now();
const hash = nodeCrypto.createHash("sha256").update(secret).digest("hex");
sqlite.prepare("INSERT INTO users VALUES(?,?,0,NULL,?)").run(uid, JSON.stringify({ name: "Synthetic", email: "synthetic@example.invalid" }), now);
sqlite.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run(id, uid, hash, hash, now + 600000, now + 600000, now);
const prepared = (sql, values = []) => ({
  bind: (...args) => prepared(sql, args),
  first: async () => sqlite.prepare(sql).get(...values) ?? null,
  run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
});
let aiCalls = 0;
const env = {
  DB: { prepare: prepared }, AI_IMPORT_ENABLED: "false",
  AI: { run: async () => {
    aiCalls++;
    return { response: JSON.stringify({ rows: [{ date: "2026-10-10", name: "Synthetic cafe", amount: 28000, direction: "expense", activity: "purchase" }] }), usage: { prompt_tokens: 1000, completion_tokens: 100 } };
  } },
};
const input = JSON.stringify({ kind: "text", month: "2026-10", text: "10/10/2026 Synthetic cafe DB 28.000" });
const request = (body = input, headers = {}) => worker.fetch(new Request("https://saku.example/v1/import/extract", { method: "POST", headers: { authorization: `Bearer ${id}.${secret}`, "content-type": "application/json", "x-saku-user-id": uid, ...headers }, body }), env);
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
try {
  assert.equal((await request()).status, 503, "the release gate must deny extraction");
  assert.equal(aiCalls, 0);
  env.AI_IMPORT_ENABLED = "true";
  assert.equal((await request(input, { "x-saku-user-id": "other-user" })).status, 409);
  assert.equal((await request(input, { "x-saku-user-id": "" })).status, 403);
  assert.equal((await request(JSON.stringify({ kind: "image", month: "2026-10", image: "data:image/svg+xml;base64,AA==" }))).status, 400);
  assert.equal(aiCalls, 0, "invalid requests must not reach the AI binding");
  const browserWithoutCsrf = await worker.fetch(new Request("https://saku.example/v1/import/extract", { method: "POST", headers: { cookie: `saku_access=${id}.${secret}`, "x-saku-user-id": uid }, body: input }), env);
  assert.equal(browserWithoutCsrf.status, 403);
  const response = await request();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).rows[0].amount, 28000);
  assert.equal(aiCalls, 1);
  env.AI.run = async () => {
    aiCalls++;
    return { response: JSON.stringify({ rows: [{ date: "2026-10-12", dateEvidence: "Kemarin 05 Sep 2025", name: "Synthetic wallet payment", amount: 39200, direction: "expense", activity: "purchase" }] }), usage: { prompt_tokens: 1000, completion_tokens: 100 } };
  };
  const imageResponse = await request(JSON.stringify({ kind: "image", month: "2026-10", image: "data:image/jpeg;base64,AA==" }));
  assert.equal(imageResponse.status, 200);
  assert.equal((await imageResponse.json()).rows[0].date, "2025-09-05", "the HTTP image route must use printed date evidence");
  assert.equal(aiCalls, 2);
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(sqlite.prepare("SELECT neurons FROM import_ai_budget WHERE day=?").get(day).neurons, 24);
  sqlite.prepare("UPDATE import_ai_budget SET neurons=3990 WHERE day=?").run(day);
  assert.equal((await request()).status, 429, "the app allowance must stop another call");
  assert.equal(aiCalls, 2);
  console.log("AI import route: auth, release gate, input validation and quota passed with a stub binding");
} finally { delete crypto.subtle.timingSafeEqual; sqlite.close(); }
