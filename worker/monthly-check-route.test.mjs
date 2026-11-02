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
import { BUDGET_RESERVATION, parseBudgetAnswer, validateBudgetInput } from "./budget-ai.js";
import { MATCH_RESERVATION, parseMatchAnswer, validateMatchInput } from "./import-match.js";

let calls = [];
let answer = () => ({ rows: [] });
const env = {
  DB: { prepare: prepared, batch }, AI_IMPORT_ENABLED: "true",
  AI: { run: async (_model, options) => { calls.push(options); return { response: JSON.stringify(answer(options, calls.length)), usage: { prompt_tokens: 500, completion_tokens: 50 } }; } },
};
const post = (path, body) => worker.fetch(new Request(`https://saku.example${path}`, { method: "POST", headers: { authorization: `Bearer ${id}.${secret}`, "content-type": "application/json", "x-saku-user-id": uid }, body: JSON.stringify(body) }), env);
const cafe = { date: "2026-10-10", dateEvidence: "10/10/2026", name: "Synthetic cafe", amount: 28000, direction: "expense", activity: "purchase" };
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
try {
  // Text statements name their bank; the Worker reads the six supported ones and refuses the rest before any AI call.
  answer = () => ({ rows: [cafe] });
  let response = await post("/v1/import/extract", { kind: "text", month: "2026-10", source: "auto", text: "PT Bank Jago Tbk\n10/10/2026 Synthetic cafe 28.000" });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).bank, "jago");
  assert.equal(calls.length, 2);
  assert.match(calls[0].messages[0].content, /Bank Jago account history/, "the bank's own conventions reach the prompt");
  calls = [];
  response = await post("/v1/import/extract", { kind: "text", month: "2026-10", source: "auto", text: "Bank Mandiri\n10/10/2026 Synthetic cafe 28.000" });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, "unsupported_bank");
  assert.equal(calls.length, 0, "an unsupported statement costs nothing");
  response = await post("/v1/import/extract", { kind: "text", month: "2026-10", source: "bca", text: "PT Bank Jago Tbk\n10/10/2026 Synthetic cafe 28.000" });
  assert.equal((await response.json()).error, "not_bca", "2.4.0 clients keep the BCA-only answer");
  assert.equal((await post("/v1/import/extract", { kind: "text", month: "2026-10", source: "mandiri", text: "x".repeat(100) })).status, 400);

  // A screenshot with no account guess: the first pass names the bank and doubles as the reading.
  calls = [];
  answer = (options) => options.messages[1].content[0]?.text?.includes("Second accuracy pass") ? { rows: [cafe] } : { bank: "dana", rows: [cafe] };
  response = await post("/v1/import/extract", { kind: "image", month: "2026-10", source: "auto", image: "data:image/jpeg;base64,AA==" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).bank, "dana");
  assert.equal(calls.length, 2, "detection costs no extra pass");
  assert.match(calls[1].messages[0].content, /DANA wallet history/);
  calls = [];
  answer = () => ({ bank: "other", rows: [] });
  response = await post("/v1/import/extract", { kind: "image", month: "2026-10", source: "auto", image: "data:image/jpeg;base64,AA==" });
  assert.equal((await response.json()).error, "unsupported_bank");
  assert.equal(calls.length, 1);
  // Recognised as BCA: the field-by-field BCA reader takes over.
  calls = [];
  answer = (options, n) => n === 1 ? { bank: "bca", rows: [] } : { bank: "BCA", rows: [{ dateText: "27 Oct 2026", ref: "TGL: 2710 QR 008 45500.00WARTEG", type: "TRANSAKSI DEBIT", amountText: "IDR 45,500.00" }] };
  response = await post("/v1/import/extract", { kind: "image", month: "2026-10", source: "auto", image: "data:image/jpeg;base64,AA==" });
  const bcaBody = await response.json();
  assert.equal(bcaBody.bank, "bca");
  assert.equal(bcaBody.rows[0].amount, 45500);
  assert.equal(calls.length, 3);

  // Name tiebreak: bounded input, small reservation, picks only from the offered candidates.
  assert.throws(() => validateMatchInput({ items: [{ id: "r1", name: "x", date: "2026-10-10", candidates: [{ id: "a", date: "2026-10-10" }] }] }), /2 to 5/);
  const items = [{ id: "r1", name: "TRSF DB BERNADETTA", date: "2026-10-10", candidates: [{ id: "a", name: "trf to ci bebe", note: "", date: "2026-10-10" }, { id: "b", name: "Dimas", note: "", date: "2026-10-10" }] }];
  assert.deepEqual(parseMatchAnswer({ response: JSON.stringify({ picks: [{ id: "r1", candidateId: "zzz", confidence: "high" }] }) }, { items }), [{ id: "r1", candidateId: "none", confidence: "low" }], "an invented candidate is never passed on");
  calls = [];
  answer = () => ({ picks: [{ id: "r1", candidateId: "a", confidence: "high" }] });
  response = await post("/v1/import/match", { items });
  assert.deepEqual((await response.json()).picks, [{ id: "r1", candidateId: "a", confidence: "high" }]);
  assert.equal(calls[0].max_completion_tokens, 1024);
  assert.equal(MATCH_RESERVATION, 100);

  // Budget refine: the model can only adjust inside the limits; anything else returns the phone's own plan.
  const plan = { income: 8_000_000, kind: "fixed", pockets: [
    { key: "food", name: "Makan", group: "needs", baseline: 2_500_000, spend: 2_400_000, fixed: 0 },
    { key: "kos", name: "Kos", group: "needs", baseline: 2_000_000, spend: 2_000_000, fixed: 2_000_000 },
    { key: "save", name: "Tabungan", group: "savings", baseline: 1_600_000, spend: 0, fixed: 0 },
  ] };
  assert.throws(() => validateBudgetInput({ ...plan, income: 1_000_000 }), /larger than the income/);
  assert.throws(() => validateBudgetInput({ ...plan, pockets: [{ ...plan.pockets[0], name: "" }] }));
  const input = validateBudgetInput(plan);
  const reply = (allocations) => parseBudgetAnswer({ response: JSON.stringify({ allocations }) }, input);
  const good = reply([{ key: "food", amount: 2_604_000, reason: "Rata-rata 3 bulan Rp2,4 jt" }, { key: "kos", amount: 2_000_000, reason: "Tetap" }, { key: "save", amount: 2_000_000, reason: "Minimal 10%" }]);
  assert.equal(good.source, "ai");
  assert.equal(good.allocations[0].amount, 2_600_000, "rounded to Rp10.000");
  assert.equal(reply([{ key: "food", amount: 900_000 }, { key: "kos", amount: 2_000_000 }, { key: "save", amount: 2_000_000 }]).source, "baseline", "too far from real spending");
  assert.equal(reply([{ key: "food", amount: 2_500_000 }, { key: "kos", amount: 1_500_000 }, { key: "save", amount: 2_000_000 }]).source, "baseline", "below a fixed commitment");
  assert.equal(reply([{ key: "food", amount: 3_000_000 }, { key: "kos", amount: 2_000_000 }, { key: "save", amount: 3_500_000 }]).source, "baseline", "over income");
  assert.equal(reply([{ key: "food", amount: 2_500_000 }]).source, "baseline", "a missing pocket");
  assert.deepEqual(parseBudgetAnswer({ response: "not json" }, input).allocations.map((item) => item.amount), [2_500_000, 2_000_000, 1_600_000]);
  calls = [];
  answer = () => ({ allocations: [{ key: "food", amount: 2_500_000, reason: "ok" }, { key: "kos", amount: 2_000_000, reason: "ok" }, { key: "save", amount: 1_600_000, reason: "ok" }] });
  response = await post("/v1/budget/suggest", plan);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).source, "ai");
  assert.match(calls[0].messages[0].content, /40%/);
  assert.equal(BUDGET_RESERVATION, 150);
  assert.equal((await post("/v1/budget/suggest", { ...plan, kind: "weekly" })).status, 400);
  console.log("Monthly check routes: six banks, unsupported refusal, screenshot detection, name tiebreak and budget limits passed");
} finally { delete crypto.subtle.timingSafeEqual; sqlite.close(); }
