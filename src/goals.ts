import type { Data } from "./domain";

// Savings goals observe pocket funding; they never own a second balance.
export type SavingsGoal = { id: string; name: string; target: number; targetDate?: string; pocketId: string; createdMonth: string; startingFunding: number };

export function pocketFunding(data: Data, pocketId: string, throughMonth: string): number {
  const pocket = data.pockets.find((item) => item.id === pocketId);
  if (!pocket) return 0;
  const firstMonth = pocket.createdMonth;
  let funded = 0;
  for (let year = Number(firstMonth.slice(0, 4)), month = Number(firstMonth.slice(5, 7));
    year * 12 + month <= Number(throughMonth.slice(0, 4)) * 12 + Number(throughMonth.slice(5, 7)); month++) {
    if (month > 12) { year++; month = 1; }
    const key = `${year}-${String(month).padStart(2, "0")}`;
    funded += pocket.budgets[key] ?? pocket.budget;
  }
  return funded + data.pocketTransfers.reduce((sum, move) => move.month <= throughMonth
    ? sum + (move.toPocketId === pocketId ? move.amount : move.fromPocketId === pocketId ? -move.amount : 0) : sum, 0);
}

export function goalProgress(data: Data, goal: SavingsGoal, month: string) {
  const saved = Math.min(goal.target, Math.max(0, pocketFunding(data, goal.pocketId, month) - goal.startingFunding));
  const remaining = goal.target - saved;
  const monthsLeft = goal.targetDate ? Math.max(1, (Number(goal.targetDate.slice(0, 4)) - Number(month.slice(0, 4))) * 12 + Number(goal.targetDate.slice(5, 7)) - Number(month.slice(5, 7))) : null;
  return { saved, remaining, monthlyTarget: monthsLeft ? Math.ceil(remaining / monthsLeft) : null };
}

export function removePocketWithGoals(data: Data, pocketId: string, replacementId: string, month: string): Data {
  if (!data.pockets.some((pocket) => pocket.id === pocketId) || replacementId && !data.pockets.some((pocket) => pocket.id === replacementId && pocket.id !== pocketId))
    throw new Error("Choose an existing replacement pocket.");
  const goals = data.goals.flatMap((goal) => goal.pocketId !== pocketId ? [goal] : replacementId
    ? [{ ...goal, pocketId: replacementId, createdMonth: month, startingFunding: pocketFunding(data, replacementId, month) }] : []);
  return { ...data, pockets: data.pockets.filter((pocket) => pocket.id !== pocketId), goals };
}
