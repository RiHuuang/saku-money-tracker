import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData, summary, validateData } from "./domain";
import { applySharedSourceDate, confirmedImportAccount, importedTransactions, importMatchesNeedSourceDateCheck, importPatchNeedsSourceRecheck, importRowAccount, importRowAlreadySaved, importRowReady, importRowReviewIssue, importRowsNeedingDuplicateConfirmation, suggestImportDecision } from "./importTransactions";
import type { ImportDraft, ImportRow } from "./importDraft";

const ledger = emptyData();
ledger.accounts = ["BCA", "GoPay"];
ledger.creditCards = [{ id: "visa", name: "BCA Visa", limit: 5_000_000, openingDebt: 0, dueDay: 15 }];
const base: ImportRow = { id: "row-1", sourceId: "screen-1", page: 1, date: "2026-10-10", name: "Coffee", amount: 28000, direction: "expense", activity: "purchase", decision: "ready", pocketId: "" };

test("source account needs explicit confirmation before saving", () => {
  assert.equal(confirmedImportAccount({ account: "BCA" }, ledger), "");
  assert.equal(confirmedImportAccount({ account: "BCA", accountConfirmed: false }, ledger), "");
  assert.equal(importRowReady(base, importRowAccount(base, { account: "", accountConfirmed: false }, ledger), ledger), false, "an extracted row cannot be saved before account mapping");
  assert.equal(confirmedImportAccount({ account: "BCA", accountConfirmed: true }, ledger), "BCA");
  assert.equal(confirmedImportAccount({ account: "BCA Visa", accountConfirmed: true }, ledger), "BCA Visa");
  assert.equal(confirmedImportAccount({ account: "Missing", accountConfirmed: true }, ledger), "");
});

test("a mixed-history row may use another explicitly selected Saku account", () => {
  const source = { account: "BCA", accountConfirmed: true };
  assert.equal(importRowAccount(base, source, ledger), "BCA");
  assert.equal(importRowAccount({ ...base, account: "GoPay" }, source, ledger), "GoPay");
  assert.equal(importRowAccount({ ...base, account: "Missing" }, source, ledger), "");
  assert.equal(importRowAccount({ ...base, account: "GoPay" }, { ...source, accountConfirmed: false }, ledger), "GoPay");
  const mixed = { ...source, mixedAccounts: true };
  assert.equal(importRowAccount(base, mixed, ledger), "");
  assert.equal(importRowReady(base, importRowAccount(base, mixed, ledger), ledger), false);
  assert.equal(importRowAccount({ ...base, account: "BCA" }, mixed, ledger), "BCA");
});

test("out-of-month rows wait for an explicit decision before batch save", () => {
  assert.equal(suggestImportDecision(base, "2026-10"), "ready");
  assert.equal(suggestImportDecision({ ...base, amount: 1_000_000 }, "2026-10"), "later", "large outgoing rows need a second look before batch add");
  assert.equal(suggestImportDecision({ ...base, amount: 999_999 }, "2026-10"), "ready");
  assert.equal(suggestImportDecision({ ...base, date: "2026-09-30" }, "2026-10"), "later");
  assert.equal(suggestImportDecision({ ...base, activity: "pending" }, "2026-10"), "later");
  assert.equal(suggestImportDecision({ ...base, name: "Move Money", activity: "transfer" }, "2026-10"), "later");
  assert.equal(suggestImportDecision({ ...base, name: "Top Up GoPay", activity: "purchase" }, "2026-10"), "later");
  assert.equal(suggestImportDecision({ ...base, name: "ShopeePay", activity: "purchase" }, "2026-10"), "later", "a wallet name alone does not prove spending rather than funding");
  assert.equal(suggestImportDecision({ ...base, name: "GoPay Pembayaran", activity: "purchase" }, "2026-10"), "later");
  assert.equal(suggestImportDecision({ ...base, name: "Pindah Dana antar Kantong", activity: "purchase" }, "2026-10"), "later");
  assert.equal(suggestImportDecision({ ...base, name: "TRSF E-BANKING CR", direction: "income", activity: "refund" }, "2026-10"), "later");
  assert.equal(suggestImportDecision({ ...base, name: "Pembayaran kedaluwarsa", activity: "purchase" }, "2026-10"), "later");
  assert.equal(suggestImportDecision({ ...base, name: "Payment cancelled", activity: "purchase" }, "2026-10"), "later");
});

test("one shared date updates only undated unsaved source rows and keeps uncertain payments for review", () => {
  const rows: ImportRow[] = [
    { ...base, id: "missing", date: "", decision: "later" },
    { ...base, id: "pending", date: "", activity: "pending", decision: "later" },
    { ...base, id: "already-dated", date: "2026-10-09" },
    { ...base, id: "excluded", date: "", decision: "skip" },
    { ...base, id: "saved", date: "", decision: "later" },
    { ...base, id: "other-source", sourceId: "screen-2", date: "", decision: "later" },
  ];
  const dated = applySharedSourceDate(rows, "screen-1", "2026-10-14", "2026-10", (row) => row.id === "saved", "2026-10-15");
  assert.equal(dated[0].date, "2026-10-14");
  assert.equal(dated[0].decision, "ready");
  assert.equal(dated[1].date, "2026-10-14");
  assert.equal(dated[1].decision, "later");
  for (const index of [2, 3, 4, 5]) assert.strictEqual(dated[index], rows[index]);
  assert.deepEqual(applySharedSourceDate(rows, "screen-1", "2026-02-30", "2026-10", () => false, "2026-10-15"), rows);
  assert.deepEqual(applySharedSourceDate(rows, "screen-1", "2026-10-16", "2026-10", () => false, "2026-10-15"), rows);
});

test("editing extracted source details requires comparing the source again", () => {
  for (const patch of [{ date: "2026-10-11" }, { name: "Tea" }, { amount: 29000 }, { direction: "income" as const }, { activity: "refund" as const }, { paymentMethod: "QRIS" }]) {
    assert.equal(importPatchNeedsSourceRecheck(patch), true);
  }
  for (const patch of [{ decision: "later" as const }, { account: "GoPay" }, { pocketId: "food" }, { confirmedSeparate: true }]) {
    assert.equal(importPatchNeedsSourceRecheck(patch), false);
  }
});

test("same-value purchases at different merchants avoid duplicate prompts, overlapping rows do not", () => {
  const rows: ImportRow[] = [
    { ...base, id: "cafe", name: "Example Cafe" },
    { ...base, id: "shop", name: "Example Shop" },
    { ...base, id: "overlap", sourceId: "screen-2", name: " example  cafe! " },
    { ...base, id: "saved", name: "Example Shop", decision: "ready" },
    { ...base, id: "skipped", name: "Another Shop", decision: "skip" },
  ];
  const accountFor = (row: ImportRow) => row.id === "shop" || row.id === "saved" ? "GoPay" : "BCA";
  const existing = [{ ...importedTransactions({ ...base, id: "existing", name: "Existing Cafe" }, "BCA", "example.jpg", ledger)[0], id: "existing" }];
  const duplicates = importRowsNeedingDuplicateConfirmation(rows, existing, accountFor, (row) => row.id === "saved");
  assert.deepEqual([...duplicates].sort(), ["cafe", "overlap"]);
  assert.equal(duplicates.has("shop"), false);
  assert.equal(duplicates.has("saved"), false);
  const withExistingMatch = importRowsNeedingDuplicateConfirmation(rows, [{ ...existing[0], name: "Example Shop", account: "GoPay" }], accountFor, (row) => row.id === "saved");
  assert.equal(withExistingMatch.has("shop"), true);
});

test("matching history rows from separate apps need review even when mapped to different accounts", () => {
  const bank = { ...base, id: "bank", sourceId: "bank-screen", name: "Example Cafe" };
  const wallet = { ...base, id: "wallet", sourceId: "wallet-screen", name: "example cafe!" };
  const accountFor = (row: ImportRow) => row.id === "bank" ? "BCA" : "GoPay";
  const duplicates = importRowsNeedingDuplicateConfirmation([bank, wallet], [], accountFor, () => false);
  assert.deepEqual([...duplicates].sort(), ["bank", "wallet"]);
  assert.deepEqual([...importRowsNeedingDuplicateConfirmation([bank, wallet], [], accountFor, (row) => row.id === "bank")], ["wallet"]);
  assert.equal(importRowsNeedingDuplicateConfirmation([bank, { ...wallet, decision: "skip" }], [], accountFor, () => false).size, 0);
  assert.equal(importRowsNeedingDuplicateConfirmation([bank, { ...wallet, name: "Another Cafe" }], [], accountFor, () => false).size, 0);
  assert.equal(importRowsNeedingDuplicateConfirmation([bank, { ...wallet, sourceId: "bank-screen" }], [], accountFor, () => false).size, 0);
});

test("statement import asks before adding a same-value ledger entry with a different merchant", () => {
  const source = { ...base, id: "statement-row", name: "Different merchant" };
  const existing = importedTransactions({ ...base, id: "recorded-row", name: "Coffee" }, "BCA", "recorded.jpg", ledger);
  const accountFor = () => "BCA";
  assert.equal(importRowsNeedingDuplicateConfirmation([source], existing, accountFor, () => false).size, 0, "ordinary catch-up does not flag unrelated names");
  assert.deepEqual([...importRowsNeedingDuplicateConfirmation([source], existing, accountFor, () => false, true)], [source.id]);
  assert.equal(importRowsNeedingDuplicateConfirmation([{ ...source, amount: 29000 }], existing, accountFor, () => false, true).size, 0);
  assert.equal(importRowsNeedingDuplicateConfirmation([source], existing, () => "GoPay", () => false, true).size, 0);
  assert.equal(importRowsNeedingDuplicateConfirmation([source], existing, accountFor, () => true, true).size, 0);
});

test("statement matches cannot be marked checked before their own source dates are checked", () => {
  const draft: ImportDraft = {
    id: "draft", owner: "synthetic", month: "2026-10", createdAt: 1, saved: [],
    rows: [{ ...base, id: "checked", sourceId: "screen-1" }, { ...base, id: "unchecked", sourceId: "screen-2" }],
    sources: [
      { id: "screen-1", name: "first.jpg", account: "BCA", file: {} as File, processedPages: 1, pageCount: 1, datesChecked: true },
      { id: "screen-2", name: "second.jpg", account: "BCA", file: {} as File, processedPages: 1, pageCount: 1, datesChecked: false },
    ],
  };
  assert.equal(importMatchesNeedSourceDateCheck(draft, [{ id: "checked" }]), false);
  assert.equal(importMatchesNeedSourceDateCheck(draft, [{ id: "checked" }, { id: "unchecked" }]), true);
  assert.equal(importMatchesNeedSourceDateCheck(draft, [{ id: "missing" }]), true);
  assert.equal(importMatchesNeedSourceDateCheck(null, [{ id: "checked" }]), true);
  assert.equal(importMatchesNeedSourceDateCheck(draft, []), false);
});

test("review explains non-rupiah and unsettled rows before asking for missing amounts", () => {
  const incomplete = { ...base, date: "", amount: 0, account: "" };
  assert.match(importRowReviewIssue({ ...incomplete, activity: "reward" }, "", ledger, false), /Points or rewards/);
  assert.match(importRowReviewIssue({ ...incomplete, activity: "pending" }, "", ledger, false), /pending/);
  assert.match(importRowReviewIssue({ ...incomplete, activity: "failed" }, "", ledger, false), /failed or expired/);
  assert.match(importRowReviewIssue({ ...incomplete, activity: "pay_later" }, "", ledger, false), /PayLater or credit account/);
  assert.match(importRowReviewIssue({ ...base, amount: 0 }, "BCA", ledger, false, "2026-10-15"), /whole-rupiah amount/);
  assert.match(importRowReviewIssue({ ...base, date: "" }, "BCA", ledger, false, "2026-10-15"), /transaction date/);
});

test("thirty clear purchases can be committed together without duplicating IDs", () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({ ...base, id: `row-${index}`, name: `Merchant ${index}` }));
  assert.equal(importRowsNeedingDuplicateConfirmation(rows, [], () => "BCA", () => false).size, 0);
  const transactions = rows.flatMap((row) => importedTransactions(row, "BCA", "bca.png", ledger));
  assert.equal(transactions.length, 30);
  assert.equal(validateData({ ...ledger, transactions }).transactions.length, 30);
  assert.equal(summary({ ...ledger, transactions }, "2026-10").expenses, 840000);
});

test("a wallet top-up becomes one balanced transfer and does not count as spending", () => {
  const row: ImportRow = { ...base, activity: "topup", name: "Top up GoPay", amount: 37000, counterparty: "GoPay" };
  assert.equal(importRowReady({ ...row, counterparty: undefined }, "BCA", ledger), false);
  assert.equal(importRowReady({ ...row, counterparty: "BCA" }, "BCA", ledger), false);
  const transactions = importedTransactions(row, "BCA", "bca.png", ledger);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].transferId, transactions[1].transferId);
  assert.deepEqual(transactions.map((transaction) => transaction.verified), [true, false]);
  assert.equal(validateData({ ...ledger, transactions }).transactions.length, 2);
  assert.equal(summary({ ...ledger, transactions }, "2026-10").expenses, 0);
});

test("card purchase and payment need their correct account details", () => {
  const purchase: ImportRow = { ...base, firstDueMonth: "2026-11" };
  assert.equal(importRowReady({ ...purchase, firstDueMonth: undefined }, "BCA Visa", ledger), false);
  const cardPurchase = importedTransactions(purchase, "BCA Visa", "card.pdf", ledger)[0];
  assert.equal(cardPurchase.kind, "card_purchase");
  const payment: ImportRow = { ...base, id: "row-2", activity: "card_payment", name: "Pay BCA Visa", cardId: "visa" };
  assert.equal(importRowReady({ ...payment, cardId: undefined }, "BCA", ledger), false);
  const cardPayment = importedTransactions(payment, "BCA", "bank.png", ledger)[0];
  assert.equal(cardPayment.kind, "card_payment");
  validateData({ ...ledger, transactions: [cardPurchase, cardPayment] });
});

test("pending activity and incomplete amounts cannot enter a ledger batch", () => {
  for (const row of [{ ...base, activity: "pending" as const }, { ...base, amount: 0 }, { ...base, date: "2026-02-30" }]) assert.equal(importRowReady(row, "BCA", ledger), false);
});

test("money direction agrees with purchase, fee, and refund activity", () => {
  assert.equal(importRowReady({ ...base, activity: "purchase", direction: "income" }, "BCA", ledger), false);
  assert.equal(importRowReady({ ...base, activity: "fee", direction: "income" }, "BCA", ledger), false);
  assert.equal(importRowReady({ ...base, activity: "refund", direction: "expense" }, "BCA", ledger), false);
  const refund = importedTransactions({ ...base, activity: "refund", direction: "income" }, "BCA", "bank.png", ledger)[0];
  assert.equal(refund.type, "income");
});

test("bank interest is rupiah income while points and fractional amounts wait for review", () => {
  const interest: ImportRow = { ...base, name: "Bunga Tabungan", amount: 332, direction: "income", activity: "interest" };
  assert.equal(suggestImportDecision(interest, "2026-10"), "ready");
  assert.equal(importRowReady(interest, "BCA", ledger), true);
  assert.equal(importedTransactions(interest, "BCA", "bank.png", ledger)[0].type, "income");
  assert.equal(importRowReady({ ...interest, direction: "expense" }, "BCA", ledger), false);
  assert.equal(suggestImportDecision({ ...interest, activity: "reward", name: "GoPay Coins" }, "2026-10"), "later");
  assert.equal(suggestImportDecision({ ...interest, amount: 0 }, "2026-10"), "later");
});

test("ordinary money received waits for review and saves as income only after confirmation", () => {
  const salary: ImportRow = { ...base, name: "Gaji dari Contoh Studio", amount: 3_500_000, direction: "income", activity: "income", decision: "later" };
  assert.equal(suggestImportDecision(salary, "2026-10"), "later");
  assert.equal(importRowReady(salary, "BCA", ledger), false);
  const approved = { ...salary, decision: "ready" as const };
  assert.equal(importRowReady(approved, "BCA", ledger), true);
  assert.equal(importRowReady({ ...approved, direction: "expense" }, "BCA", ledger), false);
  assert.equal(importRowReady(approved, "BCA Visa", ledger), false);
  const transaction = importedTransactions(approved, "BCA", "bank.png", ledger)[0];
  assert.equal(transaction.type, "income");
  assert.equal(summary({ ...ledger, transactions: [transaction] }, "2026-10").income, 3_500_000);
});

test("PayLater funding waits until a matching card account is chosen", () => {
  const deferred: ImportRow = { ...base, name: "Fabricated cafe", paymentMethod: "Example PayLater", activity: "pay_later", decision: "later" };
  assert.equal(suggestImportDecision({ ...deferred, activity: "purchase" }, "2026-10"), "later");
  assert.equal(importRowReady({ ...deferred, activity: "purchase", decision: "ready" }, "GoPay", ledger), false);
  assert.equal(importRowReady({ ...deferred, activity: "purchase", decision: "ready", firstDueMonth: "2026-11" }, "BCA Visa", ledger), true);
  const approved = { ...deferred, decision: "ready" as const, firstDueMonth: "2026-11" };
  assert.equal(importRowReady(approved, "GoPay", ledger), false);
  assert.equal(importRowReady({ ...approved, paymentMethod: "" }, "GoPay", ledger), false);
  assert.equal(importRowReady({ ...approved, firstDueMonth: "2026-09" }, "BCA Visa", ledger), false);
  assert.equal(importRowReady(approved, "BCA Visa", ledger), true);
  assert.match(importRowReviewIssue({ ...approved, firstDueMonth: "" }, "BCA Visa", ledger, false), /first due month/);
  assert.match(importRowReviewIssue({ ...approved, direction: "income" }, "BCA Visa", ledger, false), /marked Money in, but its activity is a payment/);
  assert.match(importRowReviewIssue({ ...base, activity: "income", direction: "expense" }, "BCA", ledger, false), /marked Money out, but its activity is money received/);
  const transaction = importedTransactions(approved, "BCA Visa", "wallet.png", ledger)[0];
  assert.equal(transaction.kind, "card_purchase");
  assert.equal(transaction.cardId, "visa");
  assert.equal(transaction.firstDueMonth, "2026-11");
  validateData({ ...ledger, transactions: [transaction] });
});

test("only the explicitly paired screenshot row is treated as saved", () => {
  const outgoing: ImportRow = { ...base, id: "outgoing", activity: "topup", amount: 37000, counterparty: "GoPay" };
  const incoming: ImportRow = { ...outgoing, id: "incoming", sourceId: "wallet", direction: "income", counterparty: "BCA" };
  const anotherIncoming: ImportRow = { ...incoming, id: "another-incoming" };
  const transactions = importedTransactions(outgoing, "BCA", "bank.png", ledger);
  const draft: ImportDraft = { id: "draft", owner: "synthetic", month: "2026-10", createdAt: 1, sources: [], rows: [outgoing, incoming, anotherIncoming], saved: transactions.map((transaction) => ({ id: transaction.id, fingerprint: JSON.stringify(transaction), pairedRowId: incoming.id })) };
  const savedLedger = { ...ledger, transactions };
  assert.equal(importRowAlreadySaved(outgoing, draft, savedLedger), true);
  assert.equal(importRowAlreadySaved(incoming, draft, savedLedger), true);
  assert.equal(importRowAlreadySaved(anotherIncoming, draft, savedLedger), false);
});

test("both sides of a paired top-up remain recognizable if the local draft write fails", () => {
  const outgoing: ImportRow = { ...base, id: "bank-row", activity: "topup", amount: 37000, counterparty: "GoPay" };
  const incoming: ImportRow = { ...outgoing, id: "wallet-row", sourceId: "wallet", direction: "income", counterparty: "BCA" };
  const transactions = importedTransactions(outgoing, "BCA", "bank.png", ledger, incoming.id);
  const staleDraft: ImportDraft = { id: "draft", owner: "synthetic", month: "2026-10", createdAt: 1, sources: [], rows: [outgoing, incoming], saved: [] };
  const savedLedger = { ...ledger, transactions };
  assert.deepEqual(transactions.map((transaction) => transaction.id), [outgoing.id, incoming.id]);
  assert.deepEqual(transactions.map((transaction) => transaction.verified), [true, true]);
  assert.equal(validateData(savedLedger).transactions.length, 2);
  assert.equal(importRowAlreadySaved(outgoing, staleDraft, savedLedger), true);
  assert.equal(importRowAlreadySaved(incoming, staleDraft, savedLedger), true);
  const walletFirst = importedTransactions(incoming, "GoPay", "wallet.png", ledger, outgoing.id);
  assert.deepEqual(walletFirst.map((transaction) => transaction.id), [outgoing.id, incoming.id]);
  assert.deepEqual(walletFirst.map((transaction) => transaction.verified), [true, true]);
  assert.equal(validateData({ ...ledger, transactions: walletFirst }).transactions.length, 2);
});
