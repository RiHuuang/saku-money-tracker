import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData } from "./domain";
import { checkinAdjustment, checkinGap, mergeCheckins, type BalanceCheckin } from "./balanceCheckins";

const at = new Date(2026, 9, 25, 9, 0).getTime();
const ledger = () => {
  const data = emptyData();
  data.accounts = ["BCA"];
  data.transactions = [
    { id: "open", name: "Opening balance", amount: 3_200_000, type: "income", kind: "opening_balance", date: "2026-10-01", pocketId: "", account: "BCA", note: "" },
    { id: "lunch", name: "Lunch", amount: 50_000, type: "expense", date: "2026-10-25", pocketId: "", account: "BCA", note: "" },
    { id: "later", name: "Later", amount: 99_000, type: "expense", date: "2026-10-26", pocketId: "", account: "BCA", note: "" },
  ];
  return data;
};
const checkin: BalanceCheckin = { id: "c1", account: "BCA", appName: "BCA mobile", reported: 3_210_000, occurredAt: at };

test("a reported balance is compared with the ledger as of that day", () => {
  assert.deepEqual(checkinGap(ledger(), checkin), { saku: 3_150_000, difference: 60_000, worthAsking: true });
  assert.equal(checkinGap(ledger(), { ...checkin, reported: 3_150_800 }).worthAsking, false, "differences up to Rp1.000 are ignored");
  assert.equal(checkinGap(ledger(), { ...checkin, account: "Gone" }).worthAsking, false);
});

test("accepting creates one balance adjustment for the difference, dated at the notification", () => {
  const adjustment = checkinAdjustment(ledger(), checkin);
  assert.equal(adjustment.kind, "balance_adjustment");
  assert.equal(adjustment.type, "income");
  assert.equal(adjustment.amount, 60_000);
  assert.equal(adjustment.date, "2026-10-25");
  assert.equal(adjustment.account, "BCA");
  const after = { ...ledger(), transactions: [...ledger().transactions, adjustment] };
  assert.equal(checkinGap(after, checkin).worthAsking, false, "the check-in is settled afterwards");
});

test("only the newest check-in per account is kept", () => {
  const merged = mergeCheckins([checkin], [{ ...checkin, id: "c2", reported: 3_000_000, occurredAt: at + 1000 }, { ...checkin, id: "old", occurredAt: at - 1000 }]);
  assert.deepEqual(merged.map((item) => item.id), ["c2"]);
});
