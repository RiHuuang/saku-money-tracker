import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData, summary, validateData } from "./domain";
import { confirmedImportAccount, importedTransactions, importRowAccount, importRowAlreadySaved, importRowReady, suggestImportDecision } from "./importTransactions";
import type { ImportDraft, ImportRow } from "./importDraft";

const ledger = emptyData();
ledger.accounts = ["BCA", "GoPay"];
ledger.creditCards = [{ id: "visa", name: "BCA Visa", limit: 5_000_000, openingDebt: 0, dueDay: 15 }];
const base: ImportRow = { id: "row-1", sourceId: "screen-1", page: 1, date: "2026-10-10", name: "Coffee", amount: 28000, direction: "expense", activity: "purchase", decision: "ready", pocketId: "" };

test("source account needs explicit confirmation before extraction or saving", () => {
  assert.equal(confirmedImportAccount({ account: "BCA" }, ledger), "");
  assert.equal(confirmedImportAccount({ account: "BCA", accountConfirmed: false }, ledger), "");
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
  assert.equal(suggestImportDecision({ ...base, date: "2026-09-30" }, "2026-10"), "later");
  assert.equal(suggestImportDecision({ ...base, activity: "pending" }, "2026-10"), "later");
  assert.equal(suggestImportDecision({ ...base, name: "Move Money", activity: "transfer" }, "2026-10"), "later");
});

test("thirty clear purchases can be committed together without duplicating IDs", () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({ ...base, id: `row-${index}`, name: `Merchant ${index}` }));
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

test("PayLater funding waits until a matching card account is chosen", () => {
  const deferred: ImportRow = { ...base, name: "Fabricated cafe", paymentMethod: "Example PayLater", activity: "pay_later", decision: "later" };
  assert.equal(suggestImportDecision({ ...deferred, activity: "purchase" }, "2026-10"), "later");
  assert.equal(importRowReady({ ...deferred, activity: "purchase", decision: "ready" }, "GoPay", ledger), false);
  assert.equal(importRowReady({ ...deferred, activity: "purchase", decision: "ready", firstDueMonth: "2026-11" }, "BCA Visa", ledger), true);
  assert.equal(importRowReady({ ...deferred, activity: "pay_later", decision: "ready", firstDueMonth: "2026-11" }, "BCA Visa", ledger), false);
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
