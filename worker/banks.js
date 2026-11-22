// The banks and wallets Monthly check reads. Shared by the Worker (detection; prompt hints live in import-ai.js) and the app
// (account preselection, own-account transfer pairing), so both sides always agree on the list.
//
// beta: true until the bank's synthetic fixtures pass the accuracy gate in docs/monthly-check-3.0.md.
// A beta bank's new rows always go to "Needs a look"; links to rows already in Saku still work.

export const BANKS = [
  {
    id: "bri", name: "BRI", beta: true,
    signature: /\bLAPORAN TRANSAKSI FINANSIAL\b(?=[\s\S]{0,2000}\b(?:Britama|BRImo)\b)|\bbank\s+rakyat\s+indonesia\b|\bBRImo\b/i,
    account: /\bbri\b|\bbritama\b/i,
    keyword: /\bbri\b|\bbrimo\b/i,
  },
  {
    id: "blu", name: "blu by BCA", beta: true,
    // Checked before BCA: blu statements also print "BCA".
    signature: /\bbluAccount\b|\bblu\s*by\s*bca\b|\bbank\s+digital\s+bca\b|\bbca\s+digital\b/i,
    account: /\bblu\b/i,
    keyword: /\bblu\b|\bbca\s*digital\b|\bbank\s+digital\s+bca\b/i,
  },
  {
    id: "jago", name: "Jago", beta: true,
    signature: /\bbank\s+jago\b|\bpt\s+bank\s+jago\b|\bjago\s+syariah\b/i,
    account: /\bjago\b/i,
    keyword: /\bjago\b|\bartos\b/i,
  },
  {
    id: "seabank", name: "SeaBank", beta: true,
    signature: /\bsea\s?bank\b|\bbank\s+seabank\s+indonesia\b/i,
    account: /\bsea\s?bank\b/i,
    keyword: /\bsea\s?bank\b|\bbank\s+kesejahteraan\s+ekonomi\b|\bbke\b/i,
  },
  {
    id: "gopay", name: "GoPay", beta: true,
    signature: /\bE-statement\b(?=[\s\S]{0,300}\bTotal Coins\b)|\bgo-?pay\b.*\b(?:riwayat|history|transaksi|transactions?)\b|\b(?:riwayat|history)\b.*\bgo-?pay\b|\bgojek\b/i,
    account: /\bgo-?pay\b/i,
    keyword: /\bgo-?pay\b|\bgojek\b/i,
  },
  {
    id: "dana", name: "DANA", beta: true,
    signature: /\bespay\s+debit\s+indonesia\s+koe\b|\bdana\b.*\b(?:riwayat|history|transaksi|transactions?|mutasi)\b|\b(?:riwayat|history|mutasi)\b.*\bdana\b/i,
    // "Dana darurat" (emergency fund) and similar savings names are not the DANA wallet.
    account: /\bdana\b(?!\s+(?:darurat|pensiun|cadangan|tabungan|investasi|pendidikan|nikah|liburan))/i,
    keyword: /\bdana\b|\bespay\b/i,
  },
  {
    id: "bca", name: "BCA", beta: false,
    signature: /\bREKENING\s+TAHAPAN(?:\s+XPRESI)?\b|\bbank\s+central\s+asia\b|\bbca\b/i,
    account: /\bbca\b/i,
    keyword: /\bbca\b|\bbank\s+central\s+asia\b/i,
  },
  // From public 2025–26 sources (docs/audit/master-plan.md, Pass 5B); no real statement checked yet.
  {
    id: "bsi", name: "BSI", beta: true,
    // Checked before Mandiri: older BSI accounts are still named "Mandiri Syariah".
    signature: /\bpt\s+bank\s+syariah\s+indonesia\b|\bbsi\s+tabungan\b|\bbyond\s+by\s+bsi\b/i,
    account: /\bbsi\b|\bbyond\b|\bsyariah\s+(?:indonesia|mandiri)\b|\bmandiri\s+syariah\b/i,
    keyword: /\bbsi\b|\bbyond\b|\bsyariah\s+indonesia\b/i,
  },
  {
    id: "mandiri", name: "Mandiri", beta: true,
    signature: /\bpt\s+bank\s+mandiri\b|\blivin'?\s*by\s*mandiri\b|\bmandiri\s+call\s*14000\b|\btabungan\s+(?:now|mandiri)\b/i,
    account: /\bmandiri\b|\blivin\b/i,
    keyword: /\bmandiri\b|\blivin\b/i,
  },
  {
    id: "bni", name: "BNI", beta: true,
    signature: /\bpt\.?\s+bank\s+negara\s+indonesia\b|\bbni\s+taplus\b|\bwondr\s+by\s+bni\b/i,
    account: /\bbni\b|\bwondr\b/i,
    keyword: /\bbni\b|\bwondr\b/i,
  },
  {
    id: "cimb", name: "CIMB Niaga", beta: true,
    signature: /\bcimb\s+niaga\b|\bpt\s+bank\s+cimb\b/i,
    account: /\bcimb\b|\bocto\b/i,
    keyword: /\bcimb\b|\bocto\b/i,
  },
  {
    id: "permata", name: "Permata", beta: true,
    signature: /\bpt\s+bank\s+permata\b|\bpermata\s*(?:bank|me)\b/i,
    account: /\bpermata\b/i,
    keyword: /\bpermata\b/i,
  },
  {
    id: "ocbc", name: "OCBC", beta: true,
    signature: /\bpt\s+bank\s+ocbc\b|\bocbc\s+(?:nisp|indonesia)\b/i,
    account: /\bocbc\b|\bnyala\b/i,
    keyword: /\bocbc\b|\bnyala\b/i,
  },
  {
    id: "maybank", name: "Maybank", beta: true,
    signature: /\bpt\s+bank\s+maybank\b|\bmaybank\s+indonesia\b|\bringkasan\s+rekening\s+maybank\b/i,
    account: /\bmaybank\b/i,
    keyword: /\bmaybank\b/i,
  },
  {
    id: "danamon", name: "Danamon", beta: true,
    signature: /\bpt\s+bank\s+danamon\b|\bdanamon\s+indonesia\b|\bd-bank\s+pro\b/i,
    account: /\bdanamon\b|\bd-?bank\b/i,
    keyword: /\bdanamon\b|\bd-?bank\b/i,
  },
  {
    id: "btn", name: "BTN", beta: true,
    signature: /\bpt\s+bank\s+tabungan\s+negara\b|\bbal[eé]\s+by\s+btn\b/i,
    account: /\bbtn\b/i,
    keyword: /\bbtn\b|\btabungan\s+negara\b/i,
  },
  {
    id: "superbank", name: "Superbank", beta: true,
    // Checked before OVO: OVO Nabung is a Superbank account.
    signature: /\bpt\s+super\s+bank\s+indonesia\b|\bsuperbank\b/i,
    account: /\bsuper\s?bank\b|\bovo\s+nabung\b/i,
    keyword: /\bsuper\s?bank\b|\bovo\s+nabung\b/i,
  },
  {
    id: "jenius", name: "Jenius", beta: true,
    signature: /\bpt\s+bank\s+smbc\s+indonesia\b|\bjenius\b/i,
    account: /\bjenius\b/i,
    keyword: /\bjenius\b|\bsmbc\b|\bbtpn\b/i,
  },
  {
    id: "linkaja", name: "LinkAja", beta: true,
    signature: /\be-statement\s+linkaja\b|\blinkaja\b.*\b(?:riwayat|history|transaksi)\b|\b(?:riwayat|history)\b.*\blinkaja\b/i,
    account: /\blink\s?aja\b/i,
    keyword: /\blink\s?aja\b/i,
  },
  {
    id: "ovo", name: "OVO", beta: true,
    signature: /\bovo\b.*\b(?:riwayat|history|transaksi)\b|\b(?:riwayat|history)\b.*\bovo\b/i,
    account: /\bovo\b/i,
    keyword: /\bovo\b/i,
  },
  {
    id: "shopeepay", name: "ShopeePay", beta: true,
    signature: /\bshopee\s?pay\b.*\b(?:riwayat|history|transaksi)\b|\b(?:riwayat|history)\b.*\bshopee\s?pay\b/i,
    account: /\bshopee\s?pay\b|\bspay\b/i,
    keyword: /\bshopee\s?pay\b|\bshopee\b/i,
  },
];

export const BANK_IDS = BANKS.map((bank) => bank.id);
export const bankById = (id) => BANKS.find((bank) => bank.id === id);

// A loan or mortgage statement's balance is debt, not cash, so it names no bank and is never read as a ledger.
const LOAN = /\bREKENING\s+KORAN\s+KPR\b|\bSISA\s+(?:KREDIT|PINJAMAN)\b/i;

// The header names the bank; a transaction line may name another one (a transfer to Jago on a BCA statement),
// so the bank named earliest in the document wins. On a tie the list order decides (blu before BCA).
export function detectBank(text) {
  if (typeof text !== "string" || !text.trim() || LOAN.test(text)) return "";
  let best = null;
  for (const bank of BANKS) {
    const at = text.search(bank.signature);
    if (at >= 0 && (!best || at < best.at)) best = { id: bank.id, at };
  }
  return best ? best.id : "";
}

// The user's Saku account for a bank: the only account whose name names it ("BCA Utama", "Jago").
// blu accounts often read "blu BCA", so BCA never claims a name that also names blu.
export function bankOfAccount(name) {
  if (typeof name !== "string") return "";
  return BANKS.find((bank) => bank.account.test(name))?.id || "";
}
export function accountForBank(accounts, id) {
  const matches = (accounts || []).filter((name) => bankOfAccount(name) === id);
  return matches.length === 1 ? matches[0] : "";
}
// Whether a description names the account itself ("BCA Utama"), not just its bank.
export function namesAccount(text, account) {
  if (typeof text !== "string" || typeof account !== "string" || !account.trim()) return false;
  const own = account.trim().toLocaleLowerCase("id-ID").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${own}(?:$|[^\\p{L}\\p{N}])`, "u").test(text.toLocaleLowerCase("id-ID"));
}
// Whether a transaction description names the bank or wallet behind an account (or the account itself). A bank
// alone proves little: statements print the other party's bank on every transfer.
export function mentionsAccount(text, account) {
  if (typeof text !== "string" || typeof account !== "string" || !account.trim()) return false;
  const bank = bankById(bankOfAccount(account));
  return (!!bank && bank.keyword.test(text)) || namesAccount(text, account);
}
