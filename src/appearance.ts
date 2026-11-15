import { Preferences } from "@capacitor/preferences";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type ThemePreference = "system" | "light" | "dark";
const KEY = "saku-appearance-v1";
let currentPreference: ThemePreference = "system";
let nativeSystemDark: boolean | null = null;
const native = registerPlugin<{
  applyAppearance(options: { preference: ThemePreference }): Promise<void>;
  getSystemTheme(): Promise<{ systemDark: boolean }>;
  addListener(eventName: "systemThemeChanged", listener: (value: { systemDark: boolean }) => void): Promise<PluginListenerHandle>;
}>("HomeWidget");
const systemBars = registerPlugin<{ setStyle(options: { style: "LIGHT" | "DARK" }): Promise<void> }>("SystemBars");

export function normalizeTheme(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export function paintTheme(preference: ThemePreference): void {
  currentPreference = preference;
  const dark = resolveTheme(preference, nativeSystemDark ?? matchMedia("(prefers-color-scheme: dark)").matches) === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#101D18" : "#F7F6F0");
  if (Capacitor.isNativePlatform()) void systemBars.setStyle({ style: dark ? "DARK" : "LIGHT" }).catch(() => {});
}

export async function loadSystemTheme(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try { nativeSystemDark = (await native.getSystemTheme()).systemDark; }
  catch { nativeSystemDark = null; }
}

export async function loadTheme(): Promise<ThemePreference> {
  return normalizeTheme((await Preferences.get({ key: KEY })).value);
}

export async function saveTheme(preference: ThemePreference): Promise<void> {
  await Preferences.set({ key: KEY, value: preference });
  paintTheme(preference);
  if (Capacitor.isNativePlatform()) await native.applyAppearance({ preference });
}

export function watchSystemTheme(): () => void {
  const media = matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    paintTheme(currentPreference);
  };
  media.addEventListener("change", onChange);
  const nativeListener = Capacitor.isNativePlatform() ? native.addListener("systemThemeChanged", ({ systemDark }) => {
    nativeSystemDark = systemDark;
    paintTheme(currentPreference);
  }).catch(() => null) : null;
  const onVisible = () => {
    if (document.visibilityState === "visible" && Capacitor.isNativePlatform()) void loadSystemTheme().then(() => paintTheme(currentPreference));
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    media.removeEventListener("change", onChange);
    document.removeEventListener("visibilitychange", onVisible);
    if (nativeListener) void nativeListener.then((handle) => handle?.remove());
  };
}
