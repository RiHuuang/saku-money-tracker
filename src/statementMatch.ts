import { bankOfAccount, mentionsAccount } from "../worker/banks.js";
import { validAmount, validDate, type Data, type Transaction } from "./domain";
import type { ImportRow } from "./importDraft";
import { merchantKey } from "./merchants";

// Monthly check: decides, for every statement row, whether it is already in Saku, one side of a move between the
// user's own accounts, new, or something only the user can settle. Principles (docs/monthly-check-3.0.md):
// amount + date + account decide a match and the name only breaks ties; a link is made without asking only when it
// is unique on both sides; every link stays visible and can be undone.

export const MATCH_DAYS = 2;

export type Verdict =
  | { kind: "linked"; transactionId: string; auto: boolean; alias?: { from: string; to: string } }
  | { kind: "transfer"; counterparty: string; partnerRowId?: string }
  | { kind: "look"; reason: "ambiguous" | "other_account" | "transfer_tie" | "check"; candidates: string[]; partnerRowIds?: string[] }
  | { kind: "new" };

export type MatchRow = Pick<ImportRow, "id" | "sourceId" | "date" | "amount" | "direction" | "name" | "cleanName" | "activity" | "matchId" | "unlinked" | "unpaired" | "pairRowId" | "confirmedSeparate" | "userDecided"> & { account: string };

export type Analysis = { verdicts: Map<string, Verdict>; onlyInSaku: Transaction[] };

const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const gap = (a: string, b: string) => Math.abs(day(a) - day(b));
const words = (value: string) => new Set(value.toLocaleLowerCase("id-ID").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((word) => word.length > 2 && !GENERIC.has(word)));
const GENERIC = new Set(["trsf", "trf", "transfer", "banking", "e-banking", "ebanking", "debit", "credit", "kredit", "debet", "pembayaran", "payment", "purchase", "qris", "dari", "from", "untuk", "for", "bca", "jago", "dana", "gopay", "seabank", "blu", "bank", "the", "dan"]);
const simplify = (value: string) => value.toLocaleLowerCase("id-ID").replace(/[^\p{L}\p{N}]+/gu, "");

// How strongly a statement row and a ledger entry are the same thing, beyond equal value: an alias the user taught
// Saku outweighs everything, then shared name words, then a closer date.
export function nameScore(row: Pick<MatchRow, "name" | "cleanName">, transaction: Pick<Transaction, "name" | "note">, rules: Data["merchantRules"]): number {
  const target = simplify(transaction.name);
  const alias = [row.name, row.cleanName || ""].map((value) => rules.find((rule) => rule.key === merchantKey(value))).find(Boolean);
  if (alias && simplify(alias.name) === target) return 4;
  const mine = new Set([...words(row.name), ...words(row.cleanName || "")]);
  const theirs = words(`${transaction.name} ${transaction.note}`);
  const shared = [...mine].filter((word) => theirs.has(word)).length;
  const clean = simplify(row.cleanName || "");
  if (clean.length >= 4 && target.length >= 4 && (clean.includes(target) || target.includes(clean))) return 3;
  return shared >= 2 ? 3 : shared === 1 ? 2 : 0;
}

const eligible = (row: MatchRow) => !!row.account && validDate(row.date) && validAmount(row.amount) && row.direction !== "unknown" && !["pending", "failed", "reward", "unknown"].includes(row.activity);

/**
 * rows: the draft's statement rows not yet saved, with their resolved Saku account.
 * flagged: sources whose balance doesn't add up, or whose bank is still beta; their new rows go to "look".
 * draftIds: ids the draft already wrote, so a statement row never "links" to a row it created itself.
 */
export function analyzeStatement(rows: readonly MatchRow[], data: Pick<Data, "transactions" | "accounts" | "merchantRules" | "name" | "creditCards">, options: { flagged?: ReadonlySet<string>; draftIds?: ReadonlySet<string>; ownerName?: string } = {}): Analysis {
  const verdicts = new Map<string, Verdict>();
  const usable = rows.filter(eligible);
  const draftIds = options.draftIds || new Set<string>();
  const ledger = data.transactions.filter((transaction) => !draftIds.has(transaction.id) && !draftIds.has(transaction.transferId || "") && !["opening_balance", "balance_adjustment"].includes(transaction.kind || ""));
  const claimed = new Set<string>();

  // 1. Choices the user already made win.
  for (const row of usable) {
    if (row.matchId && ledger.some((transaction) => transaction.id === row.matchId)) {
      const transaction = ledger.find((item) => item.id === row.matchId)!;
      claimed.add(transaction.id);
      verdicts.set(row.id, { kind: "linked", transactionId: transaction.id, auto: false, alias: aliasFor(row, transaction) });
    }
  }

  // 2. Links to rows already in Saku. A pair is made only when each side is the other's clear best.
  const open = usable.filter((row) => !verdicts.has(row.id) && !row.unlinked && !row.confirmedSeparate);
  const candidatesOf = new Map<string, Transaction[]>();
  for (const row of open) candidatesOf.set(row.id, ledger.filter((transaction) => transaction.account === row.account && transaction.type === row.direction && transaction.amount === row.amount && gap(transaction.date, row.date) <= MATCH_DAYS));
  const score = (row: MatchRow, transaction: Transaction) => nameScore(row, transaction, data.merchantRules) * 10 - gap(row.date, transaction.date) * 2;
  let progress = true;
  while (progress) {
    progress = false;
    for (const row of open) {
      if (verdicts.has(row.id)) continue;
      const candidates = (candidatesOf.get(row.id) || []).filter((transaction) => !claimed.has(transaction.id));
      if (!candidates.length) continue;
      const ranked = candidates.map((transaction) => ({ transaction, score: score(row, transaction) })).sort((a, b) => b.score - a.score);
      const best = ranked[0];
      // A clear winner beats the runner-up by a name signal, not just by a day.
      if (ranked[1] && best.score - ranked[1].score < 10) continue;
      const rivals = open.filter((other) => other.id !== row.id && !verdicts.has(other.id) && (candidatesOf.get(other.id) || []).some((transaction) => transaction.id === best.transaction.id));
      if (rivals.some((other) => score(other, best.transaction) > best.score - 10)) continue;
      claimed.add(best.transaction.id);
      verdicts.set(row.id, { kind: "linked", transactionId: best.transaction.id, auto: true, alias: aliasFor(row, best.transaction) });
      progress = true;
    }
  }
  for (const row of open) {
    if (verdicts.has(row.id)) continue;
    const left = (candidatesOf.get(row.id) || []).filter((transaction) => !claimed.has(transaction.id));
    if (left.length) verdicts.set(row.id, { kind: "look", reason: "ambiguous", candidates: left.map((transaction) => transaction.id) });
  }

  // 3. Moves between the user's own accounts, across the uploaded statements.
  const transferable = usable.filter((row) => !verdicts.has(row.id) && !row.unpaired && data.accounts.includes(row.account));
  const signal = (row: MatchRow, other: MatchRow) => {
    let value = ["transfer", "topup"].includes(row.activity) || ["transfer", "topup"].includes(other.activity) ? 2 : 0;
    if (mentionsAccount(`${row.name} ${row.cleanName || ""}`, other.account)) value += 2;
    if (mentionsAccount(`${other.name} ${other.cleanName || ""}`, row.account)) value += 2;
    const owner = (options.ownerName ?? data.name).toLocaleLowerCase("id-ID").split(/\s+/).filter((part) => part.length >= 4 && part !== "my");
    if (owner.some((part) => `${row.name} ${other.name}`.toLocaleLowerCase("id-ID").includes(part))) value += 2;
    return value - gap(row.date, other.date);
  };
  const outs = transferable.filter((row) => row.direction === "expense");
  const ins = transferable.filter((row) => row.direction === "income");
  const pairs: { out: MatchRow; in: MatchRow; score: number }[] = [];
  for (const out of outs) for (const into of ins) {
    if (out.account === into.account || out.amount !== into.amount || gap(out.date, into.date) > MATCH_DAYS) continue;
    pairs.push({ out, in: into, score: signal(out, into) });
  }
  // Rows the user paired by hand come first.
  for (const row of transferable) {
    if (!row.pairRowId || verdicts.has(row.id)) continue;
    const partner = transferable.find((other) => other.id === row.pairRowId && !verdicts.has(other.id));
    if (!partner) continue;
    verdicts.set(row.id, { kind: "transfer", counterparty: partner.account, partnerRowId: partner.id });
    verdicts.set(partner.id, { kind: "transfer", counterparty: row.account, partnerRowId: row.id });
  }
  const options_ = (row: MatchRow) => pairs.filter((pair) => (pair.out.id === row.id || pair.in.id === row.id) && !verdicts.has(pair.out.id) && !verdicts.has(pair.in.id));
  for (const pair of [...pairs].sort((a, b) => b.score - a.score)) {
    if (verdicts.has(pair.out.id) || verdicts.has(pair.in.id)) continue;
    const tied = [pair.out, pair.in].some((row) => options_(row).filter((other) => other !== pair && other.score >= pair.score).length > 0);
    if (tied) continue;
    verdicts.set(pair.out.id, { kind: "transfer", counterparty: pair.in.account, partnerRowId: pair.in.id });
    verdicts.set(pair.in.id, { kind: "transfer", counterparty: pair.out.account, partnerRowId: pair.out.id });
  }
  for (const row of transferable) {
    if (verdicts.has(row.id)) continue;
    const left = options_(row);
    if (left.length) verdicts.set(row.id, { kind: "look", reason: "transfer_tie", candidates: [], partnerRowIds: left.map((pair) => pair.out.id === row.id ? pair.in.id : pair.out.id) });
  }

  // 4. One side only: the row names another of the user's accounts whose statement isn't in this check.
  const uploaded = new Set(usable.map((row) => row.account));
  for (const row of transferable) {
    if (verdicts.has(row.id) || row.activity === "card_payment") continue;
    const text = `${row.name} ${row.cleanName || ""}`;
    const others = data.accounts.filter((account) => account !== row.account && !uploaded.has(account) && bankOfAccount(account) && mentionsAccount(text, account));
    if (others.length === 1) verdicts.set(row.id, { kind: "transfer", counterparty: others[0] });
  }

  // 5. The same value logged under a different account.
  for (const row of open) {
    if (verdicts.has(row.id)) continue;
    const elsewhere = ledger.filter((transaction) => !claimed.has(transaction.id) && transaction.account !== row.account && transaction.kind !== "account_transfer" && transaction.type === row.direction && transaction.amount === row.amount && gap(transaction.date, row.date) <= 1);
    if (elsewhere.length === 1) { claimed.add(elsewhere[0].id); verdicts.set(row.id, { kind: "look", reason: "other_account", candidates: [elsewhere[0].id] }); }
  }

  // 6. Everything else is new; a source Saku may have misread sends its new rows for a look.
  for (const row of usable) {
    if (verdicts.has(row.id)) continue;
    verdicts.set(row.id, options.flagged?.has(row.sourceId) && !row.userDecided && !row.confirmedSeparate ? { kind: "look", reason: "check", candidates: [] } : { kind: "new" });
  }

  // Only in Saku: entries on a checked account, inside the dates the statements cover, with no statement row.
  const ranges = new Map<string, { from: string; to: string }>();
  for (const row of rows) {
    if (!row.account || !validDate(row.date)) continue;
    const range = ranges.get(row.account);
    ranges.set(row.account, { from: !range || row.date < range.from ? row.date : range.from, to: !range || row.date > range.to ? row.date : range.to });
  }
  const linked = new Set([...verdicts.values()].flatMap((verdict) => verdict.kind === "linked" ? [verdict.transactionId] : verdict.kind === "look" ? verdict.candidates : []));
  const onlyInSaku = ledger.filter((transaction) => {
    const range = ranges.get(transaction.account);
    return !!range && transaction.date >= range.from && transaction.date <= range.to && !linked.has(transaction.id) && transaction.kind !== "card_purchase";
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { verdicts, onlyInSaku };
}

function aliasFor(row: Pick<MatchRow, "name" | "cleanName">, transaction: Pick<Transaction, "name">) {
  const printed = (row.cleanName || row.name).trim();
  return printed && simplify(printed) !== simplify(transaction.name) && merchantKey(row.name) ? { from: printed, to: transaction.name } : undefined;
}

// What the draft row becomes once the verdict is applied: links are skipped (they are already in Saku), transfers get
// their other account, and rows that still need the user wait as "later".
export function applyVerdict(row: ImportRow, verdict: Verdict | undefined): ImportRow {
  if (!verdict) return row;
  if (verdict.kind === "linked") return { ...row, decision: "skip", alreadyInSaku: true };
  if (verdict.kind === "transfer") return { ...row, activity: "transfer", counterparty: verdict.counterparty, decision: row.userDecided ? row.decision : "ready", alreadyInSaku: false };
  if (verdict.kind === "look") return { ...row, decision: row.userDecided && verdict.reason === "check" ? row.decision : "later", alreadyInSaku: false };
  return { ...row, alreadyInSaku: false };
}

// The balance printed on a statement must equal the opening balance plus the rows Saku read.
export function balanceMismatch(rows: readonly Pick<ImportRow, "amount" | "direction" | "activity">[], totals: { opening?: number; closing?: number } | undefined): boolean {
  if (totals?.opening === undefined || totals.closing === undefined) return false;
  const counted = rows.filter((row) => !["pending", "failed", "reward"].includes(row.activity) && row.direction !== "unknown");
  const sum = counted.reduce((total, row) => total + (row.direction === "income" ? row.amount : -row.amount), 0);
  return Math.abs(totals.opening + sum - totals.closing) > 1;
}
