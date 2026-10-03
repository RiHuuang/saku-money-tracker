import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { validateData, type Data } from "./domain";
import { refreshHomeWidgets } from "./homeWidget";

type NativeSession = { signedIn: boolean; accessToken?: string; refreshToken?: string };
type Authorization = { code: string };
interface GoogleAuthPlugin {
  isConfigured(): Promise<{ configured: boolean; deviceSecure: boolean }>;
  authorize(): Promise<Authorization>;
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
  };
};
type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: NonNullable<CloudState["user"]>;
  sync: { revision: number; spreadsheetUrl: string };
};

const plugin = registerPlugin<GoogleAuthPlugin>("GoogleAuth");
const stateKey = "saku-cloud-state-v1";
export const AGREEMENT_VERSION = "2026-10-03";
const apiUrl = (import.meta.env.VITE_SAKU_API_URL || "").replace(/\/$/, "");
export const legalUrl = (page: "privacy" | "terms" | "account-deletion") => `${apiUrl}/${page}`;
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
export async function markCloudDirty() {
  const state = await publicState();
  if (state.user) await savePublic({ ...state, dirty: true, changeVersion: (state.changeVersion || 0) + 1 });
}
export async function loadCloudState(): Promise<CloudState> {
  const local = await publicState();
  if (!Capacitor.isNativePlatform()) return { ...local, signedIn: false, configured: false };
  const [config, session] = await Promise.all([plugin.isConfigured(), plugin.getSession()]);
  if (session.signedIn && !local.user?.id && config.configured && apiUrl) {
    try {
      const result = await request("/v1/me");
      const next = { ...local, user: identified(result.user), revision: result.sync.revision, spreadsheetUrl: result.sync.spreadsheetUrl };
      await savePublic(next);
      return { ...next, signedIn: Boolean(result.user?.id), configured: true };
    } catch { /* The login screen will recover an expired legacy session. */ }
  }
  return { ...local, signedIn: session.signedIn && Boolean(local.user?.id), configured: config.configured && Boolean(apiUrl) };
}
async function request(path: string, options: RequestInit = {}, retry = true): Promise<any> {
  if (!apiUrl) throw new Error("Cloud API is not configured in this build");
  const session = await plugin.getSession();
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  if (session.accessToken) headers.set("authorization", `Bearer ${session.accessToken}`);
  let response = await fetch(`${apiUrl}${path}`, { ...options, headers });
  if (response.status === 401 && retry && session.refreshToken) {
    const refreshed = await fetch(`${apiUrl}/v1/auth/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: session.refreshToken }) });
    if (refreshed.ok) {
      const tokens = await refreshed.json();
      await plugin.saveSession(tokens);
      return request(path, options, false);
    }
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || "Cloud request failed"), { status: response.status, revision: result.revision });
  return result;
}
export async function signInGoogle(agreementVersion = AGREEMENT_VERSION): Promise<CloudState> {
  if (!Capacitor.isNativePlatform()) throw new Error("Google sign-in is available in the Android app");
  const config = await plugin.isConfigured();
  if (!config.deviceSecure) throw new Error("Set a screen lock before signing in so Saku can protect your session");
  if (!config.configured || !apiUrl) throw new Error("Google sign-in is not configured in this build");
  const auth = await plugin.authorize();
  const response = await fetch(`${apiUrl}/v1/auth/google`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...auth, agreementVersion }) });
  const result: AuthResponse & { error?: string } = await response.json().catch(() => ({ error: "Cloud sign-in failed" }) as any);
  if (!response.ok) throw new Error(result.error || "Cloud sign-in failed");
  await plugin.saveSession(result);
  const local = await publicState();
  const next = { ...local, signedIn: true, configured: true, revision: result.sync.revision, spreadsheetUrl: result.sync.spreadsheetUrl, user: identified(result.user) };
  await savePublic(next);
  return next;
}
export async function pushCloud(data: Data): Promise<CloudState> {
  const local = await publicState();
  const result = await request("/v1/sync", { method: "PUT", body: JSON.stringify({ baseRevision: local.revision, data: validateData(data) }) });
  const current = await publicState();
  const next = { ...current, signedIn: true, configured: true, dirty: current.changeVersion !== local.changeVersion, revision: result.revision, lastSyncedAt: new Date().toISOString(), spreadsheetUrl: result.spreadsheetUrl, sheetPending: Boolean(result.sheetPending) };
  await savePublic(next);
  return next;
}
export async function pullCloud(): Promise<{ data: Data | null; state: CloudState }> {
  const result = await request("/v1/sync");
  const local = await publicState();
  const next = { ...local, signedIn: true, configured: true, dirty: false, revision: result.revision, lastSyncedAt: new Date().toISOString(), spreadsheetUrl: result.spreadsheetUrl };
  await savePublic(next);
  return { data: result.data ? validateData(result.data) : null, state: next };
}
export async function signOutGoogle() {
  try { await request("/v1/auth/logout", { method: "POST", body: "{}" }, false); } catch { /* Local sign-out still wins. */ }
  await plugin.clearSession();
  await Preferences.remove({ key: stateKey });
  await refreshHomeWidgets();
}
export async function deleteCloudAccount() {
  await request("/v1/me", { method: "DELETE", body: "{}" });
  await plugin.clearSession();
  await Preferences.remove({ key: stateKey });
  await refreshHomeWidgets();
}
export async function updateProfile(name: string, image?: string) {
  const result = await request("/v1/me", { method: "PUT", body: JSON.stringify({ name, image }) });
  const local = await publicState();
  const user = identified(result.user);
  await savePublic({ ...local, user });
  return { ...local, signedIn: true, configured: true, user } as CloudState;
}
export async function loadAvatarUrl(version?: string) {
  const session = await plugin.getSession();
  if (!session.accessToken || !apiUrl) return "";
  const response = await fetch(`${apiUrl}/v1/me/avatar?v=${encodeURIComponent(version || "legacy")}`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${session.accessToken}` },
  });
  return response.ok ? URL.createObjectURL(await response.blob()) : "";
}
