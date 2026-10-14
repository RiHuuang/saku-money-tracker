import assert from "node:assert/strict";
import { DAILY_CAP, RESERVATION, aiImportAvailable, importMessages, neuronsUsed, parseImportAnswer, validateImportInput } from "./import-ai.js";

assert.equal(aiImportAvailable({ AI_IMPORT_ENABLED: "true", AI: {} }), true);
assert.equal(aiImportAvailable({ AI_IMPORT_ENABLED: "false", AI: {} }), false);
assert.equal(aiImportAvailable({ AI_IMPORT_ENABLED: "true" }), false);

const input = validateImportInput({ kind: "text", month: "2026-10", text: "10/10 TOKOPEDIA 41.244 DB" });
assert.equal(importMessages(input)[1].content.includes("TOKOPEDIA"), true);
assert.throws(() => validateImportInput({ kind: "image", month: "2026-10", image: "data:image/svg+xml;base64,AA==" }));
assert.equal(DAILY_CAP, 4000);
assert.equal(RESERVATION, 2500);
assert.equal(DAILY_CAP * 2, 8000);
const response = { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ rows: [{ date: "2026-10-10", name: "Tokopedia", amount: 41244, direction: "expense", activity: "purchase" }] }) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } };
assert.deepEqual(parseImportAnswer(response)[0], { date: "2026-10-10", name: "Tokopedia", paymentMethod: "", amount: 41244, direction: "expense", activity: "purchase" });
assert.equal(parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-10", name: "QRIS WARUNG CONTOH", amount: 28000, direction: "expense", activity: "card_payment" }] }) })[0].activity, "purchase");
for (const name of ["Move Money", "Pindah Dana antar Kantong", "Transfer Antar Kantong"]) {
  assert.equal(parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-10", name, amount: 28000, direction: "expense", activity: "purchase" }] }) })[0].activity, "transfer");
}
assert.equal(parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-10", name: "Bunga Tabungan", amount: "Rp 332", direction: "income", activity: "interest" }] }) })[0].activity, "interest");
const deferred = parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-10", name: "Fabricated cafe", paymentMethod: "Example PayLater", amount: 39200, direction: "expense", activity: "purchase" }] }) })[0];
assert.equal(deferred.activity, "pay_later");
assert.equal(deferred.paymentMethod, "Example PayLater");
const amountFrom = (value) => parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-10", name: "Fabricated purchase", amount: value, direction: "expense", activity: "purchase" }] }) })[0].amount;
assert.equal(amountFrom("28.000"), 28000);
assert.equal(amountFrom("Rp 28.000,00"), 28000);
assert.equal(amountFrom("28,000.00"), 28000);
assert.equal(amountFrom("28000"), 28000);
assert.equal(amountFrom("28,000"), 0);
assert.equal(amountFrom("28.000,50"), 0);
assert.equal(amountFrom(true), 0);
assert.equal(amountFrom(28.5), 0);
assert.equal(neuronsUsed(response), 12);
assert.equal(neuronsUsed({}), RESERVATION);
assert.throws(() => parseImportAnswer({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }));
assert.throws(() => parseImportAnswer({ response: "not json" }));
console.log("AI import: bounded inputs, source prompts, output validation and neuron accounting passed");
