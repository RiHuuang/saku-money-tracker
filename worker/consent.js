// Consent receipts for cloud AI (master plan 1B, HC5). One row per user and purpose: the version the user agreed to,
// when, and when they withdrew. AI routes check it before any text, image or name reaches Workers AI.

export const CONSENT_VERSIONS = Object.freeze({
  // Statement pages, screenshots and the names used to match them (Catch up).
  ai_import: 1,
  // Merchant names of rows already in the ledger ("Tidy merchant names with AI").
  merchant_tidy: 1,
  // Pocket names and amounts sent when the user asks AI to suggest a plan.
  ai_budget: 1,
});

export const CONSENT_TABLE = "CREATE TABLE IF NOT EXISTS consents (uid TEXT NOT NULL, purpose TEXT NOT NULL, version INTEGER NOT NULL, granted_at INTEGER NOT NULL, withdrawn_at INTEGER, PRIMARY KEY(uid, purpose))";

const ROUTE_PURPOSES = Object.freeze({
  "/v1/import/extract": "ai_import",
  "/v1/import/match": "ai_import",
  "/v1/merchants/clean": "merchant_tidy",
  "/v1/budget/suggest": "ai_budget",
});

export const consentPurposeFor = (path) => ROUTE_PURPOSES[path] || null;

export function validateConsentInput(input) {
  const purpose = typeof input?.purpose === "string" ? input.purpose : "";
  if (!Object.hasOwn(CONSENT_VERSIONS, purpose)) throw new Error("Unknown consent purpose");
  if (input.version !== CONSENT_VERSIONS[purpose]) throw new Error("Agree to the current version");
  if (typeof input.granted !== "boolean") throw new Error("Say whether consent is granted or withdrawn");
  return { purpose, version: input.version, granted: input.granted };
}

export async function recordConsent(db, uid, { purpose, version, granted }, now = Date.now()) {
  await db.prepare(CONSENT_TABLE).run();
  if (granted) {
    await db.prepare("INSERT INTO consents(uid,purpose,version,granted_at,withdrawn_at) VALUES(?,?,?,?,NULL) ON CONFLICT(uid,purpose) DO UPDATE SET version=excluded.version, granted_at=excluded.granted_at, withdrawn_at=NULL")
      .bind(uid, purpose, version, now).run();
  } else {
    await db.prepare("UPDATE consents SET withdrawn_at=? WHERE uid=? AND purpose=? AND withdrawn_at IS NULL").bind(now, uid, purpose).run();
  }
  return { purpose, version, granted, at: now };
}

export async function hasConsent(db, uid, purpose) {
  await db.prepare(CONSENT_TABLE).run();
  const row = await db.prepare("SELECT version FROM consents WHERE uid=? AND purpose=? AND withdrawn_at IS NULL").bind(uid, purpose).first();
  return Boolean(row) && row.version === CONSENT_VERSIONS[purpose];
}
