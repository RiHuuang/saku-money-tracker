import { shiftMonth, today, validAmount, validDate, type Data, type Transaction } from "./domain";
import type { ImportDraft, ImportRow, ImportSource } from "./importDraft";
import { t } from "./i18n";

export function confirmedImportAccount(source: Pick<ImportSource, "account" | "accountConfirmed"> | undefined, data: Data): string {
  return source?.accountConfirmed && [...data.accounts, ...data.creditCards.map((card) => card.name)].includes(source.account) ? source.account : "";
}

export function importRowAccount(row: Pick<ImportRow, "account">, source: Pick<ImportSource, "account" | "accountConfirmed" | "mixedAccounts"> | undefined, data: Data): string {
  if (!row.account) return source?.mixedAccounts ? "" : confirmedImportAccount(source, data);
  return [...data.accounts, ...data.creditCards.map((card) => card.name)].includes(row.account) ? row.account : "";
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Names a source by its printed funding method, or by its file name when a row shows none.
export function detectImportAccount(rows: readonly Pick<ImportRow, "paymentMethod">[], source: Pick<ImportSource, "name" | "mixedAccounts">, data: Data): string {
  if (source.mixedAccounts || !rows.length) return "";
  const names = [...data.accounts, ...data.creditCards.map((card) => card.name)];
  const matches = (text: string) => names.filter((name) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(name.toLocaleLowerCase("id-ID"))}(?:$|[^\\p{L}\\p{N}])`, "u").test(text.toLocaleLowerCase("id-ID")));
  const found = new Set<string>();
  for (const row of rows) {
    const named = matches(row.paymentMethod?.trim() || source.name);
    if (named.length !== 1) return "";
    found.add(named[0]);
  }
  return found.size === 1 ? [...found][0] : "";
}
export const importRowName = (row: Pick<ImportRow, "name" | "cleanName">) => (row.cleanName?.trim() || row.name).trim();
// A card purchase is billed from the next month unless the user picks another one, as in the manual add form.
export const importRowFirstDueMonth = (row: Pick<ImportRow, "date" | "activity" | "firstDueMonth">) =>
  row.firstDueMonth || (row.activity === "purchase" && validDate(row.date) ? shiftMonth(row.date.slice(0, 7), 1) : "");

export const usesDeferredFunding = (row: Pick<ImportRow, "name" | "paymentMethod">) => /pay[\s-]?later/i.test(`${row.name} ${row.paymentMethod || ""}`);
const looksLikeTransfer = (name: string) => /\b(?:top[\s-]?up|isi saldo|pindah dana|move money|antar[\s-]?kantong|transfer|trsf|trf)\b/i.test(name);
const looksUnsettled = (name: string) => /\b(?:expired|kedaluwarsa|kadaluarsa|dibatalkan|cancelled|canceled|pending|tertunda|gagal)\b/i.test(name);
const namesOnlyWallet = (name: string) => /^(?:shopee\s*pay|gopay|ovo|dana|linkaja)(?:\s+(?:pembayaran|payment))?$/i.test(name.trim());

export function importPatchNeedsSourceRecheck(patch: Partial<ImportRow>): boolean {
  return ["date", "name", "cleanName", "amount", "direction", "activity", "paymentMethod"].some((field) => field in patch);
}

export function suggestImportDecision(row: Pick<ImportRow, "date" | "name" | "paymentMethod" | "amount" | "direction" | "activity">, month: string): ImportRow["decision"] {
  return validDate(row.date) && row.date.startsWith(month) && validAmount(row.amount) && row.name.trim() && !usesDeferredFunding(row) && !looksLikeTransfer(row.name) && !looksUnsettled(row.name) && !namesOnlyWallet(row.name) &&
    (row.direction !== "expense" || row.amount < 1_000_000) &&
    (["refund", "interest"].includes(row.activity) ? row.direction === "income" : row.direction === "expense" && ["purchase", "fee"].includes(row.activity))
    ? "ready" : "later";
}

export function applySharedSourceDate(rows: readonly ImportRow[], sourceId: string, date: string, month: string, wasSaved: (row: ImportRow) => boolean, currentDay = today()): ImportRow[] {
  if (!validDate(date) || date > currentDay) return [...rows];
  return rows.map((row) => {
    if (row.sourceId !== sourceId || row.date || row.decision === "skip" || wasSaved(row)) return row;
    const dated = { ...row, date, confirmedSeparate: false };
    return { ...dated, decision: suggestImportDecision(dated, month) };
  });
}

function duplicateKey(row: Pick<ImportRow, "date" | "name" | "amount" | "direction">, account: string): string {
  return JSON.stringify([account, row.date, row.amount, row.direction, row.name.toLocaleLowerCase("id-ID").replace(/[^a-z0-9]+/g, " ").trim()]);
}

function valueKey(row: Pick<ImportRow, "date" | "amount" | "direction">, account: string): string {
  return JSON.stringify([account, row.date, row.amount, row.direction]);
}

export function importRowsNeedingDuplicateConfirmation(rows: readonly ImportRow[], transactions: readonly Transaction[], accountFor: (row: ImportRow) => string, wasSaved: (row: ImportRow) => boolean, statementMode = false): Set<string> {
  const existing = new Set(transactions.map((transaction) => duplicateKey({ ...transaction, direction: transaction.type }, transaction.account)));
  const existingValues = statementMode ? new Set(transactions.map((transaction) => valueKey({ ...transaction, direction: transaction.type }, transaction.account))) : null;
  const counts = new Map<string, number>();
  const sources = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.decision === "skip") continue;
    const crossSourceKey = duplicateKey(row, "");
    const seenSources = sources.get(crossSourceKey) || new Set<string>();
    seenSources.add(row.sourceId);
    sources.set(crossSourceKey, seenSources);
    if (wasSaved(row)) continue;
    const key = duplicateKey(row, accountFor(row));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set(rows.filter((row) => {
    if (row.decision === "skip" || wasSaved(row)) return false;
    const key = duplicateKey(row, accountFor(row));
    // Saved imports carry the cleaned name, so the ledger is checked under both spellings.
    return existing.has(key) || existing.has(duplicateKey({ ...row, name: importRowName(row) }, accountFor(row))) || !!existingValues?.has(valueKey(row, accountFor(row))) || (counts.get(key) || 0) > 1 || (sources.get(duplicateKey(row, ""))?.size || 0) > 1;
  }).map((row) => row.id));
}

export function importMatchesNeedSourceDateCheck(draft: ImportDraft | null, matches: readonly { id: string }[]): boolean {
  return matches.some((match) => {
    const sourceId = draft?.rows.find((row) => row.id === match.id)?.sourceId;
    return !sourceId || !draft?.sources.find((source) => source.id === sourceId)?.datesChecked;
  });
}

export function importRowReviewIssue(row: ImportRow, account: string, data: Data, duplicate: boolean, currentDay = today()): string {
  if (row.check === "amount") return t("reviewBcaAmount");
  if (row.check) return t("reviewBcaRecheck");
  if (row.activity === "pending") return t("reviewPending");
  if (row.activity === "failed") return t("reviewFailed");
  if (row.activity === "reward") return t("reviewReward");
  if (row.activity === "pay_later") {
    if (!data.creditCards.some((card) => card.name === account)) return t("reviewPayLaterAccount");
    if (!row.firstDueMonth || !validDate(`${row.firstDueMonth}-01`) || validDate(row.date) && row.firstDueMonth < row.date.slice(0, 7)) return t("reviewPayLaterMonth");
  }
  if (!account) return t("reviewAccount");
  if (!validDate(row.date)) return t("reviewDate");
  if (row.date > currentDay) return t("reviewFuture");
  if (!validAmount(row.amount)) return t("reviewAmount");
  if (!row.name.trim()) return t("reviewDescription");
  if (row.direction === "unknown") return t("reviewDirection");
  if (["refund", "income", "interest"].includes(row.activity) && row.direction !== "income") return t("reviewIncomeDirection");
  if (["purchase", "fee", "card_payment", "pay_later"].includes(row.activity) && row.direction !== "expense") return t("reviewExpenseDirection");
  if (row.activity === "unknown") return t("reviewActivity");
  if (["transfer", "topup"].includes(row.activity) && !row.counterparty) return t("reviewOtherAccount");
  if (row.activity === "card_payment" && !row.cardId) return t("reviewPaidCard");
  if (data.creditCards.some((card) => card.name === account) && row.activity === "purchase" && !importRowFirstDueMonth(row)) return t("reviewFirstDue");
  if (duplicate && !row.confirmedSeparate) return t("reviewSeparate");
  if (row.activity === "income") return t("reviewExternalIncome");
  if (namesOnlyWallet(row.name)) return t("reviewWallet");
  if (row.direction === "expense" && row.amount >= 1_000_000) return t("reviewLargeAmount");
  return t("reviewDefault");
}

export function importRowAlreadySaved(row: ImportRow, draft: ImportDraft | null, data: Data): boolean {
  if (data.transactions.some((transaction) => transaction.id === row.id || transaction.transferId === row.id)) return true;
  return !!draft?.saved.some((item) => item.pairedRowId === row.id && data.transactions.some((transaction) => transaction.id === item.id));
}

export function importRowsWaiting(drafts: readonly ImportDraft[], data: Data): number {
  return drafts.reduce((total, draft) => total + draft.rows.filter((row) => row.decision !== "skip" && !importRowAlreadySaved(row, draft, data)).length, 0);
}

export function importRowReady(row: ImportRow, account: string, data: Data, currentDay = today()): boolean {
  if (row.decision !== "ready" || !validDate(row.date) || row.date > currentDay || !validAmount(row.amount) || !row.name.trim() || row.direction === "unknown") return false;
  if (["pending", "failed", "reward", "unknown"].includes(row.activity)) return false;
  if (["transfer", "topup"].includes(row.activity)) return data.accounts.includes(account) && !!row.counterparty && row.counterparty !== account && data.accounts.includes(row.counterparty);
  if (row.activity === "card_payment") return row.direction === "expense" && data.accounts.includes(account) && !!data.creditCards.find((card) => card.id === row.cardId);
  if (!["purchase", "fee", "refund", "income", "interest", "pay_later"].includes(row.activity)) return false;
  if (["refund", "income", "interest"].includes(row.activity) ? row.direction !== "income" : row.direction !== "expense") return false;
  const card = data.creditCards.find((item) => item.name === account);
  if (row.activity === "pay_later" && !card) return false;
  if (usesDeferredFunding(row) && !card) return false;
  if (card) {
    const due = importRowFirstDueMonth(row);
    return row.direction === "expense" && ["purchase", "pay_later"].includes(row.activity) && !!due && validDate(`${due}-01`) && due >= row.date.slice(0, 7);
  }
  if (!data.accounts.includes(account)) return false;
  return row.direction === "income" || !row.pocketId || data.pockets.some((pocket) => pocket.id === row.pocketId && pocket.createdMonth <= row.date.slice(0, 7));
}

export function importedTransactions(row: ImportRow, account: string, sourceName: string, data: Data, pairedRowId?: string): Transaction[] {
  if (!importRowReady(row, account, data)) throw new Error("Review this row before saving");
  const name = importRowName(row);
  const note = `${row.note ? `${row.note} · ` : ""}${name !== row.name.trim() ? `${row.name.trim()} · ` : ""}Imported from ${/\.pdf$/i.test(sourceName) ? "PDF statement" : "screenshot"}, page ${row.page}`;
  if (row.activity === "transfer" || row.activity === "topup") {
    const from = row.direction === "expense" ? account : row.counterparty!;
    const to = row.direction === "expense" ? row.counterparty! : account;
    const oppositeId = pairedRowId && pairedRowId !== row.id ? pairedRowId : `${row.id}:pair`;
    const bothSidesShown = !!pairedRowId && pairedRowId !== row.id;
    const outgoing: Transaction = { id: row.direction === "expense" ? row.id : oppositeId, transferId: row.id, kind: "account_transfer", name: `Transfer to ${to}`.slice(0, 100), amount: row.amount, type: "expense", date: row.date, pocketId: "", account: from, note, verified: row.direction === "expense" || bothSidesShown };
    const incoming: Transaction = { id: row.direction === "income" ? row.id : oppositeId, transferId: row.id, kind: "account_transfer", name: `Transfer from ${from}`.slice(0, 100), amount: row.amount, type: "income", date: row.date, pocketId: "", account: to, note, verified: row.direction === "income" || bothSidesShown };
    return [outgoing, incoming];
  }
  const card = data.creditCards.find((item) => item.name === account);
  const base: Transaction = { id: row.id, name, amount: row.amount, type: row.direction as "expense" | "income", date: row.date, account, pocketId: row.direction === "income" ? "" : row.pocketId, note, verified: true };
  if (card) return [{ ...base, kind: "card_purchase", cardId: card.id, installments: 1, firstDueMonth: importRowFirstDueMonth(row) }];
  if (row.activity === "card_payment") return [{ ...base, kind: "card_payment", cardId: row.cardId, pocketId: "" }];
  return [base];
}

const walletPatterns: Record<string, RegExp> = {
  flazz: /flazz|e-?money|kartu elektronik|uang elektronik/i,
  dana: /\bdana\b/i, gopay: /\bgo-?pay\b/i, ovo: /\bovo\b/i, shopeepay: /shopee\s?pay/i,
};
export const bcaAccount = (data: Data) => {
  const matches = data.accounts.filter((name) => /\bbca\b/i.test(name));
  return matches.length === 1 ? matches[0] : "";
};

// BCA rows (2.4.0): fill in what the reading already implies, and skip rows the ledger already has.
export function prepareBcaRow(row: ImportRow, data: Data, account: string): ImportRow {
  let next = { ...row };
  if (next.activity === "topup") {
    const pattern = walletPatterns[(next.paymentMethod || "").toLocaleLowerCase("id-ID").replace(/\s/g, "")];
    const wallets = pattern ? data.accounts.filter((name) => name !== account && pattern.test(name)) : [];
    next = wallets.length === 1 ? { ...next, counterparty: wallets[0] } : { ...next, activity: "purchase" };
  }
  if (next.activity === "card_payment") {
    const cards = data.creditCards.filter((card) => /\bbca\b/i.test(card.name));
    const card = cards.length === 1 ? cards[0] : data.creditCards.length === 1 ? data.creditCards[0] : undefined;
    if (card) next = { ...next, cardId: card.id };
  }
  const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  const recorded = validDate(next.date) && data.transactions.some((transaction) => transaction.account === account && transaction.amount === next.amount &&
    transaction.type === next.direction && Math.abs(day(transaction.date) - day(next.date)) <= 1);
  if (recorded) return { ...next, alreadyInSaku: true, decision: "skip" };
  const confident = !next.check && validDate(next.date) && validAmount(next.amount) && next.direction !== "unknown" && next.activity !== "unknown";
  // Money from someone else always gets a look; spending, card payments and own top-ups can go straight in.
  const ready = confident && next.direction === "expense" && (next.activity !== "purchase" || next.amount < 1_000_000);
  return { ...next, decision: ready ? "ready" : "later" };
}

// Overlapping screenshots repeat rows; a row another source in the draft already has is left out.
const overlapKey = (row: Pick<ImportRow, "date" | "amount" | "direction" | "name">) =>
  [row.date, row.amount, row.direction, row.name.toLocaleLowerCase("id-ID").replace(/[^a-z0-9]+/g, " ").trim()].join("|");
export function withoutOverlap<T extends Pick<ImportRow, "date" | "amount" | "direction" | "name">>(rows: readonly T[], otherSources: readonly ImportRow[]): { rows: T[]; dropped: number } {
  const seen = new Set(otherSources.map(overlapKey));
  const kept = rows.filter((row) => !seen.has(overlapKey(row)));
  return { rows: kept, dropped: rows.length - kept.length };
}
