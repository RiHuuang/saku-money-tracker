import Papa from "papaparse";
import { isSpending, personalAmount, type Pocket, type Transaction } from "./domain";

// CSV reading and export live apart from domain.ts so papaparse loads only when a CSV is used (master plan 4.5).
export function readCSV(text: string) {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().replace(/^\uFEFF/, ""),
  });
  if (result.errors.length)
    throw new Error(`CSV could not be read: ${result.errors[0].message}`);
  const headers = result.meta.fields || [];
  if (!headers.length || !result.data.length)
    throw new Error("This file has no transaction rows.");
  if (result.data.length > 10000)
    throw new Error("Use statements with fewer than 10,000 rows.");
  const find = (names: string[]) =>
    headers.find((h) => names.includes(h.toLowerCase())) || "";
  return {
    headers,
    raw: result.data,
    mapping: {
      date: find(["date", "tanggal", "transaction date"]),
      name: find(["description", "keterangan", "name", "uraian", "merchant"]),
      amount: find(["amount", "jumlah", "nominal"]),
      type: find(["type", "tipe", "jenis", "debit/credit", "db/cr"]),
      debit: find(["debit", "debet", "withdrawal"]),
      credit: find(["credit", "kredit", "deposit"]),
    },
  };
}
export function exportCSV(transactions: Transaction[], pockets: Pocket[]) {
  return Papa.unparse(
    transactions.map((t) => ({
      date: t.date,
      description: t.name,
      amount: t.amount,
      type: t.type,
      account: t.account,
      pocket: pockets.find((p) => p.id === t.pocketId)?.name || "",
      note: t.note,
      id: t.id,
      kind: t.kind || (t.type === "income" ? "income" : "expense"),
      personalAmount: isSpending(t) ? personalAmount(t) : "",
      cardId: t.cardId || "",
      installments: t.installments || "",
      firstDueMonth: t.firstDueMonth || "",
      recurringRuleId: t.recurringRuleId || "",
      occurrenceMonth: t.occurrenceMonth || "",
      splitPeople: t.split?.people || "",
      splitOwnAmount: t.split?.ownAmount || "",
      forTransactionId: t.forTransactionId || "",
      transferId: t.transferId || "",
      statementChecked: !!t.verified,
    })),
    { escapeFormulae: true },
  );
}
