import { Preferences } from "@capacitor/preferences";
import { Capacitor, registerPlugin } from "@capacitor/core";

export type ThemePreference = "system" | "light" | "dark";
const KEY = "saku-appearance-v1";
let currentPreference: ThemePreference = "system";
const native = registerPlugin<{ applyAppearance(options: { preference: ThemePreference }): Promise<void> }>("HomeWidget");

export function normalizeTheme(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export function paintTheme(preference: ThemePreference): void {
  currentPreference = preference;
  const dark = resolveTheme(preference, matchMedia("(prefers-color-scheme: dark)").matches) === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#101D18" : "#F7F6F0");
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
    if (currentPreference === "system" && Capacitor.isNativePlatform()) void native.applyAppearance({ preference: currentPreference });
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
