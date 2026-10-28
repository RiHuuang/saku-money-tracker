import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bcaRow, looksLikeBcaStatement, mergeBcaReads, parseBcaAnswer, settlePending } from "./import-bca.js";

// Every synthetic myBCA row in the benchmark parses to the expected Saku row when the transcription is right.
const { screens } = JSON.parse(readFileSync(new URL("../scripts/fixtures/bca/expected.json", import.meta.url), "utf8"));
const read = (row) => ({ dateText: row.printedDate, ref: row.printedRef, type: row.printedType, amountText: `IDR ${row.amount.toLocaleString("en-US")}.00` });
const kind = (row) => row.activity === "card_payment" ? "card_payment" : row.activity === "topup" ? "wallet_topup" : row.direction;
for (const screen of screens) for (const [index, parsed] of settlePending(screen.rows.map((row) => bcaRow(read(row))), "2026-10-28").entries()) {
  const row = screen.rows[index];
  assert.equal(parsed.amount, row.amount, row.printedRef);
  assert.equal(parsed.direction, row.direction, row.printedRef);
  assert.equal(parsed.date, row.expect.date, row.printedRef);
  assert.equal(kind(parsed), row.expect.kind, row.printedRef);
  assert.equal(parsed.cleanName, row.expect.name, row.printedRef);
  assert.equal(parsed.note.replace(/\s/g, ""), row.expect.note.replace(/\s/g, ""), row.printedRef);
  assert.equal(parsed.check, "", row.printedRef);
}

// PEND takes the day after the latest booked date on screen, never later than today, and needs review with no date on screen.
const pend = { dateText: "PEND", ref: "2710/FTSCY/WS95271 55000.00 BAGUS PRAKOSO", type: "TRSF E-BANKING CR", amountText: "IDR 55,000.00" };
const dated = { ...pend, dateText: "25 Oct 2026" };
assert.equal(settlePending([bcaRow(pend), bcaRow(dated)], "2026-10-28")[0].date, "2026-10-26");
assert.equal(settlePending([bcaRow(pend), bcaRow({ ...pend, dateText: "28 Oct 2026" })], "2026-10-28")[0].date, "2026-10-28");
assert.deepEqual(settlePending([bcaRow(pend)], "2026-10-28").map((row) => [row.date, row.check]), [["", "date"]]);

// The amount repeated inside a transfer reference must agree with the IDR line.
assert.equal(bcaRow({ dateText: "27 Oct 2026", ref: "2710/FTSCY/WS95271 55000.00 BAGUS PRAKOSO", type: "TRSF E-BANKING CR", amountText: "IDR 85,000.00" }, "2026-10-28").check, "amount");
// myBCA prints both "QR" and "QRP" before the merchant on a QRIS debit.
assert.equal(bcaRow({ dateText: "28 Oct 2026", ref: "TGL: 1028 QRP 008 00000.00Warung Bu Sri", type: "TRANSAKSI DEBIT", amountText: "IDR 3,000.00" }).cleanName, "Warung Bu Sri");
// Unreadable amounts, unknown types and missing dates never go straight in.
assert.equal(bcaRow({ dateText: "27 Oct 2026", ref: "X", type: "TRSF E-BANKING CR", amountText: "IDR 1,5" }, "2026-10-28").check, "amount");
assert.equal(bcaRow({ dateText: "27 Oct 2026", ref: "BIAYA ADM", type: "SOMETHING NEW", amountText: "IDR 15,000.00" }, "2026-10-28").check, "type");
assert.equal(bcaRow({ dateText: "October", ref: "X", type: "TRSF E-BANKING DB", amountText: "IDR 15,000.00" }, "2026-10-28").check, "date");

// The owner's PEND rows: when one read drops the type line, the other read's type decides the direction.
const pendIn = { dateText: "PEND", ref: "2810/FTSCY/WS95031 24449.00 ADVENIA TRICAHYA W", type: "TRSF E-BANKING CR", amountText: "IDR 24,449.00" };
const booked = { dateText: "27 Oct 2026", ref: "2710/FTSCY/WS95271 55000.00 BAGUS PRAKOSO", type: "TRSF E-BANKING CR", amountText: "IDR 55,000.00" };
const recovered = mergeBcaReads({ bank: "BCA", rows: [{ ...pendIn, type: "" }, booked] }, { bank: "BCA", rows: [pendIn, booked] }, "2026-10-28");
assert.deepEqual([recovered[0].direction, recovered[0].cleanName, recovered[0].amount, recovered[0].date, recovered[0].check], ["income", "Transfer dari Advenia Tricahya W", 24449, "2026-10-28", "unconfirmed"]);
assert.equal(bcaRow({ ...pendIn, type: "TRSF E-BANKING CR." }).direction, "income");
assert.equal(bcaRow({ ...pendIn, type: "" }).check, "type");
// Two reads that disagree on a row send it to review; a row only one read saw is unconfirmed.
const one = { bank: "BCA", rows: [read(screens[2].rows[0]), read(screens[2].rows[1])] };
const misread = { bank: "BCA", rows: [{ ...read(screens[2].rows[0]), amountText: "IDR 2,535,050.00" }] };
const merged = mergeBcaReads(one, misread, "2026-10-28");
assert.deepEqual(merged.map((row) => row.check), ["amount", "unconfirmed"]);

assert.deepEqual(parseBcaAnswer({ choices: [{ message: { content: JSON.stringify({ bank: "other", rows: [] }) } }] }), { bank: "other", rows: [] });
assert.throws(() => parseBcaAnswer({ choices: [{ finish_reason: "length", message: { content: "{" } }] }), /cut off/);
assert.equal(looksLikeBcaStatement("PT BANK CENTRAL ASIA Tbk\nREKENING TAHAPAN"), true);
assert.equal(looksLikeBcaStatement("BANK MANDIRI rekening koran"), false);

console.log("BCA reading: myBCA row formats, PEND dates, amount cross-checks, two-read review and BCA-only gate passed");
