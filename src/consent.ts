import { recordConsentReceipt } from "./cloud";

// Cloud AI purposes and the version of the wording the user agreed to. Must match worker/consent.js.
export const CONSENT_VERSIONS = { ai_import: 1, merchant_tidy: 1, ai_budget: 1, notification_reader: 1 } as const;
export type ConsentPurpose = keyof typeof CONSENT_VERSIONS;

const receiptKey = (userId: string, purpose: ConsentPurpose) => `saku-consent-receipt-v1-${userId}-${purpose}-${CONSENT_VERSIONS[purpose]}`;
const pendingKey = (userId: string, purpose: ConsentPurpose) => `saku-consent-withdraw-v1-${userId}-${purpose}`;
const stored = (key: string) => { try { return localStorage.getItem(key) === "sent"; } catch { return false; } };

// Records the receipt on the server once per account, purpose and version; later calls are free.
export async function ensureConsentReceipt(userId: string, purpose: ConsentPurpose) {
  const key = receiptKey(userId, purpose);
  // The user's latest choice is "on": an older withdrawal still waiting to be sent is dropped.
  try { localStorage.removeItem(pendingKey(userId, purpose)); } catch { /* Nothing pending. */ }
  if (stored(key)) return;
  await recordConsentReceipt(userId, purpose, CONSENT_VERSIONS[purpose], true);
  try { localStorage.setItem(key, "sent"); } catch { /* Without storage the receipt is simply re-sent next time. */ }
}

// A withdrawal is marked pending first and cleared only once the server has it, so an offline phone retries it
// (retryPendingWithdrawals runs on every app start) instead of silently forgetting.
export async function withdrawConsentReceipt(userId: string, purpose: ConsentPurpose) {
  try { localStorage.removeItem(receiptKey(userId, purpose)); localStorage.setItem(pendingKey(userId, purpose), "pending"); } catch { /* Sent below either way. */ }
  await recordConsentReceipt(userId, purpose, CONSENT_VERSIONS[purpose], false);
  try { localStorage.removeItem(pendingKey(userId, purpose)); } catch { /* Re-sending a withdrawal is harmless. */ }
}
export async function retryPendingWithdrawals(userId: string) {
  for (const purpose of Object.keys(CONSENT_VERSIONS) as ConsentPurpose[]) {
    let pending = false;
    try { pending = localStorage.getItem(pendingKey(userId, purpose)) === "pending"; } catch { /* No storage, nothing pending. */ }
    // A newer receipt (the user turned it back on) supersedes the old withdrawal.
    if (pending && stored(receiptKey(userId, purpose))) { try { localStorage.removeItem(pendingKey(userId, purpose)); } catch { /* ignore */ } continue; }
    if (pending) await withdrawConsentReceipt(userId, purpose).catch(() => { /* Next start. */ });
  }
}

export const hasConsentReceipt = (userId: string, purpose: ConsentPurpose) => stored(receiptKey(userId, purpose));

// Account deletion removes the server's receipts, so the phone's "already sent" marks go too.
export function clearConsentReceipts(userId: string) {
  for (const purpose of Object.keys(CONSENT_VERSIONS) as ConsentPurpose[]) {
    try { localStorage.removeItem(receiptKey(userId, purpose)); localStorage.removeItem(pendingKey(userId, purpose)); } catch { /* Nothing cached. */ }
  }
}

// Runs a cloud AI call with its receipt. If the server has no receipt (403 consent_required), the receipt is sent
// again and the call retried once, so a stale mark on this phone can't block the feature.
export async function withConsent<T>(userId: string, purpose: ConsentPurpose, call: () => Promise<T>): Promise<T> {
  await ensureConsentReceipt(userId, purpose);
  try { return await call(); }
  catch (error) {
    if ((error as { status?: number })?.status !== 403 || !/consent_required/.test(String((error as Error)?.message))) throw error;
    try { localStorage.removeItem(receiptKey(userId, purpose)); } catch { /* Re-sent below either way. */ }
    await ensureConsentReceipt(userId, purpose);
    return call();
  }
}
