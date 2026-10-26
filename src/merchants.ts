import type { Data, MerchantRule } from "./domain";

export const MERCHANT_RULE_LIMIT = 500;
const markers = /\b(?:QRIS|TRSF|E-?BANKING|DB|CR)\b/g;
const cities = /(?:\s+(?:JKT|JAKARTA|JAKSEL|JAKBAR|JAKPUS|JAKUT|JAKTIM|BDG|BANDUNG|SBY|SURABAYA|DPS|DENPASAR|MDN|MEDAN|SMG|SEMARANG|YOG|JOG|YK|BKS|BEKASI|TNG|TANGERANG|DPK|DEPOK|BGR|BOGOR|MLG|MALANG|SLO|SOLO|PLM|MKS|BTM|IDN|ID))+$/;
const titleCase = (value: string) => value.toLocaleLowerCase("id-ID").replace(/(^|[\s/&-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toLocaleUpperCase("id-ID"));

// Bank and wallet texts wrap the same merchant in rails, codes and branch places; strip those so one store maps to one key.
export function normalizeMerchant(raw: string) {
  const plain = raw.toLocaleUpperCase("id-ID").replace(/\*/g, " ").replace(markers, " ").replace(/\S*\d{3,}\S*/g, " ").replace(/[^\p{L}\p{N}&/'.-]+/gu, " ").replace(/\s+/g, " ").trim();
  return titleCase(plain.replace(cities, "").replace(/^[\s./&'-]+|[\s./&'-]+$/g, "").trim());
}
export const merchantKey = (raw: string) => normalizeMerchant(raw).toLocaleLowerCase("id-ID");

export function suggestMerchant(data: Pick<Data, "merchantRules" | "pockets">, raw: string): { name: string; pocketId: string } | null {
  const key = merchantKey(raw);
  const rule = key ? data.merchantRules.find((item) => item.key === key) : undefined;
  return rule ? { name: rule.name, pocketId: data.pockets.some((pocket) => pocket.id === rule.pocketId) ? rule.pocketId : "" } : null;
}

// Remember what the user settled on whenever it differs from what Saku would have suggested.
export function learnMerchant(data: Pick<Data, "merchantRules" | "pockets">, raw: string, final: { name: string; pocketId: string }, now = new Date().toISOString()): MerchantRule[] {
  const key = merchantKey(raw), name = final.name.trim().slice(0, 100);
  if (!key || !name) return data.merchantRules;
  const suggestion = suggestMerchant(data, raw);
  if (suggestion && suggestion.name.toLocaleLowerCase("id-ID") === name.toLocaleLowerCase("id-ID") && suggestion.pocketId === final.pocketId) return data.merchantRules;
  const next = [...data.merchantRules.filter((rule) => rule.key !== key), { key, name, pocketId: final.pocketId, updatedAt: now }];
  return next.length > MERCHANT_RULE_LIMIT ? [...next].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(-MERCHANT_RULE_LIMIT) : next;
}
