import { today, validAmount, validDate, type Data, type Transaction } from "./domain";
import type { ImportDraft, ImportRow, ImportSource } from "./importDraft";

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
  if (row.activity === "pending") return "Payment appears pending. Recheck it when your account shows a final result.";
  if (row.activity === "failed") return "Payment appears failed or expired. Check before recording a charge.";
  if (row.activity === "reward") return "Points or rewards are not a rupiah transaction.";
  if (row.activity === "pay_later") {
    if (!data.creditCards.some((card) => card.name === account)) return "Choose the PayLater or credit account that funded this purchase. Add it in Cards first if needed.";
    if (!row.firstDueMonth || !validDate(`${row.firstDueMonth}-01`) || validDate(row.date) && row.firstDueMonth < row.date.slice(0, 7)) return "Choose a valid first due month for this PayLater purchase.";
  }
  if (!account) return "Choose the Saku account used for this transaction.";
  if (!validDate(row.date)) return "Check the transaction date.";
  if (row.date > currentDay) return "This date is in the future. Check the source.";
  if (!validAmount(row.amount)) return "Enter a valid whole-rupiah amount.";
  if (!row.name.trim()) return "Add a description.";
  if (row.direction === "unknown") return "Choose whether money came in or went out.";
  if (["refund", "income", "interest"].includes(row.activity) && row.direction !== "income") return "This row is marked Money out, but its activity is money received. Check the source and correct whichever field is wrong.";
  if (["purchase", "fee", "card_payment", "pay_later"].includes(row.activity) && row.direction !== "expense") return "This row is marked Money in, but its activity is a payment. Check the source and correct whichever field is wrong.";
  if (row.activity === "unknown") return "Choose what happened before adding this row.";
  if (["transfer", "topup"].includes(row.activity) && !row.counterparty) return "Choose the other Saku account for this transfer.";
  if (row.activity === "card_payment" && !row.cardId) return "Choose the credit card that was paid.";
  if (data.creditCards.some((card) => card.name === account) && row.activity === "purchase" && !row.firstDueMonth) return "Choose the first due month for this card purchase.";
  if (duplicate && !row.confirmedSeparate) return "Confirm that this really is a separate transaction.";
  if (row.activity === "income") return "Confirm this came from someone else, not another account of yours.";
  if (namesOnlyWallet(row.name)) return "Check whether this wallet payment was spending or a transfer to your own wallet.";
  if (row.direction === "expense" && row.amount >= 1_000_000) return "Check this large amount and whether it was a purchase or a transfer.";
  return "Review the details and choose Add to Saku when you are sure.";
}

export function importRowAlreadySaved(row: ImportRow, draft: ImportDraft | null, data: Data): boolean {
  if (data.transactions.some((transaction) => transaction.id === row.id || transaction.transferId === row.id)) return true;
  return !!draft?.saved.some((item) => item.pairedRowId === row.id && data.transactions.some((transaction) => transaction.id === item.id));
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
  if (card) return row.direction === "expense" && ["purchase", "pay_later"].includes(row.activity) && !!row.firstDueMonth && validDate(`${row.firstDueMonth}-01`) && row.firstDueMonth >= row.date.slice(0, 7);
  if (!data.accounts.includes(account)) return false;
  return row.direction === "income" || !row.pocketId || data.pockets.some((pocket) => pocket.id === row.pocketId && pocket.createdMonth <= row.date.slice(0, 7));
}

export function importedTransactions(row: ImportRow, account: string, sourceName: string, data: Data, pairedRowId?: string): Transaction[] {
  if (!importRowReady(row, account, data)) throw new Error("Review this row before saving");
  const name = importRowName(row);
  const note = `${name !== row.name.trim() ? `${row.name.trim()} · ` : ""}Imported from ${/\.pdf$/i.test(sourceName) ? "PDF statement" : "screenshot"}, page ${row.page}`;
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
  if (card) return [{ ...base, kind: "card_purchase", cardId: card.id, installments: 1, firstDueMonth: row.firstDueMonth }];
  if (row.activity === "card_payment") return [{ ...base, kind: "card_payment", cardId: row.cardId, pocketId: "" }];
  return [base];
}
