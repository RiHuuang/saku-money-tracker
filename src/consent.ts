import { recordConsentReceipt } from "./cloud";

// Cloud AI purposes and the version of the wording the user agreed to. Must match worker/consent.js.
export const CONSENT_VERSIONS = { ai_import: 1, merchant_tidy: 1, ai_budget: 1 } as const;
export type ConsentPurpose = keyof typeof CONSENT_VERSIONS;

const receiptKey = (userId: string, purpose: ConsentPurpose) => `saku-consent-receipt-v1-${userId}-${purpose}-${CONSENT_VERSIONS[purpose]}`;
const stored = (key: string) => { try { return localStorage.getItem(key) === "sent"; } catch { return false; } };

// Records the receipt on the server once per account, purpose and version; later calls are free.
export async function ensureConsentReceipt(userId: string, purpose: ConsentPurpose) {
  const key = receiptKey(userId, purpose);
  if (stored(key)) return;
  await recordConsentReceipt(userId, purpose, CONSENT_VERSIONS[purpose], true);
  try { localStorage.setItem(key, "sent"); } catch { /* Without storage the receipt is simply re-sent next time. */ }
}

export async function withdrawConsentReceipt(userId: string, purpose: ConsentPurpose) {
  try { localStorage.removeItem(receiptKey(userId, purpose)); } catch { /* Nothing cached to clear. */ }
  await recordConsentReceipt(userId, purpose, CONSENT_VERSIONS[purpose], false);
}
