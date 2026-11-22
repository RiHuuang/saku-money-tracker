import { lastPocketFor, type Data } from "./domain";
import type { ImportRow } from "./importDraft";
import { importRowAccount, importRowReady, importRowsNeedingDuplicateConfirmation, suggestImportDecision } from "./importTransactions";
import { merchantKey, suggestMerchant } from "./merchants";
import type { InboxItem } from "./notificationCapture";
import { t } from "./i18n";

export const captureAppNames: Record<string, string> = {
  "com.bca": "BCA mobile", "com.bca.mybca.omni.android": "myBCA", "com.jago.digitalBanking": "Jago",
  "com.gojek.gopay": "GoPay", "com.gojek.app": "Gojek", "id.co.bankbkemobile.digitalbank": "SeaBank", "id.dana": "DANA",
};
const PAIR_WINDOW_MS = 30 * 60 * 1000;
const localDate = (ms: number) => { const date = new Date(ms); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const same = (a: string, b: string) => a.trim().toLocaleLowerCase("id-ID") === b.trim().toLocaleLowerCase("id-ID");

export type NotificationRow = ImportRow & { occurredAt: number; appName: string; balance: number | null; pairedWith?: string };

export function notificationStatusTap(decision: ImportRow["decision"], ready: boolean): "review" | "ready" | "skip" {
  if (decision === "skip") return "ready";
  return ready ? "skip" : "review";
}

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
      // A payment the bank cancelled after its spend was added: adding this row records the money back.
      name: item.cancels ? t("cancelledPayment", { app: appName }) : item.rawMerchant || `${appName} ${item.direction === "income" ? "money in" : "payment"}`, cleanName: data.merchantRules.find((rule) => rule.key === merchantKey(item.rawMerchant))?.automaticName ? remembered?.name : undefined,
      amount: item.amount, direction: item.direction, activity: item.cancels ? "refund" as const : counterparty ? "topup" as const : item.direction === "income" ? "income" as const : "purchase" as const,
      pocketId: remembered?.pocketId || (counterparty || item.direction !== "expense" ? "" : lastPocketFor(data, item.rawMerchant) || ""), counterparty, occurredAt: item.occurredAt, appName, balance: item.balance,
    };
    return { ...row, decision: suggestImportDecision(row, row.date.slice(0, 7)) };
  });
  // The receiving notification of that top-up is the same money; the transfer records both sides.
  for (const row of rows) {
    if (row.activity !== "topup" || row.direction !== "expense") continue;
    const twin = rows.find((other) => !other.pairedWith && other.direction === "income" && other.account === row.counterparty && other.amount === row.amount && Math.abs(other.occurredAt - row.occurredAt) <= PAIR_WINDOW_MS);
    if (twin) { twin.pairedWith = row.id; twin.decision = "skip"; row.pairedWith = twin.id; }
  }
  // 4.2: captured income starts ready, unless it may be the user's own money moving or a reversal.
  for (const row of rows) if (incomeLooksSafe(row, rows, data)) row.decision = "ready";
  return rows;
}

const INCOME_READY_LIMIT = 10_000_000;
const minutesOf = (time?: string) => time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) : null;

// Guards from the master plan: under Rp 10.000.000; no opposite-direction row of the same amount within 30 minutes,
// in the inbox or the ledger; and the sender isn't the user's own name (a transfer between their own accounts).
export function incomeLooksSafe(row: NotificationRow, inbox: readonly NotificationRow[], data: Pick<Data, "transactions" | "name">): boolean {
  if (row.direction !== "income" || row.activity !== "income" || row.pairedWith || row.decision !== "later" || !row.account || row.amount >= INCOME_READY_LIMIT || !row.name.trim()) return false;
  const own = data.name.trim().toLocaleLowerCase("id-ID");
  if (own.length >= 3 && row.name.toLocaleLowerCase("id-ID").includes(own)) return false;
  if (inbox.some((other) => other.id !== row.id && other.direction === "expense" && other.amount === row.amount && Math.abs(other.occurredAt - row.occurredAt) <= PAIR_WINDOW_MS)) return false;
  const at = new Date(row.occurredAt), minute = at.getHours() * 60 + at.getMinutes();
  return !data.transactions.some((transaction) => {
    if (transaction.type !== "expense" || transaction.amount !== row.amount || transaction.date !== row.date) return false;
    const other = minutesOf(transaction.time);
    // A ledger row without a time could be any time that day, so it counts as close.
    return other === null || Math.abs(other - minute) <= 30;
  });
}

// What "Add N" would add, shared by the review screen and the Home card so both always agree.
export function inboxReadiness(rows: readonly NotificationRow[], data: Data) {
  const accountFor = (row: ImportRow) => importRowAccount(row, undefined, data);
  const twinFor = (row: NotificationRow) => rows.find((other) => other.id !== row.id && other.account === row.counterparty && other.direction !== row.direction && other.amount === row.amount && Math.abs(other.occurredAt - row.occurredAt) <= PAIR_WINDOW_MS);
  // Statement-style matching: same account, day, amount and direction counts as a possible duplicate whatever it was named.
  const duplicates = importRowsNeedingDuplicateConfirmation([...rows], data.transactions, accountFor, () => false, true);
  const ready = rows.filter((row) => importRowReady(row, accountFor(row), data) && (!duplicates.has(row.id) || row.confirmedSeparate) && !rows.some((other) => other.activity === "transfer" && other.id !== row.id && twinFor(other)?.id === row.id));
  // Not ready and not left out (auto-skipped transfer twins included): what "Add N" leaves for a look.
  const look = rows.filter((row) => !ready.includes(row) && row.decision !== "skip").length;
  return { ready, duplicates, twinFor, accountFor, look };
}
