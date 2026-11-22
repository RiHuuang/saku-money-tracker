import { Preferences } from "@capacitor/preferences";
import type { Data } from "./domain";
import { learnMerchant, suggestMerchant } from "./merchants";

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

// Tidying runs only after rows are in the ledger (master plan 1B, HC3): a captured row still waiting in the
// inbox never leaves the phone. Names the AI returns become merchant rules, and the rows just added take the
// tidy name if the user hasn't renamed them since.
export function applyTidiedNames(data: Data, addedIds: ReadonlySet<string>, results: readonly { name: string; cleanName: string }[], now = new Date().toISOString()): Data {
  let merchantRules = data.merchantRules;
  for (const result of results) merchantRules = learnMerchant({ ...data, merchantRules }, result.name, { name: result.cleanName, pocketId: suggestMerchant({ ...data, merchantRules }, result.name)?.pocketId || "" }, now, true);
  const renames = new Map(results.filter((result) => result.cleanName.trim() && result.cleanName !== result.name).map((result) => [result.name, result.cleanName.trim()]));
  let renamed = false;
  const transactions = data.transactions.map((transaction) => {
    const next = addedIds.has(transaction.id) ? renames.get(transaction.name) : undefined;
    if (!next) return transaction;
    renamed = true;
    return { ...transaction, name: next };
  });
  return merchantRules === data.merchantRules && !renamed ? data : { ...data, merchantRules, transactions };
}
