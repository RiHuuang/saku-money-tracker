import { Preferences } from "@capacitor/preferences";
import type { en } from "./locales/en";

// Only the active language is downloaded (master plan 4.5); main.tsx waits for it before the first render.
type Dictionary = Record<keyof typeof en, string>;
const dictionaries: Partial<Record<"id" | "en", Dictionary>> = {};
export function registerDictionary(language: "id" | "en", dictionary: Dictionary) { dictionaries[language] = dictionary; }

export type LanguagePreference = "system" | "id" | "en";
const KEY = "saku-language-v1";
let activeLanguage: "id" | "en" = typeof navigator !== "undefined" && /^id(?:-|$)/i.test(navigator.language) ? "id" : "en";

export function resolveLanguage(preference: LanguagePreference, deviceLanguage = typeof navigator === "undefined" ? "en" : navigator.language): "id" | "en" {
  return preference === "system" ? /^id(?:-|$)/i.test(deviceLanguage) ? "id" : "en" : preference;
}
export function setActiveLanguage(preference: LanguagePreference): void { activeLanguage = resolveLanguage(preference); }
export async function prepareLanguage(preference: LanguagePreference): Promise<void> {
  const language = resolveLanguage(preference);
  if (dictionaries[language]) return;
  dictionaries[language] = language === "id" ? (await import("./locales/id")).id : (await import("./locales/en")).en;
}
export function localeTag(): string { return activeLanguage === "id" ? "id-ID" : "en-GB"; }
export function t(key: keyof typeof en, values: Record<string, string | number> = {}): string {
  // Falls back to whichever language is loaded while a switch is still downloading.
  const phrase = (dictionaries[activeLanguage] ?? dictionaries.en ?? dictionaries.id)?.[key] ?? key;
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
