import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  bankRows,
  accountBalance,
  balanceAdjustment,
  cardBalance,
  cardDue,
  catchUpGap,
  daysAgo,
  frequentExpenses,
  lastPocketFor,
  budgetFor,
  demoData,
  dueRules,
  emptyData,
  exportCSV,
  installmentAmounts,
  receiptSuggestion,
  parseMoney,
  readCSV,
  reconcile,
  shiftMonth,
  summary,
  validDate,
  validateData,
  type Statement,
} from "./domain";

test("balance adjustments reconcile an account without changing income or spending", () => {
  const data = emptyData();
  data.accounts = ["BCA"];
  data.pockets = [];
  data.transactions = [{
    id: "opening",
    name: "Opening balance",
    amount: 100000,
    type: "income",
    kind: "opening_balance",
    date: "2026-10-01",
    pocketId: "",
    account: "BCA",
    note: "",
  }];

  const increase = balanceAdjustment(data, "BCA", 125000, "2026-10-20", "Matched bank app");
  assert.equal(increase.type, "income");
  assert.equal(increase.amount, 25000);
  data.transactions.push(increase);
  assert.equal(accountBalance(data, "BCA"), 125000);
  assert.equal(summary(data, "2026-10").income, 0);
  assert.equal(summary(data, "2026-10").expenses, 0);
  assert.doesNotThrow(() => validateData(data));

  const decrease = balanceAdjustment(data, "BCA", 90000, "2026-10-21", "Corrected reconciliation", increase);
  assert.equal(decrease.id, increase.id);
  assert.equal(decrease.type, "expense");
  assert.equal(decrease.amount, 10000);
  data.transactions = data.transactions.map((item) => item.id === decrease.id ? decrease : item);
  assert.equal(accountBalance(data, "BCA"), 90000);
  assert.equal(summary(data, "2026-10").income, 0);
  assert.equal(summary(data, "2026-10").expenses, 0);
  assert.doesNotThrow(() => validateData(data));
});

test("balance adjustments require a real change and an audit reason", () => {
  const data = emptyData();
  data.accounts = ["Cash"];
  data.pockets = [];
  data.transactions = [];
  assert.throws(() => balanceAdjustment(data, "Cash", 0, "2026-10-21", "Counted cash"));
  assert.throws(() => balanceAdjustment(data, "Cash", 1000, "2026-10-21", " "));
  assert.throws(() => balanceAdjustment(data, "Unknown", 1000, "2026-10-21", "Counted cash"));
});

test("balances and pocket budgets follow transaction create, edit, delete and month boundaries", () => {
  const d = emptyData();
  d.pockets = [
    {
      id: "fun",
      name: "Fun",
      color: "#15786e",
      icon: "game",
      budget: 100000,
      budgets: { "2026-10": 200000 },
      createdMonth: "2026-09",
    },
  ];
  d.transactions = [
    {
      id: "income",
      name: "Income",
      type: "income",
      amount: 500000,
      date: "2026-08-01",
      account: "BCA",
      pocketId: "",
      note: "",
    },
    {
      id: "spend",
      name: "Cinema",
      type: "expense",
      amount: 40000,
      date: "2026-09-01",
      account: "BCA",
      pocketId: "fun",
      note: "",
    },
  ];
  let s = summary(d, "2026-09");
  assert.equal(s.balance, 460000);
  assert.equal(s.available, 60000);
  assert.equal(s.pockets[0].spent, 40000);
  assert.equal(s.income, 0);
  d.transactions[1].amount = 120000;
  s = summary(d, "2026-09");
  assert.equal(s.available, 0);
  assert.equal(s.pockets[0].limit - s.pockets[0].spent, -20000);
  assert.equal(summary(d, "2026-10").available, 200000);
  assert.equal(summary(d, "2026-10").expenses, 0);
  assert.equal(budgetFor(d.pockets[0], "2026-08"), 0);
  d.transactions.pop();
  assert.equal(summary(d, "2026-09").available, 100000);
  d.transactions[0].amount = 50000;
  assert.equal(summary(d, "2026-09").available, 50000);
});
test("whole rupiah parsing rejects ambiguous grouping and fractional values", () => {
  assert.equal(parseMoney("Rp 1.250.000,00", "id"), 1250000);
  assert.equal(parseMoney("1,250,000.00", "en"), 1250000);
  assert.equal(parseMoney("-100000", "id"), -100000);
  assert.throws(() => parseMoney("1,200", "id"));
  assert.throws(() => parseMoney("10.50", "id"));
  assert.throws(() => parseMoney("120,25", "id"));
  assert.throws(() => parseMoney("hello", "id"));
});
test("CSV parsing and conservative one-to-one reconciliation across accounts and overlapping files", () => {
  const parsed = readCSV(
    "date,description,debit,credit\n2026-09-02,Apartment rent,1500000,\n2026-09-20,New expense,25000,\n2026-08-20,Old expense,25000,\n2026-09-31,Invalid date,25000,",
  );
  const s: Statement = {
    id: "file1",
    file: "bank.csv",
    account: "BCA",
    format: "id",
    dateOrder: "dmy",
    ...parsed,
  };
  const rows = bankRows(s),
    data = demoData("2026-09");
  const result = reconcile(rows, data.transactions, "2026-09");
  assert.deepEqual(
    result.map((r) => r.status),
    ["matched", "missing", "outside", "invalid"],
  );
  assert.equal(
    reconcile(
      [rows[0], { ...rows[0], id: "other" }],
      data.transactions,
      "2026-09",
    )[0].status,
    "review",
  );
  assert.equal(
    reconcile(
      [{ ...rows[0], account: "Mandiri" }],
      data.transactions,
      "2026-09",
    )[0].status,
    "missing",
  );
  assert.equal(
    reconcile(
      [rows[0]],
      [...data.transactions, { ...data.transactions[1], id: "copy" }],
      "2026-09",
    )[0].status,
    "review",
  );
  assert.equal(reconcile([{ ...rows[0], amount: rows[0].amount + 1000 }], data.transactions, "2026-09")[0].status, "different");
  const sameAmountDifferentMerchant = reconcile([{ ...rows[0], name: "Different merchant" }], data.transactions, "2026-09")[0];
  assert.equal(sameAmountDifferentMerchant.status, "different");
  assert.equal(sameAmountDifferentMerchant.matchId, result[0].matchId);
});
test("signed CSV amounts, type columns and date orders are explicit", () => {
  const s: Statement = {
    id: "a",
    file: "a.csv",
    account: "BCA",
    format: "en",
    dateOrder: "mdy",
    ...readCSV(
      "date,description,amount\n09/26/2026,Income,10000\n09/27/2026,Lunch,-1000",
    ),
  };
  const rows = bankRows(s);
  assert.equal(rows[0].type, "income");
  assert.equal(rows[1].type, "expense");
  assert.equal(rows[1].date, "2026-09-27");
});
test("backups reject broken references, duplicate IDs and unsafe amounts", () => {
  const d = demoData("2026-09");
  assert.doesNotThrow(() => validateData(d));
  assert.throws(() =>
    validateData({
      ...d,
      transactions: [...d.transactions, d.transactions[0]],
    }),
  );
  assert.throws(() =>
    validateData({
      ...d,
      transactions: [{ ...d.transactions[1], pocketId: "missing" }],
    }),
  );
  assert.throws(() =>
    validateData({ ...d, transactions: [{ ...d.transactions[0], amount: 0 }] }),
  );
  assert.throws(() =>
    validateData({
      ...d,
      transactions: [{ ...d.transactions[0], account: "Unknown" }],
    }),
  );
  assert.match(
    exportCSV([{ ...d.transactions[0], name: "=DANGEROUS()" }], d.pockets),
    /'=DANGEROUS/,
  );
});
test("calendar helpers reject impossible dates and shift years correctly", () => {
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-04-31"), false);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});
test("card purchase charges a pocket once and payment restores card credit", () => {
  const d = emptyData();
  d.pockets = [{ id: "food", name: "Food", icon: "utensils", color: "#15786e", budget: 200000, budgets: {}, createdMonth: "2026-09" }];
  d.creditCards = [{ id: "bca-card", name: "CC BCA", limit: 1000000, openingDebt: 0, dueDay: 15 }];
  d.transactions = [
    { id: "salary", name: "Salary", amount: 500000, type: "income", date: "2026-09-01", pocketId: "", account: "BCA", note: "" },
    { id: "lunch", name: "Lunch", amount: 120001, type: "expense", kind: "card_purchase", cardId: "bca-card", installments: 3, firstDueMonth: "2026-10", date: "2026-09-10", pocketId: "food", account: "CC BCA", note: "" },
  ];
  assert.doesNotThrow(() => validateData(d));
  assert.equal(summary(d, "2026-09").expenses, 120001);
  assert.equal(summary(d, "2026-09").balance, 500000);
  assert.equal(summary(d, "2026-09").pockets[0].spent, 120001);
  assert.equal(cardBalance(d, "bca-card"), 120001);
  assert.deepEqual(installmentAmounts(120001, 3), [40001, 40000, 40000]);
  assert.equal(cardDue(d, "bca-card", "2026-10"), 40001);
  d.transactions.push({ id: "payment", name: "Card payment", amount: 40001, type: "expense", kind: "card_payment", cardId: "bca-card", date: "2026-10-15", pocketId: "", account: "BCA", note: "" });
  assert.doesNotThrow(() => validateData(d));
  assert.equal(cardBalance(d, "bca-card"), 80000);
  assert.equal(summary(d, "2026-10").balance, 459999);
  assert.equal(summary(d, "2026-10").expenses, 0);
  d.transactions[2].amount = 130000;
  assert.doesNotThrow(() => validateData(d));
  assert.equal(cardBalance(d, "bca-card"), -9999);
  assert.equal(summary(d, "2026-10").cardDebt, 0);
  assert.equal(summary(d, "2026-10").balance, 370000);
  assert.equal(1000000 - cardBalance(d, "bca-card"), 1009999);
  d.transactions.push({ id: "later-purchase", name: "Later purchase", amount: 4000, type: "expense", kind: "card_purchase", cardId: "bca-card", installments: 1, firstDueMonth: "2026-11", date: "2026-10-16", pocketId: "food", account: "CC BCA", note: "" });
  assert.doesNotThrow(() => validateData(d));
  assert.equal(cardBalance(d, "bca-card"), -5999);
  assert.equal(summary(d, "2026-10").balance, 370000);
  assert.equal(summary(d, "2026-10").expenses, 4000);
});
test("shared bill retains full cash movement but spends only own share", () => {
  const d = emptyData();
  d.pockets = [{ id: "fun", name: "Fun", icon: "game", color: "#15786e", budget: 100000, budgets: {}, createdMonth: "2026-09" }];
  d.transactions = [
    { id: "bill", name: "Dinner", amount: 100000, type: "expense", date: "2026-09-10", pocketId: "fun", account: "BCA", note: "", split: { people: 4, ownAmount: 25000 } },
    { id: "friend", name: "Repaid", amount: 75000, type: "income", kind: "reimbursement", forTransactionId: "bill", date: "2026-09-11", pocketId: "", account: "BCA", note: "" },
  ];
  assert.doesNotThrow(() => validateData(d));
  const s = summary(d, "2026-09");
  assert.equal(s.balance, -25000);
  assert.equal(s.expenses, 25000);
  assert.equal(s.income, 0);
  d.transactions[1].amount = 75001;
  assert.throws(() => validateData(d), /Repayments exceed/);
});
test("old backups migrate and receipt suggestions require a total label", () => {
  const old = demoData("2026-09") as unknown as Record<string, unknown>;
  old.version = 1;
  delete old.creditCards; delete old.recurring; delete old.favorites;
  const migrated = validateData(old);
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.pocketTransfers, []);
  assert.deepEqual(migrated.creditCards, []);
  assert.deepEqual(receiptSuggestion("KOPI PAGI\nCoffee 25.000\nTOTAL Rp 25.000"), { amount: 25000, merchant: "KOPI PAGI" });
  assert.equal(receiptSuggestion("CAFE\nTOTAL 25,000").amount, 25000);
  assert.equal(receiptSuggestion("Coffee 25.000").amount, null);
});
test("complete version 3 backups survive a JSON round trip", () => {
  const d = emptyData();
  d.name = "Backup Test";
  d.pockets = [{ id: "daily", name: "Daily", icon: "coffee", color: "#15786e", budget: 300000, budgets: { "2026-10": 350000 }, createdMonth: "2026-09" }];
  d.creditCards = [{ id: "card", name: "CC BCA", limit: 1000000, openingDebt: 50000, dueDay: 12 }];
  d.recurring = [{ id: "stream", name: "Streaming", amount: 65000, type: "expense", pocketId: "daily", account: "CC BCA", cardId: "card", installments: 1, day: 20, startMonth: "2026-09", active: true, skippedMonths: ["2026-10"] }];
  d.favorites = [{ id: "coffee", name: "Coffee", amount: 25000, type: "expense", pocketId: "daily", account: "BCA" }];
  d.transactions = [{ id: "purchase", name: "Headphones", amount: 300000, type: "expense", kind: "card_purchase", cardId: "card", installments: 3, firstDueMonth: "2026-10", date: "2026-09-20", pocketId: "daily", account: "CC BCA", note: "" }];
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(d))), d);
});
test("unassigned expenses and paired transfers keep cash and spending correct", () => {
  const d = emptyData();
  d.accounts = ["BCA", "Jago"];
  d.pockets = [{ id: "food", name: "Food", icon: "utensils", color: "#15786e", budget: 100000, budgets: {}, createdMonth: "2026-09" }];
  d.transactions = [
    { id: "open", name: "Opening", amount: 1000000, type: "income", kind: "opening_balance", date: "2026-09-01", pocketId: "", account: "BCA", note: "" },
    { id: "coffee", name: "Coffee", amount: 25000, type: "expense", date: "2026-09-02", pocketId: "", account: "BCA", note: "" },
    { id: "out", transferId: "move", kind: "account_transfer", name: "Transfer to Jago", amount: 200000, type: "expense", date: "2026-09-03", pocketId: "", account: "BCA", note: "" },
    { id: "in", transferId: "move", kind: "account_transfer", name: "Transfer from BCA", amount: 200000, type: "income", date: "2026-09-03", pocketId: "", account: "Jago", note: "" },
  ];
  assert.doesNotThrow(() => validateData(d));
  const s = summary(d, "2026-09");
  assert.equal(s.balance, 975000);
  assert.equal(s.expenses, 25000);
  assert.equal(s.unassigned, 25000);
  assert.deepEqual(s.accounts.map((a) => a.balance), [775000, 200000]);
  d.transactions.pop();
  assert.throws(() => validateData(d), /bank transfer/);
});
test("pocket moves and existing installments affect plans without moving cash", () => {
  const d = emptyData();
  d.pockets = [
    { id: "food", name: "Food", icon: "utensils", color: "#15786e", budget: 100000, budgets: {}, createdMonth: "2026-09" },
    { id: "fun", name: "Fun", icon: "game", color: "#8270ce", budget: 50000, budgets: {}, createdMonth: "2026-09" },
  ];
  d.pocketTransfers = [{ id: "move", fromPocketId: "food", toPocketId: "fun", amount: 20000, month: "2026-09" }];
  d.creditCards = [{ id: "card", name: "BCA Visa", limit: 1000000, openingDebt: 300000, dueDay: 15 }];
  d.existingInstallments = [{ id: "phone", cardId: "card", name: "Phone", monthlyAmount: 100000, nextDueMonth: "2026-09", paymentsLeft: 2 }];
  assert.equal(summary(d, "2026-09").pockets.find((p) => p.id === "food")?.limit, 80000);
  assert.equal(summary(d, "2026-09").pockets.find((p) => p.id === "fun")?.limit, 70000);
  assert.equal(cardDue(d, "card", "2026-10"), 100000);
  assert.equal(cardDue(d, "card", "2026-11"), 0);
});
test("recurring bills show only unrecorded, unskipped occurrences", () => {
  const d = emptyData();
  d.pockets = [{ id: "bills", name: "Bills", icon: "home", color: "#15786e", budget: 200000, budgets: {}, createdMonth: "2026-09" }];
  d.recurring = [{ id: "wifi", name: "Wi-Fi", amount: 100000, type: "expense", pocketId: "bills", account: "BCA", day: 31, startMonth: "2026-09", active: true, skippedMonths: ["2026-10"] }];
  assert.deepEqual(dueRules(d, "2026-10-31").map((x) => x.date), ["2026-09-30"]);
  d.transactions.push({ id: "paid", name: "Wi-Fi", amount: 100000, type: "expense", pocketId: "bills", account: "BCA", date: "2026-09-30", note: "", recurringRuleId: "wifi", occurrenceMonth: "2026-09" });
  assert.deepEqual(dueRules(d, "2026-10-31"), []);
  assert.doesNotThrow(() => validateData(d));
});

test("catchUpGap counts days since the last real entry or checked day, capped at 14", () => {
  const data = emptyData();
  data.accounts = ["Cash"];
  assert.deepEqual(catchUpGap(data, "2026-10-25"), []);
  const row = (id: string, date: string, extra: object = {}) => ({ id, name: id, amount: 1000, type: "expense", date, pocketId: "", account: "Cash", note: "", ...extra }) as typeof data.transactions[number];
  data.transactions = [row("open", "2026-10-20", { type: "income", kind: "opening_balance" })];
  assert.deepEqual(catchUpGap(data, "2026-10-23"), ["2026-10-21", "2026-10-22", "2026-10-23"]);
  data.transactions.push(row("coffee", "2026-10-22"), row("rent", "2026-10-24", { recurringRuleId: "r1" }), row("later", "2026-11-02"));
  assert.deepEqual(catchUpGap(data, "2026-10-25"), ["2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.deepEqual(catchUpGap(data, "2026-10-25", ["2026-10-23", "2026-10-24"]), ["2026-10-25"]);
  assert.deepEqual(catchUpGap(data, "2026-10-25", ["2026-10-25"]), []);
  data.transactions.push(row("today", "2026-10-25"));
  assert.deepEqual(catchUpGap(data, "2026-10-25"), []);
  const gap = catchUpGap(data, "2026-12-01");
  assert.equal(gap.length, 14);
  assert.deepEqual([gap[0], gap.at(-1)], ["2026-11-18", "2026-12-01"]);
});

test("snapshots without checkedDays load, and invalid checked days are rejected", () => {
  const { checkedDays: _, ...old } = emptyData();
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(old))).checkedDays, []);
  assert.deepEqual(validateData({ ...emptyData(), checkedDays: ["2026-10-23"] }).checkedDays, ["2026-10-23"]);
  assert.throws(() => validateData({ ...emptyData(), checkedDays: ["23 Oct"] }));
  assert.throws(() => validateData({ ...emptyData(), checkedDays: ["2026-10-23", "2026-10-23"] }));
});

test("daysAgo uses the local calendar day, not UTC", () => {
  const zone = process.env.TZ;
  process.env.TZ = "Asia/Jakarta";
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-25T17:30:00Z") });
  try {
    assert.deepEqual([daysAgo(0), daysAgo(1), daysAgo(2)], ["2026-10-26", "2026-10-25", "2026-10-24"]);
    assert.equal(daysAgo(26), "2026-09-30");
  } finally {
    mock.timers.reset();
    if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone;
  }
});

test("lastPocketFor uses the most recent expense with the same name", () => {
  const data = emptyData();
  data.accounts = ["Cash"];
  const row = (id: string, name: string, date: string, pocketId: string, extra: object = {}) => ({ id, name, amount: 1000, type: "expense", date, pocketId, account: "Cash", note: "", ...extra }) as typeof data.transactions[number];
  data.transactions = [row("a", "Grab", "2026-10-01", "food"), row("b", "grab ", "2026-10-20", "transport"), row("c", "Grab", "2026-10-10", "food"), row("d", "Kopi", "2026-10-05", ""), row("e", "Grab", "2026-10-30", "", { type: "income" })];
  assert.equal(lastPocketFor(data, " GRAB"), "transport");
  assert.equal(lastPocketFor(data, "Kopi"), "");
  assert.equal(lastPocketFor(data, "Bakso"), undefined);
  assert.equal(lastPocketFor(data, "  "), undefined);
});

test("frequentExpenses suggests the most used recent expenses that aren't quick entries", () => {
  const data = emptyData();
  data.accounts = ["Cash"];
  data.favorites = [{ id: "f1", name: "Parkir", amount: 5000, type: "expense", pocketId: "", account: "Cash" }];
  const row = (id: string, name: string, date: string, amount: number, extra: object = {}) => ({ id, name, amount, type: "expense", date, pocketId: "", account: "Cash", note: "", ...extra }) as typeof data.transactions[number];
  data.transactions = [
    row("k1", "Kopi", "2026-10-01", 25000), row("k2", "kopi ", "2026-10-20", 28000), row("k3", "Kopi", "2026-10-10", 26000),
    row("g1", "Grab", "2026-10-21", 15000), row("g2", "Grab", "2026-10-22", 18000),
    row("p1", "parkir", "2026-10-22", 5000), row("old", "Old", "2026-08-01", 1000), row("old2", "Old", "2026-08-02", 1000), row("old3", "Old", "2026-08-03", 1000),
    row("r1", "Rent", "2026-10-05", 900000, { recurringRuleId: "r" }), row("r2", "Rent", "2026-09-05", 900000, { recurringRuleId: "r" }),
    row("s1", "Salary", "2026-10-01", 9000000, { type: "income" }), row("x1", "Bakso", "2026-10-23", 20000),
  ];
  const suggested = frequentExpenses(data, "2026-10-25");
  assert.deepEqual(suggested.map((f) => [f.name, f.amount]), [["kopi ", 28000], ["Grab", 18000], ["Bakso", 20000]]);
  assert.equal(frequentExpenses(data, "2026-10-25", 1).length, 1);
});
