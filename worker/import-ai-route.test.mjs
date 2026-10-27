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
const otherUid = "synthetic-import-route-other", otherId = "synthetic-import-route-other-session";
sqlite.prepare("INSERT INTO users VALUES(?,?,0,NULL,?)").run(otherUid, JSON.stringify({ name: "Other", email: "other@example.invalid" }), now);
sqlite.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run(otherId, otherUid, hash, hash, now + 600000, now + 600000, now);
const prepared = (sql, values = []) => ({
  bind: (...args) => prepared(sql, args),
  first: async () => sqlite.prepare(sql).get(...values) ?? null,
  run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  all: async () => /\bRETURNING\b|^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...values), meta: {} } : { results: [], meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } },
});
// D1 runs a batch as one transaction on one connection, so changes() sees the previous statement.
const batch = async (statements) => {
  sqlite.exec("BEGIN");
  try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec("COMMIT"); return results; }
  catch (error) { sqlite.exec("ROLLBACK"); throw error; }
};
let aiCalls = 0;
let aiOptions;
const env = {
  DB: { prepare: prepared, batch }, AI_IMPORT_ENABLED: "false",
  AI: { run: async (_model, options) => {
    aiCalls++;
    aiOptions = options;
    return { response: JSON.stringify({ rows: [{ date: "2026-10-10", name: "Synthetic cafe", amount: 28000, direction: "expense", activity: "purchase" }] }), usage: { prompt_tokens: 1000, completion_tokens: 100 } };
  } },
};
const input = JSON.stringify({ kind: "text", month: "2026-10", text: "10/10/2026 Synthetic cafe DB 28.000" });
const request = (body = input, headers = {}) => worker.fetch(new Request("https://saku.example/v1/import/extract", { method: "POST", headers: { authorization: `Bearer ${id}.${secret}`, "content-type": "application/json", "x-saku-user-id": uid, ...headers }, body }), env);
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
try {
  env.MINIMUM_ANDROID_BUILD = "8";
  const updateRequired = await request();
  assert.equal(updateRequired.status, 426, "an obsolete native build must pause cloud routes");
  assert.equal((await updateRequired.json()).code, "UPDATE_REQUIRED");
  assert.equal((await request(input, { "x-saku-app-build": "8" })).status, 503, "the current native build may continue to the feature gate");
  env.MINIMUM_ANDROID_BUILD = "7";
  assert.equal((await request()).status, 503, "the release gate must deny extraction");
  assert.equal(aiCalls, 0);
  env.AI_IMPORT_ENABLED = "true";
  assert.equal((await request(input, { "x-saku-user-id": "other-user" })).status, 409);
  assert.equal((await request(input, { "x-saku-user-id": "" })).status, 403);
  assert.equal((await request(JSON.stringify({ kind: "image", month: "2026-10", image: "data:image/svg+xml;base64,AA==" }))).status, 400);
  assert.equal(aiCalls, 0, "invalid requests must not reach the AI binding");
  const browserWithoutCsrf = await worker.fetch(new Request("https://saku.example/v1/import/extract", { method: "POST", headers: { cookie: `saku_access=${id}.${secret}`, "x-saku-user-id": uid }, body: input }), env);
  assert.equal(browserWithoutCsrf.status, 403);
  sqlite.exec("DROP TABLE import_ai_budget");
  const response = await request();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='import_ai_budget'").get().name, "import_ai_budget", "the route must repair an additive budget-table migration missed by an older environment");
  const firstRow = (await response.json()).rows[0];
  assert.equal(firstRow.amount, 28000);
  assert.equal(firstRow.date, "", "the HTTP route must not trust a model date without printed evidence");
  assert.equal(aiCalls, 2, "every source page needs extraction and verification passes");
  assert.equal(aiOptions.temperature, 0, "extraction should use deterministic sampling");
  assert.equal(aiOptions.seed, 0, "extraction should request a stable best-effort seed");
  assert.equal(aiOptions.messages[1].content.includes("Second accuracy pass"), true);
  assert.equal(aiOptions.messages[1].content.includes("Synthetic cafe"), true, "the verifier should receive the first-pass candidates");
  env.AI.run = async (_model, options) => {
    aiCalls++;
    const verifying = options.messages[1].content.includes("Second accuracy pass");
    return { response: JSON.stringify({ rows: verifying ? [
      { date: "2026-10-10", dateEvidence: "10/10/2026", name: "Synthetic cafe", amount: 28000, direction: "expense", activity: "purchase" },
      { date: "2026-10-10", dateEvidence: "10/10/2026", name: "Synthetic fee", amount: 5000, direction: "expense", activity: "fee" },
    ] : [{ date: "2026-10-10", dateEvidence: "10/10/2026", name: "Synthetic cafe", amount: 28000, direction: "expense", activity: "purchase" }] }), usage: { prompt_tokens: 1000, completion_tokens: 100 } };
  };
  const correctedResponse = await request();
  const correctedRows = (await correctedResponse.json()).rows;
  assert.equal(correctedRows.length, 2, "the verification pass should be able to restore a row omitted by the first pass");
  assert.equal(correctedRows[1].name, "Synthetic fee");
  env.AI.run = async () => {
    aiCalls++;
    return { response: JSON.stringify({ rows: [{ date: "2026-10-12", dateEvidence: "10/10/2026", name: "Synthetic cafe", amount: 28000, direction: "expense", activity: "purchase" }] }), usage: { prompt_tokens: 1000, completion_tokens: 100 } };
  };
  const evidencedResponse = await request();
  assert.equal((await evidencedResponse.json()).rows[0].date, "2026-10-10", "the HTTP route must check text-PDF evidence against its page");
  env.AI.run = async () => {
    aiCalls++;
    return { response: JSON.stringify({ rows: [{ date: "2026-10-12", dateEvidence: "Kemarin 05 Sep 2025", name: "Synthetic wallet payment", amount: 39200, direction: "expense", activity: "purchase" }] }), usage: { prompt_tokens: 1000, completion_tokens: 100 } };
  };
  const imageResponse = await request(JSON.stringify({ kind: "image", month: "2026-10", image: "data:image/jpeg;base64,AA==" }));
  assert.equal(imageResponse.status, 200);
  assert.equal((await imageResponse.json()).rows[0].date, "2025-09-05", "the HTTP image route must use printed date evidence");
  assert.equal(aiCalls, 8);
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(sqlite.prepare("SELECT neurons FROM import_ai_budget WHERE day=?").get(day).neurons, 96);
  assert.equal(sqlite.prepare("SELECT neurons FROM import_ai_user_budget WHERE uid=? AND day=?").get(uid, day).neurons, 96, "refunds reduce the user's counter as well as the shared one");
  sqlite.prepare("UPDATE import_ai_user_budget SET neurons=1200 WHERE uid=? AND day=?").run(uid, day);
  const ownLimit = await request();
  assert.equal(ownLimit.status, 429, "a user at their own cap is stopped");
  assert.match((await ownLimit.json()).error, /your account/);
  assert.equal(aiCalls, 8);
  assert.equal(sqlite.prepare("SELECT neurons FROM import_ai_budget WHERE day=?").get(day).neurons, 96, "a refused user reservation leaves the shared counter untouched");
  const otherUser = await request(input, { authorization: `Bearer ${otherId}.${secret}`, "x-saku-user-id": otherUid });
  assert.equal(otherUser.status, 200, "another user can still extract");
  assert.equal(aiCalls, 10);
  assert.equal(sqlite.prepare("SELECT neurons FROM import_ai_user_budget WHERE uid=? AND day=?").get(otherUid, day).neurons, 24);
  sqlite.prepare("UPDATE import_ai_budget SET neurons=3990 WHERE day=?").run(day);
  const sharedLimit = await request(input, { authorization: `Bearer ${otherId}.${secret}`, "x-saku-user-id": otherUid });
  assert.equal(sharedLimit.status, 429, "the app allowance must stop another call");
  assert.match((await sharedLimit.json()).error, /shared/);
  assert.equal(sqlite.prepare("SELECT neurons FROM import_ai_user_budget WHERE uid=? AND day=?").get(otherUid, day).neurons, 24, "a refused shared reservation leaves the user's counter untouched");
  assert.equal(aiCalls, 10);
  console.log("AI import route: auth, release gate, input validation and quota passed with a stub binding");
} finally { delete crypto.subtle.timingSafeEqual; sqlite.close(); }
