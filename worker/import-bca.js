// BCA-only Catch up reading. The model copies each printed field word for word; the meaning of a row
// (money in or out, what kind, who, note, date) is decided here, so it follows BCA's fixed formats exactly.

const TRANSCRIBE = `You read screenshots of the BCA mobile banking app (myBCA or BCA mobile: Account Information, Account Transactions, Mutasi Rekening, Financial Diary).
Return one JSON object: {"bank": "BCA" or "other", "rows": [...]}. Set bank to "other" when the image is not a BCA transaction list; then rows is empty.
Each transaction row on screen becomes one item, top to bottom, with four strings copied exactly as printed:
- dateText: the date block at the left of the row, joined on one line (for example "27 Oct 2026"), or "PEND" when the row shows PEND instead of a date. Never use a section heading such as "October".
- ref: the first bold line(s) of the row exactly as printed, joined with single spaces when it wraps (for example "2710/FTSCY/WS95271 55000.00 ADITYA PRATOMO").
- type: the line that names the transaction type (for example "TRSF E-BANKING CR", "KARTU KREDIT/PL", "FLAZZ BCA", "TRANSAKSI DEBIT", "SETORAN PEMINDAHAN").
- amountText: the amount line exactly as printed, for example "IDR 315,229.00". Copy every digit; do not round or reformat.
Include every row, also rows cut off at the top or bottom if their amount is visible. Do not add rows that are not on screen.`;

export function bcaMessages(input) {
  return [{ role: "system", content: TRANSCRIBE }, { role: "user", content: [
    { type: "text", text: "Copy every transaction row from this BCA screenshot." },
    { type: "image_url", image_url: { url: input.image, detail: "high" } },
  ] }];
}

// A second, independent read: rows where the two reads disagree go to review instead of being trusted.
export function bcaCheckMessages(input) {
  return [{ role: "system", content: TRANSCRIBE }, { role: "user", content: [
    { type: "text", text: "Read this BCA screenshot again from the bottom row up, digit by digit, then return the rows in top-to-bottom order." },
    { type: "image_url", image_url: { url: input.image, detail: "high" } },
  ] }];
}

export function parseBcaAnswer(answer) {
  const choice = answer?.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("AI response was cut off; split this screenshot and retry");
  const raw = choice?.message?.content ?? answer?.response;
  if (typeof raw !== "string" || raw.length > 100000) throw new Error("AI returned an unreadable response");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("AI returned incomplete JSON; retry this screenshot"); }
  if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length > 100) throw new Error("AI returned an invalid transaction list");
  const text = (value, max) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
  return { bank: parsed.bank === "other" ? "other" : "BCA", rows: parsed.rows.map((row) => ({
    dateText: text(row?.dateText, 40), ref: text(row?.ref, 160), type: text(row?.type, 60), amountText: text(row?.amountText, 40),
  })) };
}

const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, agt: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12 };
// PEND rows have no booking date yet; settlePending dates them from the rest of the screenshot.
function bcaDate(dateText) {
  if (/^pend/i.test(dateText)) return "";
  const match = dateText.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(20\d{2})$/);
  const month = match && months[match[2].toLowerCase()];
  if (!month) return "";
  const date = new Date(Date.UTC(Number(match[3]), month - 1, Number(match[1])));
  return date.getUTCDate() === Number(match[1]) ? date.toISOString().slice(0, 10) : "";
}

// BCA prints "IDR 1,234,567.00": commas group thousands and the last two digits are sen.
function bcaAmount(amountText) {
  const match = amountText.replace(/\s/g, "").match(/^(?:IDR|Rp)?(\d{1,3}(?:,\d{3})*)(?:\.(\d{2}))?$/i);
  if (!match || match[2] && match[2] !== "00") return 0;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

const title = (value) => value.toLocaleLowerCase("id-ID").replace(/(^|[\s.'-])(\p{L})/gu, (_, gap, letter) => gap + letter.toLocaleUpperCase("id-ID"));
// The sender or recipient is the trailing run of capitalised words; anything before it is the transfer note.
function splitPerson(text) {
  const words = text.split(" ").filter(Boolean);
  let start = words.length;
  while (start > 0 && /^[A-Z][A-Z.,'-]*$/.test(words[start - 1])) start--;
  return { person: title(words.slice(start).join(" ")), note: words.slice(0, start).join(" ") };
}

export function bcaRow(read) {
  const date = bcaDate(read.dateText);
  const amount = bcaAmount(read.amountText);
  const type = read.type.toUpperCase();
  const base = { date, dateEvidence: read.dateText, name: `${read.ref} ${read.type}`.trim().slice(0, 100), paymentMethod: "", amount, note: "", check: "" };
  const transfer = read.ref.match(/^\d{4}\/FT([A-Z]{2,4})\/\S+\s+(.*)$/);
  let row;
  if (/KARTU KREDIT/.test(type)) row = { ...base, cleanName: "Bayar kartu kredit BCA", direction: "expense", activity: "card_payment" };
  else if (/FLAZZ/.test(type)) row = { ...base, cleanName: "Isi saldo Flazz", paymentMethod: "Flazz", direction: "expense", activity: "topup" };
  else if (/SETORAN/.test(type)) row = { ...base, cleanName: "Setoran", direction: "income", activity: "income" };
  else if (/TRANSAKSI DEBIT/.test(type)) {
    const merchant = read.ref.replace(/^TGL:\s*\d{4}\s+QRP?\s+\d+\s+[\d.,]*\s*/i, "").trim();
    row = { ...base, cleanName: merchant || "Pembayaran QRIS", direction: "expense", activity: "purchase" };
  } else if (transfer && /\bCR$/.test(type)) {
    const [, , rest] = transfer;
    const { person, note } = splitPerson(rest.replace(/^[\d.,]+\s*/, ""));
    const embedded = Number((rest.match(/^([\d,]+)\.\d{2}\b/)?.[1] || "").replace(/,/g, ""));
    row = { ...base, cleanName: person ? `Transfer dari ${person}` : "Transfer masuk", note, direction: "income", activity: "income", check: embedded && embedded !== amount ? "amount" : "" };
  } else if (transfer && transfer[1].endsWith("VA") && /\bDB$/.test(type)) {
    const wallet = transfer[2].match(/\/\s*([A-Za-z][A-Za-z ]*?)\s*(?:-|$)/)?.[1]?.trim().toUpperCase() || "";
    row = { ...base, cleanName: wallet ? `Isi saldo ${wallet}` : "Pembayaran virtual account", paymentMethod: wallet, direction: "expense", activity: wallet ? "topup" : "purchase" };
  } else if (transfer && /\bDB$/.test(type)) {
    const rest = transfer[2];
    const { person, note } = splitPerson(rest.replace(/^[\d.,]+\s*/, ""));
    const embedded = Number((rest.match(/^([\d,]+)\.\d{2}\b/)?.[1] || "").replace(/,/g, ""));
    row = { ...base, cleanName: person ? `Transfer ke ${person}` : "Transfer keluar", note, direction: "expense", activity: "purchase", check: embedded && embedded !== amount ? "amount" : "" };
  } else if (/\bCR$/.test(type)) row = { ...base, cleanName: title(read.ref).slice(0, 60) || "Uang masuk", direction: "income", activity: "income" };
  else if (/\bDB$/.test(type)) row = { ...base, cleanName: title(read.ref).slice(0, 60) || "Uang keluar", direction: "expense", activity: "purchase" };
  else row = { ...base, cleanName: read.ref.slice(0, 60), direction: "unknown", activity: "unknown", check: "type" };
  if (!amount) row.check = "amount";
  else if (!date) row.check ||= "date";
  return row;
}

// Pairs the two reads row by row; a field that differs marks the row for review.
// A pending row takes the day after the latest booked date on the same screenshot (never later than today);
// with no booked date on screen it goes to review.
export function settlePending(rows, today) {
  const booked = rows.filter((row) => !/^pend/i.test(row.dateEvidence) && row.date).map((row) => row.date).sort();
  const latest = booked.at(-1);
  const next = latest ? new Date(Date.parse(`${latest}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : "";
  return rows.map((row) => {
    if (!/^pend/i.test(row.dateEvidence)) return row;
    if (!next) return { ...row, date: "", check: row.check || "date" };
    return { ...row, date: next > today ? today : next, check: row.check === "date" ? "" : row.check };
  });
}

export function mergeBcaReads(first, second, today) {
  return settlePending(first.rows.map((read, index) => {
    const other = second.rows[index];
    const row = bcaRow(read);
    if (!other) return { ...row, check: row.check || "unconfirmed" };
    if (other.amountText.replace(/\s/g, "") !== read.amountText.replace(/\s/g, "")) return { ...row, check: "amount" };
    if (other.type.toUpperCase() !== read.type.toUpperCase() || other.dateText !== read.dateText) return { ...row, check: row.check || "unconfirmed" };
    return row;
  }).concat(second.rows.slice(first.rows.length).map((read) => ({ ...bcaRow(read), check: "unconfirmed" }))), today);
}

export const looksLikeBcaStatement = (text) => /\bBANK CENTRAL ASIA\b|\bBCA\b/i.test(text);

export const jakartaToday = (now = Date.now()) => new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
