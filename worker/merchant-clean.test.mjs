import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { CLEAN_RESERVATION, parseCleanAnswer, validateCleanInput } from "./merchant-clean.js";

assert.throws(() => validateCleanInput({ names: [] }));
assert.throws(() => validateCleanInput({ names: Array(21).fill("Shop") }), /1 to 20/);
assert.throws(() => validateCleanInput({ names: ["x".repeat(101)] }), /under 100/);
assert.throws(() => validateCleanInput({ names: ["TRSF 1234567 BUDI"] }), /long numbers/);
assert.deepEqual(validateCleanInput({ names: ["  QRIS  ALFAMART 0123 JKT "] }), ["QRIS ALFAMART 0123 JKT"]);
assert.deepEqual(parseCleanAnswer({ response: JSON.stringify({ names: ["Alfamart", "Shop 98765"] }) }, ["QRIS ALFAMART 0123 JKT", "SHOP 98765"]), [
  { name: "QRIS ALFAMART 0123 JKT", cleanName: "Alfamart" }, { name: "SHOP 98765", cleanName: "SHOP 98765" },
], "a cleaned name with a code-like digit run falls back to the input");
assert.deepEqual(parseCleanAnswer({ response: "not json" }, ["Grab"]), [{ name: "Grab", cleanName: "Grab" }]);
assert.deepEqual(parseCleanAnswer({ response: JSON.stringify({ names: ["Only one"] }) }, ["A", "B"]).map((row) => row.cleanName), ["A", "B"], "a miscounted answer is ignored");

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(await fs.readFile("worker/schema.sql", "utf8"));
const uid = "synthetic-clean-user", id = "synthetic-clean-session", secret = "synthetic-clean-secret", now = Date.now();
const hash = nodeCrypto.createHash("sha256").update(secret).digest("hex");
sqlite.prepare("INSERT INTO users VALUES(?,?,0,NULL,?)").run(uid, JSON.stringify({ name: "Synthetic", email: "synthetic@example.invalid" }), now);
sqlite.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run(id, uid, hash, hash, now + 600000, now + 600000, now);
const prepared = (sql, values = []) => ({
  bind: (...args) => prepared(sql, args),
  first: async () => sqlite.prepare(sql).get(...values) ?? null,
  run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  all: async () => /\bRETURNING\b|^\s*SELECT/i.test(sql) ? { results: sqlite.prepare(sql).all(...values), meta: {} } : { results: [], meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } },
});
const batch = async (statements) => {
  sqlite.exec("BEGIN");
  try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec("COMMIT"); return results; }
  catch (error) { sqlite.exec("ROLLBACK"); throw error; }
};
let aiCalls = 0, aiOptions;
const env = { DB: { prepare: prepared, batch }, AI_IMPORT_ENABLED: "true", AI: { run: async (_model, options) => { aiCalls++; aiOptions = options; return { response: JSON.stringify({ names: ["Alfamart", "Grab"] }), usage: { prompt_tokens: 300, completion_tokens: 40 } }; } } };
const request = (body) => worker.fetch(new Request("https://saku.example/v1/merchants/clean", { method: "POST", headers: { authorization: `Bearer ${id}.${secret}`, "content-type": "application/json", "x-saku-user-id": uid }, body: JSON.stringify(body) }), env);
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
try {
  assert.equal((await request({ names: ["x".repeat(101)] })).status, 400);
  assert.equal((await request({ names: ["TRSF 9988776655 BUDI"] })).status, 400);
  assert.equal(aiCalls, 0, "invalid names never reach the AI binding");
  const response = await request({ names: ["QRIS ALFAMART 0123 JKT", "GRAB* A-5XK2 RIDE"] });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await response.json()).results.map((row) => row.cleanName), ["Alfamart", "Grab"]);
  assert.equal(aiOptions.store, false);
  const day = new Date().toISOString().slice(0, 10);
  const used = sqlite.prepare("SELECT neurons FROM import_ai_user_budget WHERE uid=? AND day=?").get(uid, day).neurons;
  assert.ok(used > 0 && used < CLEAN_RESERVATION, "the small reservation is settled to actual use on both counters");
  assert.equal(sqlite.prepare("SELECT neurons FROM import_ai_budget WHERE day=?").get(day).neurons, used);
  sqlite.prepare("UPDATE import_ai_user_budget SET neurons=1200 WHERE uid=? AND day=?").run(uid, day);
  assert.equal((await request({ names: ["Shop"] })).status, 429, "the per-user AI quota applies");
  assert.equal(aiCalls, 1);
  console.log("Merchant cleaning: input limits, fallbacks, small reservation and per-user quota passed");
} finally { delete crypto.subtle.timingSafeEqual; sqlite.close(); }
