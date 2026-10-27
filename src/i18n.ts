import { Preferences } from "@capacitor/preferences";
import { en } from "./locales/en";
import { id } from "./locales/id";

export type LanguagePreference = "system" | "id" | "en";
const KEY = "saku-language-v1";
let activeLanguage: "id" | "en" = typeof navigator !== "undefined" && /^id(?:-|$)/i.test(navigator.language) ? "id" : "en";

export function resolveLanguage(preference: LanguagePreference, deviceLanguage = typeof navigator === "undefined" ? "en" : navigator.language): "id" | "en" {
  return preference === "system" ? /^id(?:-|$)/i.test(deviceLanguage) ? "id" : "en" : preference;
}
export function setActiveLanguage(preference: LanguagePreference): void { activeLanguage = resolveLanguage(preference); }
export function localeTag(): string { return activeLanguage === "id" ? "id-ID" : "en-GB"; }
export function t(key: keyof typeof en, values: Record<string, string | number> = {}): string {
  const phrase = activeLanguage === "id" ? id[key] : en[key];
  return phrase.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}
export async function loadLanguage(): Promise<LanguagePreference> {
  const value = (await Preferences.get({ key: KEY })).value;
  return value === "id" || value === "en" ? value : "system";
}
export async function saveLanguage(preference: LanguagePreference): Promise<void> {
  await Preferences.set({ key: KEY, value: preference });
  setActiveLanguage(preference);
}
