import { useState } from "react";
import { PencilLine, SlidersHorizontal, Trash2, Wallet } from "lucide-react";
import { accountBalance, money, renameAccount, type Data, type Transaction } from "./domain";
import { Modal } from "./components";
import { t } from "./i18n";

// Accounts keep their colour by their place in the account list, never by rank, so a balance change never repaints them.
// The six hues pass the palette validator on both surfaces; past six, accounts share the neutral "other" colour.
const SLOTS = 6;
export const accountColor = (data: Data, account: string) => {
  const index = data.accounts.indexOf(account);
  return index >= 0 && index < SLOTS ? `var(--account-${index + 1})` : "var(--account-other)";
};

// The cash card's own view: the same total, split by where the money actually sits.
export function AccountsOverview({ data, monthTransactions, onClose, onEdit }: {
  data: Data; monthTransactions: Transaction[]; onClose: () => void; onEdit: (account: string) => void;
}) {
  const rows = data.accounts.map((account) => {
    const own = monthTransactions.filter((item) => item.account === account && item.kind !== "card_purchase");
    return {
      account, balance: accountBalance(data, account),
      income: own.filter((item) => item.type === "income").reduce((sum, item) => sum + item.amount, 0),
      expense: own.filter((item) => item.type === "expense").reduce((sum, item) => sum + item.amount, 0),
    };
  }).sort((a, b) => b.balance - a.balance);
  const total = rows.reduce((sum, row) => sum + row.balance, 0);
  const positive = rows.filter((row) => row.balance > 0);
  const held = positive.reduce((sum, row) => sum + row.balance, 0);
  const largest = Math.max(1, ...rows.map((row) => Math.abs(row.balance)));
  return <Modal title={t("moneyByAccount")} subtitle={t("acrossAccounts", { count: data.accounts.length })} onClose={onClose}>
    <div className="accounts-overview">
      <p className="accounts-total"><small>{t("recordedCash")}</small><strong>{money(total)}</strong></p>
      {held > 0 && <div className="accounts-share" role="img" aria-label={positive.map((row) => `${row.account} ${Math.round(row.balance / held * 100)}%`).join(", ")}>
        {positive.map((row) => <i key={row.account} title={`${row.account}: ${money(row.balance)}`} style={{ flexGrow: row.balance, background: accountColor(data, row.account) }} />)}
      </div>}
      <ul className="accounts-list">
        {rows.map((row) => <li key={row.account}>
          <button type="button" onClick={() => onEdit(row.account)} aria-label={t("editAccountNamed", { account: row.account })}>
            <span className="accounts-dot" style={{ background: accountColor(data, row.account) }} aria-hidden="true" />
            <span className="accounts-name"><strong>{row.account}</strong><small>{row.income || row.expense ? t("accountMonthFlow", { income: money(row.income), expense: money(row.expense) }) : t("noActivityThisMonth")}</small></span>
            <span className="accounts-figure"><strong className={row.balance < 0 ? "is-negative" : ""}>{money(row.balance)}</strong><small>{held > 0 && row.balance > 0 ? `${Math.round(row.balance / held * 100)}%` : row.balance < 0 ? t("belowZero") : "0%"}</small></span>
            <span className="accounts-bar" aria-hidden="true"><i style={{ width: `${Math.abs(row.balance) / largest * 100}%`, background: row.balance < 0 ? "var(--danger)" : accountColor(data, row.account) }} /></span>
          </button>
        </li>)}
      </ul>
      <p className="accounts-tip">{t("accountsTip")}</p>
    </div>
  </Modal>;
}

// Rename an account, fix its balance or remove an empty one, straight from Home.
export function AccountEditor({ data, account, busy, onClose, onSave, onAdjust }: {
  data: Data; account: string; busy: boolean; onClose: () => void;
  onSave: (next: Data, message: string, renamed?: { from: string; to: string }) => Promise<boolean>; onAdjust: (account: string) => void;
}) {
  const [name, setName] = useState(account);
  const [error, setError] = useState("");
  const balance = accountBalance(data, account);
  const removable = data.accounts.length > 1 && !data.transactions.some((item) => item.account === account);
  async function rename() {
    const next = renameAccount(data, account, name);
    if (!next) { setError(name.trim() ? t("thisAccountAlreadyExists") : t("accountNameNeeded")); return; }
    if (next === data) { onClose(); return; }
    if (await onSave(next, t("accountRenamed"), { from: account, to: name.trim() })) onClose();
  }
  return <Modal title={account} subtitle={money(balance)} onClose={onClose}>
    <form className="account-editor" onSubmit={(event) => { event.preventDefault(); void rename(); }}>
      <label className="field">{t("accountName")}<input value={name} maxLength={50} onChange={(event) => { setName(event.target.value); setError(""); }} aria-invalid={!!error} aria-describedby={error ? "account-name-error" : undefined} /></label>
      {error && <p className="field-error" id="account-name-error" role="alert">{error}</p>}
      <button className="button primary" disabled={busy || name.trim() === account}><PencilLine size={16} />{t("saveName")}</button>
      <button type="button" className="button secondary" disabled={busy} onClick={() => { onClose(); onAdjust(account); }}><SlidersHorizontal size={16} />{t("fixBalance")}</button>
      {removable && <button type="button" className="button danger-button" disabled={busy} onClick={() => void onSave({ ...data, accounts: data.accounts.filter((item) => item !== account) }, t("accountRemoved")).then((ok) => { if (ok) onClose(); })}><Trash2 size={16} />{t("removeAccount")}</button>}
      {!removable && data.accounts.length > 1 && <p className="cloud-note"><Wallet size={14} /> {t("accountHasHistory")}</p>}
    </form>
  </Modal>;
}
