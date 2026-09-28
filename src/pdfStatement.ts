import { parseMoney, uid, validAmount, validDate, type BankRow } from "./domain";

export type SourceLine = { id: string; page: number; text: string };
export type PdfCandidate = BankRow & {
  page: number;
  sourceLine: string;
  sourceId: string;
  issues: string[];
  accepted: boolean;
  manualConfirmed?: boolean;
};
export type PdfDraft = {
  id: string;
  file: string;
  account: string;
  lines: SourceLine[];
  candidates: PdfCandidate[];
  stage: string;
  progress: number;
  error?: string;
  balanceIssue?: string;
};

const amountTokens = (s: string) =>
  [...s.matchAll(/(?:Rp\.?\s*)?[+-]?(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi)]
    .map((m) => m[0]);

const monthAliases = [
  [], ["JAN"], ["FEB"], ["MAR"], ["APR"], ["MEI", "MAY"], ["JUN"],
  ["JUL"], ["AGU", "AUG"], ["SEP"], ["OKT", "OCT"], ["NOV"], ["DES", "DEC"],
];

const normalizeModelDate = (value: unknown, sourceLine = "", statementMonth = "") => {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  const sourceDate = sourceLine.toUpperCase().match(new RegExp(`\\b(\\d{1,2})[-/\\s](${monthAliases.flat().join("|")})\\b`));
  const sourceMonth = sourceDate && monthAliases.findIndex((aliases) => aliases.includes(sourceDate[2]));
  const year = raw.match(/\b(20\d{2})\b/)?.[1] || statementMonth.slice(0, 4);
  if (sourceDate && sourceMonth && sourceMonth > 0 && year)
    return `${year}-${String(sourceMonth).padStart(2, "0")}-${sourceDate[1].padStart(2, "0")}`;
  const sourceNumeric = sourceLine.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (sourceNumeric && year)
    return `${year}-${sourceNumeric[2].padStart(2, "0")}-${sourceNumeric[1].padStart(2, "0")}`;
  const numeric = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (numeric) return `${numeric[3]}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  const named = raw.toUpperCase().match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/);
  const month = named && monthAliases.findIndex((aliases) => aliases.includes(named[2]));
  return named && month && month > 0
    ? `${named[3]}-${String(month).padStart(2, "0")}-${named[1].padStart(2, "0")}`
    : raw;
};

const statementMetadata = (line: string) =>
  /^(?:period|statement date|opening balance|closing balance|saldo awal|saldo akhir|saldo sebelumnya|account number|card number|nomor rekening|nomor kartu)\b/i.test(line.trim());

export function evidenceIssues(candidate: Pick<PdfCandidate, "date" | "name" | "amount" | "type" | "sourceLine">): string[] {
  const issues: string[] = [];
  if (!validDate(candidate.date)) issues.push("Check the date");
  if (!candidate.name.trim() || candidate.name.length > 100) issues.push("Check the description");
  if (!validAmount(candidate.amount)) issues.push("Check the amount");
  if (candidate.type !== "income" && candidate.type !== "expense") issues.push("Check the direction");
  const present = amountTokens(candidate.sourceLine).some((token) =>
    (["id", "en"] as const).some((format) => {
      try { return Math.abs(parseMoney(token, format)) === candidate.amount; }
      catch { return false; }
    }),
  );
  if (validAmount(candidate.amount) && !present) issues.push("Amount not found in source text");
  if (validDate(candidate.date)) {
    const [year, month, day] = candidate.date.split("-");
    const namedDates = monthAliases[Number(month)].flatMap((name) =>
      [" ", "-", "/"].flatMap((separator) => [`${Number(day)}${separator}${name}`, `${day}${separator}${name}`]));
    const source = candidate.sourceLine.toUpperCase();
    const dateVisible = [candidate.date, `${Number(day)}/${Number(month)}/${year}`, `${day}/${month}/${year}`, `${Number(day)}-${Number(month)}-${year}`, `${day}-${month}-${year}`, `${Number(day)}/${Number(month)}`, `${day}/${month}`, `${Number(day)}-${Number(month)}`, `${day}-${month}`, ...namedDates]
      .some((value) => source.includes(value.toUpperCase()));
    if (!dateVisible) issues.push("Date not found in source line");
  }
  return issues;
}

export function parseModelRows(response: string, lines: SourceLine[], file: string, account: string, statementMonth = ""): PdfCandidate[] {
  const clean = response.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed: unknown = JSON.parse(clean);
  const rows = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown })?.rows;
  if (!Array.isArray(rows) || rows.length > lines.length) throw new Error("Model returned invalid transaction rows");
  const byId = new Map(lines.map((line) => [line.id, line]));
  const used = new Set<string>();
  return rows.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("Model returned an invalid row");
    const r = raw as Record<string, unknown>;
    if (typeof r.lineId !== "string" || !byId.has(r.lineId) || used.has(r.lineId))
      throw new Error("Model cited a missing or repeated source line");
    used.add(r.lineId);
    const source = byId.get(r.lineId)!;
    const date = normalizeModelDate(r.date, source.text, statementMonth);
    let amount = typeof r.amount === "number" ? r.amount : 0;
    if (typeof r.amount === "string") {
      for (const format of ["id", "en"] as const) {
        try { amount = Math.abs(parseMoney(r.amount, format)); break; } catch { /* Try the other known format. */ }
      }
    }
    const rawType = typeof r.type === "string" ? r.type.toLowerCase().trim() : "";
    const sourceMarker = source.text.match(/\b(CR|CREDIT|KREDIT|DB|DEBIT|DEBET)\b/i);
    const sourceType = sourceMarker && /^(?:CR|CREDIT|KREDIT)$/i.test(sourceMarker[1]) ? "income"
      : sourceMarker ? "expense" : "";
    if (sourceMarker?.index !== undefined) {
      const beforeMarker = source.text.slice(0, sourceMarker.index).trim();
      const transactionToken = amountTokens(beforeMarker).at(-1);
      if (transactionToken && beforeMarker.endsWith(transactionToken)) {
        for (const format of ["id", "en"] as const) {
          try { amount = Math.abs(parseMoney(transactionToken, format)); break; } catch { /* Try the other known format. */ }
        }
      }
    }
    const incomeTypes = ["income", "credit", "cr", "kredit", "in", "money in", "refund", "payment"];
    const expenseTypes = ["expense", "debit", "db", "debet", "out", "money out", "purchase", "charge", "withdrawal"];
    const type = sourceType || (incomeTypes.includes(rawType) ? "income" : "expense");
    const candidate: PdfCandidate = {
      id: uid(), file, account, page: source.page, sourceId: source.id,
      sourceLine: source.text, name: typeof r.name === "string" ? r.name.trim().slice(0, 100) : "",
      date, amount, type,
      issues: [], accepted: false,
    };
    candidate.issues = evidenceIssues(candidate);
    if (!sourceType && ![...incomeTypes, ...expenseTypes].includes(rawType)) candidate.issues.push("Check the direction");
    return candidate;
  }).filter((candidate) => !statementMetadata(candidate.sourceLine)
    && (validDate(candidate.date) || validAmount(candidate.amount)));
}

export const hasTransactionEvidence = (candidate: PdfCandidate) =>
  validDate(candidate.date) && validAmount(candidate.amount)
  && !candidate.issues.includes("Amount not found in source text")
  && !candidate.issues.includes("Date not found in source line");

export function parseDeterministicBankRows(
  lines: SourceLine[], file: string, account: string, statementMonth: string,
): PdfCandidate[] {
  return lines.flatMap((source) => {
    const marker = source.text.match(/\b(CR|CREDIT|KREDIT|DB|DEBIT|DEBET)\b/i);
    const dateToken = source.text.match(/\b\d{1,2}[/-]\d{1,2}\b/);
    const namedDates = [...source.text.matchAll(new RegExp(`\\b\\d{1,2}[-/](${monthAliases.flat().join("|")})\\b`, "gi"))];
    if ((!marker || marker.index === undefined || !dateToken) && namedDates.length === 0) return [];
    const rowEnd = marker?.index === undefined ? source.text.length : marker.index;
    const beforeMarker = source.text.slice(0, rowEnd).trim();
    const amountToken = amountTokens(beforeMarker).at(-1);
    if (!amountToken || !beforeMarker.endsWith(amountToken)) return [];
    let amount = 0;
    for (const format of ["id", "en"] as const) {
      try { amount = Math.abs(parseMoney(amountToken, format)); break; } catch { /* Try the other known format. */ }
    }
    const printedDate = dateToken?.[0] || namedDates[0]?.[0] || "";
    const date = normalizeModelDate(`${statementMonth.slice(0, 4)}-${printedDate}`, source.text, statementMonth);
    const amountAt = beforeMarker.lastIndexOf(amountToken);
    const lastPrintedDate = namedDates.at(-1)?.[0] || printedDate;
    const dateAt = beforeMarker.lastIndexOf(lastPrintedDate);
    const name = beforeMarker.slice(dateAt + lastPrintedDate.length, amountAt).trim().slice(0, 100);
    const type = marker && /^(?:CR|CREDIT|KREDIT)$/i.test(marker[1]) ? "income" : "expense";
    const candidate: PdfCandidate = {
      id: uid(), file, account, page: source.page, sourceId: source.id, sourceLine: source.text,
      date, name, amount, type, issues: [], accepted: false,
    };
    candidate.issues = evidenceIssues(candidate);
    return hasTransactionEvidence(candidate) && name ? [candidate] : [];
  });
}

export function statementContext(lines: SourceLine[]): string {
  const pages = [...new Set(lines.map((line) => line.page))];
  const seen = new Set<string>();
  const samples: SourceLine[] = [];
  for (const line of lines) {
    if (!/\b\d{1,2}[/-](?:\d{1,2}|[A-Z]{3})\b/i.test(line.text)) continue;
    const shape = line.text.toUpperCase()
      .replace(/\d[\d.,/-]*/g, "#")
      .replace(/[A-Z]{3,}/g, "TEXT")
      .replace(/\s+/g, " ");
    const key = `${line.page}:${shape}`;
    if (seen.has(key)) continue;
    seen.add(key); samples.push(line);
  }
  const headers = pages.flatMap((page) => lines.filter((line) => line.page === page).slice(0, 3));
  const chosen = [...headers, ...samples].filter((line, index, all) => all.findIndex((item) => item.id === line.id) === index);
  let context = `Pages: ${pages.join(", ")}. These samples cover every page and distinct dated row shape. A trailing amount after DB/CR is usually the running balance.\n`;
  for (const line of chosen) {
    const next = `${line.id}: ${line.text}\n`;
    if (context.length + next.length > 3_000) break;
    context += next;
  }
  return context.trim();
}

export function extractionPrompt(lines: SourceLine[], month: string, documentContext = ""): string {
  const ids = lines.map((line) => line.id).join(",");
  return `/no_think\nReturn only one compact JSON object with a "rows" array. Do not explain or copy this instruction. Each row has exactly lineId, date, name, amount, and type.\nWhole-statement layout context:\n${documentContext || "No additional layout samples."}\nRules:\n- Extract only from the Lines section. Context explains layout only.\n- lineId must be one of: ${ids}\n- Include only a transaction, purchase, payment, refund, transfer, fee, or interest row. Ignore statement dates, periods, card/account numbers, headers, balances, limits, currency-conversion detail lines, and totals.\n- date is YYYY-MM-DD and uses the date printed on that line. Infer only the year from ${month}; never replace a printed transaction month with the statement month. Indonesian months are JAN,FEB,MAR,APR,MEI,JUN,JUL,AGU,SEP,OKT,NOV,DES.\n- amount is a positive whole-rupiah JSON number without separators. On a bank row with DB or CR, use the amount immediately before DB or CR; the final amount is the balance. Otherwise use the final rupiah amount.\n- type is exactly "expense" for debit/out/card purchase or "income" for credit/in/payment/refund.\n- Omit any uncertain row. Never invent a value.\nLines:\n${lines.map((l) => `${l.id}: ${l.text}`).join("\n")}\nJSON:`;
}

export function balanceIssue(lines: SourceLine[], candidates: PdfCandidate[]): string {
  const labeled = (pattern: RegExp) => {
    const line = lines.find((item) => pattern.test(item.text));
    if (!line) return null;
    const tokens = amountTokens(line.text);
    const last = tokens.at(-1);
    if (!last) return null;
    for (const format of ["id", "en"] as const) {
      try { return parseMoney(last, format); } catch { /* Try the other format. */ }
    }
    return null;
  };
  const opening = labeled(/\b(opening balance|saldo awal|saldo sebelumnya)\b/i);
  const closing = labeled(/\b(closing balance|saldo akhir)\b/i);
  if (opening === null || closing === null) return "Opening or closing balance was not recognized; check totals manually.";
  const calculated = opening + candidates.reduce((sum, c) => sum + (c.type === "income" ? c.amount : -c.amount), 0);
  return calculated === closing ? "" : "Statement balances do not equal extracted transactions; review missing or incorrect rows.";
}
