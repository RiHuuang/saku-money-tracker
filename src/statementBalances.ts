import { accountBalance, balanceAdjustment, today, validDate, type Data } from "./domain";

export type VerifiedAccountBalance = { account: string; date: string; balance: number };
const atDate = (data: Data, date: string) => ({ ...data, transactions: data.transactions.filter((row) => row.date <= date) });

// An old closing-balance correction carries forward into every later balance.
// Preview that effect and require today's independently verified balance before saving.
export function previewStatementAdjustment(data: Data, target: VerifiedAccountBalance, verified: readonly VerifiedAccountBalance[], currentDate = today()) {
  if (!data.accounts.includes(target.account) || !validDate(target.date) || !validDate(currentDate) || target.date > currentDate
    || !Number.isSafeInteger(target.balance) || target.balance < 0 || target.balance > 1e12) throw new Error("Check the statement account, closing date and balance.");
  const before = accountBalance(atDate(data, target.date), target.account);
  const difference = target.balance - before;
  const currentBefore = accountBalance(atDate(data, currentDate), target.account);
  const later = verified.filter((item) => item.account === target.account && item.date >= target.date && item.date <= currentDate);
  if (later.some((item) => !validDate(item.date) || !Number.isSafeInteger(item.balance) || item.balance < 0 || item.balance > 1e12)) throw new Error("Check the verified balances.");
  const checks = later.map((item) => {
    const recorded = accountBalance(atDate(data, item.date), target.account);
    return { ...item, before: recorded, after: recorded + difference, conflicts: recorded + difference !== item.balance };
  });
  const currentVerified = target.date === currentDate || checks.some((item) => item.date === currentDate);
  return { before, target: target.balance, difference, currentBefore, currentAfter: currentBefore + difference, checks,
    currentVerified, canApply: difference !== 0 && currentVerified && checks.every((item) => !item.conflicts) };
}

export function statementBalanceAdjustment(data: Data, target: VerifiedAccountBalance, verified: readonly VerifiedAccountBalance[], reason: string, currentDate = today()) {
  const preview = previewStatementAdjustment(data, target, verified, currentDate);
  if (!preview.canApply) throw new Error("Review the effect on current and later verified balances before adjusting this statement.");
  return balanceAdjustment(atDate(data, target.date), target.account, target.balance, target.date, reason);
}
