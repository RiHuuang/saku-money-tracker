import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BellRing, Check, Info, X } from "lucide-react";
import { money, timeOfDay, type Data, type Transaction } from "./domain";
import type { ImportRow } from "./importDraft";
import { importedTransactions, importRowAccount, importRowFirstDueMonth, importRowName, importRowReady, importRowReviewIssue, importRowsNeedingDuplicateConfirmation } from "./importTransactions";
import { learnNotificationPocket } from "./merchants";
import { cleanMerchantNames } from "./cloud";
import { applyTidiedNames, loadCleaningOptIn, namesToClean } from "./merchantCleaning";
import { withConsent } from "./consent";
import { notificationCapture, type InboxItem } from "./notificationCapture";
import { inboxReadiness, inboxRows, notificationStatusTap, type NotificationRow } from "./notificationRows";
import { ChoiceField, Modal } from "./components";
import { useRowGestures } from "./rowGestures";
import { useHiddenWhileScrollingUp } from "./scrollReveal";
import { RowStatus, type RowState } from "./RowStatus";
import { checkinAdjustment, checkinGap, loadCheckins, mergeCheckins, saveCheckins, type BalanceCheckin } from "./balanceCheckins";
import { localeTag, t } from "./i18n";

const friendlyDate = (date: string) => { const value = new Date(`${date}T12:00:00`); return `${value.toLocaleDateString(localeTag(), { weekday: "short" })}, ${value.toLocaleDateString(localeTag(), { day: "numeric", month: "short" })}`; };

export default function NotificationReview({ data, userId, commit, getCurrentData, busy, notify, onCount, onSettings, autoAdd = false, onAutoAdded }: {
  data: Data; userId?: string; busy: boolean; notify: (message: string | { message: string; action: { label: string; run: () => void } }) => void; onCount: (count: number) => void; onSettings: () => void; getCurrentData: () => Data | null;
  commit: (data: Data, message: string) => Promise<boolean>;
  // Set by the Home card's "Add N": the ready rows are added once loaded, with the usual Undo.
  autoAdd?: boolean; onAutoAdded?: () => void;
}) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<NotificationRow>>>({});
  const [editingRow, setEditingRow] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkins, setCheckins] = useState<BalanceCheckin[]>([]);
  const [captureOff, setCaptureOff] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => { void loadCheckins().then(setCheckins); }, []);
  useEffect(() => { void notificationCapture.status().then((status) => setCaptureOff(!status.granted || status.paused)).catch(() => {}); }, []);
  async function updateCheckins(next: BalanceCheckin[]) { setCheckins(next); await saveCheckins(next).catch(() => {}); }
  async function acceptCheckin(checkin: BalanceCheckin) {
    try {
      if (await commit({ ...data, transactions: [...data.transactions, checkinAdjustment(data, checkin)] }, t("accountBalanceAdjusted"))) await updateCheckins(checkins.filter((item) => item.id !== checkin.id));
    } catch { notify(t("adjustmentError")); }
  }
  const load = async () => {
    try { const next = (await notificationCapture.inbox()).items; setItems(next); onCount(next.length); }
    catch { setItems([]); notify(t("notificationReadError")); }
  };
  useEffect(() => { void load(); }, []);
  const rows = useMemo(() => inboxRows(items || [], data).map((row): NotificationRow => ({ ...row, ...edits[row.id] })), [items, data, edits]);
  const accountFor = (row: ImportRow) => importRowAccount(row, undefined, data);
  const { ready, duplicates, twinFor, look } = useMemo(() => inboxReadiness(rows, data), [rows, data]);
  // Rows the user chose to leave out stay visible as skipped (and can be changed back) until the list is saved.
  const skipped = rows.filter((row) => edits[row.id]?.decision === "skip");
  // Leaving out one half of a paired transfer leaves out its twin too, so nothing is stranded on the phone.
  const skippedIds = [...new Set(skipped.flatMap((row) => row.pairedWith ? [row.id, row.pairedWith] : [row.id]))];
  // Rows "Add N" leaves out: not ready and not skipped. Said on the button bar, never silent.
  const leftOut = look;
  // Captured rows are deleted after 7 days; warn about those within a day of it.
  const expiringSoon = rows.filter((row) => Date.now() - row.occurredAt > 6 * 86_400_000).length;
  const edit = (id: string, patch: Partial<NotificationRow>) => setEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const chooseOtherAccount = (row: NotificationRow, value: string) => {
    const twin = value ? twinFor({ ...row, counterparty: value }) : undefined;
    const previousTwin = rows.find((other) => other.id === row.pairedWith && other.id !== twin?.id);
    setEdits((current) => ({
      ...current,
      [row.id]: { ...current[row.id], counterparty: value, pairedWith: twin?.id },
      ...(previousTwin ? { [previousTwin.id]: { ...current[previousTwin.id], decision: "later" as const, pairedWith: undefined } } : {}),
      ...(twin ? { [twin.id]: { ...current[twin.id], decision: "skip" as const, pairedWith: row.id } } : {}),
    }));
  };
  const toggleTransfer = (row: NotificationRow) => {
    if (row.activity !== "transfer") { edit(row.id, { activity: "transfer", pocketId: "", decision: "later" }); return; }
    const twin = rows.find((other) => other.id === row.pairedWith);
    setEdits((current) => ({
      ...current,
      [row.id]: { ...current[row.id], activity: row.direction === "income" ? "income" : "purchase", counterparty: undefined, pairedWith: undefined, decision: "later" },
      ...(twin ? { [twin.id]: { ...current[twin.id], decision: "later" as const, pairedWith: undefined } } : {}),
    }));
  };
  const decide = (id: string, decision: ImportRow["decision"]) => {
    const row = rows.find((item) => item.id === id);
    // A row that still can't be added opens (or stays open) so its missing detail is right there to fix.
    const blocked = decision === "ready" && !!row && !(importRowReady({ ...row, decision }, accountFor(row), data) && (!duplicates.has(row.id) || row.confirmedSeparate));
    setEditingRow(blocked ? id : "");
    gestures.announce(t(blocked ? "rowNeedsLook" : decision === "ready" ? "rowWillAdd" : decision === "skip" ? "rowSkipped" : "rowLater", { name: row ? importRowName(row) : "" }));
    edit(id, { decision });
  };
  const gestures = useRowGestures({ onAdd: (id) => decide(id, "ready"), onSkip: (id) => decide(id, "skip"), onOpen: setEditingRow });
  const saveBarHidden = useHiddenWhileScrollingUp(rows.length > 4);
  const decideAll = (decision: "ready" | "skip") => {
    gestures.announce(t(decision === "ready" ? "allMarkedAdd" : "allMarkedSkip"));
    // The second half of a paired transfer stays skipped: it is saved together with its twin.
    const twins = new Set(rows.filter((row) => row.pairedWith && row.decision === "skip" && rows.some((other) => other.id === row.pairedWith && ["transfer", "topup"].includes(other.activity))).map((row) => row.id));
    setEdits((current) => ({ ...current, ...Object.fromEntries(rows.filter((row) => !twins.has(row.id)).map((row) => [row.id, { ...current[row.id], decision }])) }));
  };
  async function remove(ids: string[]) {
    await notificationCapture.removeInbox({ ids });
    setEdits((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !ids.includes(id))));
    await load();
  }
  // Sends only names of rows now in the ledger; a captured row waiting here never leaves the phone (HC3).
  async function tidySaved(owner: string, names: string[], addedIds: ReadonlySet<string>) {
    try {
      if (!(await loadCleaningOptIn())) return;
      const results = await withConsent(owner, "merchant_tidy", () => cleanMerchantNames(owner, names));
      const current = getCurrentData();
      if (!current) return;
      const next = applyTidiedNames(current, addedIds, results);
      if (next !== current) await commit(next, t("merchantNamesTidied"));
    } catch { /* Raw names stay usable; tidying is a convenience. */ }
  }
  const autoAdded = useRef(false);
  useEffect(() => {
    if (!autoAdd || autoAdded.current || items === null || busy || saving) return;
    autoAdded.current = true;
    onAutoAdded?.();
    if (ready.length) void save();
  });
  async function save() {
    if ((!ready.length && !skipped.length) || busy || saving) return;
    if (!ready.length) { setSaving(true); try { await remove(skippedIds); } catch { notify(t("notificationAddError")); } finally { setSaving(false); } return; }
    setSaving(true);
    try {
      const additions: Transaction[] = [];
      let merchantRules = data.merchantRules;
      const done = new Set<string>();
      for (const row of ready) {
        if (done.has(row.id)) continue;
        const account = accountFor(row);
        const twin = row.pairedWith ? rows.find((other) => other.id === row.pairedWith) : row.activity === "transfer" ? twinFor(row) : undefined;
        const created = importedTransactions(row, account, "notification", data, twin?.id, twin?.date);
        // The time is the notification's first post time, not when the row is added.
        additions.push(...created.map((transaction) => ({ ...transaction, time: timeOfDay(transaction.type === row.direction || !twin ? row.occurredAt : twin.occurredAt), note: `${importRowName(row) !== row.name.trim() ? `${row.name.trim()} · ` : ""}${t("notificationSource", { app: row.appName })}` })));
        if (row.direction === "expense" && row.activity === "purchase" && row.pocketId) merchantRules = learnNotificationPocket({ ...data, merchantRules }, row.name, row.pocketId);
        done.add(row.id);
        if (twin) done.add(twin.id);
      }
      // Unknown names are picked before the save (merchant memory learns them on save), but sent only after it.
      const toTidy = namesToClean(ready.filter((row) => row.direction === "expense").map((row) => ({ name: importRowName(row), activity: row.activity })), data);
      if (!(await commit({ ...data, transactions: [...data.transactions, ...additions], merchantRules }, t("notificationRowsAdded", { count: ready.length })))) return;
      const removedItems = (items || []).filter((item) => done.has(item.id) || skippedIds.includes(item.id));
      const addedIds = new Set(additions.map((transaction) => transaction.id));
      const priorCheckins = checkins;
      const priorRules = new Map(data.merchantRules.map((rule) => [rule.key, rule]));
      const changedRules = new Map(merchantRules.filter((rule) => JSON.stringify(rule) !== JSON.stringify(priorRules.get(rule.key))).map((rule) => [rule.key, rule]));
      // A balance printed in a saved notification can be checked once its payment is in the ledger.
      const reported = ready.filter((row) => row.balance !== null && data.accounts.includes(accountFor(row))).map((row) => ({ id: row.id, account: accountFor(row), appName: row.appName, reported: row.balance!, occurredAt: row.occurredAt }));
      if (reported.length) await updateCheckins(mergeCheckins(checkins, reported));
      if (toTidy.length && userId) void tidySaved(userId, toTidy, addedIds);
      await remove([...done, ...skippedIds.filter((id) => !done.has(id))]);
      notify({ message: t("notificationRowsAdded", { count: ready.length }), action: { label: t("undo"), run: () => { void (async () => {
        try {
          const current = getCurrentData();
          if (!current) { notify(t("undoUnavailable")); return; }
          await notificationCapture.restoreInbox({ items: removedItems });
          const restoredRules = current.merchantRules.flatMap((rule) => {
            const saved = changedRules.get(rule.key);
            if (!saved || JSON.stringify(saved) !== JSON.stringify(rule)) return [rule];
            const prior = priorRules.get(rule.key);
            return prior ? [prior] : [];
          });
          if (await commit({ ...current, transactions: current.transactions.filter((transaction) => !addedIds.has(transaction.id)), merchantRules: restoredRules }, t("entriesUndone"))) {
            const currentCheckins = await loadCheckins();
            const savedCheckins = mergeCheckins(priorCheckins, reported);
            const restoredCheckins = JSON.stringify(currentCheckins) === JSON.stringify(savedCheckins)
              ? priorCheckins
              : currentCheckins.filter((checkin) => !reported.some((item) => item.id === checkin.id));
            await updateCheckins(restoredCheckins);
            await load();
          }
        } catch { notify(t("notificationAddError")); }
      })(); } } });
    } catch { notify(t("notificationAddError")); }
    finally { setSaving(false); }
  }
  if (items === null) return <p className="loading-view">{t("loadingNotifications")}</p>;
  const openCheckins = checkins.filter((checkin) => checkinGap(data, checkin).worthAsking);
  const checkinCards = openCheckins.map((checkin) => {
    const { saku } = checkinGap(data, checkin);
    return <section className="catch-up-card balance-checkin" key={checkin.id} aria-label={t("balanceCheck", { account: checkin.account })}><BellRing size={20} /><div><strong>{t("balanceComparison", { account: checkin.account, reported: money(checkin.reported), saku: money(saku) })}</strong><small>{t("balanceSource", { app: checkin.appName, date: friendlyDate(new Date(checkin.occurredAt).toLocaleDateString("en-CA")) })}</small><div className="catch-up-actions"><button className="button primary" disabled={busy} onClick={() => void acceptCheckin(checkin)}>{t("addAdjustment")}</button><button className="button secondary" disabled={busy} onClick={() => void updateCheckins(checkins.filter((item) => item.id !== checkin.id))}>{t("dismiss")}</button></div></div></section>;
  });
  if (!rows.length) return <>{checkinCards}<section className="catchup-panel"><p className="catchup-review-empty"><BellRing size={18} /> {captureOff ? <>{t("notificationCaptureOff")} <button className="text-button" onClick={onSettings}>{t("openNotificationSettings")}</button></> : t("notificationsEmpty")}</p></section></>;
  return <>{checkinCards}<section className="catchup-panel catchup-review notification-review">
    <div className="catchup-panel-head"><div><h3>{t("notificationsTitle")} <button type="button" className="icon-button" aria-label={t("aboutNotifications")} aria-expanded={showHelp} onClick={() => setShowHelp((value) => !value)}><Info size={16} /></button></h3>{showHelp && <p>{t("notificationsHelp")}</p>}</div></div><div className="catchup-bulk">{expiringSoon > 0 && <p className="catchup-expiry" role="status">{t("expireSoon", { count: expiringSoon })}</p>}<div><button type="button" className="text-button" disabled={busy || saving || rows.every((row) => row.decision === "ready")} onClick={() => decideAll("ready")}><Check size={14} /> {t("addAll")}</button><button type="button" className="text-button" disabled={busy || saving || rows.every((row) => row.decision === "skip")} onClick={() => decideAll("skip")}><X size={14} /> {t("skipAll")}</button></div></div><p className="sr-only" aria-live="polite">{gestures.announcement}</p>
    {rows.map((row) => {
      const account = accountFor(row), rowReady = ready.includes(row), duplicate = duplicates.has(row.id), offset = gestures.offset(row.id);
      const state: RowState = row.decision === "skip" ? "skip" : rowReady ? "ready" : row.decision === "later" ? "later" : "review";
      const statusTap = notificationStatusTap(row.decision, rowReady);
      const hint = rowReady || row.decision === "skip" ? "" : importRowReviewIssue(row, account, data, duplicate);
      return <div className="catchup-row" key={row.id} data-state={state} data-swipe={offset > 40 ? "add" : offset < -40 ? "skip" : undefined} data-add-label={t("swipeAdd")} data-skip-label={t("swipeSkip")}>
        <button type="button" className="catchup-row-summary" aria-haspopup="dialog" style={offset ? { transform: `translateX(${offset}px)` } : undefined} {...gestures.handlers(row.id, busy || saving)}>
          <span className="catchup-row-identity"><span className="catchup-row-kicker"><time dateTime={row.date}>{friendlyDate(row.date)}</time><small className="catchup-row-account">{account || t("chooseAccount")} · {row.appName}</small></span><strong>{importRowName(row)}</strong>{importRowName(row) !== row.name.trim() && <small className="catchup-row-raw">{row.name}</small>}{row.pairedWith && row.decision === "skip" ? <small className="catchup-row-hint">{t("recordedWithTransfer")}</small> : hint && <small className="catchup-row-hint">{hint}</small>}</span>
          <span className="catchup-row-figure"><strong>{row.direction === "expense" ? "−" : "+"}{money(row.amount)}</strong></span>
        </button>
        {duplicate && !row.confirmedSeparate && row.decision !== "skip" && <div className="duplicate-choice" role="group" aria-label={t("looksLikeDuplicate")}>
          <span>{t("looksLikeDuplicate")}</span>
          <button type="button" className="text-button" onClick={() => decide(row.id, "skip")}>{t("skipRow")}</button>
          <button type="button" className="text-button" onClick={() => edit(row.id, { confirmedSeparate: true, decision: "ready" })}>{t("addAnyway")}</button>
        </div>}
        <div className="notification-row-controls">
          {row.direction === "expense" && row.activity === "purchase" && <button type="button" className="notification-pocket-chip" onClick={() => setEditingRow(row.id)}>{data.pockets.find((pocket) => pocket.id === row.pocketId)?.name || t("noPocket")}</button>}
          {row.pairedWith && row.decision === "skip" && rows.some((other) => other.id === row.pairedWith && ["transfer", "topup"].includes(other.activity)) ? <RowStatus state={state} label={t("recordedWithTransfer")} /> : <button type="button" className="notification-status-toggle" aria-label={t(statusTap === "review" ? "checkThisRow" : statusTap === "ready" ? "markRowToAdd" : "markRowToSkip")} onClick={() => statusTap === "review" ? setEditingRow(row.id) : decide(row.id, statusTap)}><RowStatus state={state} label={row.decision === "skip" ? t("notImporting") : rowReady ? t("willAdd") : row.decision === "later" ? t("reviewLater") : t("openReview")} /></button>}
        </div>
        {editingRow === row.id && <Modal title={importRowName(row)} subtitle={`${friendlyDate(row.date)} · ${row.direction === "expense" ? "−" : "+"}${money(row.amount)}`} onClose={() => setEditingRow("")}><div className="catchup-row-details">
          <div className="catchup-row-main"><label className="catchup-field">{t("description")}<input value={row.cleanName ?? importRowName(row)} placeholder={row.name} maxLength={100} onChange={(event) => edit(row.id, { cleanName: event.target.value })} /></label></div>
          <div className="catchup-row-meta">
            <ChoiceField className="catchup-field" label={t("sakuAccount")} value={account} onValueChange={(value) => edit(row.id, { account: value, confirmedSeparate: false })} placeholder={t("chooseUsedAccount")} options={[...data.accounts.map((item) => ({ value: item, label: item })), ...data.creditCards.map((card) => ({ value: card.name, label: card.name, description: t("creditCard") }))]} />
            {data.accounts.includes(account) && data.accounts.length > 1 && ["purchase", "income", "transfer"].includes(row.activity) && <button type="button" className="text-button notification-transfer-toggle" aria-pressed={row.activity === "transfer"} onClick={() => toggleTransfer(row)}>{t("movedToMyOtherAccount")}</button>}
            {(row.activity === "transfer" || row.activity === "topup") && <ChoiceField className="catchup-field" label={t("otherAccount")} value={row.counterparty || ""} onValueChange={(value) => chooseOtherAccount(row, value)} placeholder={t("chooseOtherAccount")} options={data.accounts.filter((item) => item !== account).map((item) => ({ value: item, label: item }))} />}
            {row.direction === "expense" && row.activity === "purchase" && <ChoiceField className="catchup-field" label={t("budgetPocket")} value={row.pocketId} onValueChange={(value) => edit(row.id, { pocketId: value })} options={[{ value: "", label: t("noPocket") }, ...data.pockets.map((pocket) => ({ value: pocket.id, label: pocket.name }))]} />}
            {data.creditCards.some((card) => card.name === account) && row.activity === "purchase" && <label className="catchup-field">{t("firstDueMonth")}<input type="month" min={row.date.slice(0, 7)} value={importRowFirstDueMonth(row)} onChange={(event) => edit(row.id, { firstDueMonth: event.target.value })} /></label>}
            {row.decision === "ready" && !rowReady && <p className="catchup-issue" role="status">{importRowReviewIssue(row, account, data, duplicate)}</p>}
            <div className="catchup-decision"><div role="group" aria-label={t("importChoiceFor", { name: importRowName(row) })}>
              <button type="button" className={row.decision === "ready" ? "selected" : ""} aria-pressed={row.decision === "ready"} onClick={() => decide(row.id, "ready")}>{t("addToSaku")}</button>
              <button type="button" className={row.decision === "later" ? "selected" : ""} aria-pressed={row.decision === "later"} onClick={() => decide(row.id, "later")}>{t("reviewLater")}</button>
              <button type="button" className={row.decision === "skip" ? "selected" : ""} aria-pressed={row.decision === "skip"} onClick={() => decide(row.id, "skip")}>{t("dontImport")}</button>
            </div></div>
            <button type="button" className="button primary notification-done" onClick={() => setEditingRow("")}>{t("done")}</button>
          </div>
        </div></Modal>}
      </div>;
    })}
    <div className={`catchup-save is-compact${saveBarHidden ? " is-hidden" : ""}`}><p><strong>{t("readyCount", { count: ready.length })}</strong>{skipped.length > 0 && <small>{t("skippedCount", { count: skipped.length })}</small>}{leftOut > 0 && <small>{t("needLookCount", { count: leftOut })}</small>}</p><button className="button primary" disabled={(!ready.length && !skipped.length) || busy || saving} onClick={() => void save()}>{ready.length ? t("addCount", { count: ready.length }) : t("removeSkipped", { count: skipped.length })} <ArrowRight size={16} /></button></div>
  </section></>;
}
