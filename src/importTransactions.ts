import { today, validAmount, validDate, type Data, type Transaction } from "./domain";
import type { ImportDraft, ImportRow, ImportSource } from "./importDraft";

export function confirmedImportAccount(source: Pick<ImportSource, "account" | "accountConfirmed"> | undefined, data: Data): string {
  return source?.accountConfirmed && [...data.accounts, ...data.creditCards.map((card) => card.name)].includes(source.account) ? source.account : "";
}

export function importRowAccount(row: Pick<ImportRow, "account">, source: Pick<ImportSource, "account" | "accountConfirmed" | "mixedAccounts"> | undefined, data: Data): string {
  if (!row.account) return source?.mixedAccounts ? "" : confirmedImportAccount(source, data);
  return [...data.accounts, ...data.creditCards.map((card) => card.name)].includes(row.account) ? row.account : "";
}

export const usesDeferredFunding = (row: Pick<ImportRow, "name" | "paymentMethod">) => /pay[\s-]?later/i.test(`${row.name} ${row.paymentMethod || ""}`);
const looksLikeTransfer = (name: string) => /\b(?:top[\s-]?up|isi saldo|pindah dana|move money|antar[\s-]?kantong|transfer|trsf|trf)\b/i.test(name);
const looksUnsettled = (name: string) => /\b(?:expired|kedaluwarsa|kadaluarsa|dibatalkan|cancelled|canceled|pending|tertunda|gagal)\b/i.test(name);

export function suggestImportDecision(row: Pick<ImportRow, "date" | "name" | "paymentMethod" | "amount" | "direction" | "activity">, month: string): ImportRow["decision"] {
  return validDate(row.date) && row.date.startsWith(month) && validAmount(row.amount) && row.name.trim() && !usesDeferredFunding(row) && !looksLikeTransfer(row.name) && !looksUnsettled(row.name) &&
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

export function importRowAlreadySaved(row: ImportRow, draft: ImportDraft | null, data: Data): boolean {
  if (data.transactions.some((transaction) => transaction.id === row.id || transaction.transferId === row.id)) return true;
  return !!draft?.saved.some((item) => item.pairedRowId === row.id && data.transactions.some((transaction) => transaction.id === item.id));
}

export function importRowReady(row: ImportRow, account: string, data: Data, currentDay = today()): boolean {
  if (row.decision !== "ready" || !validDate(row.date) || row.date > currentDay || !validAmount(row.amount) || !row.name.trim() || row.direction === "unknown") return false;
  if (["pending", "failed", "reward", "pay_later", "unknown"].includes(row.activity)) return false;
  if (["transfer", "topup"].includes(row.activity)) return data.accounts.includes(account) && !!row.counterparty && row.counterparty !== account && data.accounts.includes(row.counterparty);
  if (row.activity === "card_payment") return row.direction === "expense" && data.accounts.includes(account) && !!data.creditCards.find((card) => card.id === row.cardId);
  if (!["purchase", "fee", "refund", "income", "interest"].includes(row.activity)) return false;
  if (["refund", "income", "interest"].includes(row.activity) ? row.direction !== "income" : row.direction !== "expense") return false;
  const card = data.creditCards.find((item) => item.name === account);
  if (usesDeferredFunding(row) && !card) return false;
  if (card) return row.direction === "expense" && row.activity === "purchase" && !!row.firstDueMonth && validDate(`${row.firstDueMonth}-01`) && row.firstDueMonth >= row.date.slice(0, 7);
  if (!data.accounts.includes(account)) return false;
  return row.direction === "income" || !row.pocketId || data.pockets.some((pocket) => pocket.id === row.pocketId && pocket.createdMonth <= row.date.slice(0, 7));
}

export function importedTransactions(row: ImportRow, account: string, sourceName: string, data: Data, pairedRowId?: string): Transaction[] {
  if (!importRowReady(row, account, data)) throw new Error("Review this row before saving");
  const note = `Imported from ${/\.pdf$/i.test(sourceName) ? "PDF statement" : "screenshot"}, page ${row.page}`;
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
  const base: Transaction = { id: row.id, name: row.name.trim(), amount: row.amount, type: row.direction as "expense" | "income", date: row.date, account, pocketId: row.direction === "income" ? "" : row.pocketId, note, verified: true };
  if (card) return [{ ...base, kind: "card_purchase", cardId: card.id, installments: 1, firstDueMonth: row.firstDueMonth }];
  if (row.activity === "card_payment") return [{ ...base, kind: "card_payment", cardId: row.cardId, pocketId: "" }];
  return [base];
}
