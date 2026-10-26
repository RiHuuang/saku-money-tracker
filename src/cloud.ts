import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { validateData, type Data } from "./domain";
import { refreshHomeWidgets } from "./homeWidget";
import { clearNotificationInbox } from "./notificationCapture";
import { sheetChanges, sheetGridRows } from "./sheetMirror";
import { downloadSnapshot, uploadSnapshot, type SnapshotRequest } from "./snapshotTransfer";
import { acknowledgeNativeLedger, loadNativeSyncBase, saveNativeSyncBase } from "./nativeLedger";
import { mergeTransactionSnapshots } from "./transactionMerge";

type NativeSession = { signedIn: boolean; accessToken?: string; refreshToken?: string };
type Authorization = { code: string };
interface GoogleAuthPlugin {
  isConfigured(): Promise<{ configured: boolean; deviceSecure: boolean }>;
  authorize(): Promise<Authorization>;
  authorizeDrive(): Promise<Authorization>;
  saveSession(options: { accessToken: string; refreshToken: string }): Promise<void>;
  getSession(): Promise<NativeSession>;
  clearSession(): Promise<void>;
}
export type CloudState = {
  signedIn: boolean;
  configured: boolean;
  dirty: boolean;
  revision: number;
  lastSyncedAt?: string;
  spreadsheetUrl?: string;
  sheetPending?: boolean;
  changeVersion?: number;
  user?: {
    id: string;
    name: string;
    email: string;
    hasAvatar: boolean;
    avatarVersion?: string;
    avatarSource?: "google" | "custom";
    agreementVersion?: string;
  };
};
type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: NonNullable<CloudState["user"]>;
  sync: { revision: number; spreadsheetUrl: string; sheetPending?: boolean };
};

const plugin = registerPlugin<GoogleAuthPlugin>("GoogleAuth");
const stateKey = "saku-cloud-state-v1";
export const SAKU_ANDROID_BUILD = 10;
export const AGREEMENT_VERSION = "2026-10-26";
const apiUrl = Capacitor.isNativePlatform() ? (import.meta.env.VITE_SAKU_API_URL || "").replace(/\/$/, "") : "";
export const legalUrl = (page: "privacy" | "terms" | "account-deletion") => `${apiUrl}/${page}`;
const native = () => Capacitor.isNativePlatform();
const csrf = () => document.cookie.split("; ").find((part) => part.startsWith("saku_csrf="))?.slice("saku_csrf=".length) || "";
const identified = (user: CloudState["user"] | ({ id?: string; name: string; email: string; hasAvatar: boolean })) => user ? { ...user, id: user.id || user.email.toLowerCase() } : undefined;

async function publicState(): Promise<Omit<CloudState, "signedIn" | "configured">> {
  const { value } = await Preferences.get({ key: stateKey });
  if (!value) return { dirty: false, revision: 0 };
  try {
    const state = JSON.parse(value);
    return {
      dirty: Boolean(state.dirty), revision: Number.isSafeInteger(state.revision) ? state.revision : 0,
      lastSyncedAt: state.lastSyncedAt, spreadsheetUrl: state.spreadsheetUrl,
      sheetPending: Boolean(state.sheetPending),
      changeVersion: Number.isSafeInteger(state.changeVersion) ? state.changeVersion : 0,
      user: state.user && typeof state.user.email === "string" ? identified(state.user) : undefined,
    };
  } catch { return { dirty: false, revision: 0 }; }
}
async function savePublic(state: Omit<CloudState, "signedIn" | "configured">) {
  await Preferences.set({ key: stateKey, value: JSON.stringify(state) });
}
const syncBaseKey = (userId: string) => `saku-sync-base-v1-${userId}`;
async function loadSyncBase(userId: string): Promise<{ revision: number; data: Data } | null> {
  if (native()) return loadNativeSyncBase(userId);
  const { value } = await Preferences.get({ key: syncBaseKey(userId) });
  if (!value) return null;
  try {
    const base = JSON.parse(value);
    return Number.isSafeInteger(base.revision) ? { revision: base.revision, data: validateData(base.data) } : null;
  } catch { return null; }
}
async function saveSyncBase(userId: string, revision: number, data: Data) {
  if (native()) await saveNativeSyncBase(userId, revision, data);
  else await Preferences.set({ key: syncBaseKey(userId), value: JSON.stringify({ revision, data: validateData(data) }) });
}
export async function removeSyncBase(userId: string) {
  await Preferences.remove({ key: syncBaseKey(userId) });
}
/** Three-way merge of a rejected upload against the last snapshot the cloud acknowledged. */
export async function mergeWithSyncBase(local: Data, remote: Data, state: CloudState) {
  const userId = state.user?.id;
  if (!userId || (await publicState()).user?.id !== userId) return { data: null, conflicts: ["workspace"] };
  const base = await loadSyncBase(userId);
  return mergeTransactionSnapshots(base && base.revision <= state.revision ? base.data : null, local, remote);
}
export async function markCloudDirty() {
  const state = await publicState();
  if (state.user) await savePublic({ ...state, dirty: true, changeVersion: (state.changeVersion || 0) + 1 });
}
export async function loadCloudState(): Promise<CloudState> {
  const local = await publicState();
  if (!native()) {
    try {
      const result = await request("/v1/me");
      const current = local.user?.id === result.user.id ? local : { dirty: false, revision: result.sync.revision };
      const next = { ...current, user: identified(result.user), spreadsheetUrl: result.sync.spreadsheetUrl, sheetPending: result.sync.sheetPending };
      await savePublic(next);
      return { ...next, signedIn: true, configured: true };
    } catch { return { dirty: false, revision: 0, signedIn: false, configured: true }; }
  }
  const [config, session] = await Promise.all([plugin.isConfigured(), plugin.getSession()]);
  if (session.signedIn && config.configured && apiUrl) {
    try {
      const result = await request("/v1/me");
      if (local.user?.id && local.user.id !== result.user.id) {
        await plugin.clearSession();
        return { ...local, signedIn: false, configured: true };
      }
      const next = { ...local, user: identified(result.user), spreadsheetUrl: result.sync.spreadsheetUrl, sheetPending: Boolean(result.sync.sheetPending) };
      await savePublic(next);
      return { ...next, signedIn: Boolean(result.user?.id), configured: true };
    } catch (error) {
      if ([401, 404, 410].includes((error as { status?: number }).status || 0)) {
        await plugin.clearSession();
        return { ...local, signedIn: false, configured: true };
      }
      // Keep a previously authenticated workspace available offline.
    }
  }
  return { ...local, signedIn: session.signedIn && Boolean(local.user?.id), configured: config.configured && Boolean(apiUrl) };
}
let refreshing: { key: string; task: Promise<boolean> } | undefined;
async function refreshSession(session: NativeSession): Promise<boolean> {
  if (native() && (await plugin.getSession()).refreshToken !== session.refreshToken) return true;
  const key = native() ? session.refreshToken || "" : "browser";
  if (refreshing?.key === key) return refreshing.task;
  const task = (async () => {
    const headers = new Headers({ "content-type": "application/json" });
    if (native()) headers.set("x-saku-app-build", String(SAKU_ANDROID_BUILD));
    if (!native()) headers.set("x-saku-csrf", csrf());
    const response = await fetch(`${apiUrl}/v1/auth/refresh`, { method: "POST", headers, credentials: native() ? "omit" : "same-origin", body: native() ? JSON.stringify({ refreshToken: session.refreshToken }) : "{}" });
    if (!response.ok) return false;
    if (native()) {
      const tokens = await response.json();
      if ((await plugin.getSession()).refreshToken !== session.refreshToken) throw new Error("Google session changed during synchronization");
      await plugin.saveSession(tokens);
    }
    return true;
  })();
  refreshing = { key, task };
  try { return await task; }
  finally { if (refreshing?.task === task) refreshing = undefined; }
}
async function requestRaw(path: string, options: RequestInit = {}, retry = true): Promise<Response> {
  if (native() && !apiUrl) throw new Error("Cloud API is not configured in this build");
  const session = native() ? await plugin.getSession() : { signedIn: false } as NativeSession;
  const headers = new Headers(options.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (native()) headers.set("x-saku-app-build", String(SAKU_ANDROID_BUILD));
  if (session.accessToken) headers.set("authorization", `Bearer ${session.accessToken}`);
  if (!native() && options.method && options.method !== "GET") headers.set("x-saku-csrf", csrf());
  let response = await fetch(`${apiUrl}${path}`, { ...options, headers, credentials: native() ? "omit" : "same-origin" });
  if (response.status === 401 && retry && (session.refreshToken || !native())) {
    await refreshSession(session);
    // Another tab or the widget may have won the refresh race. Retry once with
    // the current cookie/native session even if this refresh lost.
    return requestRaw(path, options, false);
  }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw Object.assign(new Error(result.error || "Cloud request failed"), { status: response.status, revision: result.revision });
  }
  return response;
}
async function request(path: string, options: RequestInit = {}, retry = true): Promise<any> {
  return (await requestRaw(path, options, retry)).json();
}
function requestsFor(userId: string | undefined): SnapshotRequest {
  if (!userId) throw new Error("Sign in required");
  return async (path, options = {}) => {
    if ((await publicState()).user?.id !== userId) throw new Error("Google account changed during synchronization");
    const headers = new Headers(options.headers);
    headers.set("x-saku-user-id", userId);
    const response = await requestRaw(path, { ...options, headers });
    if ((await publicState()).user?.id !== userId) throw new Error("Google account changed during synchronization");
    return response;
  };
}
export async function extractImportPage(userId: string, page: { month: string } & ({ kind: "text"; text: string } | { kind: "image"; image: string })): Promise<{ rows: { date: string; dateEvidence: string; name: string; cleanName?: string; paymentMethod: string; amount: number; direction: "expense" | "income" | "unknown"; activity: "purchase" | "transfer" | "topup" | "card_payment" | "refund" | "income" | "fee" | "interest" | "pay_later" | "reward" | "pending" | "failed" | "unknown" }[] }> {
  const send = requestsFor(userId);
  try {
    return (await send("/v1/import/extract", { method: "POST", body: JSON.stringify(page) })).json();
  } catch (error) {
    if (error instanceof TypeError) throw new Error("Could not reach Saku Cloud. Check this device's connection and retry.");
    throw error;
  }
}
export async function signInGoogle(agreementVersion = AGREEMENT_VERSION): Promise<CloudState> {
  if (!native()) {
    window.location.assign("/auth/google/start");
    return new Promise<CloudState>(() => {});
  }
  const config = await plugin.isConfigured();
  if (!config.deviceSecure) throw new Error("Set a screen lock before signing in so Saku can protect your session");
  if (!config.configured || !apiUrl) throw new Error("Google sign-in is not configured in this build");
  const auth = await plugin.authorize();
  let response = await fetch(`${apiUrl}/v1/auth/google`, { method: "POST", headers: { "content-type": "application/json", "x-saku-app-build": String(SAKU_ANDROID_BUILD) }, body: JSON.stringify({ ...auth, agreementVersion, bounded: true }) });
  let result: AuthResponse & { error?: string; pendingToken?: string } = await response.json().catch(() => ({ error: "Cloud sign-in failed" }) as any);
  if (response.status === 202) {
    if (typeof result.pendingToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.pendingToken)) throw new Error("Invalid Google sign-in response");
    response = await fetch(`${apiUrl}/v1/auth/google/finish`, { method: "POST", headers: { "content-type": "application/json", "x-saku-app-build": String(SAKU_ANDROID_BUILD) }, body: JSON.stringify({ pendingToken: result.pendingToken }) });
    result = await response.json().catch(() => ({ error: "Cloud sign-in failed" }) as any);
  }
  if (!response.ok) throw new Error(result.error || "Cloud sign-in failed");
  await plugin.saveSession(result);
  const local = await publicState();
  const current = local.user?.id === result.user.id ? local : { dirty: false, revision: 0, changeVersion: 0 };
  const next = { ...current, signedIn: true, configured: true, dirty: false, revision: result.sync.revision, spreadsheetUrl: result.sync.spreadsheetUrl, sheetPending: Boolean(result.sync.sheetPending), user: identified(result.user) };
  await savePublic(next);
  return next;
}
export async function connectGoogleDrive(): Promise<CloudState> {
  if (!native()) {
    window.location.assign("/auth/google/drive/start");
    return new Promise<CloudState>(() => {});
  }
  const local = await publicState();
  const send = requestsFor(local.user?.id);
  const auth = await plugin.authorizeDrive();
  const result = await (await send("/v1/auth/google/drive", { method: "POST", body: JSON.stringify(auth) })).json();
  const next = { ...local, signedIn: true, configured: true, spreadsheetUrl: result.spreadsheetUrl, sheetPending: true };
  await savePublic(next);
  return next;
}
export async function pushCloud(data: Data): Promise<CloudState> {
  const local = await publicState();
  const result = await uploadSnapshot(JSON.stringify(validateData(data)), local.revision, requestsFor(local.user?.id));
  await saveSyncBase(local.user!.id, result.revision, data);
  const acknowledged = !native() || await acknowledgeNativeLedger(local.user!.id, data);
  const current = await publicState();
  if (current.user?.id !== local.user?.id) throw new Error("Google account changed during synchronization");
  const next = { ...current, signedIn: true, configured: true, dirty: !acknowledged || current.changeVersion !== local.changeVersion, revision: result.revision, lastSyncedAt: new Date().toISOString(), spreadsheetUrl: result.spreadsheetUrl, sheetPending: Boolean(result.sheetPending) };
  await savePublic(next);
  return next;
}
export async function pullCloud(): Promise<{ data: Data | null; state: CloudState }> {
  const initial = await publicState(), send = requestsFor(initial.user?.id);
  const response = await send("/v2/sync?format=manifest");
  const revision = Number(response.headers.get("x-saku-revision"));
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid cloud revision");
  let data: Data | null = null;
  if (response.status !== 204) {
    data = validateData(await downloadSnapshot(response, send));
  }
  const local = await publicState();
  if (local.user?.id !== initial.user?.id) throw new Error("Google account changed during synchronization");
  if (local.changeVersion !== initial.changeVersion) throw new Error("Local data changed during cloud download");
  if (local.dirty) return { data, state: { ...local, revision, signedIn: true, configured: true } };
  const next = { ...local, signedIn: true, configured: true, dirty: false, revision, lastSyncedAt: revision > 0 ? new Date().toISOString() : undefined, spreadsheetUrl: response.headers.get("x-saku-spreadsheet-url") || "", sheetPending: response.headers.get("x-saku-sheet-pending") === "true" };
  return { data, state: next };
}

export async function adoptCloudSnapshot(state: CloudState, explicit = false, snapshot?: Data): Promise<CloudState> {
  const current = await publicState();
  if (current.user?.id !== state.user?.id || (!explicit && (current.dirty || current.changeVersion !== state.changeVersion))) throw new Error("Local data changed during cloud download");
  if (native() && (!snapshot || !await acknowledgeNativeLedger(current.user!.id, snapshot))) throw new Error("Local data changed during cloud download");
  if (snapshot) await saveSyncBase(current.user!.id, state.revision, snapshot);
  const next = { ...current, dirty: false, revision: state.revision, lastSyncedAt: state.lastSyncedAt, spreadsheetUrl: state.spreadsheetUrl, sheetPending: state.sheetPending };
  await savePublic(next);
  return { ...next, signedIn: true, configured: true };
}

export async function resolveCloudWithLocal(state: CloudState, remote?: Data): Promise<CloudState> {
  const current = await publicState();
  if (current.user?.id !== state.user?.id) throw new Error("Google account changed during synchronization");
  // The reviewed cloud copy is what the next upload replaces, so it becomes the merge base.
  if (remote) await saveSyncBase(current.user!.id, state.revision, remote);
  const next = { ...current, revision: state.revision, dirty: true, changeVersion: (current.changeVersion || 0) + 1 };
  await savePublic(next);
  return { ...next, signedIn: true, configured: true };
}

export async function refreshCloudMetadata(): Promise<{ revision: number; state: CloudState }> {
  const local = await publicState();
  const result = await (await requestsFor(local.user?.id)("/v1/me")).json();
  const current = await publicState();
  if (current.user?.id !== result.user.id) throw new Error("Google account changed during synchronization");
  const next = { ...current, user: identified(result.user), spreadsheetUrl: result.sync.spreadsheetUrl, sheetPending: Boolean(result.sync.sheetPending) };
  await savePublic(next);
  return { revision: result.sync.revision, state: { ...next, signedIn: true, configured: true } };
}

export async function liveTicket(): Promise<{ room: string; ticket: string }> {
  const local = await publicState();
  return (await requestsFor(local.user?.id)("/v1/live-ticket", { method: "POST", body: "{}" })).json();
}

export function liveUrl(room: string, ticket: string): string {
  const url = new URL(`${apiUrl}/v1/live`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams({ room, ticket }).toString();
  return url.toString();
}

async function sheetSnapshot(kind: "baseline" | "target", send: SnapshotRequest): Promise<Data | null> {
  const response = await send(`/v2/sheets/snapshot?kind=${kind}&format=manifest`);
  if (response.status === 204) return null;
  return validateData(await downloadSnapshot(response, send));
}

export async function mirrorCloud(): Promise<CloudState> {
  const initial = await publicState();
  if (!initial.user?.id || !initial.spreadsheetUrl || !initial.sheetPending) return { ...initial, signedIn: true, configured: true };
  const send = requestsFor(initial.user.id);
  const mirrorRequest = async (path: string, options: RequestInit) => (await send(path, options)).json();
  const job: { targetRevision: number; cursor: number; total: number } = await mirrorRequest("/v2/sheets/start", { method: "POST", body: "{}" });
  const [baseline, target] = await Promise.all([sheetSnapshot("baseline", send), sheetSnapshot("target", send)]);
  if (!target) throw new Error("Sheet mirror has no backup to copy");
  const changes = sheetChanges(baseline, target);
  const plan: { cursor: number; total: number } = await mirrorRequest("/v2/sheets/plan", { method: "POST", body: JSON.stringify({ targetRevision: job.targetRevision, total: changes.length }) });
  if (plan.total !== changes.length) throw new Error("Sheet mirror plan changed");
  await mirrorRequest("/v2/sheets/grid", { method: "POST", body: JSON.stringify({ targetRevision: job.targetRevision, rows: sheetGridRows(baseline, target) }) });
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  for (let index = plan.cursor; index < changes.length; index++) {
    if (index > plan.cursor) await delay(1_200);
    for (let attempt = 0; ; attempt++) {
      try {
        await mirrorRequest("/v2/sheets/batch", { method: "POST", body: JSON.stringify({ targetRevision: job.targetRevision, index, ...changes[index] }) });
        break;
      } catch (error) {
        if (error instanceof Error && (error as Error & { status?: number }).status === 428 && attempt < 4) {
          await mirrorRequest("/v2/sheets/refresh", { method: "POST", body: "{}" });
          continue;
        }
        if (!(error instanceof Error) || (error as Error & { status?: number }).status !== 429 || attempt >= 4) throw error;
        await delay(5_000 * 2 ** attempt);
      }
    }
  }
  const result = await mirrorRequest("/v2/sheets/finish", { method: "POST", body: JSON.stringify({ targetRevision: job.targetRevision }) });
  const current = await publicState();
  if (current.user?.id !== initial.user.id) throw new Error("Google account changed during Sheet mirroring");
  const next = { ...current, sheetPending: Boolean(result.sheetPending) };
  await savePublic(next);
  return { ...next, signedIn: true, configured: true };
}
export async function signOutGoogle() {
  try { await request("/v1/auth/logout", { method: "POST", body: "{}" }, false); } catch { /* Local sign-out still wins. */ }
  if (native()) await plugin.clearSession();
  await Preferences.remove({ key: stateKey });
  await clearNotificationInbox();
  await refreshHomeWidgets();
}
export async function deleteCloudAccount() {
  const local = await publicState();
  const send = requestsFor(local.user?.id);
  let result: { driveCleanupFailed?: boolean };
  for (;;) {
    const response = await send("/v1/me", { method: "DELETE", body: "{}" });
    result = await response.json();
    if (response.status === 200) break;
    if (response.status !== 202) throw new Error("Account deletion did not finish");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (native()) await plugin.clearSession();
  await removeSyncBase(local.user!.id);
  await Preferences.remove({ key: stateKey });
  await refreshHomeWidgets();
  return result;
}
export async function updateProfile(name: string, image?: string) {
  const local = await publicState();
  const send = requestsFor(local.user?.id);
  let response: Response;
  if (image) {
    if (!image.startsWith("data:image/webp;base64,")) throw new Error("Choose a valid profile image");
    const bytes = Uint8Array.from(atob(image.slice(image.indexOf(",") + 1)), (character) => character.charCodeAt(0));
    response = await send(`/v2/me/avatar?name=${encodeURIComponent(name)}`, { method: "PUT", headers: { "content-type": "image/webp" }, body: bytes });
  } else response = await send("/v1/me", { method: "PUT", body: JSON.stringify({ name, image }) });
  const result = await response.json();
  const user = identified(result.user);
  const current = await publicState();
  if (current.user?.id !== local.user?.id) throw new Error("Google account changed during synchronization");
  await savePublic({ ...current, user });
  return { ...current, signedIn: true, configured: true, user } as CloudState;
}
export async function acceptAgreement() {
  const local = await publicState();
  const result = await (await requestsFor(local.user?.id)("/v1/me/agreement", { method: "POST", body: JSON.stringify({ agreementVersion: AGREEMENT_VERSION }) })).json();
  const current = await publicState();
  if (current.user?.id !== local.user?.id) throw new Error("Google account changed during synchronization");
  const user = identified(result.user);
  await savePublic({ ...current, user });
  return { ...current, signedIn: true, configured: true, user } as CloudState;
}
export async function cleanMerchantNames(userId: string, names: string[]): Promise<{ name: string; cleanName: string }[]> {
  return (await (await requestsFor(userId)("/v1/merchants/clean", { method: "POST", body: JSON.stringify({ names }) })).json()).results;
}
export type SignedInDevice = { id: string; label: string; createdAt: number | null; lastActiveAt: number; current: boolean };
export async function listDevices(): Promise<SignedInDevice[]> {
  const user = (await publicState()).user;
  return (await (await requestsFor(user?.id)("/v1/sessions")).json()).sessions;
}
export async function signOutDevice(id: string) {
  const user = (await publicState()).user;
  await requestsFor(user?.id)(`/v1/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export async function loadAvatarUrl(version?: string) {
  try {
    const user = (await publicState()).user;
    const response = await requestsFor(user?.id)(`/v1/me/avatar?v=${encodeURIComponent(version || "legacy")}`, { cache: "no-store" });
    return URL.createObjectURL(await response.blob());
  } catch { return ""; }
}
