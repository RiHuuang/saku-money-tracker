import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { CONSENT_VERSIONS, consentPurposeFor, validateConsentInput } from "./consent.js";

assert.throws(() => validateConsentInput({ purpose: "marketing", version: 1, granted: true }), /Unknown/);
assert.throws(() => validateConsentInput({ purpose: "ai_import", version: 0, granted: true }), /current version/);
assert.throws(() => validateConsentInput({ purpose: "ai_import", version: 1 }), /granted/);
assert.equal(consentPurposeFor("/v1/merchants/clean"), "merchant_tidy");
assert.equal(consentPurposeFor("/v1/import/extract"), "ai_import");
assert.equal(consentPurposeFor("/v1/import/match"), "ai_import");
assert.equal(consentPurposeFor("/v1/budget/suggest"), "ai_budget");
assert.equal(consentPurposeFor("/v1/me"), null);

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(await fs.readFile("worker/schema.sql", "utf8"));
const uid = "synthetic-consent-user", id = "synthetic-consent-session", secret = "synthetic-consent-secret", now = Date.now();
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
let aiCalls = 0;
const env = { DB: { prepare: prepared, batch }, AI_IMPORT_ENABLED: "true", AI_CONSENT_REQUIRED: "true", AI: { run: async () => { aiCalls++; return { response: JSON.stringify({ names: ["Alfamart"] }), usage: { prompt_tokens: 100, completion_tokens: 10 } }; } } };
const post = (path, body, options = env) => worker.fetch(new Request(`https://saku.example${path}`, { method: "POST", headers: { authorization: `Bearer ${id}.${secret}`, "content-type": "application/json", "x-saku-user-id": uid }, body: JSON.stringify(body) }), options);
const clean = (options) => post("/v1/merchants/clean", { names: ["QRIS ALFAMART 0123 JKT"] }, options);
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
try {
  const refused = await clean();
  assert.equal(refused.status, 403, "an AI route refuses a user with no consent receipt");
  assert.match(await refused.text(), /consent_required/);
  assert.equal(aiCalls, 0, "nothing reaches the AI binding without consent");
  assert.equal((await post("/v1/budget/suggest", { income: 5_000_000, kind: "fixed", pockets: [] })).status, 403, "each purpose needs its own receipt");

  assert.equal((await post("/v1/me/consent", { purpose: "merchant_tidy", version: 0, granted: true })).status, 400);
  const granted = await post("/v1/me/consent", { purpose: "merchant_tidy", version: CONSENT_VERSIONS.merchant_tidy, granted: true });
  assert.equal(granted.status, 200, await granted.clone().text());
  const receipt = sqlite.prepare("SELECT * FROM consents WHERE uid=? AND purpose='merchant_tidy'").get(uid);
  assert.equal(receipt.version, 1);
  assert.ok(receipt.granted_at >= now && receipt.withdrawn_at === null, "the receipt keeps purpose, version and time");

  assert.equal((await clean()).status, 200, "the route works once the receipt exists");
  assert.equal(aiCalls, 1);
  assert.equal((await post("/v1/import/match", { items: [] })).status, 403, "tidy consent does not cover statement matching");

  assert.equal((await post("/v1/me/consent", { purpose: "merchant_tidy", version: 1, granted: false })).status, 200);
  assert.ok(sqlite.prepare("SELECT withdrawn_at FROM consents WHERE uid=?").get(uid).withdrawn_at >= now, "withdrawal is recorded, not deleted");
  assert.equal((await clean()).status, 403, "withdrawing consent stops the route again");
  assert.equal(aiCalls, 1);

  const { AI_CONSENT_REQUIRED: _flag, ...unenforced } = env;
  assert.equal((await clean(unenforced)).status, 200, "until enforcement is switched on, older clients keep working");
  console.log("Consent route: receipts per purpose and version, 403 without one, withdrawal, enforcement flag passed");
} finally { delete crypto.subtle.timingSafeEqual; sqlite.close(); }
