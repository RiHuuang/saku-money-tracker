import assert from "node:assert/strict";
import { test } from "node:test";
import { accountBalance, emptyData, summary, validateData, type Transaction } from "./domain";
import { owedByPerson, owedEntries } from "./owed";

const row = (id: string, amount: number, type: "income" | "expense"): Transaction => ({ id, name: id, amount, type, date: "2026-10-26", pocketId: "", account: "Cash", note: "" });

test("a three-way dinner tracks each person's share and repayment", () => {
  const data = emptyData();
  data.accounts = ["Cash"];
  const dinner: Transaction = { ...row("dinner", 300000, "expense"), split: { people: 3, ownAmount: 100000, shares: [{ person: "Ani", amount: 100000 }, { person: "Budi", amount: 100000 }] } };
  data.transactions = [dinner, { ...row("ani-paid", 100000, "income"), kind: "reimbursement", person: "Ani", forTransactionId: "dinner" }];
  assert.doesNotThrow(() => validateData(data));
  assert.deepEqual(owedEntries(data).map((entry) => [entry.person, entry.remaining]), [["Budi", 100000]]);
  assert.equal(summary(data, "2026-10").expenses, 100000);
  assert.equal(accountBalance(data, "Cash"), -200000);
  assert.throws(() => validateData({ ...data, transactions: [...data.transactions, { ...row("extra", 1, "income"), kind: "reimbursement", person: "Ani", forTransactionId: "dinner" }] }), /Repayments exceed/);
});

test("lending, borrowing and repayments change cash but not spending or income", () => {
  const data = emptyData(); data.accounts = ["Cash"];
  data.transactions = [
    { ...row("lent", 500000, "expense"), kind: "loan_given", person: "Ani" },
    { ...row("lent-paid", 200000, "income"), kind: "reimbursement", person: "Ani", forTransactionId: "lent" },
    { ...row("borrowed", 300000, "income"), kind: "loan_received", person: "Budi" },
    { ...row("borrowed-paid", 100000, "expense"), kind: "reimbursement", person: "Budi", forTransactionId: "borrowed" },
  ];
  assert.doesNotThrow(() => validateData(data));
  assert.equal(summary(data, "2026-10").expenses, 0);
  assert.equal(summary(data, "2026-10").income, 0);
  assert.equal(accountBalance(data, "Cash"), -100000);
  assert.deepEqual(owedByPerson(data).map((group) => [group.person, group.net]), [["Ani", 300000], ["Budi", -200000]]);
});

test("old shared expenses and reimbursements remain valid", () => {
  const data = emptyData(); data.accounts = ["Cash"];
  data.transactions = [{ ...row("shared", 300000, "expense"), split: { people: 3, ownAmount: 100000 } }, { ...row("paid", 100000, "income"), kind: "reimbursement", forTransactionId: "shared" }];
  assert.doesNotThrow(() => validateData(data));
  assert.equal(owedEntries(data)[0].remaining, 100000);
});
