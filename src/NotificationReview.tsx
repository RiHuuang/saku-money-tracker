import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BellRing, Check, ChevronDown } from "lucide-react";
import { money, type Data, type Transaction } from "./domain";
import type { ImportRow } from "./importDraft";
import { importedTransactions, importRowAccount, importRowName, importRowReady, importRowReviewIssue, importRowsNeedingDuplicateConfirmation } from "./importTransactions";
import { learnMerchant } from "./merchants";
import { cleanMerchantNames } from "./cloud";
import { loadCleaningOptIn, namesToClean } from "./merchantCleaning";
import { notificationCapture, type InboxItem } from "./notificationCapture";
import { inboxRows, type NotificationRow } from "./notificationRows";
import { ChoiceField } from "./components";
import { checkinAdjustment, checkinGap, loadCheckins, mergeCheckins, saveCheckins, type BalanceCheckin } from "./balanceCheckins";
import { localeTag, t } from "./i18n";

const friendlyDate = (date: string) => { const value = new Date(`${date}T12:00:00`); return `${value.toLocaleDateString(localeTag(), { weekday: "short" })}, ${value.toLocaleDateString(localeTag(), { day: "numeric", month: "short" })}`; };

export default function NotificationReview({ data, userId, commit, busy, notify, onCount }: {
  data: Data; userId?: string; busy: boolean; notify: (message: string) => void; onCount: (count: number) => void;
  commit: (data: Data, message: string) => Promise<boolean>;
}) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<ImportRow>>>({});
  const [expanded, setExpanded] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkins, setCheckins] = useState<BalanceCheckin[]>([]);
  useEffect(() => { void loadCheckins().then(setCheckins); }, []);
  async function updateCheckins(next: BalanceCheckin[]) { setCheckins(next); await saveCheckins(next).catch(() => {}); }
  async function acceptCheckin(checkin: BalanceCheckin) {
    try {
      if (await commit({ ...data, transactions: [...data.transactions, checkinAdjustment(data, checkin)] }, `${checkin.account} balance adjusted`)) await updateCheckins(checkins.filter((item) => item.id !== checkin.id));
    } catch { notify(t("adjustmentError")); }
  }
  const load = async () => {
    try { const next = (await notificationCapture.inbox()).items; setItems(next); onCount(next.length); }
    catch { setItems([]); notify(t("notificationReadError")); }
  };
  useEffect(() => { void load(); }, []);
  const [cleaned, setCleaned] = useState(false);
  useEffect(() => {
    if (cleaned || !items?.length || !userId) return;
    setCleaned(true);
    void (async () => {
      const names = namesToClean(inboxRows(items, data), data);
      if (!names.length || !(await loadCleaningOptIn())) return;
      try {
        // Each answer becomes a merchant rule, so a name is sent at most once.
        const results = await cleanMerchantNames(userId, names);
        const merchantRules = results.reduce((rules, result) => learnMerchant({ ...data, merchantRules: rules }, result.name, { name: result.cleanName, pocketId: "" }), data.merchantRules);
        if (merchantRules !== data.merchantRules) await commit({ ...data, merchantRules }, t("merchantNamesTidied"));
      } catch { /* Raw names stay usable; cleaning is a convenience. */ }
    })();
  }, [items, userId, cleaned]);
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
        additions.push(...created.map((transaction) => ({ ...transaction, note: `${importRowName(row) !== row.name.trim() ? `${row.name.trim()} · ` : ""}${t("notificationSource", { app: row.appName })}` })));
        if (row.direction === "expense" && row.activity === "purchase") merchantRules = learnMerchant({ ...data, merchantRules }, row.name, { name: importRowName(row), pocketId: row.pocketId });
        done.add(row.id);
        if (row.pairedWith) done.add(row.pairedWith);
      }
      if (!(await commit({ ...data, transactions: [...data.transactions, ...additions], merchantRules }, `${ready.length} notification ${ready.length === 1 ? "row" : "rows"} added`))) return;
      // A balance printed in a saved notification can be checked once its payment is in the ledger.
      const reported = ready.filter((row) => row.balance !== null && data.accounts.includes(accountFor(row))).map((row) => ({ id: row.id, account: accountFor(row), appName: row.appName, reported: row.balance!, occurredAt: row.occurredAt }));
      if (reported.length) await updateCheckins(mergeCheckins(checkins, reported));
      await remove([...done]);
    } catch { notify(t("notificationAddError")); }
    finally { setSaving(false); }
  }
  if (items === null) return <p className="loading-view">{t("loadingNotifications")}</p>;
  const openCheckins = checkins.filter((checkin) => checkinGap(data, checkin).worthAsking);
  const checkinCards = openCheckins.map((checkin) => {
    const { saku } = checkinGap(data, checkin);
    return <section className="catch-up-card balance-checkin" key={checkin.id} aria-label={t("balanceCheck", { account: checkin.account })}><BellRing size={20} /><div><strong>{t("balanceComparison", { account: checkin.account, reported: money(checkin.reported), saku: money(saku) })}</strong><small>{t("balanceSource", { app: checkin.appName, date: friendlyDate(new Date(checkin.occurredAt).toLocaleDateString("en-CA")) })}</small><div className="catch-up-actions"><button className="button primary" disabled={busy} onClick={() => void acceptCheckin(checkin)}>{t("addAdjustment")}</button><button className="button secondary" disabled={busy} onClick={() => void updateCheckins(checkins.filter((item) => item.id !== checkin.id))}>{t("dismiss")}</button></div></div></section>;
  });
  if (!rows.length) return <>{checkinCards}<section className="catchup-panel"><p className="catchup-review-empty"><BellRing size={18} /> {t("notificationsEmpty")}</p></section></>;
  return <>{checkinCards}<section className="catchup-panel catchup-review notification-review">
    <div className="catchup-panel-head"><div><h3>{t("notificationsTitle")}</h3><p>{t("notificationsHelp")}</p></div></div>
    {rows.map((row) => {
      const account = accountFor(row), rowReady = ready.includes(row), duplicate = duplicates.has(row.id), open = expanded === row.id;
      const hint = rowReady || row.decision === "skip" ? "" : importRowReviewIssue(row, account, data, duplicate);
      return <div className="catchup-row" key={row.id}>
        <button type="button" className="catchup-row-summary" aria-expanded={open} onClick={() => setExpanded(open ? "" : row.id)}>
          <span className="catchup-row-identity"><span className="catchup-row-kicker"><time dateTime={row.date}>{friendlyDate(row.date)}</time><small className="catchup-row-account">{account || t("chooseAccount")} · {row.appName}</small></span><strong>{importRowName(row)}</strong>{importRowName(row) !== row.name.trim() && <small className="catchup-row-raw">{row.name}</small>}{row.pairedWith && row.decision === "skip" ? <small className="catchup-row-hint">{t("recordedWithTransfer")}</small> : hint && <small className="catchup-row-hint">{hint}</small>}</span>
          <span className="catchup-row-figure"><strong>{row.direction === "expense" ? "−" : "+"}{money(row.amount)}</strong><small className={rowReady ? "is-ready" : ""}>{row.decision === "skip" ? t("notImporting") : rowReady ? t("willAdd") : t("openReview")}</small></span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {open && <div className="catchup-row-details">
          <div className="catchup-row-main"><label className="catchup-field">{t("description")}<input value={importRowName(row)} maxLength={100} onChange={(event) => edit(row.id, { cleanName: event.target.value })} /></label></div>
          <div className="catchup-row-meta">
            <ChoiceField className="catchup-field" label={t("sakuAccount")} value={account} onValueChange={(value) => edit(row.id, { account: value, confirmedSeparate: false })} placeholder={t("chooseUsedAccount")} options={[...data.accounts.map((item) => ({ value: item, label: item })), ...data.creditCards.map((card) => ({ value: card.name, label: card.name, description: t("creditCard") }))]} />
            {row.direction === "expense" && row.activity === "purchase" && <ChoiceField className="catchup-field" label={t("budgetPocket")} value={row.pocketId} onValueChange={(value) => edit(row.id, { pocketId: value })} options={[{ value: "", label: t("noPocket"), description: t("categorizeLater") }, ...data.pockets.map((pocket) => ({ value: pocket.id, label: pocket.name }))]} />}
            {duplicate && <label className="catchup-confirm"><input type="checkbox" checked={!!row.confirmedSeparate} onChange={(event) => edit(row.id, { confirmedSeparate: event.target.checked })} /> {t("separateTransaction")}</label>}
            <div className="catchup-decision"><strong>{t("whatToDo")}</strong><div role="group" aria-label={t("importChoiceFor", { name: importRowName(row) })}>
              <button type="button" className={row.decision === "ready" ? "selected" : ""} aria-pressed={row.decision === "ready"} onClick={() => edit(row.id, { decision: "ready" })}>{t("addToSaku")}<small>{t("includeComplete")}</small></button>
              <button type="button" className={row.decision === "later" ? "selected" : ""} aria-pressed={row.decision === "later"} onClick={() => edit(row.id, { decision: "later" })}>{t("reviewLater")}<small>{t("keepSevenDays")}</small></button>
              <button type="button" onClick={() => void remove([row.id])}>{t("dontImport")}<small>{t("removeFromPhone")}</small></button>
            </div></div>
          </div>
        </div>}
      </div>;
    })}
    <div className="catchup-save"><div><strong>{ready.length} {ready.length === 1 ? t("row") : t("rows")} {t("canAddNow")}</strong><span>{t("keptOnPhone", { count: rows.length - ready.length })}</span></div><button className="button primary" disabled={!ready.length || busy || saving} onClick={() => void save()}><Check size={16} /> {t("addClearRows", { count: ready.length, unit: ready.length === 1 ? t("row") : t("rows") })} <ArrowRight size={16} /></button></div>
  </section></>;
}
