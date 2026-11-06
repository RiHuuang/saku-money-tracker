import assert from "node:assert/strict";
import { test } from "node:test";
import { accountForBank, bankOfAccount, detectBank, mentionsAccount } from "../worker/banks.js";
import { emptyData, type Transaction } from "./domain";
import type { ImportRow } from "./importDraft";
import { learnMerchant } from "./merchants";
import { analyzeStatement, applyVerdict, balanceMismatch, type MatchRow } from "./statementMatch";
import { moneyToken, parseStatementPage, statementTotals } from "./statementLines";

const data = emptyData();
data.name = "Rina Wulandari";
data.accounts = ["BCA", "Jago", "Cash", "DANA"];
const tx = (patch: Partial<Transaction>): Transaction => ({ id: "t1", name: "Coffee", amount: 50_000, type: "expense", date: "2026-10-10", pocketId: "", account: "BCA", note: "", ...patch });
const row = (patch: Partial<MatchRow>): MatchRow => ({ id: "r1", sourceId: "bca-pdf", account: "BCA", date: "2026-10-10", amount: 50_000, direction: "expense", name: "TRSF E-BANKING DB", cleanName: "", activity: "purchase", ...patch });
const verdict = (analysis: ReturnType<typeof analyzeStatement>, id: string) => analysis.verdicts.get(id);

test("banks: statements, accounts and descriptions resolve to the right bank", () => {
  assert.equal(detectBank("PT BANK CENTRAL ASIA Tbk\nREKENING TAHAPAN"), "bca");
  assert.equal(detectBank("blu by BCA Digital\nRiwayat transaksi BCA"), "blu", "blu prints BCA too, and is checked first");
  assert.equal(detectBank("PT Bank Jago Tbk\nTransfer ke BCA"), "jago", "the header decides, not a transfer line");
  assert.equal(detectBank("PT Bank SeaBank Indonesia"), "seabank");
  assert.equal(detectBank("Riwayat transaksi GoPay"), "gopay");
  assert.equal(detectBank("E-statement Halaman 1 dari 3 Periode transaksi\nTotal Coins didapatkan Total Coins dipakai\nTabungan by Jago\nGoPay Tabungan top up"), "gopay", "funding bank does not replace the wallet statement identity");
  assert.equal(detectBank("REKENING TAHAPAN XPRESI\nTransfer BANK JAGO"), "bca", "the BCA title identifies a statement without a text logo");
  assert.equal(detectBank("bluAccount\nDana masuk BANK JAGO\nBCA Digital"), "blu", "blu's header wins over a transfer bank");
  assert.equal(detectBank("PT Espay Debit Indonesia Koe"), "dana");
  assert.equal(detectBank("Bank Mandiri rekening koran"), "");
  assert.equal(bankOfAccount("BCA Utama"), "bca");
  assert.equal(bankOfAccount("blu BCA"), "blu");
  assert.equal(bankOfAccount("Dana Darurat"), "", "an emergency fund is not the DANA wallet");
  assert.equal(bankOfAccount("DANA"), "dana");
  assert.equal(accountForBank(["BCA", "BCA Bisnis"], "bca"), "", "two BCA accounts: the user picks");
  assert.equal(accountForBank(["BCA", "Jago"], "jago"), "Jago");
  assert.ok(mentionsAccount("TRSF E-BANKING DB BANK JAGO RINA", "Jago"));
  assert.ok(mentionsAccount("Transfer from Bank Artos", "Jago"), "Jago's former name");
  assert.ok(!mentionsAccount("ALFAMART", "Jago"));
});

test("an entry the user logged under another name links without asking, and teaches the alias", () => {
  const ledger = [tx({ id: "bebe", name: "trf to ci bebe", amount: 150_000, date: "2026-10-11" })];
  const rows = [row({ id: "s1", amount: 150_000, date: "2026-10-12", name: "TRSF E-BANKING DB 1210/FTSCY/WS95051 BERNADETTA SUSANTI", cleanName: "Transfer ke Bernadetta Susanti" })];
  const analysis = analyzeStatement(rows, { ...data, transactions: ledger });
  const result = verdict(analysis, "s1");
  assert.equal(result?.kind, "linked");
  assert.ok(result?.kind === "linked" && result.auto && result.transactionId === "bebe");
  assert.deepEqual(result?.kind === "linked" && result.alias, { from: "Transfer ke Bernadetta Susanti", to: "trf to ci bebe" });
  assert.equal(analysis.onlyInSaku.length, 0);
  // Next month the alias makes the name agree, so it wins even against an equal-value rival.
  const merchantRules = learnMerchant(data, rows[0].name, { name: "trf to ci bebe", pocketId: "" });
  const next = analyzeStatement([
    row({ id: "a", amount: 150_000, date: "2026-11-12", name: rows[0].name }),
    row({ id: "b", amount: 150_000, date: "2026-11-12", name: "TRSF E-BANKING DB 1211/FTSCY/WS1 YOGA" }),
  ], { ...data, merchantRules, transactions: [tx({ id: "bebe2", name: "trf to ci bebe", amount: 150_000, date: "2026-11-12" })] });
  assert.ok(next.verdicts.get("a")?.kind === "linked", "the alias decides between two equal amounts");
  assert.equal(next.verdicts.get("b")?.kind, "new");
});

test("two equal amounts on the same day never link silently", () => {
  const rows = [row({ id: "a", name: "TRSF DB YOGA" }), row({ id: "b", name: "TRSF DB DIMAS" })];
  const analysis = analyzeStatement(rows, { ...data, transactions: [tx({ id: "one", name: "lunch money" })] });
  assert.deepEqual([verdict(analysis, "a")?.kind, verdict(analysis, "b")?.kind], ["look", "look"]);
  assert.deepEqual(verdict(analysis, "a")?.kind === "look" && verdict(analysis, "a"), { kind: "look", reason: "ambiguous", candidates: ["one"] });
  // One statement row, two equal ledger entries: also the user's call.
  const other = analyzeStatement([row({ id: "a" })], { ...data, transactions: [tx({ id: "x", name: "Lunch" }), tx({ id: "y", name: "Snack", date: "2026-10-11" })] });
  assert.equal(verdict(other, "a")?.kind, "look");
  // A name signal settles it.
  const named = analyzeStatement([row({ id: "a", name: "QRIS KOPI KENANGAN", cleanName: "Kopi Kenangan" })], { ...data, transactions: [tx({ id: "x", name: "Kopi Kenangan" }), tx({ id: "y", name: "Snack" })] });
  assert.ok(verdict(named, "a")?.kind === "linked" && (verdict(named, "a") as { transactionId: string }).transactionId === "x");
});

test("the user's picks win: a chosen entry links, 'it's new' and unlink stay new", () => {
  const ledger = [tx({ id: "x" }), tx({ id: "y", date: "2026-10-11" })];
  assert.ok(verdict(analyzeStatement([row({ id: "a", matchId: "y" })], { ...data, transactions: ledger }), "a")?.kind === "linked");
  assert.equal(verdict(analyzeStatement([row({ id: "a", confirmedSeparate: true })], { ...data, transactions: ledger }), "a")?.kind, "new");
  assert.equal(verdict(analyzeStatement([row({ id: "a", unlinked: true })], { ...data, transactions: [tx({ id: "x" })] }), "a")?.kind, "new");
});

test("dates more than two days apart, other directions and the draft's own rows are not matches", () => {
  const ledger = [tx({ id: "far", date: "2026-10-13" }), tx({ id: "in", type: "income" }), tx({ id: "mine" })];
  const analysis = analyzeStatement([row({ id: "a" })], { ...data, transactions: ledger }, { draftIds: new Set(["mine"]) });
  assert.equal(verdict(analysis, "a")?.kind, "new");
});

test("a BCA → Jago move pairs into one transfer across two statements", () => {
  const rows = [
    row({ id: "out", amount: 500_000, date: "2026-10-05", name: "TRSF E-BANKING DB 0510/FTSCY/WS1 RINA WULANDARI BANK JAGO" }),
    row({ id: "in", sourceId: "jago-pdf", account: "Jago", amount: 500_000, date: "2026-10-06", direction: "income", name: "Transfer masuk dari RINA WULANDARI BCA", activity: "income" }),
    row({ id: "lunch", amount: 45_000, name: "QRIS WARTEG" }),
  ];
  const analysis = analyzeStatement(rows, { ...data, transactions: [] });
  assert.deepEqual(verdict(analysis, "out"), { kind: "transfer", counterparty: "Jago", partnerRowId: "in" });
  assert.deepEqual(verdict(analysis, "in"), { kind: "transfer", counterparty: "BCA", partnerRowId: "out" });
  assert.equal(verdict(analysis, "lunch")?.kind, "new");
  const applied = applyVerdict({ ...rows[0], page: 1, decision: "later", pocketId: "" } as ImportRow, verdict(analysis, "out"));
  assert.equal(applied.activity, "transfer");
  assert.equal(applied.counterparty, "Jago");
  assert.equal(applied.decision, "ready");
});

test("a transfer already logged as two legs links both statement rows instead of pairing them again", () => {
  const legs = [tx({ id: "leg-out", transferId: "tr", kind: "account_transfer", amount: 500_000, date: "2026-10-05", name: "Transfer to Jago" }), tx({ id: "leg-in", transferId: "tr", kind: "account_transfer", type: "income", account: "Jago", amount: 500_000, date: "2026-10-05", name: "Transfer from BCA" })];
  const rows = [row({ id: "out", amount: 500_000, date: "2026-10-05" }), row({ id: "in", account: "Jago", direction: "income", amount: 500_000, date: "2026-10-05", activity: "income" })];
  const analysis = analyzeStatement(rows, { ...data, transactions: legs });
  assert.ok(verdict(analysis, "out")?.kind === "linked" && verdict(analysis, "in")?.kind === "linked");
});

test("two equally good transfer partners go to the user", () => {
  const rows = [
    row({ id: "out", amount: 100_000 }),
    row({ id: "in1", account: "Jago", direction: "income", amount: 100_000, activity: "income" }),
    row({ id: "in2", account: "DANA", direction: "income", amount: 100_000, activity: "income" }),
  ];
  const analysis = analyzeStatement(rows, { ...data, transactions: [] });
  const out = verdict(analysis, "out");
  assert.equal(out?.kind, "look");
  assert.deepEqual(out?.kind === "look" && out.partnerRowIds?.sort(), ["in1", "in2"]);
  assert.equal(verdict(analyzeStatement(rows.map((item) => item.id === "out" ? { ...item, pairRowId: "in2" } : item), { ...data, transactions: [] }), "out")?.kind, "transfer");
  assert.notEqual(verdict(analyzeStatement(rows.map((item) => item.id === "out" ? { ...item, unpaired: true } : item), { ...data, transactions: [] }), "out")?.kind, "transfer");
});

test("a move to an account whose statement isn't here becomes a one-sided transfer", () => {
  const analysis = analyzeStatement([row({ id: "top", amount: 200_000, name: "TRSF E-BANKING DB /DANA - - 0812", activity: "topup" })], { ...data, transactions: [] });
  assert.deepEqual(verdict(analysis, "top"), { kind: "transfer", counterparty: "DANA" });
});

test("the same value logged under another account asks to move it", () => {
  const analysis = analyzeStatement([row({ id: "a" })], { ...data, transactions: [tx({ id: "cash", account: "Cash" })] });
  assert.deepEqual(verdict(analysis, "a"), { kind: "look", reason: "other_account", candidates: ["cash"] });
});

test("Only in Saku covers the statement's own dates on the checked accounts", () => {
  const ledger = [tx({ id: "inside", date: "2026-10-08", amount: 12_000 }), tx({ id: "before", date: "2026-09-20" }), tx({ id: "cash", account: "Cash", date: "2026-10-09" })];
  const rows = [row({ id: "a", date: "2026-10-01" }), row({ id: "b", date: "2026-10-15", amount: 9_000 })];
  assert.deepEqual(analyzeStatement(rows, { ...data, transactions: ledger }).onlyInSaku.map((item) => item.id), ["inside"]);
});

test("a source that may be misread sends its new rows for a look, until the user decides", () => {
  const flagged = new Set(["bca-pdf"]);
  assert.deepEqual(verdict(analyzeStatement([row({ id: "a" })], { ...data, transactions: [] }, { flagged }), "a"), { kind: "look", reason: "check", candidates: [] });
  assert.equal(verdict(analyzeStatement([row({ id: "a", userDecided: true })], { ...data, transactions: [] }, { flagged }), "a")?.kind, "new");
  // Links still work: they need the amount to agree exactly anyway.
  assert.equal(verdict(analyzeStatement([row({ id: "a" })], { ...data, transactions: [tx({ id: "x" })] }, { flagged }), "a")?.kind, "linked");
});

test("balance check: opening plus rows must reach the closing balance", () => {
  const rows = [{ amount: 100, direction: "income" as const, activity: "income" as const }, { amount: 30, direction: "expense" as const, activity: "purchase" as const }, { amount: 999, direction: "expense" as const, activity: "pending" as const }];
  assert.equal(balanceMismatch(rows, { opening: 1000, closing: 1070 }), false);
  assert.equal(balanceMismatch(rows, { opening: 1000, closing: 1250 }), true);
  assert.equal(balanceMismatch(rows, { opening: 1000 }), false, "no closing balance printed: nothing to check");
});

test("money tokens: grouped or decimal amounts only", () => {
  assert.deepEqual(moneyToken("1,234,567.89"), { sen: 123456789, sign: 0 });
  assert.deepEqual(moneyToken("1.234.567,00"), { sen: 123456700, sign: 0 });
  assert.deepEqual(moneyToken("Rp50.000"), { sen: 5000000, sign: 0 });
  assert.deepEqual(moneyToken("-25.000"), { sen: 2500000, sign: -1 });
  assert.equal(moneyToken("0000"), null, "branch codes are not money");
  assert.equal(moneyToken("WS95051"), null);
  assert.equal(moneyToken("2026"), null);
});

const bcaPage = `PT BANK CENTRAL ASIA Tbk
REKENING TAHAPAN
PERIODE : OKTOBER 2026
TANGGAL KETERANGAN CBG MUTASI SALDO
01/10 SALDO AWAL 2,000,000.00
02/10 TRSF E-BANKING DB 0210/FTSCY/WS95051 500,000.00 DB 1,500,000.00
RINA WULANDARI
03/10 TRANSAKSI DEBIT TGL: 0310 QR 008 45,500.00 DB
WARTEG BAHARI
03/10 TRSF E-BANKING CR 0310/FTSCY/WS95052 1,250,000.00 2,704,500.00
PT MAJU JAYA
SALDO AKHIR 2,704,500.00
Bersambung ke halaman berikut`;

test("a text statement whose running balance proves every row is read without AI", () => {
  const result = parseStatementPage(bcaPage, "2026-10");
  assert.ok(result);
  assert.deepEqual(result.rows.map((item) => [item.date, item.amount, item.direction]), [["2026-10-02", 500_000, "expense"], ["2026-10-03", 45_500, "expense"], ["2026-10-03", 1_250_000, "income"]]);
  assert.equal(result.rows[0].cleanName, "Rina Wulandari");
  assert.match(result.rows[1].name, /WARTEG BAHARI/);
  assert.equal(result.balance, 270_450_000);
  assert.deepEqual(statementTotals(bcaPage), { opening: 2_000_000, closing: 2_704_500 });
});

test("one wrong digit anywhere sends the whole page to AI", () => {
  assert.equal(parseStatementPage(bcaPage.replace("45,500.00", "54,500.00"), "2026-10"), null);
  assert.equal(parseStatementPage(bcaPage.replace("01/10 SALDO AWAL 2,000,000.00\n", ""), "2026-10"), null, "no opening balance: nothing to prove against");
  assert.equal(parseStatementPage(bcaPage.replace("SALDO AKHIR 2,704,500.00\n", "").replace(" 2,704,500.00", ""), "2026-10"), null, "the last rows must be covered by a printed balance");
});

test("pages continue the proof from the balance the previous page ended on", () => {
  const second = `03/11 BIAYA ADM 10,000.00 DB 1,990,000.00\n04/11 BUNGA 1.234,56 1.991.234,56`;
  const result = parseStatementPage(second, "2026-11", 200_000_000);
  assert.ok(result);
  assert.deepEqual(result.rows.map((item) => [item.activity, item.amount]), [["fee", 10_000], ["interest", 1_235]]);
  assert.equal(parseStatementPage(second, "2026-11"), null, "without a carried balance the first row can't be proven");
  assert.equal(parseStatementPage("15/12 SALDO AWAL 100.000,00\n31/12 TRANSFER 50.000,00 DB 50.000,00", "2027-01")?.rows[0].date, "2026-12-31", "December rows in a January check");
});

test("synthetic statements for all six banks: detected, and proven locally wherever a running balance is printed", async () => {
  const { readFileSync } = await import("node:fs");
  for (const bank of ["bca", "jago", "seabank", "blu", "gopay", "dana"]) {
    const fixture = JSON.parse(readFileSync(`scripts/fixtures/statements/${bank}.json`, "utf8"));
    assert.equal(detectBank(fixture.text), fixture.bank, `${bank}: detected`);
    const parsed = parseStatementPage(fixture.text, fixture.month);
    if (fixture.rows === null) { assert.equal(parsed, null, `${bank}: no balance column, so AI reads it`); continue; }
    assert.ok(parsed, `${bank}: proven without AI`);
    assert.deepEqual(parsed.rows.map((item) => [item.date, item.amount, item.direction]), fixture.rows, `${bank}: rows`);
    assert.equal(balanceMismatch(parsed.rows, statementTotals(fixture.text)), false, `${bank}: balance adds up`);
  }
});

test("equal amounts with no sign of a transfer are asked about, never paired", () => {
  const rows = [row({ id: "out", amount: 150_000 }), row({ id: "in", account: "Jago", direction: "income", amount: 150_000, activity: "income" })];
  const out = verdict(analyzeStatement(rows, { ...data, transactions: [] }), "out");
  assert.equal(out?.kind, "look");
});

test("balance check allows half a rupiah of rounding per row, no more", () => {
  const rows = Array.from({ length: 40 }, () => ({ amount: 100, direction: "income" as const, activity: "income" as const }));
  assert.equal(balanceMismatch(rows, { opening: 0, closing: 4015 }), false, "15 off over 40 rounded rows is rounding");
  assert.equal(balanceMismatch(rows, { opening: 0, closing: 4025 }), true, "25 off is a misread");
});

test("a person's name next to a bank is not a move between your own accounts", () => {
  const stranger = row({ id: "in", account: "Jago", direction: "income", activity: "income", amount: 500_000, name: "Transfer masuk dari RINA WULANDARI BCA" });
  const alone = analyzeStatement([stranger], { ...data, name: "Budi Santoso", accounts: ["BCA", "Jago"], transactions: [] });
  assert.equal(verdict(alone, "in")?.kind, "new", "BCA here is only the sender's bank");
  const mine = analyzeStatement([{ ...stranger, name: "Transfer masuk dari BCA Utama" }], { ...data, name: "Budi Santoso", accounts: ["BCA Utama", "Jago"], transactions: [] });
  assert.equal(verdict(mine, "in")?.kind, "transfer", "naming the account itself still counts");
});

test("BRI separate columns require every running balance and both transaction totals", () => {
  const statement = `LAPORAN TRANSAKSI FINANSIAL
Nama Produk : Britama Digital
08/10/26 15:04:00 Incoming 1234567 0.00 100,000.00 100,000.00
08/10/26 15:08:04 Top Up DANA via BRImo 1234567 20,000.00 0.00 80,000.00
Opening Balance Total Debit Transaction Total Credit Transaction Closing Balance
0.00 20,000.00 100,000.00 80,000.00`;
  assert.equal(detectBank(statement), "bri");
  const read = parseStatementPage(statement, "2026-10");
  assert.deepEqual(read?.rows.map(({date,amount,direction}) => ({date,amount,direction})), [
    {date:"2026-10-08",amount:100000,direction:"income"},
    {date:"2026-10-08",amount:20000,direction:"expense"},
  ]);
  assert.equal(parseStatementPage(statement.replace("20,000.00 0.00", "21,000.00 0.00"), "2026-10"), null);
  assert.equal(parseStatementPage(statement.replace("0.00 20,000.00 100,000.00 80,000.00", "0.00 21,000.00 100,000.00 80,000.00"), "2026-10"), null);
  assert.equal(parseStatementPage(statement.replace(/08\/10\/26 15:08:04[^\n]+\n/, ""), "2026-10"), null, "omitted text rows cannot pass the printed totals");
});

test("blu multiline rows require exact balances and both printed totals", () => {
  const text = `bluAccount
Date & Time Detail Transaksi | Ref Amount Remaining Balance
14 Oct 2026
Dana Masuk
200.000,00 201.393,91
14 Oct 2026 Transaksi Debit di Shop
- 155.200,00 46.193,91
31 Oct 2026
Bunga
11,60 46.205,51
Saldo Awal / Initial Balance 1.393,91
Total Pemasukan / Total Income 200.011,60
Total Pengeluaran / Total Expense -155.200,00
Saldo Akhir / Ending Balance 46.205,51`;
  const result = parseStatementPage(text,"2026-10");
  assert.deepEqual(result?.rows.map((r) => r.amount),[200000,155200,12]);
  assert.equal(result?.balance,4620551);
  assert.equal(parseStatementPage(text.replace("11,60 46.205,51","12,60 46.205,51"),"2026-10"),null);
  assert.equal(parseStatementPage(text.replace("200.011,60","200.012,60"),"2026-10"),null);
});

test("SeaBank carries integer-rupiah balances across English and Indonesian pages", () => {
  const first = `BANK STATEMENT
SAVINGS 58 0 1.000.069 1.000.127
DATE TRANSACTION OUTGOING (IDR) INCOMING (IDR) END BALANCE (IDR)
DANA
24 OCT 1.000.000 1.000.058
Transfer`;
  const read = parseStatementPage(first,"2026-10");
  assert.equal(read?.rows[0].amount,1000000);
  const second = `REKENING KORAN
TANGGAL TRANSAKSI KELUAR (IDR) MASUK (IDR) SALDO AKHIR (IDR)
Bunga Tabungan
25 OCT 69 1.000.127
Bunga`;
  assert.equal(parseStatementPage(second,"2026-10",read?.balance)?.rows[0].amount,69);
  assert.equal(parseStatementPage(second,"2026-10"),null);
  assert.equal(parseStatementPage(second.replace("69 1.000.127","70 1.000.127"),"2026-10",read?.balance),null);
});

test("BCA CR takes precedence over the BI-FAST TRANSFER DR description", () => {
  const text = `REKENING TAHAPAN XPRESI
01/10 SALDO AWAL 100,000.00
05/10 BI-FAST CR BIF TRANSFER DR 50,000.00
501
SYNTHETIC OWNER
05/10 KR OTOMATIS LLG-BNI 0938 20,000.00
05/10 SETORAN PEMINDAHAN 0998 30,000.00 200,000.00
SALDO AWAL : 100,000.00
SALDO AKHIR : 200,000.00`;
  assert.deepEqual(parseStatementPage(text,"2026-10")?.rows.map((r) => r.direction),["income","income","income"]);
  assert.equal(parseStatementPage(text.replace("30,000.00 200,000.00","31,000.00 200,000.00"),"2026-10"),null);
  assert.equal(parseStatementPage(`MATA UANG : SGD\n${text}`,"2026-10"),null,"foreign-currency amounts cannot be read as rupiah");
});

test("Jago document proof retains pocket identity across pages and rejects incomplete totals", async () => {
  const { parseJagoStatement } = await import("./statementLines");
  const first = `Monthly Statements October 2026
PERSONAL POCKETS
Main Pocket Previous Balance 100,00
Total Incoming +50,00
Total Outgoing -10,00
Pocket is created on 01 Sep 2021 Currency In IDR Closing Balance 140,00
01 Oct 2026 Other Pocket Pocket Money In +50,00 150,00
10:00 Movement between Pockets ID# synthetic`;
  const second = `Monthly Statements October 2026 Page 2
02 Oct 2026 Shop Payment -10,00 140,00
10:00 Main Pocket
Previous Balance 1,00
Small pocket
Total Incoming +0,45
Total Outgoing -0,09
Pocket is created on 01 Sep 2021 Currency In IDR Closing Balance 1,36
03 Oct 2026 Interest Interest +0,45 1,45
03 Oct 2026 Tax on Interest Tax on Interest -0,09 1,36`;
  const read = parseJagoStatement([first,second],"2026-10");
  assert.deepEqual(read?.map((p) => p.rows.length),[1,3]);
  assert.equal(read?.[0].rows[0].activity,"transfer");
  assert.equal(read?.[1].rows[0].statementAccount,"Main Pocket");
  assert.equal(read?.[1].rows[1].statementAccount,"Small pocket");
  assert.equal(read?.[1].rows[1].exactAmount,0.45);
  assert.equal(parseJagoStatement([first],"2026-10"),null);
  assert.equal(parseJagoStatement([first,second.replace("-10,00 140,00","-11,00 140,00")],"2026-10"),null);
  assert.equal(parseJagoStatement([first,second.replace("Total Incoming +0,45","Total Incoming +0,46")],"2026-10"),null);
});

test("GoPay document totals distinguish Coins, refunds and funding sources", async () => {
  const {parseGoPayStatement} = await import("./statementLines");
  const first = `E-statement Halaman 1 dari 2
Total Coins didapatkan Total Coins dipakai Total pemasukan Total pengeluaran
10 8 Rp5.000 Rp20.000
01/10/2026 Synthetic Shop A120261001123456ABC Tabungan by Jago -Rp20.000
12:00 abcdefID
01/10/2026 Cashback 0120261001123456ABC GoPay Coins 10
12:00 abcdefID`;
  const second = `E-statement Halaman 2 dari 2
02/10/2026 Refund 0120261002123456ABC xx-1234 Rp5.000
12:00 abcdefID
02/10/2026 Shop 0120261002123457ABC GoPay Coins -8
12:00 abcdefID`;
  const read = parseGoPayStatement([first,second],"2026-10");
  assert.deepEqual(read?.map(p=>p.rows.length),[2,2]);
  assert.equal(read?.[0].rows[0].statementAccount,"Tabungan by Jago");
  assert.equal(read?.[0].rows[1].activity,"reward");
  assert.equal(read?.[1].rows[0].activity,"refund");
  assert.equal(read?.[1].rows[0].paymentMethod,"xx-1234");
  assert.equal(parseGoPayStatement([first],"2026-10"),null);
  assert.equal(parseGoPayStatement([first,second.replace("Rp5.000\n12:00","Rp6.000\n12:00")],"2026-10"),null);
  assert.equal(parseGoPayStatement([first.replace("Coins 10","Coins 11"),second],"2026-10"),null);
});

test("BCA card reading reconciles debt and uses transaction dates before posting dates", async () => {
  const {parseBcaCardStatement}=await import("./statementLines");
  const pages=[`REKENING KARTU KREDIT
TANGGAL REKENING : 08 OKTOBER 2026
VISA CARD
SALDO SEBELUMNYA 100.000
1111-11XX-XXXX-1234 Synthetic
07-SEP 09-SEP Shop 50.000
07-SEP 09-SEP REVERSAL Shop 10.000 CR
SUBTOTAL TRANSAKSI 40.000`, `REKENING KARTU KREDIT
08-OKT 08-OKT PEMBAYARAN - MYBCA 60.000 CR
SUBTOTAL 80.000
TOTAL 80.000`];
  const read=parseBcaCardStatement(pages,"2026-10");
  assert.deepEqual(read?.map(p=>p.rows.length),[2,1]);
  assert.equal(read?.[0].rows[0].date,"2026-09-07");
  assert.equal(read?.[0].rows[0].statementAccount,"VISA CARD · 1234");
  assert.equal(read?.[0].rows[1].activity,"refund");
  assert.equal(read?.[1].rows[0].activity,"card_payment");
  assert.equal(read?.[1].rows[0].direction,"income");
  assert.equal(read?.[1].rows[0].check,"card_statement");
  assert.equal(parseBcaCardStatement([pages[0]],"2026-10"),null);
  assert.equal(parseBcaCardStatement([pages[0].replace("50.000","51.000"),pages[1]],"2026-10"),null);
  assert.equal(parseBcaCardStatement([pages[0],pages[1].replace("TOTAL 80.000","TOTAL 81.000")],"2026-10"),null);
});

test("bank debit and card credit both recognize one existing card payment", () => {
  const ledger = emptyData();
  ledger.accounts = ["BCA"];
  ledger.creditCards = [{id:"card", name:"VISA"}] as typeof ledger.creditCards;
  ledger.transactions = [tx({id:"payment",kind:"card_payment",cardId:"card",account:"BCA",amount:60000,date:"2026-10-08"})];
  const debit = row({id:"debit",amount:60000,date:"2026-10-08",activity:"card_payment"});
  const credit = row({id:"credit",sourceId:"card-pdf",account:"VISA",amount:60000,date:"2026-10-08",direction:"income",activity:"card_payment"});
  const result=analyzeStatement([debit,credit],ledger);
  for(const id of ["debit","credit"]) assert.equal((verdict(result,id) as {transactionId?:string})?.transactionId,"payment");
  assert.notEqual(verdict(analyzeStatement([credit,{...credit,id:"repeated"}],ledger),"credit")?.kind,"linked","duplicate credits require review");
  ledger.transactions.push(tx({...ledger.transactions[0],id:"second-payment"}));
  assert.notEqual(verdict(analyzeStatement([credit],ledger),"credit")?.kind,"linked","equal candidate payments require review");
});

test("BCA document keeps FX and fractional pockets separate from the rupiah account", async () => {
  const {parseBcaStatement}=await import("./statementLines");
  const section=(currency:string,amount:string)=>`REKENING TAHAPAN XPRESI
MATA UANG : ${currency}
FASILITAS : POKET
01/10 SALDO AWAL 10.00
02/10 BUNGA POKET ${amount} ${amount==='0.15'?'10.15':'12.00'}
SALDO AWAL : 10.00
MUTASI CR : ${amount} 1
MUTASI DB : 0.00 0
SALDO AKHIR : ${amount==='0.15'?'10.15':'12.00'}`;
  const read=parseBcaStatement([section("IDR","0.15"),section("SGD","2.00")],"2026-10");
  assert.equal(read?.[0].rows[0].exactAmount,0.15);
  assert.equal(read?.[1].rows[0].currency,"SGD");
  assert.equal(read?.[1].rows[0].check,"currency");
  assert.equal(parseBcaStatement([section("IDR","0.15").replace("MUTASI CR : 0.15 1","MUTASI CR : 0.15 2")],"2026-10"),null);
  const foreign=row({currency:"SGD",amount:50000});
  assert.equal(analyzeStatement([foreign],{...data,transactions:[tx({})]}).verdicts.has(foreign.id),false);
});

test("different-language sources cannot silently add the same new account movement twice", () => {
  const first=row({id:"en",sourceId:"english",name:"Savings Interest",amount:69,direction:"income",activity:"interest",proven:true});
  const second={...first,id:"id",sourceId:"indonesian",name:"Bunga Tabungan"};
  const result=analyzeStatement([first,second],{...data,transactions:[]});
  for(const r of [first,second]){
    assert.equal((verdict(result,r.id) as {reason?:string})?.reason,"duplicate_source");
    assert.equal(applyVerdict({...r,page:1,pocketId:"",decision:"ready"},verdict(result,r.id)).decision,"later");
  }
  const confirmed=analyzeStatement([{...first,confirmedSeparate:true,userDecided:true},second],{...data,transactions:[]});
  assert.equal(verdict(confirmed,"en")?.kind,"new");
  assert.equal(verdict(analyzeStatement([first,{...second,account:"Cash"}],{...data,transactions:[]}),"en")?.kind,"new");
});
