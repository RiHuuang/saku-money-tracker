import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData, accountBalance } from "./domain";
import { previewStatementAdjustment, statementBalanceAdjustment, statementBalanceReason, statementBalanceReviewIssue } from "./statementBalances";

const ledger = () => ({ ...emptyData(), accounts: ["Jago"], transactions: [
  { id: "opening", name: "Opening", amount: 35000, type: "income" as const, date: "2020-10-01", account: "Jago", pocketId: "", note: "" },
  { id: "november", name: "November income", amount: 15000, type: "income" as const, date: "2020-11-07", account: "Jago", pocketId: "", note: "" },
] });
const target = { account: "Jago", date: "2020-10-31", balance: 20000 };
const now = "2020-11-07";

test("a historical correction is blocked when today's already-correct balance would change", () => {
  const data = ledger(), anchor = { account: "Jago", date: now, balance: 50000 };
  const preview = previewStatementAdjustment(data, target, [anchor], now);
  assert.equal(preview.difference, -15000);
  assert.equal(preview.currentBefore, 50000);
  assert.equal(preview.currentAfter, 35000);
  assert.equal(preview.canApply, false);
  assert.throws(() => statementBalanceAdjustment(data, target, [anchor], "Statement", now));
  assert.equal(accountBalance(data, "Jago"), 50000);
});

test("an adjustment can fix both the historical and current independently verified balance once", () => {
  const data = ledger(), anchor = { account: "Jago", date: now, balance: 35000 };
  const adjustment = statementBalanceAdjustment(data, target, [anchor], "Approved statement difference", now);
  assert.equal(adjustment.amount, 15000);
  assert.equal(adjustment.type, "expense");
  assert.equal(adjustment.kind, "balance_adjustment");
  assert.equal(adjustment.date, target.date);
  const after = { ...data, transactions: [...data.transactions, adjustment] };
  assert.equal(accountBalance(after, "Jago"), 35000);
  assert.equal(after.transactions[1], data.transactions[1], "November entry stays unchanged");
  assert.throws(() => statementBalanceAdjustment(after, target, [anchor], "Again", now));
});

test("unknown current balances and conflicting intermediate verified balances block historical adjustments", () => {
  assert.equal(previewStatementAdjustment(ledger(), target, [], now).canApply, false);
  const anchors = [{ account: "Jago", date: "2020-11-01", balance: 35000 }, { account: "Jago", date: now, balance: 35000 }];
  assert.equal(previewStatementAdjustment(ledger(), target, anchors, now).canApply, false);
});

test("conflicting same-day verified balances block adjustment", () => {
 const data=ledger();
 assert.equal(previewStatementAdjustment(data,{account:"Jago",date:now,balance:20000},[{account:"Jago",date:now,balance:30000}],now).canApply,false);
});

test("statement balance review keeps its action available and identifies the field to fix", () => {
  const data = ledger();
  const complete = { account: "Jago", date: now, target: "35000", current: "35000" };
  assert.equal(statementBalanceReviewIssue(data, { ...complete, account: "" }, true, now), "account");
  assert.equal(statementBalanceReviewIssue(data, { ...complete, date: "2020-11-08" }, true, now), "date");
  assert.equal(statementBalanceReviewIssue(data, { ...complete, target: "" }, true, now), "target");
  assert.equal(statementBalanceReviewIssue(data, { ...complete, current: "1.5" }, true, now), "current");
  assert.equal(statementBalanceReviewIssue(data, complete, false, now), "effect");
  assert.equal(statementBalanceReviewIssue(data, complete, true, now), null);
  assert.equal(statementBalanceReason("", "Balance adjustment"), "Balance adjustment");
  assert.equal(statementBalanceReason("  Checked against bank  ", "Balance adjustment"), "Checked against bank");
});
