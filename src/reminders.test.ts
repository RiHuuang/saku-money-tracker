import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData } from "./domain";
import { defaultReminder, parseReminder, reminderPlan } from "./reminders";

const ledger = () => {
  const data = emptyData();
  data.accounts = ["Cash"];
  data.transactions = [{ id: "kopi", name: "Kopi", amount: 28000, type: "expense", date: "2026-10-23", pocketId: "", account: "Cash", note: "" }];
  return data;
};
const on = { enabled: true, time: "20:00" };

test("reminder settings parse defensively", () => {
  assert.deepEqual(parseReminder(null), defaultReminder);
  assert.deepEqual(parseReminder(JSON.stringify({ enabled: true, time: "07:30" })), { enabled: true, time: "07:30" });
  assert.deepEqual(parseReminder(JSON.stringify({ enabled: true, time: "25:00" })), { enabled: true, time: "20:00" });
});

test("daily reminders cover the coming week with gentle, current wording", () => {
  assert.deepEqual(reminderPlan(ledger(), defaultReminder, new Date(2026, 9, 26, 10)), [], "nothing is planned while off");
  const plan = reminderPlan(ledger(), on, new Date(2026, 9, 26, 10));
  assert.equal(plan.length, 7);
  assert.deepEqual(plan[0].at, new Date(2026, 9, 26, 20, 0));
  assert.equal(plan[0].body, "3 days to catch up, about 1 minute.");
  assert.equal(plan[1].body, "4 days to catch up, about 1 minute.");
  assert.equal(plan.every((item) => item.extra.kind === "catchup" && !/streak|miss/i.test(item.body)), true);
  assert.equal(reminderPlan(ledger(), on, new Date(2026, 9, 26, 21)).length, 6, "a time already passed today waits for tomorrow");
  const caughtUp = ledger();
  caughtUp.transactions.push({ id: "today", name: "Bakso", amount: 20000, type: "expense", date: "2026-10-26", pocketId: "", account: "Cash", note: "" });
  const next = reminderPlan(caughtUp, on, new Date(2026, 9, 26, 10));
  assert.equal(next[0].body, "Anything else to add today?");
  assert.equal(next[1].body, "1 day to catch up, about 1 minute.");
});

test("card reminders come 3 days before a due payment and never show amounts", () => {
  const data = ledger();
  data.creditCards = [{ id: "visa", name: "BCA Visa", limit: 5_000_000, openingDebt: 0, dueDay: 31 }, { id: "idle", name: "Idle Card", limit: 1_000_000, openingDebt: 0, dueDay: 15 }];
  data.transactions.push({ id: "tv", name: "TV", amount: 3_000_000, type: "expense", date: "2026-10-02", pocketId: "", account: "BCA Visa", note: "", kind: "card_purchase", cardId: "visa", installments: 3, firstDueMonth: "2026-10" });
  const cards = reminderPlan(data, on, new Date(2026, 9, 26, 10)).filter((item) => item.extra.kind === "card");
  assert.deepEqual(cards.map((item) => [item.at.getMonth() + 1, item.at.getDate(), item.body]), [[10, 28, "BCA Visa payment is due in 3 days."], [11, 27, "BCA Visa payment is due in 3 days."]], "October 31 and November's last day (30)");
  assert.equal(cards.some((item) => /\d{3}/.test(item.body)), false);
  assert.equal(new Set(reminderPlan(data, on, new Date(2026, 9, 26, 10)).map((item) => item.id)).size, 9);
});
