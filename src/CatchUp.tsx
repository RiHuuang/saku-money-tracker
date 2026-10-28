import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, FileImage, FileText, LockKeyhole, RotateCcw, Upload, X } from "lucide-react";
import { extractImportPage } from "./cloud";
import { money, reconcile, today, uid, validAmount, validDate, type BankRow, type Data, type Transaction } from "./domain";
import { deleteImportDraft, importConsentKey, listImportDrafts, putImportDraft, type ImportDraft, type ImportRow } from "./importDraft";
import { runImportSources } from "./importFlow";
import { learnMerchant, suggestMerchant } from "./merchants";
import { openImportPages } from "./importPages";
import { ChoiceField, Modal } from "./components";
import { localeTag, t } from "./i18n";
import { applySharedSourceDate, bcaAccount, confirmedImportAccount, detectImportAccount, prepareBcaRow, importRowName, importedTransactions, importMatchesNeedSourceDateCheck, importPatchNeedsSourceRecheck, importRowAccount, importRowAlreadySaved, importRowReady, importRowReviewIssue, importRowsNeedingDuplicateConfirmation, suggestImportDecision, usesDeferredFunding } from "./importTransactions";

const readConsent = (owner: string) => { try { return localStorage.getItem(importConsentKey(owner)) === "granted"; } catch { return false; } };
const isImage = (name: string) => !/\.pdf$/i.test(name);
const friendlyDate = (date: string) => { const value = new Date(`${date}T12:00:00`); return `${value.toLocaleDateString(localeTag(), { weekday: "short" })}, ${value.toLocaleDateString(localeTag(), { day: "numeric", month: "short" })}`; };
const activityOptions = (): { value: ImportRow["activity"]; label: string }[] => [
  { value: "purchase", label: t("activityPurchase") }, { value: "fee", label: t("activityFee") },
  { value: "refund", label: t("activityRefund") }, { value: "income", label: t("activityOtherIncome") }, { value: "interest", label: t("activityInterest") },
  { value: "transfer", label: t("activityTransfer") }, { value: "topup", label: t("activityTopup") },
  { value: "card_payment", label: t("activityCardPayment") }, { value: "pay_later", label: t("activityPayLater") },
  { value: "reward", label: t("activityReward") }, { value: "pending", label: t("activityPending") },
  { value: "failed", label: t("activityFailed") }, { value: "unknown", label: t("activityUnknown") },
];
class LocalDraftWriteError extends Error {}
export default function CatchUp({ data, month, userId, commit, busy, notify, statementMode = false }: {
  data: Data; month: string; userId?: string;
  commit: (data: Data, message: string) => Promise<boolean>;
  busy: boolean; notify: (message: string) => void; statementMode?: boolean;
}) {
  const owner = userId || "local";
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [processing, setProcessing] = useState(false);
  const [activePage, setActivePage] = useState<{ sourceId: string; page: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [consented, setConsented] = useState(() => readConsent(owner));
  const [consentAsk, setConsentAsk] = useState(false);
  const [info, setInfo] = useState("");
  const [previewId, setPreviewId] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [deleteConfirmationId, setDeleteConfirmationId] = useState("");
  const [editingRow, setEditingRow] = useState("");
  const [swipe, setSwipe] = useState<{ id: string; dx: number } | null>(null);
  const gesture = useRef<{ id: string; x: number; y: number; moved: boolean; held: boolean; touch: boolean; timer: number } | null>(null);
  // Rows keep the place they first appeared in, so choosing one never makes the list jump.
  const rowOrder = useRef(new Map<string, number>());
  const [sharedDates, setSharedDates] = useState<Record<string, string>>({});
  const [selectedMatches, setSelectedMatches] = useState<string[]>([]);
  const cancelled = useRef(false);
  const processingRef = useRef(false);
  const savingRef = useRef(false);
  const draftRef = useRef<ImportDraft | null>(null);
  const persisted = useRef(new Map<string, ImportDraft>());
  const writeTail = useRef<Promise<void>>(Promise.resolve());
  const save = async (next: ImportDraft) => {
    draftRef.current = next; setDraft(next);
    setDrafts((items) => [...items.filter((item) => item.id !== next.id), next].sort((a, b) => b.createdAt - a.createdAt));
    const write = writeTail.current.then(() => putImportDraft(next));
    writeTail.current = write.catch(() => {});
    try { await write; persisted.current.set(next.id, next); }
    catch {
      const previous = persisted.current.get(next.id);
      setDrafts((items) => items.flatMap((item) => item.id === next.id && item === next ? previous ? [previous] : [] : [item]));
      if (draftRef.current === next) { draftRef.current = persisted.current.get(next.id) || null; setDraft(draftRef.current); }
      setInfo(t("draftSaveError"));
      throw new LocalDraftWriteError(t("localDraftNotSaved"));
    }
  };
  useEffect(() => {
    let live = true;
    void listImportDrafts(owner).then((items) => { if (live) { persisted.current = new Map(items.map((item) => [item.id, item])); setDrafts(items); setDraft(items[0] || null); setSelectedMatches([]); draftRef.current = items[0] || null; } }).catch(() => { if (live) setInfo(t("draftUnavailable")); });
    return () => { live = false; cancelled.current = true; };
  }, [owner]);
  useEffect(() => { setConsented(readConsent(owner)); setConsentAsk(false); }, [owner]);
  const preview = draft?.sources.find((source) => source.id === previewId);
  useEffect(() => {
    if (!preview) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(preview.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview?.file]);
  const accountForRow = (row: ImportRow) => importRowAccount(row, draft?.sources.find((source) => source.id === row.sourceId), data);
  const rowSaved = (row: ImportRow) => importRowAlreadySaved(row, draft, data);
  const sourceHasSavedRows = (sourceId: string) => (draft?.rows || []).some((row) => row.sourceId === sourceId && rowSaved(row));
  const duplicateRows = useMemo(() => importRowsNeedingDuplicateConfirmation(draft?.rows || [], data.transactions, (row) => importRowAccount(row, draft?.sources.find((source) => source.id === row.sourceId), data), (row) => importRowAlreadySaved(row, draft, data), statementMode), [draft, data, statementMode]);
  const needsSeparateConfirmation = (row: ImportRow) => duplicateRows.has(row.id);
  const ready = (draft?.rows || []).filter((row) => importRowReady(row, accountForRow(row), data) && !rowSaved(row) && (!needsSeparateConfirmation(row) || row.confirmedSeparate));
  // Screenshots crop and scroll, so their rows are compared once by eye; statement pages are complete documents.
  const uncheckedDateSources = (draft?.sources || []).filter((source) => !source.datesChecked && isImage(source.name) && ready.some((row) => row.sourceId === source.id));
  const readySpending = ready.filter((row) => row.direction === "expense" && ["purchase", "fee", "pay_later"].includes(row.activity)).reduce((total, row) => total + row.amount, 0);
  const readyIncome = ready.filter((row) => row.direction === "income" && ["refund", "income", "interest"].includes(row.activity)).reduce((total, row) => total + row.amount, 0);
  const readyMovementCount = ready.filter((row) => ["transfer", "topup", "card_payment"].includes(row.activity)).length;
  const needsReview = (draft?.rows || []).filter((row) => !rowSaved(row) && (row.decision === "later" || (row.decision === "ready" && !ready.includes(row))));
  const undatedSources = (draft?.sources || []).filter((source) => draft?.rows.some((row) => row.sourceId === source.id && !row.date && row.decision !== "skip" && !rowSaved(row)));
  const setAside = (draft?.rows || []).filter((row) => !rowSaved(row) && row.decision === "skip");
  const statementRows: BankRow[] = (draft?.rows || []).filter((row) => row.decision !== "skip" && !!accountForRow(row) && validDate(row.date) && validAmount(row.amount) && row.direction !== "unknown" && !["pending", "failed", "reward", "unknown"].includes(row.activity) && (row.activity !== "pay_later" && !usesDeferredFunding(row) || data.creditCards.some((card) => card.name === accountForRow(row)))).map((row) => ({ id: row.id, file: draft?.sources.find((source) => source.id === row.sourceId)?.name || "", account: accountForRow(row), date: row.date, name: row.name, amount: row.amount, type: row.direction as "income" | "expense" }));
  const comparisons = reconcile(statementRows, data.transactions, draft?.month || month);
  const exactMatches = comparisons.filter((row) => row.status === "matched");
  const unverifiedMatches = exactMatches.filter((row) => !data.transactions.find((transaction) => transaction.id === row.matchId)?.verified);
  const matchesToConfirm = unverifiedMatches.filter((row) => selectedMatches.includes(row.matchId));
  const matchSourceIds = new Set(unverifiedMatches.map((match) => draft?.rows.find((row) => row.id === match.id)?.sourceId));
  const dateCheckSources = (draft?.sources || []).filter((source) => ready.some((row) => row.sourceId === source.id) || statementMode && matchSourceIds.has(source.id));
  const selectedMatchesNeedDateCheck = importMatchesNeedSourceDateCheck(draft, matchesToConfirm);
  const hasFilesToProcess = !!draft?.sources.some((source) => !source.pageCount || source.processedPages < source.pageCount);
  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    if (processingRef.current || savingRef.current) { setInfo(t("waitImport")); return; }
    if (!userId) { setInfo(t("signInSources")); return; }
    let next = draftRef.current;
    if (!next || next.owner !== owner || next.month !== month) next = { id: uid(), owner, month, sources: [], rows: [], saved: [], createdAt: Date.now() };
    const chosen = Array.from(files);
    const eligible = chosen.filter((file) => /\.pdf$/i.test(file.name) ? file.size <= 20_000_000 : /\.(png|jpe?g|webp)$/i.test(file.name) && file.size <= 12_000_000);
    const accepted = eligible.slice(0, Math.max(0, 10 - next.sources.length));
    const skipped = chosen.length - accepted.length;
    const sources = accepted.map((file) => ({ id: uid(), name: file.name, account: bcaAccount(data), accountConfirmed: !!bcaAccount(data), accountDetected: !!bcaAccount(data), file, processedPages: 0, pageCount: 0 }));
    if (!sources.length) { setInfo(next.sources.length >= 10 ? t("draftFull") : t("chooseValidFiles")); return; }
    try { await save({ ...next, sources: [...next.sources, ...sources] }); }
    catch { setInfo(t("filesSaveError")); return; }
    setDrafts(await listImportDrafts(owner));
    setInfo([t(sources.length === 1 ? "sourceAddedOne" : "sourcesAdded", { count: sources.length }), skipped ? t("sourcesSkipped", { count: skipped }) : ""].filter(Boolean).join(" "));
  }
  async function extract(consentGiven = consented) {
    if (!draftRef.current || !userId || processingRef.current || savingRef.current) return;
    if (!consentGiven) { setConsentAsk(true); return; }
    const draftId = draftRef.current.id;
    const sources = draftRef.current.sources;
    processingRef.current = true; cancelled.current = false; setProcessing(true); setInfo("");
    try {
      const failedSources = await runImportSources(sources, () => cancelled.current, async (source) => {
        const current = draftRef.current?.sources.find((item) => item.id === source.id);
        if (!current || current.processedPages >= current.pageCount && current.pageCount > 0) return;
        setInfo(t("preparingSource", { name: current.name }));
        let documentPages;
        try { documentPages = await openImportPages(current.file); }
        catch (error) {
          if (error instanceof Error && /password/i.test(error.message)) {
            const password = window.prompt(t("pdfPasswordPrompt", { name: current.name })) || "";
            if (!password) throw new Error(t("pdfPasswordRequired"));
            documentPages = await openImportPages(current.file, password);
          } else throw error;
        }
        for await (const page of documentPages.pages) {
          if (page.number <= current.processedPages) continue;
          if (cancelled.current) break;
          if (draftRef.current?.id !== draftId || draftRef.current.owner !== owner) break;
          setActivePage({ sourceId: current.id, page: page.number, total: documentPages.count });
          setInfo(t("extractingSourcePage", { name: current.name, page: page.number, total: documentPages.count }));
          const answer = await extractImportPage(userId, { month: draftRef.current.month, source: "bca", ...page.content });
          // A pause requested during inference still keeps the completed page.
          if (draftRef.current?.id !== draftId || draftRef.current.owner !== owner) break;
          const reviewMonth = draftRef.current.month;
          const rows: ImportRow[] = answer.rows.map((result) => {
            const remembered = suggestMerchant(data, result.name) || (result.cleanName ? suggestMerchant(data, result.cleanName) : null);
            const row = { ...result, ...(remembered ? { cleanName: remembered.name } : {}), id: uid(), sourceId: current.id, page: page.number, pocketId: remembered?.pocketId || "" } as Omit<ImportRow, "decision">;
            return prepareBcaRow({ ...row, decision: suggestImportDecision(row, reviewMonth) } as ImportRow, data, confirmedImportAccount(current, data) || bcaAccount(data));
          });
          const latest = draftRef.current;
          const sourceRows = [...latest.rows, ...rows].filter((row) => row.sourceId === current.id);
          await save({ ...latest, rows: [...latest.rows, ...rows], sources: latest.sources.map((item) => {
            if (item.id !== current.id) return item;
            const progress = { ...item, processedPages: page.number, pageCount: documentPages.count, datesChecked: false, error: undefined };
            if (item.accountConfirmed && !item.accountDetected) return progress;
            const detected = detectImportAccount(sourceRows, item, data) || (item.mixedAccounts ? "" : bcaAccount(data));
            return detected ? { ...progress, account: detected, accountConfirmed: true, accountDetected: true } : item.accountDetected ? { ...progress, account: "", accountConfirmed: false, accountDetected: false } : progress;
          }) });
        }
      }, async (source, error) => {
        if (error instanceof LocalDraftWriteError) throw error;
        const message = error instanceof Error ? error.message === "not_bca" ? t("bcaOnly") : error.message : t("processFileFailed");
        const latest = draftRef.current;
        if (latest?.id === draftId) await save({ ...latest, sources: latest.sources.map((item) => item.id === source.id ? { ...item, error: message.slice(0, 180) } : item) });
        return ![401, 403, 429, 503].includes(Number((error as { status?: number })?.status));
      });
      setInfo(cancelled.current ? t("extractionPaused") : failedSources ? t(failedSources === 1 ? "sourceNeedsAttentionOne" : "sourcesNeedAttention", { count: failedSources }) : draftRef.current?.rows.length ? t("extractionFinished") : t("nothingFound"));
    } catch (error) {
      setInfo(error instanceof Error ? error.message : t("pageNotProcessed"));
    } finally { processingRef.current = false; setProcessing(false); setActivePage(null); }
  }
  async function updateRow(id: string, patch: Partial<ImportRow>) {
    if (!draftRef.current || savingRef.current) return;
    const row = draftRef.current.rows.find((item) => item.id === id);
    try { await save({ ...draftRef.current, sources: importPatchNeedsSourceRecheck(patch) && row ? draftRef.current.sources.map((source) => source.id === row.sourceId ? { ...source, datesChecked: false } : source) : draftRef.current.sources, rows: draftRef.current.rows.map((item) => item.id === id ? { ...item, ...patch, confirmedSeparate: patch.confirmedSeparate ?? ("date" in patch || "amount" in patch || "direction" in patch || "name" in patch || "paymentMethod" in patch || "account" in patch || "activity" in patch ? false : item.confirmedSeparate) } : item) }); }
    catch { /* save explains the local storage problem */ }
  }
  async function markSourcesChecked(ids: string[]) {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    try { await save({ ...draftRef.current, sources: draftRef.current.sources.map((source) => ids.includes(source.id) ? { ...source, datesChecked: true } : source) }); }
    catch { /* save explains the local storage problem */ }
  }
  async function updateDatesChecked(id: string, checked: boolean) {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    try { await save({ ...draftRef.current, sources: draftRef.current.sources.map((source) => source.id === id ? { ...source, datesChecked: checked } : source) }); }
    catch { /* save explains the local storage problem */ }
  }
  async function applySharedDate(sourceId: string) {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    const date = sharedDates[sourceId] || "";
    if (!validDate(date) || date > today()) { setInfo(t("invalidDate")); return; }
    const rows = applySharedSourceDate(draftRef.current.rows, sourceId, date, draftRef.current.month, (row) => importRowAlreadySaved(row, draftRef.current, data));
    const changed = rows.filter((row, index) => row !== draftRef.current?.rows[index]).length;
    if (!changed) return;
    try {
      await save({ ...draftRef.current, rows, sources: draftRef.current.sources.map((source) => source.id === sourceId ? { ...source, datesChecked: false } : source) });
      setSharedDates((current) => ({ ...current, [sourceId]: "" }));
      setInfo(t(changed === 1 ? "dateSetOne" : "dateSetMany", { count: changed }));
    } catch { /* save explains the local storage problem */ }
  }
  async function updateAccount(id: string, account: string) {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    if (draftRef.current.rows.some((row) => row.sourceId === id && importRowAlreadySaved(row, draftRef.current, data))) return;
    try { await save({ ...draftRef.current, sources: draftRef.current.sources.map((source) => source.id === id ? { ...source, account, accountConfirmed: !!account, accountDetected: false } : source), rows: draftRef.current.rows.map((row) => row.sourceId === id ? { ...row, confirmedSeparate: false } : row) }); }
    catch { /* save explains the local storage problem */ }
  }
  async function updateMixedAccounts(id: string, mixedAccounts: boolean) {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    if (draftRef.current.rows.some((row) => row.sourceId === id && importRowAlreadySaved(row, draftRef.current, data))) return;
    try { await save({ ...draftRef.current, sources: draftRef.current.sources.map((source) => source.id === id ? { ...source, mixedAccounts } : source), rows: draftRef.current.rows.map((row) => row.sourceId === id ? { ...row, confirmedSeparate: false } : row) }); }
    catch { /* save explains the local storage problem */ }
  }
  async function saveReady() {
    if (!draftRef.current || busy || processingRef.current || savingRef.current || !ready.length || uncheckedDateSources.length) return;
    const draftId = draftRef.current.id;
    savingRef.current = true; setSaving(true);
    try {
    const additions: Transaction[] = [];
    const paired = new Set<string>();
    const pairedByTransfer = new Map<string, string>();
    for (const row of ready) {
      if (paired.has(row.id)) continue;
      const other = ["transfer", "topup"].includes(row.activity)
        ? ready.find((candidate) => candidate.id !== row.id && !paired.has(candidate.id) && ["transfer", "topup"].includes(candidate.activity) && candidate.date === row.date && candidate.amount === row.amount && candidate.direction !== row.direction && accountForRow(candidate) === row.counterparty && candidate.counterparty === accountForRow(row))
        : undefined;
      additions.push(...importedTransactions(row, accountForRow(row), draftRef.current.sources.find((source) => source.id === row.sourceId)?.name || "source", data, other?.id));
      if (other) { paired.add(other.id); pairedByTransfer.set(row.id, other.id); }
    }
    const merchantRules = ready.reduce((rules, row) => row.direction === "expense" && ["purchase", "pay_later"].includes(row.activity) ? learnMerchant({ ...data, merchantRules: rules }, row.name, { name: importRowName(row), pocketId: row.pocketId }) : rules, data.merchantRules);
    if (!(await commit({ ...data, transactions: [...data.transactions, ...additions], merchantRules }, t("importBatchSaved")))) return;
    if (draftRef.current?.id !== draftId) return;
    const saved = additions.map((transaction) => ({ id: transaction.id, fingerprint: JSON.stringify(transaction), pairedRowId: transaction.transferId ? pairedByTransfer.get(transaction.transferId) : undefined }));
    try { await save({ ...draftRef.current, rows: draftRef.current.rows.map((row) => paired.has(row.id) ? { ...row, decision: "skip" } : row), saved: [...draftRef.current.saved, ...saved] }); }
    catch { setInfo(t("savedButDraftFailed")); }
    } finally { savingRef.current = false; setSaving(false); }
  }
  async function undo() {
    if (!draftRef.current?.saved.length || busy || processingRef.current || savingRef.current) return;
    const draftId = draftRef.current.id;
    savingRef.current = true; setSaving(true);
    try {
    const saved = new Map(draftRef.current.saved.map((item) => [item.id, item.fingerprint]));
    const unchanged = data.transactions.filter((transaction) => saved.get(transaction.id) === JSON.stringify(transaction));
    const unchangedIds = new Set(unchanged.map((transaction) => transaction.id));
    const removable = unchanged.filter((transaction) => !transaction.transferId || data.transactions.filter((part) => part.transferId === transaction.transferId).every((part) => unchangedIds.has(part.id)));
    if (!removable.length) { setInfo(t("savedTransactionsChanged")); return; }
    const ids = new Set(removable.map((t) => t.id));
    if (!(await commit({ ...data, transactions: data.transactions.filter((transaction) => !ids.has(transaction.id)) }, t("importedUndone", { count: ids.size })))) return;
    if (draftRef.current?.id !== draftId) return;
    const transferIds = new Set(removable.map((transaction) => transaction.transferId).filter(Boolean));
    const pairedRowIds = new Set(draftRef.current.saved.filter((item) => ids.has(item.id)).map((item) => item.pairedRowId).filter(Boolean));
    try { await save({ ...draftRef.current, rows: draftRef.current.rows.map((row) => ids.has(row.id) || transferIds.has(row.id) || pairedRowIds.has(row.id) ? { ...row, decision: "later" } : row), saved: draftRef.current.saved.filter((item) => !ids.has(item.id)) }); }
    catch { setInfo(t("undoneButDraftFailed")); }
    } finally { savingRef.current = false; setSaving(false); }
  }
  async function confirmExactMatches() {
    const ids = new Set(matchesToConfirm.map((row) => row.matchId));
    if (!ids.size || selectedMatchesNeedDateCheck || busy || processingRef.current || savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      if (await commit({ ...data, transactions: data.transactions.map((transaction) => ids.has(transaction.id) ? { ...transaction, verified: true } : transaction) }, t("statementMatchesChecked", { count: ids.size }))) {
        setSelectedMatches((current) => current.filter((id) => !ids.has(id)));
      }
    }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function removeSource(id: string) {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    if (draftRef.current.rows.some((row) => row.sourceId === id && importRowAlreadySaved(row, draftRef.current, data))) {
      setInfo(t("sourceHasTransactions"));
      return;
    }
    try {
      await save({ ...draftRef.current, sources: draftRef.current.sources.filter((source) => source.id !== id), rows: draftRef.current.rows.filter((row) => row.sourceId !== id) });
      if (previewId === id) setPreviewId("");
      setInfo(t("sourceRemoved"));
    } catch { /* save explains the local storage problem */ }
  }
  async function newDraft() {
    if (processingRef.current || savingRef.current) return;
    const next: ImportDraft = { id: uid(), owner, month, sources: [], rows: [], saved: [], createdAt: Date.now() };
    try { await save(next); setDrafts(await listImportDrafts(owner)); setSelectedMatches([]); setInfo(""); setPreviewId(""); setDeleteConfirmationId(""); }
    catch { /* save explains the local storage problem */ }
  }
  async function deleteDraft() {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    const id = draftRef.current.id;
    await writeTail.current;
    if (draftRef.current?.id !== id || processingRef.current || savingRef.current) return;
    try {
      await deleteImportDraft(id); persisted.current.delete(id);
      const next = await listImportDrafts(owner); setDrafts(next); setDraft(next[0] || null); setSelectedMatches([]); draftRef.current = next[0] || null;
      setInfo(""); setPreviewId(""); setDeleteConfirmationId("");
    } catch { setInfo(t("localDraftRemoveError")); }
  }
  return <div className="catchup">
    <header className="catchup-hero"><div><p className="catchup-eyebrow">{statementMode ? t("catchUpMonthly") : t("catchUp")}</p><h2>{statementMode ? t("catchUpMonthlyTitle") : t("catchUpTitle")}</h2><p>{statementMode ? t("catchUpMonthlyHelp") : t("catchUpHelp")}</p></div><div className="catchup-hero-count"><strong>{statementMode ? exactMatches.length : draft?.rows.length || "0"}</strong><span>{statementMode ? t("exactMatches") : draft?.rows.length ? t("foundDraft") : t("foundAfterFile")}</span></div></header>
    <div className="catchup-steps"><span>{t("chooseFiles")}</span><ArrowRight size={13} /><span>{t("checkList")}</span><ArrowRight size={13} /><span>{t("addToSaku")}</span></div>
    <section className="catchup-panel"><div className="catchup-panel-head"><div><h3>{t("yourSources")}</h3><p>{t("sourcesHelp")}</p></div><label className="button primary"><Upload size={16} /> {t("addFiles")}<input hidden disabled={!userId || processing || saving} type="file" accept=".pdf,image/png,image/jpeg,image/webp" multiple onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /></label></div>
      {drafts.length > 1 && <ChoiceField label={t("localDraft")} disabled={processing || saving} value={draft?.id || ""} onValueChange={(value) => { const next = drafts.find((item) => item.id === value) || null; setDraft(next); setSelectedMatches([]); draftRef.current = next; setInfo(""); setPreviewId(""); setDeleteConfirmationId(""); }} options={[{ value: "", label: t("selectDraft") }, ...drafts.map((item) => ({ value: item.id, label: new Date(item.createdAt).toLocaleDateString(localeTag()), description: t("sourceCount", { count: item.sources.length, rows: item.rows.length }) }))]} />}
      {!!draft?.sources.length && <div className="catchup-sources">{draft.sources.map((source) => <div className="catchup-source" key={source.id}>{/\.pdf$/i.test(source.name) ? <FileText size={20} /> : <FileImage size={20} />}<div className="catchup-source-identity"><strong>{source.name}</strong><small className={source.error ? "catchup-source-error" : undefined}>{activePage?.sourceId === source.id ? t("extractingPage", { page: activePage.page, total: activePage.total }) : source.error ? t("needsAttentionDetail", { detail: source.error }) : source.pageCount ? `${t("pagesProcessed", { count: source.processedPages, total: source.pageCount })}${source.accountDetected && confirmedImportAccount(source, data) ? ` · ${t("detectedAccount", { account: source.account })}` : ""}` : t("readyProcess")}</small></div><button className="text-button" onClick={() => setPreviewId(source.id)}>{t("preview")}</button><ChoiceField className="catchup-source-account" label={t("account")} disabled={processing || saving || source.mixedAccounts || sourceHasSavedRows(source.id)} value={source.mixedAccounts ? "" : confirmedImportAccount(source, data)} onValueChange={(value) => void updateAccount(source.id, value)} placeholder={source.mixedAccounts ? t("accountPerRow") : t("accountRequired")} options={[...data.accounts.map((account) => ({ value: account, label: account, description: t("bankCashWallet") })), ...data.creditCards.map((card) => ({ value: card.name, label: card.name, description: t("creditCard") }))]} /><button className="catchup-icon" disabled={processing || saving || sourceHasSavedRows(source.id)} title={sourceHasSavedRows(source.id) ? t("undoBeforeRemove") : t("removeSourceTitle")} aria-label={t("removeSource", { name: source.name })} onClick={() => void removeSource(source.id)}><X size={16} /></button></div>)}</div>}
      {!!draft?.sources.some((source) => sourceHasSavedRows(source.id)) && <p className="import-note">{t("sourceLocked")}</p>}
      {hasFilesToProcess ? <>
      </> : !!draft?.sources.length && <p className="catchup-processed"><Check size={16} /> {draft.rows.length ? t("processedWithRows") : t("processedEmpty")}</p>}
      <div className="catchup-actions">{hasFilesToProcess && <button className="button primary" disabled={processing || saving || !userId} onClick={() => void extract()}>{processing ? t("processing") : draft?.sources.some((source) => source.error) ? t("retrySources") : t("extractCloudflare")}<ArrowRight size={16} /></button>}{processing && <button className="button secondary" onClick={() => { cancelled.current = true; }}>{t("pauseAfterPage")}</button>}<button className="text-button" disabled={processing || saving} onClick={() => void newDraft()}>{t("newDraft")}</button>{draft && <button className="text-button" disabled={processing || saving} onClick={() => setDeleteConfirmationId(draft.id)}>{t("removeDraft")}</button>}</div>
      {draft && deleteConfirmationId === draft.id && <div className="catchup-delete-confirm" role="group" aria-label={t("confirmDraftRemoval")}><p>{t("removeDraftQuestion")}</p><div><button className="button secondary" type="button" onClick={() => setDeleteConfirmationId("")}>{t("keepDraft")}</button><button className="button danger" type="button" disabled={processing || saving} onClick={() => void deleteDraft()}>{t("removeThisDraft")}</button></div></div>}
      {!userId && <p className="catchup-message">{t("signInExtract")}</p>}{info && <p className="catchup-message" role="status">{info}</p>}
    </section>
    {statementMode && !!draft?.rows.length && <section className="catchup-panel"><div className="catchup-panel-head"><div><h3>{t("statementComparison")}</h3><p>{t("comparisonCount", { exact: exactMatches.length, missing: comparisons.filter((row) => row.status === "missing").length, inspect: comparisons.filter((row) => row.status === "different" || row.status === "review").length })}</p></div></div>
      {!!dateCheckSources.length && <div className="catchup-date-check"><strong>{t("compareEachSource")}</strong><p>{t("compareSourceHelp")}</p>{dateCheckSources.map((source) => <div key={source.id}><label><input type="checkbox" checked={!!source.datesChecked} disabled={processing || saving} onChange={(event) => void updateDatesChecked(source.id, event.target.checked)} /><span>{t("comparedWith", { name: source.name })}</span></label><button className="text-button" type="button" onClick={() => setPreviewId(source.id)}>{t("previewSource")}</button></div>)}</div>}
      {!!unverifiedMatches.length && <details className="catchup-match-review"><summary>{t("reviewExact", { count: unverifiedMatches.length, unit: unverifiedMatches.length === 1 ? t("match") : t("matches") })}</summary><p>{t("chooseMatches")}</p><div className="catchup-match-list">{unverifiedMatches.map((row) => <label className="catchup-match" key={row.id}><input type="checkbox" checked={selectedMatches.includes(row.matchId)} disabled={busy || processing || saving} onChange={(event) => setSelectedMatches((current) => event.target.checked ? [...current, row.matchId] : current.filter((id) => id !== row.matchId))} /><span><strong>{row.name}</strong><small>{row.date} · {row.account} · {row.file}</small></span><b>{row.type === "expense" ? "−" : "+"}{money(row.amount)}</b></label>)}</div>{selectedMatchesNeedDateCheck && <p className="catchup-issue">{t("compareSelectedSource")}</p>}<button className="button secondary" disabled={!matchesToConfirm.length || selectedMatchesNeedDateCheck || busy || processing || saving} onClick={() => void confirmExactMatches()}>{t("confirmSelectedMatches", { count: matchesToConfirm.length, unit: matchesToConfirm.length === 1 ? t("match") : t("matches") })}</button></details>}
      {!unverifiedMatches.length && !!exactMatches.length && <p className="catchup-match-done"><Check size={16} /> {t("allExactChecked")}</p>}
      <p className="import-note">{t("incompleteSourceNote")}</p></section>}
    {!!draft?.rows.length && <section className="catchup-panel catchup-review"><div className="catchup-panel-head"><div><h3>{t("reviewTitle")}</h3><p>{t("reviewHelp")}</p></div><span className="catchup-private"><LockKeyhole size={13} /> {t("savedDevice")}</span></div>
      <div className="catchup-review-overview"><div><strong>{ready.length}</strong><span>{t("toAdd")}</span></div><div><strong>{needsReview.length}</strong><span>{t("needLook")}</span></div><div><strong>{setAside.length}</strong><span>{t("notImported")}</span></div></div><p className="catchup-swipe-hint">{t("swipeHint")}</p>
      {!!undatedSources.length && <div className="catchup-missing-dates"><strong>{t("someDatesMissing")}</strong><p>{t("sharedDateHelp")}</p>{undatedSources.map((source) => { const count = draft.rows.filter((row) => row.sourceId === source.id && !row.date && row.decision !== "skip" && !rowSaved(row)).length; return <div key={source.id}><b>{source.name} · {count} {count === 1 ? t("row") : t("rows")}</b><div><label>{t("sharedDate")}<input type="date" value={sharedDates[source.id] || ""} max={today()} disabled={processing || saving} onChange={(event) => setSharedDates((current) => ({ ...current, [source.id]: event.target.value }))} /></label><button type="button" className="button secondary" disabled={!validDate(sharedDates[source.id] || "") || (sharedDates[source.id] || "") > today() || processing || saving} onClick={() => void applySharedDate(source.id)}>{t("setDateFor", { count, unit: count === 1 ? t("row") : t("rows") })}</button></div></div>; })}</div>}
      {draft.sources.map((source) => {
        const order = (row: ImportRow) => needsReview.includes(row) ? 0 : ready.includes(row) ? 1 : 2;
        for (const row of draft.rows) if (row.sourceId === source.id && !rowOrder.current.has(row.id)) rowOrder.current.set(row.id, order(row) * 1_000_000 + rowOrder.current.size);
        const rows = draft.rows.filter((row) => row.sourceId === source.id).sort((a, b) => rowOrder.current.get(a.id)! - rowOrder.current.get(b.id)!);
        return rows.length ? <div className="catchup-group" key={source.id}>
          <h4>{source.mixedAccounts ? t("mixedAccountLabel") : confirmedImportAccount(source, data) || t("chooseAccount")} <span>· {source.name}</span></h4>
          {rows.map((row) => {
            const alreadySaved = rowSaved(row);
            const account = accountForRow(row);
            const accountHint = !account ? t("chooseAccount") : account !== confirmedImportAccount(source, data) ? `${t("sakuAccount")}: ${account}` : "";
            const duplicate = needsSeparateConfirmation(row);
            const pair = ["transfer", "topup"].includes(row.activity) ? draft.rows.find((candidate) => candidate.id !== row.id && ["transfer", "topup"].includes(candidate.activity) && candidate.date === row.date && candidate.amount === row.amount && candidate.direction !== row.direction && accountForRow(candidate) && accountForRow(candidate) !== account) : undefined;
            const card = data.creditCards.find((item) => item.name === account);
            const rowReady = ready.includes(row);
            const editing = editingRow === row.id;
            const decide = (decision: ImportRow["decision"]) => { setEditingRow(""); void updateRow(row.id, { decision }); };
            // Swipe right to add, left to leave out; hold to open the row for editing.
            const startGesture = (event: React.PointerEvent) => {
              if (alreadySaved || saving) return;
              const touch = event.pointerType !== "mouse";
              gesture.current = { id: row.id, x: event.clientX, y: event.clientY, moved: false, held: false, touch, timer: touch ? window.setTimeout(() => {
                if (!gesture.current || gesture.current.id !== row.id || gesture.current.moved) return;
                gesture.current.held = true; navigator.vibrate?.(12); setEditingRow(row.id);
              }, 450) : 0 };
            };
            const moveGesture = (event: React.PointerEvent) => {
              const current = gesture.current;
              if (!current || current.id !== row.id || current.held) return;
              const dx = event.clientX - current.x, dy = event.clientY - current.y;
              if (!current.moved && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { window.clearTimeout(current.timer); gesture.current = null; return; }
              if (!current.moved && Math.abs(dx) > 10) { current.moved = true; window.clearTimeout(current.timer); try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* the swipe still follows the finger */ } }
              if (current.moved) setSwipe({ id: row.id, dx: Math.max(-140, Math.min(140, dx)) });
            };
            const endGesture = () => {
              const current = gesture.current;
              if (!current || current.id !== row.id) return;
              window.clearTimeout(current.timer);
              const dx = swipe?.id === row.id ? swipe.dx : 0;
              if (current.moved && dx > 90) decide("ready");
              else if (current.moved && dx < -90) decide("skip");
              setSwipe(null);
              window.setTimeout(() => { if (gesture.current === current) gesture.current = null; }, 0);
            };
            const offset = swipe?.id === row.id ? swipe.dx : 0;            const status = alreadySaved ? t("inActivity") : row.alreadyInSaku && row.decision === "skip" ? t("alreadyInSaku") : row.decision === "skip" ? t("notImporting") : rowReady ? t("willAdd") : t("openReview");
            const hint = !alreadySaved && !rowReady && row.decision !== "skip" ? importRowReviewIssue(row, account, data, duplicate) : "";
            return <div className="catchup-row" key={row.id} data-swipe={offset > 40 ? "add" : offset < -40 ? "skip" : undefined}>
              <button type="button" className="catchup-row-summary" aria-haspopup="dialog" style={offset ? { transform: `translateX(${offset}px)` } : undefined}
                onPointerDown={startGesture} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture} onContextMenu={(event) => event.preventDefault()}
                onClick={() => { const current = gesture.current; if (current?.moved || current?.held || current?.touch) return; if (!alreadySaved) setEditingRow(row.id); }}>
                <span className="catchup-row-identity"><span className="catchup-row-kicker"><time dateTime={row.date || undefined}>{validDate(row.date) ? friendlyDate(row.date) : t("checkDate")}</time>{accountHint && <small className="catchup-row-account">{accountHint}</small>}<small>{activityOptions().find((item) => item.value === row.activity)?.label}</small></span><strong>{importRowName(row) || t("unnamedTransaction")}</strong>{row.note && <small className="catchup-row-note-text">{row.note}</small>}{hint && <small className="catchup-row-hint">{hint}</small>}</span>
                <span className="catchup-row-figure"><strong>{row.activity === "reward" ? `${row.amount || 0} ${t("pointsCoinsShort")}` : `${row.direction === "expense" ? "−" : row.direction === "income" ? "+" : "?"}${money(row.amount || 0)}`}</strong><small className={rowReady ? "is-ready" : alreadySaved ? "is-saved" : ""}>{status}</small></span>
                
              </button>
              {editing && <Modal title={importRowName(row) || t("unnamedTransaction")} subtitle={`${validDate(row.date) ? friendlyDate(row.date) : t("checkDate")} · ${row.direction === "expense" ? "−" : row.direction === "income" ? "+" : "?"}${money(row.amount || 0)}`} onClose={() => setEditingRow("")}><div className="catchup-row-details">
              <div className="catchup-row-main"><label className="catchup-field">{t("description")}<input value={importRowName(row)} maxLength={100} readOnly={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { cleanName: event.target.value })} /></label><label className="catchup-field">{t("date")}<input type="date" value={row.date} readOnly={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { date: event.target.value })} /></label><label className="catchup-field">{row.activity === "reward" ? t("pointsCoins") : t("amountRupiah")}<span className="catchup-amount">{row.activity !== "reward" && <span>Rp</span>}<input type="number" min="1" step="1" value={row.amount || ""} readOnly={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { amount: Number(event.target.value) })} /></span></label></div>
              <div className="catchup-row-meta">
                <ChoiceField className="catchup-field" label={t("moneyMovement")} value={row.direction} disabled={alreadySaved || saving} onValueChange={(value) => void updateRow(row.id, { direction: value as ImportRow["direction"], ...(["transfer", "topup", "card_payment"].includes(row.activity) ? {} : { activity: value === "income" ? "income" : "purchase" }) })} options={[{ value: "expense", label: t("wentOut") }, { value: "income", label: t("cameIn") }, { value: "unknown", label: t("unsure") }]} />
                <ChoiceField className="catchup-field" label={row.activity === "pay_later" ? t("payLaterAccount") : t("sakuAccount")} value={row.activity === "pay_later" && !card ? "" : account} disabled={alreadySaved || saving} onValueChange={(value) => void updateRow(row.id, { account: source.mixedAccounts || value !== confirmedImportAccount(source, data) ? value : undefined, counterparty: undefined })} placeholder={row.activity === "pay_later" ? t("chooseCreditAccount") : t("chooseUsedAccount")} options={(row.activity === "pay_later" ? data.creditCards.map((item) => ({ value: item.name, label: item.name, description: t("creditAccount") })) : [...data.accounts.map((item) => ({ value: item, label: item })), ...data.creditCards.map((item) => ({ value: item.name, label: item.name }))])} />
                {["transfer", "topup"].includes(row.activity) && <ChoiceField className="catchup-field" label={t("otherAccount")} value={row.counterparty || ""} disabled={alreadySaved || saving} onValueChange={(value) => void updateRow(row.id, { counterparty: value })} placeholder={t("chooseOtherAccount")} options={data.accounts.filter((item) => item !== account).map((item) => ({ value: item, label: item }))} />}
                {row.activity === "card_payment" && <ChoiceField className="catchup-field" label={t("paidCard")} value={row.cardId || ""} disabled={alreadySaved || saving} onValueChange={(value) => void updateRow(row.id, { cardId: value })} placeholder={t("chooseCard")} options={data.creditCards.map((item) => ({ value: item.id, label: item.name }))} />}
                {card && ["purchase", "pay_later"].includes(row.activity) && <label className="catchup-field">{t("firstDueMonth")}<input type="month" min={row.date.slice(0, 7)} value={row.firstDueMonth || ""} readOnly={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { firstDueMonth: event.target.value })} /></label>}
                {row.direction === "expense" && !card && !["transfer", "topup", "card_payment"].includes(row.activity) && <ChoiceField className="catchup-field" label={t("budgetPocket")} value={row.pocketId} disabled={alreadySaved || saving} onValueChange={(value) => void updateRow(row.id, { pocketId: value })} options={[{ value: "", label: t("noPocket"), description: t("categorizeLater") }, ...data.pockets.map((pocket) => ({ value: pocket.id, label: pocket.name }))]} />}
                <p className="catchup-row-note">{t("fromPage", { page: row.page })}{importRowName(row) !== row.name.trim() ? ` · ${t("printedAs", { name: row.name })}` : ""}{row.dateEvidence ? ` · ${t("printedDate", { date: row.dateEvidence })}` : ""}{alreadySaved ? ` · ${t("savedEditActivity")}` : ""}{row.date && !row.date.startsWith(draft.month) && !alreadySaved ? ` · ${t("outsideMonth")}` : ""}{pair && !alreadySaved ? ` · ${t("possibleTransfer", { account: accountForRow(pair) })}` : ""}{duplicate && !alreadySaved ? ` · ${t("possibleDuplicate")}` : ""}</p>
                {duplicate && !alreadySaved && <label className="catchup-confirm"><input type="checkbox" checked={!!row.confirmedSeparate} onChange={(event) => void updateRow(row.id, { confirmedSeparate: event.target.checked })} /> {t("separateTransaction")}</label>}
                {row.decision === "ready" && !rowReady && !alreadySaved && <p className="catchup-issue" role="status">{importRowReviewIssue(row, account, data, duplicate)}</p>}
                {!alreadySaved && <div className="catchup-decision"><div role="group" aria-label={t("importChoiceFor", { name: row.name || t("unnamedTransaction") })}><button type="button" className={row.decision === "ready" ? "selected" : ""} aria-pressed={row.decision === "ready"} disabled={saving} onClick={() => decide("ready")}>{t("addToSaku")}</button><button type="button" className={row.decision === "later" ? "selected" : ""} aria-pressed={row.decision === "later"} disabled={saving} onClick={() => decide("later")}>{t("reviewLater")}</button><button type="button" className={row.decision === "skip" ? "selected" : ""} aria-pressed={row.decision === "skip"} disabled={saving} onClick={() => decide("skip")}>{t("dontImport")}</button></div></div>}
              </div></div></Modal>}
            </div>;
          })}
        </div> : null;
      })}
      <div className="catchup-save"><div><strong>{ready.length} {ready.length === 1 ? t("sourceRow") : t("sourceRows")} {uncheckedDateSources.length ? t("afterSourceCheck") : t("canAddNow")}</strong><span>{readySpending > 0 && t("purchasesFees", { amount: money(readySpending) }) + " "}{readyIncome > 0 && t("moneyReceived", { amount: money(readyIncome) }) + " "}{readyMovementCount > 0 && t("transferRows", { count: readyMovementCount, unit: readyMovementCount === 1 ? t("row") : t("rows") }) + " "}{t("keptLater", { count: needsReview.length })}</span>{!!uncheckedDateSources.length && <p id="catchup-save-gate" className="catchup-save-gate">{t("compareRows", { source: uncheckedDateSources.length === 1 ? uncheckedDateSources[0].name : t("yourScreenshots", { count: uncheckedDateSources.length }) })} <button className="text-button" type="button" onClick={() => setPreviewId(uncheckedDateSources[0].id)}>{t("preview")}</button></p>}</div>{!!uncheckedDateSources.length && <button className="button secondary" type="button" disabled={processing || saving} onClick={() => void markSourcesChecked(uncheckedDateSources.map((source) => source.id))}><Check size={16} /> {t("checkedSource")}</button>}<button className="button primary" aria-describedby={uncheckedDateSources.length ? "catchup-save-gate" : undefined} disabled={!ready.length || !!uncheckedDateSources.length || busy || processing || saving} onClick={() => void saveReady()}>{t("addClearRows", { count: ready.length, unit: ready.length === 1 ? t("row") : t("rows") })} <ArrowRight size={16} /></button></div></section>}
    {!!draft?.saved.length && <section className="catchup-finish"><div><strong>{draft.saved.length} {t("savedDraft")}</strong><span>{t("existingSync")}</span></div><button className="button secondary" disabled={busy || processing || saving} onClick={() => void undo()}><RotateCcw size={15} /> {t("undoEntries")}</button></section>}
    {consentAsk && <Modal title={t("sendFiles")} subtitle={t("asksOnce")} onClose={() => setConsentAsk(false)}><p className="catchup-consent-text">{t("consentText")}</p><div className="form-footer"><button className="button secondary" type="button" onClick={() => setConsentAsk(false)}>{t("cancel")}</button><button className="button primary" type="button" onClick={() => { try { localStorage.setItem(importConsentKey(owner), "granted"); } catch { /* Without storage, Saku asks again next time. */ } setConsented(true); setConsentAsk(false); void extract(true); }}>{t("continue")}<ArrowRight size={16} /></button></div></Modal>}
    {preview && previewUrl && <Modal title={preview.name} subtitle={t("sourceFile")} onClose={() => setPreviewId("")}><div className="catchup-preview">{/\.pdf$/i.test(preview.name) ? <iframe title={preview.name} src={previewUrl} /> : <img alt={`${t("preview")} ${preview.name}`} src={previewUrl} />}</div></Modal>}
  </div>;
}
