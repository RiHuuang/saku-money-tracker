import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData } from "./domain";
import { importedTransactions, importRowAccount, importRowName, importRowReady, importRowsNeedingDuplicateConfirmation } from "./importTransactions";
import { learnMerchant } from "./merchants";
import type { InboxItem } from "./notificationCapture";
import { inboxRows } from "./notificationRows";

const at = new Date(2026, 9, 26, 12, 30).getTime();
const ledger = () => {
  const data = emptyData();
  data.accounts = ["BCA", "GoPay"];
  data.pockets = [{ id: "groceries", name: "Groceries", color: "#15786e", icon: "gift", budget: 0, budgets: {}, createdMonth: "2026-10" }];
  return data;
};
const item = (patch: Partial<InboxItem> = {}): InboxItem => ({ id: "n1", packageName: "com.bca", account: "BCA", amount: 48500, direction: "expense", rawMerchant: "QRIS ALFAMART 0123", balance: null, occurredAt: at, ...patch });

test("a captured BCA purchase arrives ready with its account, remembered name and date", () => {
  const data = ledger();
  data.merchantRules = learnMerchant(data, "Alfamart", { name: "Alfamart", pocketId: "groceries" });
  const [row] = inboxRows([item()], data);
  assert.equal(row.account, "BCA");
  assert.equal(importRowName(row), "Alfamart");
  assert.equal(row.pocketId, "groceries");
  assert.equal(row.date, "2026-10-26");
  assert.equal(row.decision, "ready");
  assert.equal(importRowReady(row, importRowAccount(row, undefined, data), data), true);
  const saved = importedTransactions(row, "BCA", "notification", data);
  assert.deepEqual(saved.map((t) => [t.name, t.amount, t.account, t.date, t.pocketId]), [["Alfamart", 48500, "BCA", "2026-10-26", "groceries"]]);
});

test("a manual entry for the same payment is flagged as a possible duplicate", () => {
  const data = ledger();
  data.transactions = [{ id: "manual", name: "Groceries run", amount: 48500, type: "expense", date: "2026-10-26", pocketId: "", account: "BCA", note: "" }];
  const rows = inboxRows([item()], data);
  assert.deepEqual([...importRowsNeedingDuplicateConfirmation(rows, data.transactions, (row) => importRowAccount(row, undefined, data), () => false, true)], ["n1"]);
});

test("a top-up seen from both apps becomes one transfer", () => {
  const rows = inboxRows([item({ id: "out", rawMerchant: "GoPay", amount: 100000 }), item({ id: "in", packageName: "com.gojek.gopay", account: "GoPay", direction: "income", rawMerchant: "", amount: 100000, occurredAt: at + 60_000 })], ledger());
  const out = rows.find((row) => row.id === "out")!, incoming = rows.find((row) => row.id === "in")!;
  assert.equal(out.activity, "topup");
  assert.equal(out.counterparty, "GoPay");
  assert.equal(incoming.decision, "skip");
  assert.equal(out.pairedWith, "in");
  const legs = importedTransactions({ ...out, decision: "ready" }, "BCA", "notification", ledger(), out.pairedWith);
  assert.deepEqual(legs.map((t) => [t.id, t.account, t.type]), [["out", "BCA", "expense"], ["in", "GoPay", "income"]]);
});

test("an unmapped account leaves the row waiting for a choice", () => {
  const [row] = inboxRows([item({ account: "Old bank" })], ledger());
  assert.equal(row.account, "");
});
