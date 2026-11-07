import type { ImportRow, StatementSummary } from "./importDraft";

// Summaries validate observations. They never produce ledger entries or balances.
export function compareStatementSummary(summary: StatementSummary, rows: readonly ImportRow[]) {
  const seen = new Set<string>();
  let incoming = 0, outgoing = 0;
  for (const row of rows) {
    if (row.date < summary.from || row.date > summary.to || row.currency && row.currency !== "IDR" || ["pending", "failed", "reward", "unknown"].includes(row.activity)) continue;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (row.direction === "income") incoming += row.amount;
    if (row.direction === "expense") outgoing += row.amount;
  }
  return { incoming, outgoing, matches: incoming === summary.incoming && outgoing === summary.outgoing };
}
