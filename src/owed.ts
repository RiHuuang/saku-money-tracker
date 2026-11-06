import type { Data, Transaction } from "./domain";

export type OwedEntry = { source: Transaction; person: string; direction: "they_owe_me" | "i_owe_them"; original: number; repaid: number; remaining: number };

export function owedEntries(data: Data): OwedEntry[] {
  const entries: OwedEntry[] = [];
  const repayments = new Map<string, Map<string, number>>();
  for (const row of data.transactions) {
    if (row.kind !== "reimbursement" || !row.forTransactionId) continue;
    const byPerson = repayments.get(row.forTransactionId) || new Map<string, number>();
    const person = row.person || "";
    byPerson.set(person, (byPerson.get(person) || 0) + row.amount);
    repayments.set(row.forTransactionId, byPerson);
  }
  for (const source of data.transactions) {
    const shares = source.split ? source.split.shares || [{ person: "", amount: source.amount - source.split.ownAmount }]
      : source.kind === "loan_given" || source.kind === "loan_received" ? [{ person: source.person || "", amount: source.amount }] : [];
    for (const share of shares) {
      const byPerson = repayments.get(source.id);
      const repaid = source.split && !source.split.shares ? [...(byPerson?.values() || [])].reduce((sum, amount) => sum + amount, 0) : byPerson?.get(share.person) || 0;
      const remaining = Math.max(0, share.amount - repaid);
      if (remaining > 0) entries.push({ source, person: share.person, direction: source.kind === "loan_received" ? "i_owe_them" : "they_owe_me", original: share.amount, repaid, remaining });
    }
  }
  return entries;
}

export function owedByPerson(data: Data) {
  const groups = new Map<string, { person: string; net: number; entries: OwedEntry[] }>();
  for (const entry of owedEntries(data)) {
    const key = entry.person.toLocaleLowerCase("id-ID");
    const group = groups.get(key) || { person: entry.person, net: 0, entries: [] };
    group.net += entry.direction === "they_owe_me" ? entry.remaining : -entry.remaining;
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.person.localeCompare(b.person));
}
