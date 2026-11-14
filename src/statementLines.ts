import { normalizeMerchant } from "./merchants";
import type { ImportRow } from "./importDraft";

// Deterministic reading of text bank statements, with no AI.
//
// A page is accepted only when its running balance proves every row: opening balance (or the balance carried
// from the previous page) plus or minus each amount must land on every printed balance, and the last row must
// be covered by a printed balance or the closing balance. Anything else returns null and the page goes to the
// AI reader, so this path can only ever save neurons, never add a misread amount.

export type ParsedRow = Pick<ImportRow, "date" | "dateEvidence" | "name" | "cleanName" | "paymentMethod" | "amount" | "direction" | "activity" | "statementAccount" | "exactAmount" | "check" | "currency">;
export type PageResult = { rows: ParsedRow[]; balance: number };
export type StatementTotals = { opening?: number; closing?: number };

export function statementCurrency(text: string): string {
  return text.match(/\bMATA\s+UANG\s*:\s*([A-Z]{3})\b/i)?.[1].toUpperCase() || "IDR";
}

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
  // Three digits after a comma are a thousands group, never sen (sen always have two).
  else if (/^\d{1,3}(?:,\d{3})+$/.test(token)) whole = token.replace(/,/g, "");
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
  if (statementCurrency(text) !== "IDR") return null;
  if (/LAPORAN TRANSAKSI FINANSIAL/i.test(text) && /Britama|BRImo/i.test(text)) return parseBriPage(text, reviewMonth);
  if (/Remaining Balance/i.test(text) && /bluAccount/i.test(text)) return parseBluPage(text, reviewMonth);
  if (/BANK STATEMENT|REKENING KORAN/i.test(text) && /END BALANCE \(IDR\)|SALDO AKHIR \(IDR\)/i.test(text)) return parseSeaBankPage(text, reviewMonth, carry);
  return parseBalancePage(text, reviewMonth, carry);
}

function parseBalancePage(text: string, reviewMonth: string, carry?: number): PageResult | null {
  const lines = text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  let balance = carry;
  let verified = carry !== undefined;
  const rows: (ParsedRow & { extra: string[] })[] = [];
  let open: (ParsedRow & { extra: string[] }) | null = null;
  for (const line of lines) {
    if (OPENING.test(line)) {
      // The final BCA page repeats the document's opening in its summary.
      // Its closing is still checked below against the carried running balance.
      if (rows.length && /^SALDO AWAL\s*:/i.test(line)) continue;
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
      if (open && /^REKENING TAHAPAN/m.test(text)) {
        if (FOOTER.test(line)) { open = null; continue; }
        // BCA repeats the amount, then prints a note and recipient underneath.
        if (moneyToken(line) || /^\d+$/.test(line) || /^QRP?\s*\d+$/i.test(line)) continue;
        const continuation = line.replace(/^0+\.00\s*/, "");
        if (open.extra.length < 4) open.extra.push(continuation);
        continue;
      }
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
    const bcaDirection = /\b(?:TRSF E-BANKING|BI-FAST) CR\b|^KR OTOMATIS\b|^SETORAN PEMINDAHAN\b|^BUNGA\b/i.test(description) ? 1
      : /\b(?:TRSF E-BANKING|BI-FAST) DB\b|^DB OTOMATIS\b|^BIAYA ADM\b/i.test(description) ? -1 : 0;
    // BIF TRANSFER DR means "from", while the row's CR column means money in.
    let sign = bcaDirection || marker || amount.sign;
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
    const direction = sign > 0 ? "income" : "expense";
    open = { date: dated.date, dateEvidence: dated.evidence, name: description.slice(0, 100), cleanName: "", paymentMethod: "", amount: rupiah, exactAmount: amount.sen / 100, direction, activity: activityFor(description, direction), extra: [] };
    rows.push(open);
  }
  if (!rows.length || !verified || balance === undefined) return null;
  return {
    balance,
    rows: rows.map(({ extra, ...row }) => {
      const name = [row.name, ...extra].join(" ").replace(/\s+/g, " ").trim().slice(0, 100);
      const description = extra.length ? (/^REKENING TAHAPAN/m.test(text) ? extra.at(-1)! : extra.join(" ")) : row.name;
      const clean = normalizeMerchant(description).slice(0, 60);
      return { ...row, name, cleanName: clean && !/\d{4}/.test(clean) ? clean : "" };
    }),
  };
}

function parsedRow(date: string, evidence: string, name: string, sen: number, direction: "income" | "expense"): ParsedRow {
  return { date, dateEvidence: evidence, name: name.slice(0, 100), cleanName: normalizeMerchant(name).slice(0, 60), paymentMethod: "", amount: Math.round(sen / 100), exactAmount: sen / 100, direction, activity: activityFor(name, direction) };
}

function parseBluPage(text: string, month: string): PageResult | null {
  const lines = text.split("\n").map((v) => v.trim());
  const summary = (label: string) => {
    const line = lines.find((v) => v.startsWith(label));
    return line ? moneyToken(line.split(/\s+/).at(-1)!)?.sen : undefined;
  };
  const opening = summary("Saldo Awal / Initial Balance"), closing = summary("Saldo Akhir / Ending Balance");
  const incoming = summary("Total Pemasukan / Total Income"), outgoing = summary("Total Pengeluaran / Total Expense");
  if ([opening, closing, incoming, outgoing].some((v) => v === undefined)) return null;
  let balance = opening!, credit = 0, debit = 0;
  const rows: ParsedRow[] = [];
  const start = lines.findIndex((v) => /Remaining Balance/.test(v));
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^Saldo Awal/.test(lines[i])) break;
    const date = leadingDate(lines[i], month);
    if (!date) continue;
    const description = [date.rest];
    let amounts: ReturnType<typeof moneyToken>[] | undefined;
    while (++i < lines.length) {
      const tokens = lines[i].replace(/^-\s+/, "-").split(/\s+/);
      if (tokens.length === 2 && tokens.every((v) => moneyToken(v))) { amounts = tokens.map(moneyToken); break; }
      if (leadingDate(lines[i], month) || /^Saldo Awal/.test(lines[i])) return null;
      description.push(lines[i]);
    }
    if (!amounts || amounts.some((v) => !v)) return null;
    const [amount, end] = amounts as NonNullable<ReturnType<typeof moneyToken>>[];
    const direction = amount.sign === -1 ? "expense" : "income";
    balance += direction === "income" ? amount.sen : -amount.sen;
    if (balance !== end.sen) return null;
    if (direction === "income") credit += amount.sen; else debit += amount.sen;
    rows.push(parsedRow(date.date, date.evidence, description.filter(Boolean).join(" "), amount.sen, direction));
  }
  return rows.length && balance === closing && credit === incoming && debit === outgoing ? { rows, balance } : null;
}

function parseSeaBankPage(text: string, month: string, carry?: number): PageResult | null {
  const lines = text.split("\n").map((v) => v.trim());
  const whole = (token: string) => /^\d+(?:\.\d{3})*$/.test(token) ? Number(token.replace(/\./g, "")) * 100 : NaN;
  const summary = lines.find((v) => /^(?:SAVINGS|TABUNGAN)\s+\d/.test(v))?.split(/\s+/).slice(1).map(whole);
  let balance = carry ?? summary?.[0];
  if (balance === undefined || !Number.isSafeInteger(balance)) return null;
  const start = lines.findIndex((v) => /^(?:DATE TRANSACTION|TANGGAL TRANSAKSI)/.test(v));
  if (start < 0) return null;
  const rows: ParsedRow[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const printed = lines[i].match(/^(\d{1,2}\s+[A-Za-z]{3})\s+(.+)$/);
    const date = printed ? leadingDate(`${printed[1]} ${month.slice(0, 4)} ${printed[2]}`, month) : null;
    if (!date) continue;
    const values = date.rest.split(/\s+/).map(whole);
    if (values.length !== 2 || values.some((v) => !Number.isSafeInteger(v))) return null;
    const [amount, end] = values;
    const direction = end - balance === amount ? "income" : balance - end === amount ? "expense" : null;
    if (!direction || !amount) return null;
    const name = lines[i - 1];
    if (!name || /IDR|DATE|TANGGAL/.test(name)) return null;
    rows.push(parsedRow(date.date, printed![1], name, amount, direction));
    balance = end;
  }
  return rows.length ? { rows, balance } : null;
}

// BRI prints the opening balance in the footer and separate debit/credit columns.
// Prove every running balance and both printed totals before accepting the page.
function parseBriPage(text: string, reviewMonth: string): PageResult | null {
  const lines = text.split("\n").map((line) => line.trim());
  const summary = lines.findIndex((line) => /^Opening Balance Total Debit Transaction Total Credit Transaction Closing Balance$/i.test(line));
  const totals = lines[summary + 1]?.split(/\s+/).map(moneyToken);
  if (summary < 0 || totals?.length !== 4 || totals.some((v) => !v)) return null;
  let balance = totals[0]!.sen, debit = 0, credit = 0;
  const rows: ParsedRow[] = [];
  for (const line of lines.slice(0, summary)) {
    const dated = leadingDate(line, reviewMonth);
    if (!dated) continue;
    const match = dated.rest.match(/^\d{2}:\d{2}:\d{2}\s+(.+?)\s+(\S+)\s+(\S+)\s+(\S+)$/);
    if (!match) return null;
    const values = match.slice(2).map(moneyToken);
    if (values.some((v) => !v)) return null;
    const [out, incoming, closing] = values.map((v) => v!.sen);
    if ((out > 0) === (incoming > 0) || balance - out + incoming !== closing) return null;
    balance = closing; debit += out; credit += incoming;
    const direction = incoming ? "income" : "expense";
    const name = match[1].replace(/\s+\d{7}$/, "").trim().slice(0, 100);
    rows.push({ date: dated.date, dateEvidence: dated.evidence, name, cleanName: normalizeMerchant(name).slice(0, 60), paymentMethod: "", amount: Math.round((out || incoming) / 100), direction, activity: activityFor(name, direction) });
  }
  return rows.length && debit === totals[1]!.sen && credit === totals[2]!.sen && balance === totals[3]!.sen ? { rows, balance } : null;
}

// Jago prints a separate complete balance chain for each pocket, often across pages.
// Accept the document only when every pocket's debit/credit totals and closing agree.
export function parseJagoStatement(pages: readonly string[], month: string): PageResult[] | null {
  if (!pages.some((text) => /Monthly Statements/.test(text) && /PERSONAL POCKETS/.test(text))) return null;
  const results: PageResult[] = pages.map(() => ({ rows: [], balance: 0 }));
  type Pocket = { name: string; balance: number; debit: number; credit: number; expectedDebit?: number; expectedCredit?: number; closing?: number; currency?: string };
  let pocket: Pocket | undefined;
  let open: ParsedRow | undefined;
  let sectionCount = 0;
  const complete = () => !pocket || (pocket.debit === pocket.expectedDebit && pocket.credit === pocket.expectedCredit && pocket.balance === pocket.closing);
  for (let page = 0; page < pages.length; page++) {
    const lines = pages[page].split("\n").map((line) => line.trim());
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const heading = line.match(/^(.*?)Previous Balance\s+([\d.,]+)$/);
      if (heading) {
        if (!complete()) return null;
        const start = moneyToken(heading[2]);
        if (!start) return null;
        pocket = { name: heading[1].trim() || lines[i + 1], balance: start.sen, debit: 0, credit: 0 };
        sectionCount++; open = undefined;
        continue;
      }
      if (!pocket) continue;
      const incoming = line.match(/Total Incoming\s+([+\d.,]+)$/);
      const outgoing = line.match(/Total Outgoing\s+([-\d.,]+)$/);
      const closing = line.match(/Currency In ([A-Z]{3}) Closing Balance\s+([\d.,]+)$/);
      if (incoming) { pocket.expectedCredit = moneyToken(incoming[1])?.sen; continue; }
      if (outgoing) { pocket.expectedDebit = moneyToken(outgoing[1])?.sen; continue; }
      if (closing) { pocket.closing = moneyToken(closing[2])?.sen; pocket.currency = closing[1]; continue; }
      const dated = leadingDate(line, month);
      if (dated) {
        if (pocket.currency !== "IDR") return null;
        const values = dated.rest.match(/^(.*?)\s+([+-][\d.,]+)\s+([\d.,]+)$/);
        if (!values) return null;
        const amount = moneyToken(values[2]), end = moneyToken(values[3]);
        if (!amount || !end || !amount.sign) return null;
        const direction = amount.sign === 1 ? "income" : "expense";
        pocket.balance += amount.sign * amount.sen;
        if (pocket.balance !== end.sen) return null;
        if (direction === "income") pocket.credit += amount.sen; else pocket.debit += amount.sen;
        open = { ...parsedRow(dated.date, dated.evidence, values[1], amount.sen, direction), statementAccount: pocket.name, exactAmount: amount.sen / 100 };
        if (/Incoming Transfer|Outgoing Transfer|Pocket Money In|Movement between/i.test(values[1])) open.activity = "transfer";
        results[page].rows.push(open);
      } else if (open && !/Monthly Statements|www\.|PT Bank Jago|Indonesia Deposit|licensed|^Date & Time/i.test(line)) {
        const continuation = line.match(/^\d{2}:\d{2}\s+(.+)/)?.[1].split(/\bID#/)[0].trim();
        if (continuation) open.name = `${open.name} ${continuation}`.slice(0, 100);
        if (/Movement between Pockets|Pocket Money In/.test(line)) open.activity = "transfer";
      }
      results[page].balance = pocket.balance;
    }
  }
  return sectionCount > 0 && complete() ? results : null;
}

// GoPay's report includes purchases funded by several accounts and non-rupiah Coins.
// Require both rupiah totals and both Coins totals before trusting its text layer.
export function parseGoPayStatement(pages: readonly string[], month: string): PageResult[] | null {
  if (!/E-statement[\s\S]*Total Coins/.test(pages[0] || "")) return null;
  const header = pages[0].match(/(?:^|\n)([\d.]+)\s+([\d.]+)\s+Rp([\d.]+)\s+Rp([\d.]+)(?:\n|$)/);
  if (!header) return null;
  const expected = header.slice(1).map((value) => Number(value.replace(/\./g, "")));
  let coinIn = 0, coinOut = 0, incoming = 0, outgoing = 0;
  const results: PageResult[] = [];
  for (const text of pages) {
    const lines = text.split("\n");
    const rows: ParsedRow[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^\d{2}\/\d{2}\/\d{4}\s/.test(lines[i])) continue;
      const date = leadingDate(lines[i], month);
      if (!date) return null;
      const tail = date.rest.match(/\s(-?Rp[\d.]+|-?[\d.]+)$/);
      if (!tail) return null;
      const body = date.rest.slice(0, -tail[0].length);
      const reference = body.match(/\b[A-Z]?\d{14,}[A-Za-z0-9]*/);
      if (!reference || reference.index === undefined) return null;
      let name = body.slice(0, reference.index).trim();
      let funding = body.slice(reference.index + reference[0].length).trim();
      let j = i + 1;
      for (; j < lines.length && !/^\d{2}\/\d{2}\/\d{4}\s/.test(lines[j]); j++) {
        const extra = lines[j].trim();
        if (/E-statement|Tanggal Transaksi/.test(extra)) break;
        if (/^(?:Tabungan by Jago|GoPay Coins|Simpanan|Jago|xx-\d+)$/i.test(extra)) funding = extra;
        else {
          const remainder = extra.replace(/^\d{2}:\d{2}\s*/, "").replace(/\b[A-Za-z0-9]{6,}ID\b/g, "").trim();
          if (remainder && !/^\d+$/.test(remainder)) name += ` ${remainder}`;
        }
      }
      i = j - 1;
      const coins = !tail[1].includes("Rp");
      if (coins !== /GoPay Coins/i.test(funding)) return null;
      const amount = Number(tail[1].replace(/[^\d]/g, ""));
      if (!Number.isSafeInteger(amount) || amount <= 0) return null;
      const direction = tail[1].startsWith("-") ? "expense" : "income";
      if (coins) { if (direction === "income") coinIn += amount; else coinOut += amount; }
      else if (direction === "income") incoming += amount; else outgoing += amount;
      const row = parsedRow(date.date, date.evidence, name, amount * 100, direction);
      row.paymentMethod = funding;
      if (!coins && funding) row.statementAccount = funding;
      if (coins) row.activity = "reward";
      else if (/refund/i.test(name)) row.activity = "refund";
      else if (/\btop up\b/i.test(name)) row.activity = "topup";
      rows.push(row);
    }
    results.push({ rows, balance: 0 });
  }
  return coinIn === expected[0] && coinOut === expected[1] && incoming === expected[2] && outgoing === expected[3] ? results : null;
}

// Card statements reconcile debt: purchases increase it; CR payments/reversals reduce it.
export function parseBcaCardStatement(pages: readonly string[], reviewMonth: string): PageResult[] | null {
  if (!/^REKENING KARTU KREDIT/m.test(pages[0] || "")) return null;
  const printedYear = pages[0].match(/TANGGAL REKENING\s*:\s*\d{1,2}\s+[A-Z]+\s+(20\d{2})/)?.[1];
  if (!printedYear) return null;
  const month = `${printedYear}-${reviewMonth.slice(5)}`;
  const results: PageResult[] = pages.map(() => ({ rows: [], balance: 0 }));
  let label = "", account = "", balance: number | undefined, purchaseNet = 0, total = 0, sections = 0, expectedTotal: number | undefined;
  let purchaseChecked = false;
  const amountOf = (text: string) => moneyToken(text)?.sen;
  for (let p = 0; p < pages.length; p++) {
    for (const line of pages[p].split("\n").map(v=>v.trim())) {
      if (/^(?:VISA CARD|BCA (?:EVERYDAY CARD|KKI|BLIBLI TIKET))$/.test(line)) label = line;
      const opening = line.match(/^SALDO SEBELUMNYA ([\d.]+)( CR)?$/);
      if (opening) {
        if (balance !== undefined || !label) return null;
        const value = amountOf(opening[1]); if (value === undefined) return null;
        balance = opening[2] ? -value : value; account = label; purchaseNet = 0; purchaseChecked = false; sections++;
        continue;
      }
      const card = line.match(/^\d{4}-\d{2}XX-XXXX-(\d{4})\b/);
      if (card && balance !== undefined) { account = `${label} · ${card[1]}`; continue; }
      const dated = line.match(/^(\d{2}-[A-Z]{3})\s+(\d{2}-[A-Z]{3})\s+(.+?)\s+([\d.]+)( CR)?$/);
      if (dated) {
        if (balance === undefined) return null;
        const date = leadingDate(`${dated[1]}-${printedYear} x`,month), amount = amountOf(dated[4]);
        if (!date || !amount) return null;
        const direction = dated[5] ? "income" : "expense";
        const signed = direction === "expense" ? amount : -amount;
        balance += signed;
        if (!purchaseChecked) purchaseNet += signed;
        const row = { ...parsedRow(date.date, dated[1], dated[3], amount, direction), statementAccount: account };
        if (/^PEMBAYARAN/.test(dated[3])) row.activity = "card_payment";
        else if (/^TRANSFER/.test(dated[3])) row.activity = "transfer";
        else if (/^REVERSAL/.test(dated[3])) row.activity = "refund";
        if (/CICILAN|^REVERSAL|^TRANSFER|^PEMBAYARAN/.test(dated[3])) row.check = "card_statement";
        results[p].rows.push(row);
        continue;
      }
      const subtotal = line.match(/^SUBTOTAL( TRANSAKSI)? ([\d.]+)( CR)?$/);
      if (subtotal) {
        if (balance === undefined) return null;
        const value = amountOf(subtotal[2]); if (value === undefined) return null;
        const signed = subtotal[3] ? -value : value;
        if (subtotal[1]) { if (purchaseNet !== signed) return null; purchaseChecked = true; }
        else { if (!purchaseChecked || balance !== signed) return null; total += balance; balance = undefined; }
      }
      const end = line.match(/^TOTAL ([\d.]+)( CR)?$/);
      if (end) { const value = amountOf(end[1]); if (value !== undefined) expectedTotal = end[2] ? -value : value; }
    }
  }
  return sections > 0 && balance === undefined && total === expectedTotal ? results : null;
}

// BCA appends independently balanced rupiah and foreign-currency pockets.
export function parseBcaStatement(pages: readonly string[], month: string): PageResult[] | null {
  if (!/^REKENING TAHAPAN/m.test(pages[0] || "")) return null;
  const results: PageResult[] = [];
  let carry: number | undefined, debit = 0, credit = 0, debits = 0, credits = 0, completed = true;
  for (const text of pages) {
    const opening = text.match(/^\d{2}\/\d{2} SALDO AWAL ([\d,.]+)$/m);
    if (opening) {
      if (!completed) return null;
      carry = undefined; debit = 0; credit = 0; debits = 0; credits = 0; completed = false;
    }
    const currency = statementCurrency(text);
    let read = parseBalancePage(text, month, carry);
    if (!read && /TRANSAKSI TIDAK TERSEDIA/.test(text) && opening) {
      const initial = moneyToken(opening[1])?.sen;
      const close = text.match(/^SALDO AKHIR\s*:\s*([\d,.]+)$/m);
      if (initial !== undefined && close && moneyToken(close[1])?.sen === initial) read = { rows: [], balance: initial };
    }
    if (!read) return null;
    carry = read.balance;
    for (const row of read.rows) {
      const value = Math.round((row.exactAmount ?? row.amount) * 100);
      if (row.direction === "income") { credit += value; credits++; } else { debit += value; debits++; }
      row.currency = currency;
      row.statementAccount = text.match(/FASILITAS\s*:\s*(.+)/)?.[1].trim() || "BCA";
      if (currency !== "IDR") { row.statementAccount += ` · ${currency}`; row.check = "currency"; }
    }
    const cr = text.match(/^MUTASI CR\s*:\s*([\d,.]+)\s+(\d+)$/m);
    const db = text.match(/^MUTASI DB\s*:\s*([\d,.]+)\s+(\d+)$/m);
    if (cr || db) {
      if (!cr || !db || credit !== moneyToken(cr[1])?.sen || debit !== moneyToken(db[1])?.sen || credits !== Number(cr[2]) || debits !== Number(db[2])) return null;
      completed = true;
    }
    results.push(read);
  }
  return completed ? results : null;
}

export function parseSeaBankStatement(pages: readonly string[], month: string): PageResult[] | null {
  if (!/SEABANK ACCOUNT|NO\. REKENING SEABANK/i.test(pages[0] || "")) return null;
  const whole = (token: string) => Number(token.replace(/\./g,"")) * 100;
  const summary = pages[0].match(/^(?:SAVINGS|TABUNGAN)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/m);
  if (!summary) return null;
  const [opening, outgoing, incoming, closing] = summary.slice(1).map(whole);
  if (![opening,outgoing,incoming,closing].every(Number.isSafeInteger)) return null;
  let carry = opening, debit = 0, credit = 0;
  const results: PageResult[] = [];
  for (const page of pages) {
    const read = parseSeaBankPage(page,month,carry);
    if (!read) return null;
    for (const row of read.rows) if (row.direction === "income") credit += row.amount * 100; else debit += row.amount * 100;
    carry = read.balance; results.push(read);
  }
  return carry === closing && debit === outgoing && credit === incoming ? results : null;
}
