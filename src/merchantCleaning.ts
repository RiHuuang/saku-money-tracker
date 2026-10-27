import { Preferences } from "@capacitor/preferences";
import type { Data } from "./domain";
import { suggestMerchant } from "./merchants";

// Off by default: unknown merchant names leave the phone only after the user opts in on this device.
const key = "saku-merchant-cleaning-v1";
export const loadCleaningOptIn = async () => (await Preferences.get({ key })).value === "on";
export const saveCleaningOptIn = (enabled: boolean) => enabled ? Preferences.set({ key, value: "on" }) : Preferences.remove({ key });

// Names merchant memory doesn't know yet, limited to what the cleaning route accepts.
export function namesToClean(rows: readonly { name: string; activity: string }[], data: Pick<Data, "merchantRules" | "pockets">, limit = 20) {
  const seen = new Set<string>(), names: string[] = [];
  for (const row of rows) {
    const name = row.name.replace(/\s+/g, " ").trim(), key = name.toLocaleLowerCase("id-ID");
    if (!name || name.length > 100 || /\d{6}/.test(name) || row.activity !== "purchase" || seen.has(key) || suggestMerchant(data, name)) continue;
    seen.add(key);
    names.push(name);
    if (names.length === limit) break;
  }
  return names;
}
