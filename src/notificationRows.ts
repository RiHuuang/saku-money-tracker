import type { Data } from "./domain";
import type { ImportRow } from "./importDraft";
import { suggestImportDecision } from "./importTransactions";
import { suggestMerchant } from "./merchants";
import type { InboxItem } from "./notificationCapture";

export const captureAppNames: Record<string, string> = {
  "com.bca": "BCA mobile", "com.bca.mybca.omni.android": "myBCA", "com.jago.digitalBanking": "Jago",
  "com.gojek.gopay": "GoPay", "com.gojek.app": "Gojek", "id.co.bankbkemobile.digitalbank": "SeaBank", "id.dana": "DANA",
};
const PAIR_WINDOW_MS = 30 * 60 * 1000;
const localDate = (ms: number) => { const date = new Date(ms); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const same = (a: string, b: string) => a.trim().toLocaleLowerCase("id-ID") === b.trim().toLocaleLowerCase("id-ID");

export type NotificationRow = ImportRow & { occurredAt: number; appName: string; balance: number | null; pairedWith?: string };

export function inboxRows(items: readonly InboxItem[], data: Data): NotificationRow[] {
  const accounts = [...data.accounts, ...data.creditCards.map((card) => card.name)];
  const rows = items.map((item): NotificationRow => {
    const appName = captureAppNames[item.packageName] || "Bank app";
    const account = accounts.find((name) => same(name, item.account)) || "";
    // Money sent to another tracked account (a wallet top-up) is a transfer, not spending.
    const counterparty = item.rawMerchant ? data.accounts.find((name) => name !== account && same(name, item.rawMerchant)) : undefined;
    const remembered = counterparty ? null : suggestMerchant(data, item.rawMerchant);
    const row = {
      id: item.id, sourceId: item.packageName, account, page: 0, date: localDate(item.occurredAt),
      name: item.rawMerchant || `${appName} ${item.direction === "income" ? "money in" : "payment"}`, cleanName: remembered?.name,
      amount: item.amount, direction: item.direction, activity: counterparty ? "topup" as const : item.direction === "income" ? "income" as const : "purchase" as const,
      pocketId: remembered?.pocketId || "", counterparty, occurredAt: item.occurredAt, appName, balance: item.balance,
    };
    return { ...row, decision: suggestImportDecision(row, row.date.slice(0, 7)) };
  });
  // The receiving notification of that top-up is the same money; the transfer records both sides.
  for (const row of rows) {
    if (row.activity !== "topup" || row.direction !== "expense") continue;
    const twin = rows.find((other) => !other.pairedWith && other.direction === "income" && other.account === row.counterparty && other.amount === row.amount && Math.abs(other.occurredAt - row.occurredAt) <= PAIR_WINDOW_MS);
    if (twin) { twin.pairedWith = row.id; twin.decision = "skip"; row.pairedWith = twin.id; }
  }
  return rows;
}
