import assert from "node:assert/strict";
import { test } from "node:test";
import { COLORS, ICONS, emptyData, validateData } from "./domain";
import { goalProgress, pocketFunding, removePocketWithGoals, type SavingsGoal } from "./goals";
import { sheetTables } from "./sheetMirror";

const data = emptyData();
data.pockets = [
  { id: "source", name: "Everyday", color: COLORS[0], icon: ICONS[0], budget: 500000, budgets: {}, createdMonth: "2026-10" },
  { id: "goal", name: "Trip", color: COLORS[1], icon: ICONS[1], budget: 0, budgets: {}, createdMonth: "2026-10" },
];
const goal: SavingsGoal = { id: "trip", name: "Trip", target: 2000000, targetDate: "2027-02", pocketId: "goal", createdMonth: "2026-10", startingFunding: 0 };

test("goal funding follows pocket transfers without creating another balance", () => {
  const funded = { ...data, goals: [goal], pocketTransfers: [{ id: "move", fromPocketId: "source", toPocketId: "goal", amount: 500000, month: "2026-10" }] };
  assert.equal(pocketFunding(funded, "goal", "2026-10"), 500000);
  assert.deepEqual(goalProgress(funded, goal, "2026-10"), { saved: 500000, remaining: 1500000, monthlyTarget: 375000 });
  assert.deepEqual(sheetTables(funded).Goals[1], ["trip", "Trip", "2000000", "2027-02", "goal", "2026-10", "0"]);
  assert.doesNotThrow(() => validateData(funded));
});

test("a goal due in four months with two million left needs 500,000 monthly", () => {
  assert.equal(goalProgress({ ...data, goals: [goal] }, goal, "2026-10").monthlyTarget, 500000);
});

test("old snapshots default goals and orphaned goals are rejected", () => {
  const old = { ...data } as Record<string, unknown>;
  delete old.goals;
  assert.deepEqual(validateData(old).goals, []);
  assert.throws(() => validateData({ ...data, goals: [goal], pockets: [data.pockets[0]] }), /invalid savings goal/);
});

test("deleting a pocket deletes or reassigns its goal without leaving an orphan", () => {
  const withGoal = { ...data, goals: [goal] };
  const removed = removePocketWithGoals(withGoal, "goal", "", "2026-10");
  assert.deepEqual(removed.goals, []);
  assert.doesNotThrow(() => validateData(removed));
  const reassigned = removePocketWithGoals(withGoal, "goal", "source", "2026-10");
  assert.equal(reassigned.goals[0].pocketId, "source");
  assert.equal(goalProgress(reassigned, reassigned.goals[0], "2026-10").saved, 0);
  assert.doesNotThrow(() => validateData(reassigned));
});
