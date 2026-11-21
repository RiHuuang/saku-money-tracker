export type BankId = "bca" | "bri" | "jago" | "gopay" | "seabank" | "dana" | "blu"
  | "bsi" | "mandiri" | "bni" | "cimb" | "permata" | "ocbc" | "maybank" | "danamon" | "btn" | "superbank" | "jenius" | "linkaja" | "ovo" | "shopeepay";
export type Bank = { id: BankId; name: string; beta: boolean; signature: RegExp; account: RegExp; keyword: RegExp };
export const BANKS: Bank[];
export const BANK_IDS: BankId[];
export function bankById(id: string): Bank | undefined;
export function detectBank(text: string): BankId | "";
export function bankOfAccount(name: string): BankId | "";
export function accountForBank(accounts: readonly string[], id: string): string;
export function namesAccount(text: string, account: string): boolean;
export function mentionsAccount(text: string, account: string): boolean;
