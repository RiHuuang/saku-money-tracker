import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BellRing, Check, ChevronDown } from "lucide-react";
import { money, type Data, type Transaction } from "./domain";
import type { ImportRow } from "./importDraft";
import { importedTransactions, importRowAccount, importRowName, importRowReady, importRowReviewIssue, importRowsNeedingDuplicateConfirmation } from "./importTransactions";
import { learnMerchant } from "./merchants";
import { notificationCapture, type InboxItem } from "./notificationCapture";
import { inboxRows, type NotificationRow } from "./notificationRows";
import { ChoiceField } from "./components";

const friendlyDate = (date: string) => { const value = new Date(`${date}T12:00:00`); return `${value.toLocaleDateString("en-GB", { weekday: "short" })}, ${value.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`; };

export default function NotificationReview({ data, commit, busy, notify, onCount }: {
  data: Data; busy: boolean; notify: (message: string) => void; onCount: (count: number) => void;
  commit: (data: Data, message: string) => Promise<boolean>;
}) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<ImportRow>>>({});
  const [expanded, setExpanded] = useState("");
  const [saving, setSaving] = useState(false);
  const load = async () => {
    try { const next = (await notificationCapture.inbox()).items; setItems(next); onCount(next.length); }
    catch { setItems([]); notify("Captured notifications could not be read on this phone."); }
  };
  useEffect(() => { void load(); }, []);
  const rows = useMemo(() => inboxRows(items || [], data).map((row): NotificationRow => ({ ...row, ...edits[row.id] })), [items, data, edits]);
  const accountFor = (row: ImportRow) => importRowAccount(row, undefined, data);
  // Statement-style matching: same account, day, amount and direction counts as a possible duplicate whatever it was named.
  const duplicates = useMemo(() => importRowsNeedingDuplicateConfirmation(rows, data.transactions, accountFor, () => false, true), [rows, data]);
  const ready = rows.filter((row) => importRowReady(row, accountFor(row), data) && (!duplicates.has(row.id) || row.confirmedSeparate));
  const edit = (id: string, patch: Partial<ImportRow>) => setEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  async function remove(ids: string[]) {
    await notificationCapture.removeInbox({ ids });
    setEdits((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !ids.includes(id))));
    await load();
  }
  async function save() {
    if (!ready.length || busy || saving) return;
    setSaving(true);
    try {
      const additions: Transaction[] = [];
      let merchantRules = data.merchantRules;
      const done = new Set<string>();
      for (const row of ready) {
        const account = accountFor(row);
        const created = importedTransactions(row, account, "notification", data, row.pairedWith);
        additions.push(...created.map((transaction) => ({ ...transaction, note: `${importRowName(row) !== row.name.trim() ? `${row.name.trim()} · ` : ""}From ${row.appName} notification` })));
        if (row.direction === "expense" && row.activity === "purchase") merchantRules = learnMerchant({ ...data, merchantRules }, row.name, { name: importRowName(row), pocketId: row.pocketId });
        done.add(row.id);
        if (row.pairedWith) done.add(row.pairedWith);
      }
      if (!(await commit({ ...data, transactions: [...data.transactions, ...additions], merchantRules }, `${ready.length} notification ${ready.length === 1 ? "row" : "rows"} added`))) return;
      await remove([...done]);
    } catch { notify("Some rows could not be added. Check them and try again."); }
    finally { setSaving(false); }
  }
  if (items === null) return <p className="loading-view">Loading captured notifications...</p>;
  if (!rows.length) return <section className="catchup-panel"><p className="catchup-review-empty"><BellRing size={18} /> No captured notifications waiting. New payments from your enabled bank and wallet apps appear here.</p></section>;
  return <section className="catchup-panel catchup-review notification-review">
    <div className="catchup-panel-head"><div><h3>From your notifications</h3><p>Captured on this phone and kept for 7 days. Only what you add joins your ledger.</p></div></div>
    {rows.map((row) => {
      const account = accountFor(row), rowReady = ready.includes(row), duplicate = duplicates.has(row.id), open = expanded === row.id;
      const hint = rowReady || row.decision === "skip" ? "" : importRowReviewIssue(row, account, data, duplicate);
      return <div className="catchup-row" key={row.id}>
        <button type="button" className="catchup-row-summary" aria-expanded={open} onClick={() => setExpanded(open ? "" : row.id)}>
          <span className="catchup-row-identity"><span className="catchup-row-kicker"><time dateTime={row.date}>{friendlyDate(row.date)}</time><small className="catchup-row-account">{account || "Choose account"} · {row.appName}</small></span><strong>{importRowName(row)}</strong>{importRowName(row) !== row.name.trim() && <small className="catchup-row-raw">{row.name}</small>}{row.pairedWith && row.decision === "skip" ? <small className="catchup-row-hint">Recorded with the matching transfer.</small> : hint && <small className="catchup-row-hint">{hint}</small>}</span>
          <span className="catchup-row-figure"><strong>{row.direction === "expense" ? "−" : "+"}{money(row.amount)}</strong><small className={rowReady ? "is-ready" : ""}>{row.decision === "skip" ? "Not importing" : rowReady ? "Will add" : "Open to review"}</small></span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {open && <div className="catchup-row-details">
          <div className="catchup-row-main"><label className="catchup-field">Description<input value={importRowName(row)} maxLength={100} onChange={(event) => edit(row.id, { cleanName: event.target.value })} /></label></div>
          <div className="catchup-row-meta">
            <ChoiceField className="catchup-field" label="Saku account" value={account} onValueChange={(value) => edit(row.id, { account: value, confirmedSeparate: false })} placeholder="Choose the account used" options={[...data.accounts.map((item) => ({ value: item, label: item })), ...data.creditCards.map((card) => ({ value: card.name, label: card.name, description: "Credit card" }))]} />
            {row.direction === "expense" && row.activity === "purchase" && <ChoiceField className="catchup-field" label="Budget pocket (optional)" value={row.pocketId} onValueChange={(value) => edit(row.id, { pocketId: value })} options={[{ value: "", label: "No pocket", description: "Categorize this later" }, ...data.pockets.map((pocket) => ({ value: pocket.id, label: pocket.name }))]} />}
            {duplicate && <label className="catchup-confirm"><input type="checkbox" checked={!!row.confirmedSeparate} onChange={(event) => edit(row.id, { confirmedSeparate: event.target.checked })} /> This is a separate transaction</label>}
            <div className="catchup-decision"><strong>What should Saku do with this?</strong><div role="group" aria-label={`Import choice for ${importRowName(row)}`}>
              <button type="button" className={row.decision === "ready" ? "selected" : ""} aria-pressed={row.decision === "ready"} onClick={() => edit(row.id, { decision: "ready" })}>Add to Saku<small>Include when details are complete</small></button>
              <button type="button" className={row.decision === "later" ? "selected" : ""} aria-pressed={row.decision === "later"} onClick={() => edit(row.id, { decision: "later" })}>Review later<small>Keep it here for up to 7 days</small></button>
              <button type="button" onClick={() => void remove([row.id])}>Don't import<small>Remove it from this phone</small></button>
            </div></div>
          </div>
        </div>}
      </div>;
    })}
    <div className="catchup-save"><div><strong>{ready.length} {ready.length === 1 ? "row" : "rows"} can be added now</strong><span>{rows.length - ready.length} kept for review on this phone.</span></div><button className="button primary" disabled={!ready.length || busy || saving} onClick={() => void save()}><Check size={16} /> Add {ready.length} clear {ready.length === 1 ? "row" : "rows"} <ArrowRight size={16} /></button></div>
  </section>;
}
