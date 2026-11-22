import { recordConsentReceipt } from "./cloud";

// Consent purposes and the version of the wording the user agreed to. Must match worker/consent.js.
export const CONSENT_VERSIONS = { ai_import: 1, merchant_tidy: 1, ai_budget: 1, notification_reader: 1 } as const;
export type ConsentPurpose = keyof typeof CONSENT_VERSIONS;

// Per account and purpose the phone keeps the user's latest choice and whether the server has it. Changes for one
// purpose are sent one at a time, and each send carries the choice as it is when the send starts, so the server
// always ends on the latest choice: offline toggles, quick on-off-on taps and failed requests all settle.
type Choice = { want: "on" | "off"; synced: boolean };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type Send = (userId: string, purpose: ConsentPurpose, version: number, granted: boolean) => Promise<unknown>;

export function createConsentStore(storage: () => Storage | undefined, send: Send) {
  const key = (userId: string, purpose: ConsentPurpose) => `saku-consent-receipt-v1-${userId}-${purpose}-${CONSENT_VERSIONS[purpose]}`;
  const read = (userId: string, purpose: ConsentPurpose): Choice | null => {
    try {
      const value = storage()?.getItem(key(userId, purpose));
      if (!value) return null;
      // Earlier builds of this change stored "sent" for a receipt the server had.
      if (value === "sent") return { want: "on", synced: true };
      const parsed = JSON.parse(value) as Choice;
      return parsed.want === "on" || parsed.want === "off" ? { want: parsed.want, synced: parsed.synced === true } : null;
    } catch { return null; }
  };
  const write = (userId: string, purpose: ConsentPurpose, choice: Choice) => { try { storage()?.setItem(key(userId, purpose), JSON.stringify(choice)); } catch { /* Without storage, each call sends again. */ } };
  const queues = new Map<string, Promise<void>>();

  // Sends the current choice if the server doesn't have it yet. Queued per account and purpose.
  function sync(userId: string, purpose: ConsentPurpose): Promise<void> {
    const id = `${userId}|${purpose}`;
    const run = async () => {
      const choice = read(userId, purpose);
      if (!choice || choice.synced) return;
      await send(userId, purpose, CONSENT_VERSIONS[purpose], choice.want === "on");
      // Marked synced only if the choice didn't change while the request was out; otherwise the next send follows.
      const now = read(userId, purpose);
      if (now && now.want === choice.want) write(userId, purpose, { want: choice.want, synced: true });
    };
    const next = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(run);
    queues.set(id, next);
    return next;
  }

  function choose(userId: string, purpose: ConsentPurpose, want: "on" | "off") {
    const current = read(userId, purpose);
    if (current?.want !== want || !current.synced) write(userId, purpose, { want, synced: current?.want === want && current.synced });
    return sync(userId, purpose);
  }

  return {
    // The user consented (a tap that names the purpose); resolves once the server has the receipt.
    ensure: (userId: string, purpose: ConsentPurpose) => choose(userId, purpose, "on"),
    withdraw: (userId: string, purpose: ConsentPurpose) => choose(userId, purpose, "off"),
    // The user's latest choice on this phone, whether or not it has reached the server yet.
    isOn: (userId: string, purpose: ConsentPurpose) => read(userId, purpose)?.want === "on",
    // Choices that failed to send (offline) go out again; runs on each app start.
    retry: async (userId: string) => {
      for (const purpose of Object.keys(CONSENT_VERSIONS) as ConsentPurpose[]) await sync(userId, purpose).catch(() => undefined);
    },
    // Account deletion removes the server's receipts, so the phone's record goes too.
    clear: (userId: string) => {
      for (const purpose of Object.keys(CONSENT_VERSIONS) as ConsentPurpose[]) { try { storage()?.removeItem(key(userId, purpose)); } catch { /* Nothing stored. */ } }
    },
    // The server lost the receipt (403 consent_required): send it again.
    resend: (userId: string, purpose: ConsentPurpose) => { write(userId, purpose, { want: "on", synced: false }); return sync(userId, purpose); },
  };
}

const store = createConsentStore(() => (typeof localStorage === "undefined" ? undefined : localStorage), recordConsentReceipt);
export const ensureConsentReceipt = store.ensure;
export const withdrawConsentReceipt = store.withdraw;
export const hasConsentReceipt = store.isOn;
export const retryPendingWithdrawals = store.retry;
export const clearConsentReceipts = store.clear;

// Runs a cloud AI call with its receipt. If the server has none (403 consent_required), the receipt is sent again
// and the call retried once, so a stale record on this phone can't block the feature.
export const withConsent = <T>(userId: string, purpose: ConsentPurpose, call: () => Promise<T>) => withConsentFor(store, userId, purpose, call);
export async function withConsentFor<T>(store: ReturnType<typeof createConsentStore>, userId: string, purpose: ConsentPurpose, call: () => Promise<T>): Promise<T> {
  await store.ensure(userId, purpose);
  try { return await call(); }
  catch (error) {
    if ((error as { status?: number })?.status !== 403 || !/consent_required/.test(String((error as Error)?.message))) throw error;
    // If the user turned it off while the call was out, the 403 is right: never turn it back on for them.
    if (!store.isOn(userId, purpose)) throw error;
    await store.resend(userId, purpose);
    return call();
  }
}
