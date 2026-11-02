import assert from "node:assert/strict";
import { test } from "node:test";
import { amountFromPercent, baselinePlan, classifyPocket, percentOf, planTotal, spreadRest } from "./allocation";
import { applyPocketPlan, emptyData, rollbackPocketPlan, validateData, type Data } from "./domain";

const pockets = (...names: string[]) => names.map((name, index) => ({ key: `k${index}`, name, icon: "home" }));
const fresh = () => { const data = emptyData(); data.accounts = ["BCA"]; return data; };

test("pocket names in Indonesian and English land in the right group", () => {
  assert.equal(classifyPocket("Makan"), "needs");
  assert.equal(classifyPocket("Kos & listrik"), "needs");
  assert.equal(classifyPocket("Cicilan motor"), "debt");
  assert.equal(classifyPocket("Dana darurat"), "savings");
  assert.equal(classifyPocket("Kirim orang tua"), "giving");
  assert.equal(classifyPocket("Nongkrong"), "wants");
  assert.equal(classifyPocket("Emergency fund"), "savings");
  assert.equal(classifyPocket("Something odd"), "wants");
});

test("a new user's plan uses the template and adds up to the income exactly", () => {
  const rows = baselinePlan(10_000_000, "fixed", pockets("Makan", "Kos", "Nongkrong", "Tabungan"), fresh(), "2026-11");
  assert.equal(planTotal(rows), 10_000_000);
  assert.deepEqual(rows.map((row) => row.amount), [2_500_000, 2_500_000, 3_000_000, 2_000_000]);
  assert.ok(rows.every((row) => row.amount % 50_000 === 0));
  const variable = baselinePlan(10_000_000, "variable", pockets("Makan", "Nongkrong", "Tabungan"), fresh(), "2026-11");
  assert.equal(variable.find((row) => row.name === "Tabungan")?.amount, 2_500_000, "variable income keeps more aside");
});

test("without a savings pocket the savings share stays visible as unallocated", () => {
  const rows = baselinePlan(10_000_000, "fixed", pockets("Makan", "Nongkrong"), fresh(), "2026-11");
  assert.equal(planTotal(rows), 8_000_000);
});

test("commitments come off first and never shrink", () => {
  const data = fresh();
  data.creditCards = [{ id: "c", name: "BCA Visa", limit: 10_000_000, openingDebt: 0, dueDay: 15 }];
  data.existingInstallments = [{ id: "i", cardId: "c", name: "HP", monthlyAmount: 1_000_000, nextDueMonth: "2026-11", paymentsLeft: 5 }];
  data.pockets = [{ id: "kos", name: "Kos", color: "#15786e", icon: "home", budget: 0, budgets: {}, createdMonth: "2026-01" }];
  data.recurring = [{ id: "r", name: "Kos", amount: 4_500_000, type: "expense", pocketId: "kos", account: "BCA", day: 1, startMonth: "2026-01", active: true }];
  const rows = baselinePlan(6_000_000, "fixed", [{ key: "kos", pocketId: "kos", name: "Kos", icon: "home" }, ...pockets("Nongkrong")], data, "2026-11");
  assert.equal(rows[0].amount, 4_500_000, "rent is committed");
  assert.equal(rows[0].reason.kind, "fixed");
  assert.equal(planTotal(rows), 5_000_000, "the card instalment is taken off before pockets");
});

test("with two months of history, real spending outweighs the template", () => {
  const data = fresh();
  data.pockets = [{ id: "food", name: "Makan", color: "#15786e", icon: "utensils", budget: 1_000_000, budgets: {}, createdMonth: "2026-01" }, { id: "fun", name: "Nongkrong", color: "#15786e", icon: "game", budget: 1_000_000, budgets: {}, createdMonth: "2026-01" }];
  for (const month of ["2026-08", "2026-09", "2026-10"]) data.transactions.push({ id: `f${month}`, name: "Makan", amount: 4_000_000, type: "expense", date: `${month}-10`, pocketId: "food", account: "BCA", note: "" });
  const rows = baselinePlan(10_000_000, "fixed", [{ key: "food", pocketId: "food", name: "Makan", icon: "utensils" }, { key: "fun", pocketId: "fun", name: "Nongkrong", icon: "game" }, ...pockets("Tabungan")], data, "2026-11");
  const food = rows.find((row) => row.key === "food")!;
  assert.equal(food.spend, 4_000_000);
  assert.equal(food.reason.kind, "spend");
  assert.ok(food.amount >= 3_500_000 && food.amount <= 4_500_000, `close to real spending, got ${food.amount}`);
  assert.equal(planTotal(rows), 10_000_000);
});

test("spreading the rest never touches pockets the person set", () => {
  const rows = baselinePlan(10_000_000, "fixed", pockets("Makan", "Nongkrong", "Tabungan"), fresh(), "2026-11").map((row) => row.name === "Makan" ? { ...row, amount: 1_000_000, userSet: true } : row);
  const spread = spreadRest(rows, 10_000_000, fresh());
  assert.equal(spread.find((row) => row.name === "Makan")?.amount, 1_000_000);
  assert.equal(planTotal(spread), 10_000_000);
  assert.equal(percentOf(2_500_000, 10_000_000), 25);
  assert.equal(amountFromPercent(75, 2_000_000), 1_500_000);
});

const planned = (): Data => {
  const data = fresh();
  data.pockets = [{ id: "food", name: "Makan", color: "#15786e", icon: "utensils", budget: 1_000_000, budgets: { "2026-09": 1_200_000 }, createdMonth: "2026-08" }];
  return data;
};

test("applying a plan keeps every past month's budget and adds new pockets", () => {
  const next = applyPocketPlan(planned(), { income: 8_000_000, kind: "fixed", items: [{ pocketId: "food", name: "Makan", icon: "utensils", amount: 3_000_000 }, { name: "Tabungan", icon: "heart", amount: 1_600_000 }] }, "2026-11", "2026-11-02T00:00:00Z", "plan-1");
  const food = next.pockets.find((pocket) => pocket.id === "food")!;
  assert.equal(food.budget, 3_000_000);
  assert.deepEqual(food.budgets, { "2026-08": 1_000_000, "2026-09": 1_200_000, "2026-10": 1_000_000 }, "past months are frozen at what they were");
  assert.equal(next.pockets.length, 2);
  assert.equal(next.pockets[1].createdMonth, "2026-11");
  assert.equal(next.monthlyIncome, 8_000_000);
  assert.equal(next.pocketPlans?.[0].id, "plan-1");
  assert.deepEqual(next.pocketPlans?.[0].createdPocketIds, [next.pockets[1].id]);
  assert.throws(() => applyPocketPlan(planned(), { income: 1, kind: "fixed", items: [{ name: "Makan", icon: "home", amount: 1 }] }, "2026-11"), /own name/, "a new pocket can't reuse an existing name");
});

test("rolling back restores the pockets, but keeps a new pocket that is already used", () => {
  const applied = applyPocketPlan(planned(), { income: 8_000_000, kind: "fixed", items: [{ pocketId: "food", name: "Makan", icon: "utensils", amount: 3_000_000 }, { name: "Tabungan", icon: "heart", amount: 1_600_000 }, { name: "Nongkrong", icon: "game", amount: 500_000 }] }, "2026-11", "2026-11-02T00:00:00Z", "plan-1");
  const fun = applied.pockets.find((pocket) => pocket.name === "Nongkrong")!;
  applied.transactions.push({ id: "t", name: "Kopi", amount: 30_000, type: "expense", date: "2026-11-02", pocketId: fun.id, account: "BCA", note: "" });
  const { data, kept } = rollbackPocketPlan(applied, "plan-1");
  assert.deepEqual(kept, ["Nongkrong"]);
  assert.deepEqual(data.pockets.map((pocket) => pocket.name), ["Makan", "Nongkrong"]);
  assert.deepEqual(data.pockets[0], planned().pockets[0], "the old pocket is exactly as it was");
  assert.equal(data.monthlyIncome, undefined);
  assert.deepEqual(data.pocketPlans, []);
  assert.throws(() => rollbackPocketPlan(data, "plan-1"), /no longer/);
});

test("rolling back an older plan also undoes the plans after it, and history stays at three", () => {
  let data = planned();
  for (const [index, amount] of [1, 2, 3, 4].entries()) data = applyPocketPlan(data, { income: 9_000_000, kind: "variable", items: [{ pocketId: "food", name: "Makan", icon: "utensils", amount: amount * 1_000_000 }] }, "2026-11", `2026-11-0${index + 1}T00:00:00Z`, `p${index}`);
  assert.deepEqual(data.pocketPlans?.map((plan) => plan.id), ["p3", "p2", "p1"]);
  const back = rollbackPocketPlan(data, "p2").data;
  assert.equal(back.pockets[0].budget, 2_000_000, "the state before p2");
  assert.deepEqual(back.pocketPlans?.map((plan) => plan.id), ["p1"]);
});

test("the new ledger fields are validated", () => {
  assert.equal(validateData({ ...planned(), monthlyIncome: 5_000_000, incomeKind: "fixed" }).monthlyIncome, 5_000_000);
  assert.throws(() => validateData({ ...planned(), monthlyIncome: -1 }), /income/);
  assert.throws(() => validateData({ ...planned(), incomeKind: "weekly" }), /income type/);
  assert.throws(() => validateData({ ...planned(), pocketPlans: [{ id: "x" }] }), /pocket plan/);
  assert.throws(() => validateData({ ...planned(), pocketPlans: [1, 2, 3, 4].map((n) => ({ id: `${n}`, appliedAt: "", month: "2026-11", pocketsBefore: [], createdPocketIds: [] })) }), /pocket plan/);
});
