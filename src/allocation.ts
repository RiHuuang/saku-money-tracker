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

const SHARES: Record<"fixed" | "variable", Record<"needs" | "wants" | "savings", number>> = {
  fixed: { needs: 0.5, wants: 0.3, savings: 0.2 },
  // Income that moves around keeps more aside for the thin months.
  variable: { needs: 0.5, wants: 0.25, savings: 0.25 },
};
const bucket = (group: PocketGroup): "needs" | "wants" | "savings" => group === "debt" ? "needs" : group === "giving" ? "wants" : group;
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
export function unpocketedCommitments(data: Data) {
  return data.existingInstallments.reduce((sum, item) => sum + item.monthlyAmount, 0)
    + data.recurring.filter((rule) => rule.active && rule.type === "expense" && !rule.pocketId).reduce((sum, rule) => sum + rule.amount, 0);
}

export function baselinePlan(income: number, kind: "fixed" | "variable", pockets: { key: string; pocketId?: string; name: string; icon: string }[], data: Data, month: string): PlanRow[] {
  const available = Math.max(0, income - unpocketedCommitments(data));
  const history = recentSpending(data, month);
  const rows: PlanRow[] = pockets.map((pocket) => {
    const fixed = pocket.pocketId ? data.recurring.filter((rule) => rule.active && rule.type === "expense" && rule.pocketId === pocket.pocketId).reduce((sum, rule) => sum + rule.amount, 0) : 0;
    return { ...pocket, group: classifyPocket(pocket.name), amount: 0, spend: pocket.pocketId ? history.spend.get(pocket.pocketId) || 0 : 0, fixed, reason: { kind: "template" } };
  });
  if (!rows.length || !available) return rows;
  // Template shares: a bucket with no pocket passes its share on, except savings, which stays visible as unallocated.
  const shares = { ...SHARES[kind] };
  const present = (name: "needs" | "wants" | "savings") => rows.some((row) => bucket(row.group) === name);
  const missing = (["needs", "wants"] as const).filter((name) => !present(name)).reduce((sum, name) => sum + shares[name], 0);
  for (const name of ["needs", "wants"] as const) if (!present(name)) shares[name] = 0;
  const spendTotal = (["needs", "wants"] as const).filter(present).reduce((sum, name) => sum + shares[name], 0);
  for (const name of ["needs", "wants"] as const) if (present(name) && spendTotal) shares[name] += missing * shares[name] / spendTotal;
  for (const row of rows) {
    const peers = rows.filter((item) => bucket(item.group) === bucket(row.group)).length;
    const template = available * shares[bucket(row.group)] / peers;
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
  // Rounding leftovers go to savings, else to the largest needs pocket, so a full plan adds up exactly.
  const left = available - rows.reduce((sum, row) => sum + row.amount, 0);
  const target = rows.find((row) => row.group === "savings") || (present("savings") ? undefined : [...rows].filter((row) => bucket(row.group) === "needs").sort((a, b) => b.amount - a.amount)[0]);
  const savingsShare = present("savings") ? 0 : Math.round(available * shares.savings);
  if (target && left > 0 && left - savingsShare > 0) target.amount += present("savings") ? left : left - Math.floor(savingsShare / step) * step;
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
export const amountFromPercent = (percent: number, income: number) => Math.max(0, Math.round(income * percent / 100 / 1000) * 1000);

// A sensible icon for a new pocket from its name, using only the app's existing pocket icons.
const ICON_HINTS: [string, RegExp][] = [
  ["utensils", /makan|food|groceri|dapur|sayur|pasar|dining/i], ["coffee", /kopi|coffee|nongkrong|hangout|jajan|snack/i],
  ["car", /transport|bensin|fuel|ojek|grab|gojek|motor|mobil|parkir|commute/i], ["home", /kos|kost|sewa|rent|rumah|home|listrik|air|pdam|wifi|internet|tagihan|bills?|pulsa/i],
  ["plane", /liburan|vacation|travel|mudik|trip/i], ["book", /sekolah|school|pendidikan|education|kursus|course|buku|book/i],
  ["gift", /zakat|sedekah|donasi|charity|orang\s*tua|ortu|keluarga|family|kado|gift|arisan|persembahan/i], ["shopping", /belanja|shopping|fashion|baju|skincare|beauty/i],
  ["game", /game|hobi|hobby|hiburan|fun|nonton|netflix|spotify|langganan/i], ["heart", /tabung|saving|darurat|emergency|invest|kesehatan|health|obat|asuransi|bpjs|gym|olahraga/i],
];
export const iconFor = (name: string) => ICON_HINTS.find(([, pattern]) => pattern.test(name))?.[0] || "home";
