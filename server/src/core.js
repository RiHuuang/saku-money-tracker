import crypto from "node:crypto";

export const hashToken = (value) => crypto.createHash("sha256").update(value).digest("hex");
export const tokenPart = () => crypto.randomBytes(32).toString("base64url");
export const sessionToken = (id, secret) => `${id}.${secret}`;
export function splitSessionToken(token) {
  const [id, secret, extra] = String(token || "").split(".");
  return id && secret && !extra ? { id, secret } : null;
}
export function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
export function avatarAfterSignIn(existing, googleAvatarPath, nextVersion) {
  if (existing?.avatarSource === "custom" && existing.avatarPath) {
    return { avatarPath: existing.avatarPath, avatarSource: "custom", avatarVersion: existing.avatarVersion || "legacy" };
  }
  const avatarPath = googleAvatarPath || existing?.avatarPath || null;
  return {
    avatarPath,
    avatarSource: avatarPath ? "google" : null,
    avatarVersion: googleAvatarPath ? nextVersion : existing?.avatarVersion || "legacy",
  };
}
export function isGoogleAvatarUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com"));
  } catch { return false; }
}
export function encryptionKey(value) {
  const key = Buffer.from(String(value || ""), "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64");
  return key;
}
export function encrypt(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
export function decrypt(value, key) {
  const bytes = Buffer.from(value, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}
export function sheetCell(value) {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}
export function validateSnapshot(value) {
  if (!value || typeof value !== "object" || value.version !== 3) throw new Error("Unsupported Saku data version");
  const limits = { accounts: 100, pockets: 1000, transactions: 100000, creditCards: 30, recurring: 500, favorites: 30, pocketTransfers: 10000, existingInstallments: 100 };
  for (const [field, limit] of Object.entries(limits)) {
    if (!Array.isArray(value[field]) || value[field].length > limit) throw new Error(`Invalid ${field}`);
  }
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > 10_000_000) throw new Error("Saku data exceeds 10 MB");
  return json;
}
export function sheetTables(data) {
  const table = (headers, rows) => [headers, ...rows.map((row) => row.map(sheetCell))];
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
