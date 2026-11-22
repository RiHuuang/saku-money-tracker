import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData } from "./domain";
import { importedTransactions, importRowAccount, importRowName, importRowReady, importRowsNeedingDuplicateConfirmation } from "./importTransactions";
import { learnMerchant, learnNotificationPocket } from "./merchants";
import type { InboxItem } from "./notificationCapture";
import { inboxRows, notificationStatusTap } from "./notificationRows";

test("notification status opens rows needing review without marking them skipped", () => {
  assert.equal(notificationStatusTap("later", false), "review");
  assert.equal(notificationStatusTap("ready", false), "review");
  assert.equal(notificationStatusTap("ready", true), "skip");
  assert.equal(notificationStatusTap("skip", false), "ready");
});

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
  data.merchantRules = learnMerchant(data, "Alfamart", { name: "Alfamart", pocketId: "groceries" }, "2026-10-26T10:00:00Z", true);
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

test("renaming one notification does not rename the next, while its pocket is remembered", () => {
  const data = ledger();
  data.merchantRules = learnNotificationPocket(data, "kategori Transfer Rekening", "groceries");
  const [row] = inboxRows([item({ rawMerchant: "kategori Transfer Rekening" })], data);
  assert.equal(row.name, "kategori Transfer Rekening");
  assert.equal(row.cleanName, undefined);
  assert.equal(row.pocketId, "groceries");
  data.merchantRules = learnMerchant(data, "kategori Transfer Rekening", { name: "Rent", pocketId: "groceries" });
  assert.equal(inboxRows([item({ rawMerchant: "kategori Transfer Rekening" })], data)[0].cleanName, undefined);
});

test("automatically tidied notification names keep their marker and pocket", () => {
  const data = ledger();
  data.merchantRules = learnNotificationPocket(data, "QRIS ALFAMART 0123", "groceries");
  data.merchantRules = learnMerchant(data, "QRIS ALFAMART 0123", { name: "Alfamart", pocketId: "groceries" }, "2026-10-26T10:00:00Z", true);
  const [row] = inboxRows([item()], data);
  assert.equal(row.cleanName, "Alfamart");
  assert.equal(row.pocketId, "groceries");
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

test("captured income starts ready only when it can't be the user's own money moving (4.2)", () => {
  const data = ledger();
  data.name = "Rina Wijaya";
  const income = (patch: Partial<InboxItem> = {}) => item({ id: "in", direction: "income", amount: 250_000, rawMerchant: "PT MAJU JAYA", ...patch });
  assert.equal(inboxRows([income()], data)[0].decision, "ready");
  assert.equal(inboxRows([income({ amount: 10_000_000 })], data)[0].decision, "later", "Rp 10.000.000 or more waits");
  assert.equal(inboxRows([income({ rawMerchant: "RINA WIJAYA" })], data)[0].decision, "later", "money from the user's own name waits");
  const spend = item({ id: "out", amount: 250_000, occurredAt: at - 10 * 60_000, rawMerchant: "BUDI" });
  assert.equal(inboxRows([spend, income()], data).find((row) => row.id === "in")?.decision, "later", "an opposite row in the inbox within 30 min");
  assert.equal(inboxRows([{ ...spend, occurredAt: at - 2 * 3_600_000 }, income()], data).find((row) => row.id === "in")?.decision, "ready", "two hours apart is fine");
  const base = { name: "Transfer", amount: 250_000, type: "expense" as const, date: "2026-10-26", pocketId: "", account: "BCA", note: "" };
  data.transactions = [{ ...base, id: "t1", time: "12:20" }];
  assert.equal(inboxRows([income()], data)[0].decision, "later", "an opposite ledger row 10 minutes earlier");
  data.transactions = [{ ...base, id: "t1", time: "09:00" }];
  assert.equal(inboxRows([income()], data)[0].decision, "ready");
  data.transactions = [{ ...base, id: "t1" }];
  assert.equal(inboxRows([income()], data)[0].decision, "later", "a same-day ledger row with no time counts as close");
});

test("the last pocket used for a name is prefilled, and a rule is learned only with a pocket (4.3)", () => {
  const data = ledger();
  data.transactions = [{ id: "old", name: "QRIS ALFAMART 0123", amount: 20_000, type: "expense", date: "2026-10-20", pocketId: "groceries", account: "BCA", note: "" }];
  assert.equal(inboxRows([item()], data)[0].pocketId, "groceries");
  assert.equal(inboxRows([item({ rawMerchant: "SHOP NEW" })], data)[0].pocketId, "");
  assert.equal(inboxRows([item({ direction: "income", rawMerchant: "QRIS ALFAMART 0123" })], data)[0].pocketId, "", "income never takes a pocket");
});
