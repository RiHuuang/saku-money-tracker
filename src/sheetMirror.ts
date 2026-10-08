import type { Data } from "./domain";

const cell = (value: unknown): string => {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};
const table = (headers: string[], rows: unknown[][]) => [headers, ...rows.map((row) => row.map(cell))];

export function sheetTables(data: Data) {
  return {
    Transactions: table(
      ["id", "date", "description", "direction", "amount_idr", "account", "pocket_id", "note", "verified", "kind", "card_id", "installments", "first_due_month", "recurring_rule_id", "occurrence_month", "split", "for_transaction_id", "transfer_id"],
      data.transactions.map((t) => [t.id, t.date, t.name, t.type, t.amount, t.account, t.pocketId, t.note, t.verified ?? false, t.kind, t.cardId, t.installments, t.firstDueMonth, t.recurringRuleId, t.occurrenceMonth, t.split, t.forTransactionId, t.transferId]),
    ),
    Pockets: table(["id", "name", "color", "icon", "default_budget_idr", "monthly_budgets", "created_month"], data.pockets.map((p) => [p.id, p.name, p.color, p.icon, p.budget, p.budgets, p.createdMonth])),
    Accounts: table(["name"], data.accounts.map((name) => [name])),
    Cards: table(["id", "name", "limit_idr", "opening_debt_idr", "due_day"], data.creditCards.map((c) => [c.id, c.name, c.limit, c.openingDebt, c.dueDay])),
    Recurring: table(["id", "name", "direction", "amount_idr", "pocket_id", "account", "card_id", "installments", "skipped_months", "day", "start_month", "active"], data.recurring.map((r) => [r.id, r.name, r.type, r.amount, r.pocketId, r.account, r.cardId, r.installments, r.skippedMonths, r.day, r.startMonth, r.active])),
    Quick_entries: table(["id", "name", "direction", "amount_idr", "pocket_id", "account", "card_id"], data.favorites.map((f) => [f.id, f.name, f.type, f.amount, f.pocketId, f.account, f.cardId])),
    Pocket_transfers: table(["id", "month", "from_pocket_id", "to_pocket_id", "amount_idr"], data.pocketTransfers.map((m) => [m.id, m.month, m.fromPocketId, m.toPocketId, m.amount])),
    Existing_installments: table(["id", "card_id", "description", "monthly_amount_idr", "next_due_month", "payments_left"], data.existingInstallments.map((i) => [i.id, i.cardId, i.name, i.monthlyAmount, i.nextDueMonth, i.paymentsLeft])),
  };
}

// A mirror update only touches cells that Saku wrote in the previous or current
// ledger. The caller must compare `before` with the live range before writing
// `after`; a different value is a Sheet conflict, not a reason to overwrite it.
export function sheetChanges(previous: Data | null, current: Data) {
  const oldTables = previous ? sheetTables(previous) : {} as ReturnType<typeof sheetTables>;
  const newTables = sheetTables(current);
  const changes: { range: string; before: string[][]; after: string[][] }[] = [];
  const encoder = new TextEncoder();
  for (const [name, afterRows] of Object.entries(newTables)) {
    const beforeRows = oldTables[name as keyof typeof oldTables] || [];
    const width = afterRows[0].length;
    const endColumn = String.fromCharCode(64 + width);
    let start = 1, bytes = 0, before: string[][] = [], after: string[][] = [];
    const flush = () => {
      if (!after.length) return;
      changes.push({ range: `'${name}'!A${start}:${endColumn}${start + after.length - 1}`, before, after });
      start += after.length;
      before = []; after = []; bytes = 0;
    };
    for (let index = 0; index < Math.max(beforeRows.length, afterRows.length); index++) {
      const oldRow = Array.from({ length: width }, (_, column) => beforeRows[index]?.[column] || "");
      const newRow = Array.from({ length: width }, (_, column) => afterRows[index]?.[column] || "");
      if (JSON.stringify(oldRow) === JSON.stringify(newRow)) { flush(); start++; continue; }
      const size = encoder.encode(JSON.stringify({ before: oldRow, after: newRow })).byteLength;
      if (size > 110_000) throw new Error(`A ${name} row is too large for Google Sheets`);
      if (after.length >= 64 || bytes + size > 110_000) flush();
      before.push(oldRow); after.push(newRow);
      bytes += size;
    }
    flush();
  }
  return changes;
}

export function sheetGridRows(previous: Data | null, current: Data) {
  const before = previous ? sheetTables(previous) : {} as ReturnType<typeof sheetTables>;
  const after = sheetTables(current);
  return Object.fromEntries(Object.entries(after).map(([name, rows]) => [name, Math.max(rows.length, before[name as keyof typeof before]?.length || 0)]));
}
