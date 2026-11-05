// The banks and wallets Monthly check reads. Shared by the Worker (detection, prompt hints) and the app
// (account preselection, own-account transfer pairing), so both sides always agree on the list.
//
// beta: true until the bank's synthetic fixtures pass the accuracy gate in docs/monthly-check-3.0.md.
// A beta bank's new rows always go to "Needs a look"; links to rows already in Saku still work.

export const BANKS = [
  {
    id: "blu", name: "blu by BCA", beta: true,
    // Checked before BCA: blu statements also print "BCA".
    signature: /\bblu\s*by\s*bca\b|\bbank\s+digital\s+bca\b|\bbca\s+digital\b/i,
    account: /\bblu\b/i,
    keyword: /\bblu\b|\bbca\s*digital\b|\bbank\s+digital\s+bca\b/i,
    hint: "This is a blu by BCA (PT Bank Digital BCA) account history. Money moved to or from the user's own BCA account is still a transfer, not a purchase. bluSaving and bluDeposito moves inside blu are internal transfers.",
  },
  {
    id: "jago", name: "Jago", beta: true,
    signature: /\bbank\s+jago\b|\bpt\s+bank\s+jago\b|\bjago\s+syariah\b/i,
    account: /\bjago\b/i,
    keyword: /\bjago\b|\bartos\b/i,
    hint: "This is a Bank Jago account history. Moves between Kantong (pockets) inside Jago are internal transfers. 'Transfer masuk' is money in and 'Transfer keluar' is money out; keep the other party's name in name.",
  },
  {
    id: "seabank", name: "SeaBank", beta: true,
    signature: /\bsea\s?bank\b|\bbank\s+seabank\s+indonesia\b/i,
    account: /\bsea\s?bank\b/i,
    keyword: /\bsea\s?bank\b|\bbank\s+kesejahteraan\s+ekonomi\b|\bbke\b/i,
    hint: "This is a SeaBank account history. Interest (Bunga) is income; tax on interest (Pajak) is a fee. ShopeePay top-ups are topup.",
  },
  {
    id: "gopay", name: "GoPay", beta: true,
    signature: /\bgo-?pay\b.*\b(?:riwayat|history|transaksi|transactions?)\b|\b(?:riwayat|history)\b.*\bgo-?pay\b|\bgojek\b/i,
    account: /\bgo-?pay\b/i,
    keyword: /\bgo-?pay\b|\bgojek\b/i,
    hint: "This is a GoPay wallet history. Top ups (Isi saldo) are money in from a bank and are topup. GoPay Coins are rewards, not rupiah. GoPay Later is pay_later.",
  },
  {
    id: "dana", name: "DANA", beta: true,
    signature: /\bespay\s+debit\s+indonesia\s+koe\b|\bdana\b.*\b(?:riwayat|history|transaksi|transactions?|mutasi)\b|\b(?:riwayat|history|mutasi)\b.*\bdana\b/i,
    // "Dana darurat" (emergency fund) and similar savings names are not the DANA wallet.
    account: /\bdana\b(?!\s+(?:darurat|pensiun|cadangan|tabungan|investasi|pendidikan|nikah|liburan))/i,
    keyword: /\bdana\b|\bespay\b/i,
    hint: "This is a DANA wallet history. Isi saldo / Top up is money in from a bank and is topup. Kirim uang to a person is money out. DANA Paylater is pay_later.",
  },
  {
    id: "bca", name: "BCA", beta: false,
    signature: /\bbank\s+central\s+asia\b|\bbca\b/i,
    account: /\bbca\b/i,
    keyword: /\bbca\b|\bbank\s+central\s+asia\b/i,
    hint: "",
  },
];

export const BANK_IDS = BANKS.map((bank) => bank.id);
export const bankById = (id) => BANKS.find((bank) => bank.id === id);

// The header names the bank; a transaction line may name another one (a transfer to Jago on a BCA statement),
// so the bank named earliest in the document wins. On a tie the list order decides (blu before BCA).
export function detectBank(text) {
  if (typeof text !== "string" || !text.trim()) return "";
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
