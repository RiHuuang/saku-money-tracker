import assert from "node:assert/strict";
import { DAILY_CAP, RESERVATION, aiImportAvailable, dateFromPrintedEvidence, importMessages, importVerificationMessages, mergeImportPasses, neuronsUsed, parseImportAnswer, validateImportInput } from "./import-ai.js";

assert.equal(aiImportAvailable({ AI_IMPORT_ENABLED: "true", AI: {} }), true);
assert.equal(aiImportAvailable({ AI_IMPORT_ENABLED: "false", AI: {} }), false);
assert.equal(aiImportAvailable({ AI_IMPORT_ENABLED: "true" }), false);

const input = validateImportInput({ kind: "text", month: "2026-10", text: "10/10 TOKOPEDIA 41.244 DB" });
assert.equal(importMessages(input)[1].content.includes("TOKOPEDIA"), true);
const verification = importVerificationMessages(input, [{ date: "2026-10-10", name: "TOKOPEDIA", amount: 41244, direction: "expense", activity: "purchase" }]);
assert.equal(verification[1].content.includes("Second accuracy pass"), true);
assert.equal(verification[1].content.includes("First-pass candidates"), true);
assert.equal(verification[1].content.includes("TOKOPEDIA"), true);
const firstPass = [
  { date: "2026-10-10", dateEvidence: "10/10/2026", name: "Synthetic cafe", paymentMethod: "", amount: 2800, direction: "expense", activity: "purchase" },
  { date: "2026-10-10", dateEvidence: "10/10/2026", name: "Synthetic omitted row", paymentMethod: "", amount: 5000, direction: "expense", activity: "fee" },
];
const secondPass = [
  { date: "2026-10-10", dateEvidence: "10/10/2026", name: "Synthetic cafe", paymentMethod: "", amount: 28000, direction: "expense", activity: "purchase" },
  { date: "2026-10-10", dateEvidence: "10/10/2026", name: "Synthetic newly found row", paymentMethod: "", amount: 7000, direction: "expense", activity: "purchase" },
];
assert.deepEqual(mergeImportPasses(firstPass, secondPass), [
  secondPass[0],
  { ...firstPass[1], direction: "unknown", activity: "unknown" },
  secondPass[1],
], "the second pass corrects aligned rows, adds discoveries, and cannot silently discard first-pass-only candidates");
assert.throws(() => validateImportInput({ kind: "image", month: "2026-10", image: "data:image/svg+xml;base64,AA==" }));
assert.equal(DAILY_CAP, 4000);
assert.equal(RESERVATION, 2500);
assert.equal(DAILY_CAP * 2, 8000);
const response = { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ rows: [{ date: "2026-10-10", name: "Tokopedia", amount: 41244, direction: "expense", activity: "purchase" }] }) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } };
assert.deepEqual(parseImportAnswer(response)[0], { date: "", dateEvidence: "", name: "Tokopedia", cleanName: "Tokopedia", paymentMethod: "", amount: 41244, direction: "expense", activity: "purchase" });
assert.equal(dateFromPrintedEvidence("Kemarin 05 Sep 2025"), "2025-09-05");
assert.equal(dateFromPrintedEvidence("Jumat 9 Okt 2026"), "2026-10-09");
assert.equal(dateFromPrintedEvidence("14/10/2026 · 08:12"), "2026-10-14");
assert.equal(dateFromPrintedEvidence("Tanggal Pembukuan 14/10/2026; Tanggal Transaksi 13/10/2026"), "2026-10-13");
assert.equal(dateFromPrintedEvidence("Transaction date 13 Oct 2026; Posting date 14 Oct 2026"), "2026-10-13");
assert.equal(dateFromPrintedEvidence("Posting date 14 Oct 2026"), "");
assert.equal(dateFromPrintedEvidence("Transaction date 13 Oct; Posting date 14 Oct 2026"), "");
assert.equal(dateFromPrintedEvidence("Tanggal Transaksi 13 Okt; Tanggal Pembukuan 14 Okt", "2026-10"), "2026-10-13");
assert.equal(dateFromPrintedEvidence("13/10", "2026-10"), "2026-10-13");
assert.equal(dateFromPrintedEvidence("13 Oct", "2026-09"), "");
assert.equal(dateFromPrintedEvidence("31/10", "2026-10"), "2026-10-31");
assert.equal(dateFromPrintedEvidence("31/02", "2026-02"), "");
assert.equal(dateFromPrintedEvidence("31 Feb 2026"), "");
const screenshotRow = (dateEvidence) => parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-12", dateEvidence, name: "Fabricated wallet payment", amount: 39200, direction: "expense", activity: "purchase" }] }) }, "image")[0];
assert.equal(screenshotRow("Kemarin 05 Sep 2025").date, "2025-09-05", "printed group date overrides an incorrect model-converted date");
assert.equal(screenshotRow("").date, "", "an image row without a full printed date waits for review");
assert.equal(screenshotRow("Kemarin").date, "", "relative labels alone are not calendar evidence");
assert.equal(parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-13", dateEvidence: "13 Oct", name: "Fabricated screenshot purchase", amount: 28000, direction: "expense", activity: "purchase" }] }) }, "image", "2026-10")[0].date, "", "screenshot dates need a printed year even when the selected month matches");
assert.equal(parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-14", dateEvidence: "Posting date 14 Oct 2026", name: "Fabricated card purchase", amount: 28000, direction: "expense", activity: "purchase" }] }) })[0].date, "", "posting-only evidence cannot validate a text statement date");
const textRow = (dateEvidence, date = "2025-10-13") => parseImportAnswer({ response: JSON.stringify({ rows: [{ date, dateEvidence, name: "Fabricated text-PDF purchase", amount: 28000, direction: "expense", activity: "purchase" }] }) }, "text", "2026-10")[0];
assert.equal(textRow("13 Oct").date, "2026-10-13", "printed day and month use the selected review year");
assert.equal(textRow("13/10").date, "2026-10-13", "numeric day and month override a wrong model year");
assert.equal(textRow("13 Sep").date, "", "a different printed month waits for review");
assert.equal(textRow("Transaction date 13 Oct; Posting date 14 Oct 2026").date, "2026-10-13", "a yearless transaction date outranks a full posting date");
const evidencedTextRow = (dateEvidence, sourceText) => parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-13", dateEvidence, name: "Fabricated text-PDF purchase", amount: 28000, direction: "expense", activity: "purchase" }] }) }, "text", "2026-10", sourceText)[0];
assert.equal(evidencedTextRow("13 Oct", " 13  Oct   Fabricated text-PDF purchase 28.000").date, "2026-10-13", "a printed text date can be used despite whitespace differences");
assert.equal(evidencedTextRow("13 Oct", "14 Oct Fabricated text-PDF purchase 28.000").date, "", "a model date unsupported by the page waits for review");
assert.equal(evidencedTextRow("", "13 Oct Fabricated text-PDF purchase 28.000").date, "", "a date without printed evidence waits for review");
assert.equal(importMessages(validateImportInput({ kind: "image", month: "2026-10", image: "data:image/jpeg;base64,AA==" }))[0].content.includes("dateEvidence"), true);
assert.equal(importMessages(validateImportInput({ kind: "image", month: "2026-10", image: "data:image/jpeg;base64,AA==" }))[0].content.includes("THIS MONTH"), true, "image histories must use row dates instead of a generic month heading");
assert.equal(importMessages(validateImportInput({ kind: "image", month: "2026-10", image: "data:image/jpeg;base64,AA==" }))[0].content.includes("14 Apr 2025, 08:23"), true, "image histories may print small row dates with times under activity labels");
assert.equal(importMessages(input)[0].content.includes("Rp1.234.567 means 1234567"), true, "the prompt must spell out Indonesian thousand separators with fabricated examples");
assert.equal(parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-10", name: "QRIS WARUNG CONTOH", amount: 28000, direction: "expense", activity: "card_payment" }] }) })[0].activity, "purchase");
const bcaCredit = parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-13", dateEvidence: "13 Oct 2026", name: "1310/FTSCY/WS95271 9000.00 EXAMPLE NAME TRSF E-BANKING CR", amount: 9000, direction: "expense", activity: "purchase" }] }) })[0];
assert.equal(bcaCredit.direction, "income", "a printed BCA CR credit cannot enter a spending batch");
assert.equal(bcaCredit.activity, "income", "the credit needs review as possible own-account money");
assert.equal(parseImportAnswer({ response: JSON.stringify({ rows: [{ name: "EXAMPLE NAME", paymentMethod: "TRSF E-BANKING CR", amount: 9000, direction: "expense", activity: "purchase" }] }) })[0].activity, "income", "the code may appear in either extracted field");
assert.equal(parseImportAnswer({ response: JSON.stringify({ rows: [{ name: "TRSF E-BANKING DB EXAMPLE", amount: 9000, direction: "expense", activity: "purchase" }] }) })[0].activity, "purchase", "the CR safeguard does not rewrite debits");
assert.equal(importMessages(input)[0].content.includes("TRSF E-BANKING CR is an incoming credit"), true);
assert.equal(importMessages(input)[0].content.includes("PEND is not a date"), true);
assert.equal(importMessages(validateImportInput({ kind: "image", month: "2026-10", image: "data:image/jpeg;base64,AA==" }))[1].content[0].text.includes("dated rows below any PEND entry"), true);
const bcaPending = parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-13", dateEvidence: "13 Oct 2026", name: "PEND 1310/FTSCY/WS95271 TRSF E-BANKING CR", amount: 9000, direction: "income", activity: "income" }] }) })[0];
assert.equal(bcaPending.activity, "pending", "a printed PEND marker cannot become settled income");
assert.equal(bcaPending.date, "", "a pending row cannot inherit the following row's date");
for (const name of ["Move Money", "Pindah Dana antar Kantong", "Transfer Antar Kantong"]) {
  assert.equal(parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-10", name, amount: 28000, direction: "expense", activity: "purchase" }] }) })[0].activity, "transfer");
}
assert.equal(parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-10", name: "Bunga Tabungan", amount: "Rp 332", direction: "income", activity: "interest" }] }) })[0].activity, "interest");
assert.equal(importMessages(input)[0].content.includes("Completed can still contain expired payments"), true);
assert.equal(importMessages(input)[0].content.includes("a category total is not an individual payment"), true);
assert.equal(importMessages(input)[0].content.includes("use the transaction date for date and dateEvidence"), true);
assert.equal(parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-10", name: "Pembayaran kedaluwarsa", amount: "Rp 22.000", direction: "expense", activity: "purchase" }] }) })[0].activity, "failed");
assert.equal(importMessages(input)[0].content.includes("Use income for salary"), true);
assert.equal(parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-10", name: "Gaji dari Contoh Studio", amount: "Rp 3.500.000", direction: "income", activity: "income" }] }) })[0].activity, "income");
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

const cleanNameOf = (name, cleanName) => parseImportAnswer({ response: JSON.stringify({ rows: [{ date: "2026-10-10", name, cleanName, amount: 28000, direction: "expense", activity: "purchase" }] }) })[0].cleanName;
assert.equal(cleanNameOf("QRIS ALFAMART 0123 JKT", " Alfamart "), "Alfamart");
assert.equal(cleanNameOf("GRAB* A-5XK2 RIDE", "Grab"), "Grab");
assert.equal(cleanNameOf("Synthetic shop", undefined), "Synthetic shop", "missing cleanName falls back to the printed name");
assert.equal(cleanNameOf("Synthetic shop", "x".repeat(61)), "Synthetic shop", "an overlong cleanName falls back to the printed name");
assert.equal(cleanNameOf("Synthetic shop", "Shop 12345"), "Synthetic shop", "a cleanName with a code-like digit run falls back to the printed name");
assert.equal(cleanNameOf("Synthetic shop", "Shop 123"), "Shop 123", "short numbers such as a store brand survive");
assert.equal(cleanNameOf("A".repeat(100), ""), "A".repeat(60), "the fallback is cut to the cleanName limit");
const cleanFirst = [{ date: "2026-10-10", dateEvidence: "10/10/2026", name: "QRIS ALFAMART 0123 JKT", cleanName: "Alfamart", paymentMethod: "BCA", amount: 28000, direction: "expense", activity: "purchase" }];
const cleanSecond = [{ ...cleanFirst[0], cleanName: "Alfamart Jakarta" }, { ...cleanFirst[0], name: "Synthetic second row", cleanName: "Second", amount: 5000 }];
assert.deepEqual(mergeImportPasses(cleanFirst, cleanSecond), cleanSecond, "rows that differ only in cleanName still match exactly and keep the verified pass");
assert.deepEqual(mergeImportPasses([...cleanFirst, cleanFirst[0]], [cleanSecond[0], { ...cleanFirst[0], cleanName: "Other" }]).map((row) => row.cleanName), ["Alfamart Jakarta", "Other"], "duplicate rows pair one-to-one even when cleanName differs");
console.log("Import AI cleanName: validation fallbacks and cleanName-insensitive pass merging passed");

