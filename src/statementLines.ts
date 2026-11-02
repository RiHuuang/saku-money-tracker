import { normalizeMerchant } from "./merchants";
import type { ImportRow } from "./importDraft";

// Deterministic reading of text bank statements, with no AI.
//
// A page is accepted only when its running balance proves every row: opening balance (or the balance carried
// from the previous page) plus or minus each amount must land on every printed balance, and the last row must
// be covered by a printed balance or the closing balance. Anything else returns null and the page goes to the
// AI reader, so this path can only ever save neurons, never add a misread amount.

export type ParsedRow = Pick<ImportRow, "date" | "dateEvidence" | "name" | "cleanName" | "paymentMethod" | "amount" | "direction" | "activity">;
export type PageResult = { rows: ParsedRow[]; balance: number };
export type StatementTotals = { opening?: number; closing?: number };

const MONTHS: Record<string, number> = { jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12 };
const OPENING = /\b(?:saldo\s+awal|opening\s+balance|saldo\s+sebelumnya|beginning\s+balance|previous\s+balance)\b/i;
const CLOSING = /\b(?:saldo\s+akhir|closing\s+balance|ending\s+balance)\b/i;
const SUMMARY = /\b(?:mutasi\s+(?:cr|db|debet|kredit)|total\s+(?:mutasi|debit|kredit|credit|debet)|jumlah\s+(?:debit|kredit|mutasi))\b/i;
const FOOTER = /\b(?:halaman|page\s+\d|bersambung|continued|keterangan|tanggal\s+transaksi|catatan|disclaimer|www\.|https?:)/i;
const DEBIT = /^(?:DB|D|DEBIT|DEBET|DR)$/i;
const CREDIT = /^(?:CR|K|KREDIT|CREDIT)$/i;

// Money is printed with a decimal part or thousands groups, so reference numbers and branch codes never read as money.
// Returns sen (hundredths) to keep the chain exact, or null when the token isn't money.
export function moneyToken(raw: string): { sen: number; sign: -1 | 0 | 1 } | null {
  let token = raw.trim();
  let sign: -1 | 0 | 1 = 0;
  if (/^[+-]/.test(token)) { sign = token.startsWith("-") ? -1 : 1; token = token.slice(1); }
  token = token.replace(/^(?:Rp\.?|IDR)/i, "");
  if (/^-/.test(token)) { sign = -1; token = token.slice(1); }
  let whole: string, fraction = "00";
  if (/^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(token)) [whole, fraction] = [token.slice(0, -3).replace(/,/g, ""), token.slice(-2)];
  else if (/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(token)) [whole, fraction] = [token.slice(0, -3).replace(/\./g, ""), token.slice(-2)];
  else if (/^\d+\.\d{2}$/.test(token)) [whole, fraction] = [token.slice(0, -3), token.slice(-2)];
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(token)) whole = token.replace(/\./g, "");
  else return null;
  const sen = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(sen) ? { sen, sign } : null;
}

function resolveYear(month: number, reviewMonth: string, printedYear?: number) {
  if (printedYear) return printedYear < 100 ? 2000 + printedYear : printedYear;
  const year = Number(reviewMonth.slice(0, 4)), review = Number(reviewMonth.slice(5, 7));
  if (review === 1 && month === 12) return year - 1;
  if (review === 12 && month === 1) return year + 1;
  return year;
}

// A row starts with its date: 02/10, 02-10-2026, 2 Okt, 02 OCT 2026.
export function leadingDate(line: string, reviewMonth: string): { date: string; evidence: string; rest: string } | null {
  const match = line.match(/^(\d{1,2})[/\-. ](\d{1,2}|[A-Za-z]{3,9})(?:[/\-. ](\d{4}|\d{2}))?(?=\s|$)/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = /^\d+$/.test(match[2]) ? Number(match[2]) : MONTHS[match[2].toLowerCase()] || 0;
  if (!month || month > 12 || day < 1 || day > 31 || !/^\d{4}-\d{2}$/.test(reviewMonth)) return null;
  const year = resolveYear(month, reviewMonth, match[3] ? Number(match[3]) : undefined);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCDate() !== day) return null;
  return { date: value.toISOString().slice(0, 10), evidence: match[0], rest: line.slice(match[0].length).trim() };
}

// Trailing money and direction markers: "… 50,000.00 DB 1,184,567.89".
function trailing(rest: string) {
  const words = rest.split(/\s+/).filter(Boolean);
  const tail: { kind: "money"; sen: number; sign: -1 | 0 | 1 }[] = [];
  let marker: -1 | 0 | 1 = 0;
  let cut = words.length;
  while (cut > 0 && tail.length < 3) {
    const word = words[cut - 1];
    const money = moneyToken(word);
    if (money) { tail.unshift({ kind: "money", ...money }); cut--; continue; }
    // The marker sits after the amount ("45,500.00 DB") or between amount and balance ("500,000.00 DB 1,500,000.00").
    if (DEBIT.test(word) && !marker && tail.length < 2) { marker = -1; cut--; continue; }
    if (CREDIT.test(word) && !marker && tail.length < 2) { marker = 1; cut--; continue; }
    break;
  }
  return { description: words.slice(0, cut).join(" "), tail, marker };
}

export function statementTotals(text: string): StatementTotals {
  const totals: StatementTotals = {};
  for (const line of text.split("\n")) {
    const kind = OPENING.test(line) ? "opening" : CLOSING.test(line) ? "closing" : "";
    if (!kind) continue;
    const words = line.trim().split(/\s+/);
    const money = words.map(moneyToken).filter((value): value is NonNullable<typeof value> => !!value).at(-1);
    if (!money) continue;
    const rupiah = Math.round((money.sign === -1 ? -money.sen : money.sen) / 100);
    if (kind === "opening" && totals.opening === undefined) totals.opening = rupiah;
    if (kind === "closing") totals.closing = rupiah;
  }
  return totals;
}

const activityFor = (name: string, direction: "income" | "expense"): ImportRow["activity"] => {
  if (/\b(?:biaya|adm(?:in)?|fee|pajak|tax|materai|meterai)\b/i.test(name)) return "fee";
  if (/\b(?:bunga|interest)\b/i.test(name)) return direction === "income" ? "interest" : "fee";
  if (/\bkartu\s+kredit\b|\bcredit\s+card\s+payment\b/i.test(name) && direction === "expense") return "card_payment";
  if (/\b(?:flazz|top[\s-]?up|isi\s+saldo)\b/i.test(name)) return "topup";
  return direction === "income" ? "income" : "purchase";
};

/**
 * Reads one text page. `carry` is the balance (in sen) the previous page ended on, if any.
 * Returns null when the page can't be proven line by line.
 */
export function parseStatementPage(text: string, reviewMonth: string, carry?: number): PageResult | null {
  const lines = text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  let balance = carry;
  let verified = carry !== undefined;
  const rows: (ParsedRow & { extra: string[] })[] = [];
  let open: (ParsedRow & { extra: string[] }) | null = null;
  for (const line of lines) {
    if (OPENING.test(line)) {
      const money = line.split(" ").map(moneyToken).filter(Boolean).at(-1);
      if (!money) return null;
      const value = money.sign === -1 ? -money.sen : money.sen;
      if (balance !== undefined && balance !== value) return null;
      balance = value; verified = true; open = null;
      continue;
    }
    if (CLOSING.test(line)) {
      const money = line.split(" ").map(moneyToken).filter(Boolean).at(-1);
      if (!money || balance === undefined) return null;
      if (balance !== (money.sign === -1 ? -money.sen : money.sen)) return null;
      verified = true; open = null;
      continue;
    }
    if (SUMMARY.test(line)) { open = null; continue; }
    const dated = leadingDate(line, reviewMonth);
    if (!dated) {
      // Up to two description lines follow a row (BCA prints the other party's name below the type).
      if (open && open.extra.length < 2 && !FOOTER.test(line) && !line.split(" ").some((word) => moneyToken(word))) open.extra.push(line);
      else open = null;
      continue;
    }
    const { description, tail, marker } = trailing(dated.rest);
    // A dated line with no amount (a header or a wrapped reference) can't be proven.
    if (!tail.length || tail.length > 2 || !description) return null;
    if (balance === undefined) return null;
    const amount = tail[0];
    const printedBalance = tail.length === 2 ? tail[1] : undefined;
    let sign = marker || amount.sign;
    if (!sign && printedBalance) {
      const target = printedBalance.sign === -1 ? -printedBalance.sen : printedBalance.sen;
      sign = target - balance === amount.sen ? 1 : balance - target === amount.sen ? -1 : 0;
    }
    if (!sign || !amount.sen) return null;
    balance += sign * amount.sen;
    if (printedBalance) {
      if (balance !== (printedBalance.sign === -1 ? -printedBalance.sen : printedBalance.sen)) return null;
      verified = true;
    } else verified = false;
    const rupiah = Math.round(amount.sen / 100);
    if (!rupiah) return null;
    const direction = sign > 0 ? "income" : "expense";
    open = { date: dated.date, dateEvidence: dated.evidence, name: description.slice(0, 100), cleanName: "", paymentMethod: "", amount: rupiah, direction, activity: activityFor(description, direction), extra: [] };
    rows.push(open);
  }
  if (!rows.length || !verified || balance === undefined) return null;
  return {
    balance,
    rows: rows.map(({ extra, ...row }) => {
      const name = [row.name, ...extra].join(" ").replace(/\s+/g, " ").trim().slice(0, 100);
      const clean = normalizeMerchant(extra.length ? extra.join(" ") : row.name).slice(0, 60);
      return { ...row, name, cleanName: clean && !/\d{4}/.test(clean) ? clean : "" };
    }),
  };
}
