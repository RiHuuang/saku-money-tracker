import { shiftMonth, summary, type Data } from "./domain";

// Rules-first pocket planning, on the phone, instantly and offline (the AI may refine it later, inside limits).
// Order of evidence: money already committed comes off first, then what the person really spends (70% weight once
// there are two months of history), and only then a needs / wants / savings template.

export type PocketGroup = "needs" | "wants" | "savings" | "debt" | "giving";
export type PlanReason = { kind: "spend" | "fixed" | "template" | "savings" | "user" | "ai"; amount?: number; text?: string };
export type PlanRow = { key: string; pocketId?: string; name: string; icon: string; group: PocketGroup; amount: number; spend: number; fixed: number; reason: PlanReason; userSet?: boolean };

const KEYWORDS: [PocketGroup, RegExp][] = [
  ["savings", /tabung|saving|darurat|emergency|invest|reksa|saham|deposito|dana\s*pensiun|pension|nabung|goal|impian|liburan|vacation|travel|nikah|wedding/i],
  ["debt", /cicil|installment|kredit|credit|utang|hutang|debt|loan|pinjam|paylater|kpr|leasing/i],
  ["giving", /zakat|sedekah|infa[qk]|donasi|donat|charity|perpuluhan|persembahan|gereja|church|orang\s*tua|ortu|parents|mama|papa|ibu|bapak|keluarga|family|arisan|kado|gift/i],
  ["needs", /makan|food|groceri|belanja\s*dapur|sayur|pasar|kos|kost|sewa|rent|rumah|home|listrik|electric|pln|air|water|pdam|gas|transport|bensin|fuel|ojek|grab|gojek|commute|pulsa|data|internet|wifi|phone|tagihan|bills?|kesehatan|health|obat|medic|bpjs|asuransi|insurance|sekolah|school|pendidikan|education|anak|child|laundry|kebutuhan|utilities/i],
  ["wants", /nongkrong|hangout|hiburan|fun|entertain|jajan|snack|kopi|coffee|game|hobi|hobby|belanja|shopping|fashion|baju|skincare|beauty|langganan|subscription|netflix|spotify|nonton|movie|makan\s*di\s*luar|dining|self\s*care|olahraga|gym|sport/i],
];
export function classifyPocket(name: string): PocketGroup {
  return KEYWORDS.find(([, pattern]) => pattern.test(name))?.[0] || "wants";
}

// Savings first ("pay yourself first"); income that moves around keeps more aside for the thin months.
const SAVINGS_SHARE = { fixed: 0.2, variable: 0.25 } as const;
// The rest is split by how much such a pocket usually needs, so one fun pocket never outweighs food and rent.
const WEIGHTS: [number, RegExp][] = [
  [3.5, /kos|kost|sewa|rent|rumah|home|kpr/i], [3, /makan|food|groceri|dapur|sayur|pasar/i], [2, /cicil|installment|kredit|loan|pinjam|utang|hutang/i],
  [1.5, /transport|bensin|fuel|ojek|commute|tagihan|bills?|listrik|internet|wifi|sekolah|school|pendidikan|education|anak|child/i],
  [1.2, /orang\s*tua|ortu|parents|keluarga|family|kesehatan|health|asuransi|bpjs/i], [0.6, /kopi|coffee|jajan|snack|langganan|subscription|netflix|spotify/i],
];
const weightOf = (name: string, group: PocketGroup) => WEIGHTS.find(([, pattern]) => pattern.test(name))?.[0] ?? (group === "needs" ? 1.5 : 1);
export const planStep = (income: number) => income >= 3_000_000 ? 50_000 : 10_000;

/** Average monthly spending per pocket over the three months before `month`, and how many of them had any. */
export function recentSpending(data: Data, month: string) {
  const months = [1, 2, 3].map((back) => shiftMonth(month, -back));
  const perMonth = months.map((m) => summary(data, m));
  const active = perMonth.filter((value) => value.expenses > 0).length;
  const spend = new Map<string, number>();
  for (const pocket of data.pockets) {
    const totals = perMonth.flatMap((value) => value.pockets.filter((item) => item.id === pocket.id).map((item) => item.spent));
    const counted = perMonth.filter((value, index) => value.expenses > 0 && months[index] >= pocket.createdMonth).length;
    spend.set(pocket.id, counted ? Math.round(totals.reduce((sum, value) => sum + value, 0) / counted) : 0);
  }
  return { spend, months: active };
}

/** Money already promised every month that no pocket holds: card instalments and recurring bills without a pocket. */
const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
export function unpocketedCommitments(data: Data, month = new Date().toISOString().slice(0, 7)) {
  // An instalment counts only while it is running: from its next due month, for the payments it has left.
  return data.existingInstallments.reduce((sum, item) => {
    const index = monthIndex(month) - monthIndex(item.nextDueMonth);
    return sum + (index >= 0 && index < item.paymentsLeft ? item.monthlyAmount : 0);
  }, 0)
    + data.recurring.filter((rule) => rule.active && rule.type === "expense" && !rule.pocketId).reduce((sum, rule) => sum + rule.amount, 0);
}

export function baselinePlan(income: number, kind: "fixed" | "variable", pockets: { key: string; pocketId?: string; name: string; icon: string }[], data: Data, month: string): PlanRow[] {
  const available = Math.max(0, income - unpocketedCommitments(data, month));
  const history = recentSpending(data, month);
  const rows: PlanRow[] = pockets.map((pocket) => {
    const fixed = pocket.pocketId ? data.recurring.filter((rule) => rule.active && rule.type === "expense" && rule.pocketId === pocket.pocketId).reduce((sum, rule) => sum + rule.amount, 0) : 0;
    return { ...pocket, group: classifyPocket(pocket.name), amount: 0, spend: pocket.pocketId ? history.spend.get(pocket.pocketId) || 0 : 0, fixed, reason: { kind: "template" } };
  });
  if (!rows.length || !available) return rows;
  const savers = rows.filter((row) => row.group === "savings");
  const savingsPool = available * SAVINGS_SHARE[kind];
  const spenders = rows.filter((row) => row.group !== "savings");
  const weightTotal = spenders.reduce((sum, row) => sum + weightOf(row.name, row.group), 0);
  // Without spending pockets, savings pockets share everything; without savings pockets, savings stays unallocated.
  const spendingPool = spenders.length ? available - savingsPool : 0;
  for (const row of rows) {
    const template = row.group === "savings" ? (spenders.length ? savingsPool : available) / savers.length : spendingPool * weightOf(row.name, row.group) / weightTotal;
    const blended = history.months >= 2 && row.spend > 0 ? 0.7 * row.spend + 0.3 * template : template;
    row.amount = Math.max(row.fixed, blended);
    row.reason = row.fixed && row.fixed >= blended ? { kind: "fixed", amount: row.fixed } : history.months >= 2 && row.spend > 0 ? { kind: "spend", amount: row.spend } : row.group === "savings" ? { kind: "savings" } : { kind: "template" };
  }
  // Too much for the income: the flexible part of each pocket shrinks in proportion; commitments never shrink.
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  if (total > available) {
    const fixedTotal = rows.reduce((sum, row) => sum + row.fixed, 0);
    const factor = Math.max(0, available - fixedTotal) / Math.max(1, total - fixedTotal);
    for (const row of rows) row.amount = row.fixed + (row.amount - row.fixed) * factor;
  }
  const step = planStep(income);
  for (const row of rows) row.amount = Math.max(row.fixed, Math.floor(row.amount / step) * step);
  // Rounding leftovers go to savings, else to the largest pocket, so a full plan adds up exactly; with no savings
  // pocket the savings share is left visible as unallocated.
  const left = available - rows.reduce((sum, row) => sum + row.amount, 0) - (savers.length ? 0 : Math.floor(savingsPool / step) * step);
  const target = savers[0] || [...rows].sort((a, b) => b.amount - a.amount)[0];
  if (target && left > 0) target.amount += left;
  return rows;
}

/** Fills the unallocated money into the pockets the person hasn't set themselves, keeping their proportions. */
export function spreadRest(rows: PlanRow[], income: number, data: Data): PlanRow[] {
  const available = Math.max(0, income - unpocketedCommitments(data));
  const left = available - rows.reduce((sum, row) => sum + row.amount, 0);
  const open = rows.filter((row) => !row.userSet);
  if (left <= 0 || !open.length) return rows;
  const step = planStep(income);
  const base = open.reduce((sum, row) => sum + row.amount, 0);
  const next = rows.map((row) => row.userSet ? row : { ...row, amount: row.amount + Math.floor((base ? left * row.amount / base : left / open.length) / step) * step });
  const rest = available - next.reduce((sum, row) => sum + row.amount, 0);
  const largest = next.filter((row) => !row.userSet).sort((a, b) => b.amount - a.amount)[0];
  return rest > 0 && largest ? next.map((row) => row === largest ? { ...row, amount: row.amount + rest } : row) : next;
}

export const planTotal = (rows: readonly Pick<PlanRow, "amount">[]) => rows.reduce((sum, row) => sum + row.amount, 0);
export const percentOf = (amount: number, income: number) => income > 0 ? Math.round(amount / income * 1000) / 10 : 0;
export const amountFromPercent = (percent: number, income: number) => Math.max(0, Math.round(income * percent / 100 / planStep(income)) * planStep(income));

// A sensible icon for a new pocket from its name, using only the app's existing pocket icons.
const ICON_HINTS: [string, RegExp][] = [
  ["utensils", /makan|food|groceri|dapur|sayur|pasar|dining/i], ["coffee", /kopi|coffee|nongkrong|hangout|jajan|snack/i],
  ["car", /transport|bensin|fuel|ojek|grab|gojek|motor|mobil|parkir|commute/i], ["home", /kos|kost|sewa|rent|rumah|home|listrik|air|pdam|wifi|internet|tagihan|bills?|pulsa/i],
  ["plane", /liburan|vacation|travel|mudik|trip/i], ["book", /sekolah|school|pendidikan|education|kursus|course|buku|book/i],
  ["gift", /zakat|sedekah|donasi|charity|orang\s*tua|ortu|keluarga|family|kado|gift|arisan|persembahan/i], ["shopping", /belanja|shopping|fashion|baju|skincare|beauty/i],
  ["game", /game|hobi|hobby|hiburan|fun|nonton|netflix|spotify|langganan/i], ["heart", /tabung|saving|darurat|emergency|invest|kesehatan|health|obat|asuransi|bpjs|gym|olahraga/i],
];
export const iconFor = (name: string) => ICON_HINTS.find(([, pattern]) => pattern.test(name))?.[0] || "home";
