import assert from "node:assert/strict";
import { test } from "node:test";
import { balanceIssue, evidenceIssues, hasTransactionEvidence, parseDeterministicBankRows, parseModelRows, statementContext, type SourceLine } from "./pdfStatement";
import { reconcile } from "./domain";

const lines: SourceLine[] = [
  { id: "p1l1", page: 1, text: "Saldo Awal Rp 1.000.000,00" },
  { id: "p1l2", page: 1, text: "02/09/2026 TOKO BUKU DB Rp 125.000,00" },
  { id: "p2l1", page: 2, text: "03/09/2026 GAJI CR Rp 2.000.000,00" },
  { id: "p2l2", page: 2, text: "Saldo Akhir Rp 2.875.000,00" },
];

test("PDF suggestions retain source evidence and Indonesian amounts", () => {
  const rows = parseModelRows(JSON.stringify({ rows: [
    { lineId: "p1l2", date: "2026-09-02", name: "Toko Buku", amount: 125000, type: "expense" },
    { lineId: "p2l1", date: "2026-09-03", name: "Gaji", amount: 2000000, type: "income" },
  ] }), lines, "bank.pdf", "BCA");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].page, 1);
  assert.deepEqual(rows[0].issues, []);
  assert.equal(balanceIssue(lines, rows), "");
});

test("Qwen reasoning preambles are ignored without relaxing JSON validation", () => {
  const [row] = parseModelRows('<think>\nI should inspect the cited line.\n</think>\n```json\n{"rows":[{"lineId":"p1l2","date":"02/09/2026","name":"Toko Buku","amount":"125.000","type":"debet"}]}\n```', lines, "bank.pdf", "BCA");
  assert.equal(row.name, "Toko Buku");
  assert.equal(row.date, "2026-09-02");
  assert.equal(row.amount, 125000);
  assert.equal(row.type, "expense");
  assert.deepEqual(row.issues, []);
  assert.throws(() => parseModelRows("<think>unfinished reasoning", lines, "bank.pdf", "BCA"));
});

test("statement metadata is excluded and Indonesian named dates validate", () => {
  const source = [
    { id: "p1l1", page: 1, text: "Period: September 2026" },
    { id: "p1l2", page: 1, text: "01 AGU COFFEE SHOP 45.000" },
    { id: "p1l3", page: 1, text: "Closing balance: 955.000" },
  ];
  const rows = parseModelRows(JSON.stringify({ rows: [
    { lineId: "p1l1", date: "", name: "Period", amount: 0, type: "expense" },
    { lineId: "p1l2", date: "01 AGU 2026", name: "Coffee shop", amount: "45.000", type: "debit" },
    { lineId: "p1l3", date: "", name: "Closing balance", amount: "955.000", type: "income" },
  ] }), source, "card.pdf", "BCA Credit");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-08-01");
  assert.deepEqual(rows[0].issues, []);
});

test("BCA abbreviated dates come from source evidence, not the review month", () => {
  const source = [{ id: "p2l1", page: 2, text: "21-AGU 22-AGU COFFEE SHOP 590.588" }];
  const [row] = parseModelRows('{"rows":[{"lineId":"p2l1","date":"2026-09-21","name":"Coffee shop","amount":590588,"type":"purchase"}]}', source, "card.pdf", "BCA Credit", "2026-09");
  assert.equal(row.date, "2026-08-21");
  assert.equal(row.type, "expense");
  assert.deepEqual(row.issues, []);
  assert.equal(hasTransactionEvidence(row), true);
  assert.equal(hasTransactionEvidence({ ...row, amount: 1, issues: ["Amount not found in source text"] }), false);
});

test("BCA current-account rows use the transaction amount before DB or CR", () => {
  const source = [{ id: "p1l1", page: 1, text: "01/08 TRANSFER 3,000.00 DB 657,211.94" }];
  const [row] = parseModelRows('{"rows":[{"lineId":"p1l1","date":"2026-08-01","name":"Transfer","amount":657211.94,"type":"out"}]}', source, "current.pdf", "BCA", "2026-08");
  assert.equal(row.date, "2026-08-01");
  assert.equal(row.amount, 3000);
  assert.equal(row.type, "expense");
  assert.deepEqual(row.issues, []);
  assert.equal(hasTransactionEvidence(row), true);
});

test("clear DB and CR bank rows bypass the model without importing balances", () => {
  const source = [
    { id: "p1l1", page: 1, text: "01/08 TRANSFER OUT 3,000.00 DB 657,211.94" },
    { id: "p1l2", page: 1, text: "02/08 SALARY 2,000,000.00 CR 2,657,211.94" },
  ];
  const rows = parseDeterministicBankRows(source, "current.pdf", "BCA", "2026-08");
  assert.deepEqual(rows.map(({ date, amount, type, issues }) => ({ date, amount, type, issues })), [
    { date: "2026-08-01", amount: 3000, type: "expense", issues: [] },
    { date: "2026-08-02", amount: 2000000, type: "income", issues: [] },
  ]);
});

test("clear BCA card rows use the first date and final rupiah amount", () => {
  const source: SourceLine[] = [
    { id: "p1l1", page: 1, text: "22-AGU 23-AGU HONG KONG TRAMWAY95800 HONG KONG HK 28.046" },
    { id: "p1l2", page: 1, text: "24-AGU 25-AGU REFUND MERCHANT 125.000 CR" },
  ];
  const rows = parseDeterministicBankRows(source, "card.pdf", "BCA Credit", "2026-09");
  assert.deepEqual(rows.map(({ date, name, amount, type, issues }) => ({ date, name, amount, type, issues })), [
    { date: "2026-08-22", name: "HONG KONG TRAMWAY95800 HONG KONG HK", amount: 28046, type: "expense", issues: [] },
    { date: "2026-08-24", name: "REFUND MERCHANT", amount: 125000, type: "income", issues: [] },
  ]);
});

test("document context samples every page without exceeding the mobile prompt budget", () => {
  const source = Array.from({ length: 6 }, (_, page) => [
    { id: `p${page + 1}l1`, page: page + 1, text: `Statement page ${page + 1}` },
    { id: `p${page + 1}l2`, page: page + 1, text: `0${page + 1}/08 PAYMENT ${page + 1},000.00 DB 99,000.00` },
  ]).flat();
  const context = statementContext(source);
  assert.ok(context.length <= 3000);
  for (let page = 1; page <= 6; page++) assert.match(context, new RegExp(`p${page}l`));
});

test("hallucinated evidence and malformed model responses fail closed", () => {
  assert.throws(() => parseModelRows("not json", lines, "x.pdf", "BCA"));
  assert.throws(() => parseModelRows('{"rows":[{"lineId":"p9l1"}]}', lines, "x.pdf", "BCA"));
  assert.throws(() => parseModelRows('{"rows":[{"lineId":"p1l2"},{"lineId":"p1l2"}]}', lines, "x.pdf", "BCA"));
  const [candidate] = parseModelRows('{"rows":[{"lineId":"p1l2","date":"2026-09-02","name":"Books","amount":999999,"type":"expense"}]}', lines, "x.pdf", "BCA");
  assert.match(candidate.issues.join(" "), /Amount not found/);
  assert.match(balanceIssue(lines, [candidate]), /do not equal/);
  assert.match(evidenceIssues({ ...candidate, date: "2026-09-31" }).join(" "), /date/i);
});

test("overlapping PDF rows remain ambiguous in the existing reconciler", () => {
  const [row] = parseModelRows('{"rows":[{"lineId":"p1l2","date":"2026-09-02","name":"Books","amount":125000,"type":"expense"}]}', lines, "a.pdf", "BCA");
  const result = reconcile([{ ...row, file: "a.pdf" }, { ...row, id: "other", file: "b.pdf" }], [], "2026-09");
  assert.deepEqual(result.map((r) => r.status), ["review", "review"]);
});
