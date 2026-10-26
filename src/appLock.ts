import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

export type LockAfter = 0 | 60 | 300;
export type AppLockSettings = { enabled: boolean; after: LockAfter; hideInRecents: boolean };
type AppLockPlugin = {
  status(): Promise<{ available: boolean; reason: string }>;
  authenticate(options: { title: string }): Promise<{ authenticated: boolean; message?: string }>;
  setSecure(options: { secure: boolean }): Promise<void>;
};

// Device-local on purpose: a lock protects this phone, so it never syncs with the ledger.
const key = "saku-app-lock-v1";
const plugin = registerPlugin<AppLockPlugin>("AppLock");
export const defaultAppLock: AppLockSettings = { enabled: false, after: 0, hideInRecents: false };
export const appLockSupported = () => Capacitor.isNativePlatform();

export function parseAppLock(value: string | null): AppLockSettings {
  try {
    const raw = JSON.parse(value || "null");
    return { enabled: raw?.enabled === true, after: [0, 60, 300].includes(raw?.after) ? raw.after : 0, hideInRecents: raw?.hideInRecents === true };
  } catch { return defaultAppLock; }
}
export function shouldLock(settings: AppLockSettings, hiddenAt: number | null, now: number) {
  return settings.enabled && hiddenAt !== null && now - hiddenAt >= settings.after * 1000;
}
export async function loadAppLock() {
  return appLockSupported() ? parseAppLock((await Preferences.get({ key })).value) : defaultAppLock;
}
export async function saveAppLock(settings: AppLockSettings) {
  await Preferences.set({ key, value: JSON.stringify(settings) });
  await applyRecentsPrivacy(settings);
}
export async function applyRecentsPrivacy(settings: AppLockSettings) {
  if (appLockSupported()) await plugin.setSecure({ secure: settings.enabled && settings.hideInRecents });
}
export const appLockStatus = () => appLockSupported() ? plugin.status() : Promise.resolve({ available: false, reason: "web" });
export async function authenticate(title: string) {
  try { return (await plugin.authenticate({ title })).authenticated; }
  catch { return false; }
}
