import { Preferences } from "@capacitor/preferences";
import { accountBalance, balanceAdjustment, money, type Data, type Transaction } from "./domain";

export type BalanceCheckin = { id: string; account: string; appName: string; reported: number; occurredAt: number };

// Device-local: a check-in is a prompt for this phone, not ledger data.
const key = "saku-balance-checkins-v1";
const TOLERANCE = 1000;
const localDate = (ms: number) => { const date = new Date(ms); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
// The reported balance already includes that day's payment, so compare with the ledger as of that day.
const asOf = (data: Data, checkin: BalanceCheckin) => ({ ...data, transactions: data.transactions.filter((transaction) => transaction.date <= localDate(checkin.occurredAt)) });

export function checkinGap(data: Data, checkin: BalanceCheckin) {
  const saku = accountBalance(asOf(data, checkin), checkin.account);
  return { saku, difference: checkin.reported - saku, worthAsking: data.accounts.includes(checkin.account) && Math.abs(checkin.reported - saku) > TOLERANCE };
}
export function checkinAdjustment(data: Data, checkin: BalanceCheckin): Transaction {
  return balanceAdjustment(asOf(data, checkin), checkin.account, checkin.reported, localDate(checkin.occurredAt), `${checkin.appName} notification showed ${money(checkin.reported)}`);
}
export function mergeCheckins(current: readonly BalanceCheckin[], added: readonly BalanceCheckin[]) {
  // Only the newest balance per account matters; an older one would just be corrected again.
  const latest = new Map<string, BalanceCheckin>();
  for (const checkin of [...current, ...added]) if ((latest.get(checkin.account)?.occurredAt ?? -1) < checkin.occurredAt) latest.set(checkin.account, checkin);
  return [...latest.values()].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, 20);
}
export async function loadCheckins(): Promise<BalanceCheckin[]> {
  try { const value = JSON.parse((await Preferences.get({ key })).value || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
export const saveCheckins = (checkins: readonly BalanceCheckin[]) => checkins.length ? Preferences.set({ key, value: JSON.stringify(checkins) }) : Preferences.remove({ key });
