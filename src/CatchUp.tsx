import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, FileImage, FileText, LockKeyhole, RotateCcw, Upload, X } from "lucide-react";
import { extractImportPage } from "./cloud";
import { money, reconcile, today, uid, validAmount, validDate, type BankRow, type Data, type Transaction } from "./domain";
import { deleteImportDraft, importConsentKey, listImportDrafts, putImportDraft, type ImportDraft, type ImportRow } from "./importDraft";
import { runImportSources } from "./importFlow";
import { openImportPages } from "./importPages";
import { Modal } from "./components";
import { applySharedSourceDate, confirmedImportAccount, importedTransactions, importMatchesNeedSourceDateCheck, importRowAccount, importRowAlreadySaved, importRowReady, importRowReviewIssue, importRowsNeedingDuplicateConfirmation, suggestImportDecision, usesDeferredFunding } from "./importTransactions";

const consentTargetFor = (draft: ImportDraft | null, owner: string) => draft?.owner === owner && draft.sources.length ? JSON.stringify([owner, draft.id, draft.sources.map((source) => source.id)]) : "";
const activityOptions: { value: ImportRow["activity"]; label: string }[] = [
  { value: "purchase", label: "Purchase or payment" }, { value: "fee", label: "Bank or service fee" },
  { value: "refund", label: "Refund received" }, { value: "income", label: "Other money received" }, { value: "interest", label: "Interest earned" },
  { value: "transfer", label: "Transfer between my accounts" }, { value: "topup", label: "Top up my wallet" },
  { value: "card_payment", label: "Pay a credit card bill" }, { value: "pay_later", label: "PayLater purchase" },
  { value: "reward", label: "Points or rewards" }, { value: "pending", label: "Payment still pending" },
  { value: "failed", label: "Failed or cancelled payment" }, { value: "unknown", label: "I'm not sure yet" },
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
  const [consentTarget, setConsentTarget] = useState("");
  const [info, setInfo] = useState("");
  const [previewId, setPreviewId] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [deleteConfirmationId, setDeleteConfirmationId] = useState("");
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [sharedDates, setSharedDates] = useState<Record<string, string>>({});
  const [reviewView, setReviewView] = useState<"attention" | "adding" | "setAside" | "all">("attention");
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
      setInfo("Could not save the draft on this device. Check available storage before continuing.");
      throw new LocalDraftWriteError("Local draft could not be saved");
    }
  };
  useEffect(() => {
    let live = true;
    void listImportDrafts(owner).then((items) => { if (live) { persisted.current = new Map(items.map((item) => [item.id, item])); setDrafts(items); setDraft(items[0] || null); setSelectedMatches([]); draftRef.current = items[0] || null; } }).catch(() => { if (live) setInfo("Local drafts are unavailable in this browser."); });
    return () => { live = false; cancelled.current = true; };
  }, [owner]);
  useEffect(() => { setConsentTarget(""); try { localStorage.removeItem(importConsentKey(owner)); } catch { /* Consent is never required in storage. */ } }, [owner]);
  const consent = !!consentTarget && consentTarget === consentTargetFor(draft, owner);
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
  const duplicateRows = useMemo(() => importRowsNeedingDuplicateConfirmation(draft?.rows || [], data.transactions, (row) => importRowAccount(row, draft?.sources.find((source) => source.id === row.sourceId), data), (row) => importRowAlreadySaved(row, draft, data)), [draft, data]);
  const needsSeparateConfirmation = (row: ImportRow) => duplicateRows.has(row.id);
  const ready = (draft?.rows || []).filter((row) => importRowReady(row, accountForRow(row), data) && !rowSaved(row) && (!needsSeparateConfirmation(row) || row.confirmedSeparate));
  const uncheckedDateSources = (draft?.sources || []).filter((source) => !source.datesChecked && ready.some((row) => row.sourceId === source.id));
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
    if (processingRef.current || savingRef.current) { setInfo("Wait for the current import step to finish before adding files."); return; }
    if (!userId) { setInfo("Sign in before adding sources for cloud extraction."); return; }
    let next = draftRef.current;
    if (!next || next.owner !== owner || next.month !== month) next = { id: uid(), owner, month, sources: [], rows: [], saved: [], createdAt: Date.now() };
    const chosen = Array.from(files);
    const eligible = chosen.filter((file) => /\.pdf$/i.test(file.name) ? file.size <= 20_000_000 : /\.(png|jpe?g|webp)$/i.test(file.name) && file.size <= 12_000_000);
    const accepted = eligible.slice(0, Math.max(0, 10 - next.sources.length));
    const skipped = chosen.length - accepted.length;
    const sources = accepted.map((file) => ({ id: uid(), name: file.name, account: "", accountConfirmed: false, file, processedPages: 0, pageCount: 0 }));
    if (!sources.length) { setInfo(next.sources.length >= 10 ? "This draft already has ten files. Start a new draft to add more." : "Choose PDF files under 20 MB or JPG, PNG, and WebP images under 12 MB."); return; }
    try { await save({ ...next, sources: [...next.sources, ...sources] }); }
    catch { setInfo("Could not save these files locally. Check available device storage and try again."); return; }
    setDrafts(await listImportDrafts(owner));
    setInfo(`${sources.length} source${sources.length === 1 ? "" : "s"} added.${skipped ? ` ${skipped} skipped: this draft holds ten files, PDFs must be under 20 MB, and images under 12 MB.` : ""} Review their accounts before extraction.`);
  }
  async function extract() {
    if (!draftRef.current || !userId || processingRef.current || savingRef.current) return;
    if (!consentTarget || consentTarget !== consentTargetFor(draftRef.current, owner)) { setInfo("Confirm cloud processing for these files before starting."); return; }
    if (draftRef.current.sources.some((source) => !source.mixedAccounts && !confirmedImportAccount(source, data))) { setInfo("Choose an account or mark a file as mixed accounts before extraction."); return; }
    const draftId = draftRef.current.id;
    const sources = draftRef.current.sources;
    processingRef.current = true; cancelled.current = false; setProcessing(true); setInfo("");
    try {
      const failedSources = await runImportSources(sources, () => cancelled.current, async (source) => {
        const current = draftRef.current?.sources.find((item) => item.id === source.id);
        if (!current || current.processedPages >= current.pageCount && current.pageCount > 0) return;
        setInfo(`Preparing ${current.name}…`);
        let documentPages;
        try { documentPages = await openImportPages(current.file); }
        catch (error) {
          if (error instanceof Error && /password/i.test(error.message)) {
            const password = window.prompt(`Password for ${current.name} (used on this device only):`) || "";
            if (!password) throw new Error("Password required to read this PDF");
            documentPages = await openImportPages(current.file, password);
          } else throw error;
        }
        for await (const page of documentPages.pages) {
          if (page.number <= current.processedPages) continue;
          if (cancelled.current) break;
          if (draftRef.current?.id !== draftId || draftRef.current.owner !== owner) break;
          setActivePage({ sourceId: current.id, page: page.number, total: documentPages.count });
          setInfo(`Extracting ${current.name} · page ${page.number} of ${documentPages.count}`);
          const answer = await extractImportPage(userId, { month: draftRef.current.month, ...page.content });
          // A pause requested during inference still keeps the completed page.
          if (draftRef.current?.id !== draftId || draftRef.current.owner !== owner) break;
          const reviewMonth = draftRef.current.month;
          const rows: ImportRow[] = answer.rows.map((result) => {
            const row = { ...result, id: uid(), sourceId: current.id, page: page.number, pocketId: "" } as Omit<ImportRow, "decision">;
            return { ...row, decision: suggestImportDecision(row, reviewMonth) };
          });
          const latest = draftRef.current;
          await save({ ...latest, rows: [...latest.rows, ...rows], sources: latest.sources.map((item) => item.id === current.id ? { ...item, processedPages: page.number, pageCount: documentPages.count, datesChecked: false, error: undefined } : item) });
        }
      }, async (source, error) => {
        if (error instanceof LocalDraftWriteError) throw error;
        const message = error instanceof Error ? error.message : "Could not process this file";
        const latest = draftRef.current;
        if (latest?.id === draftId) await save({ ...latest, sources: latest.sources.map((item) => item.id === source.id ? { ...item, error: message.slice(0, 180) } : item) });
        return ![401, 403, 429, 503].includes(Number((error as { status?: number })?.status));
      });
      setInfo(cancelled.current ? "Paused. Your progress is saved on this device." : failedSources ? `${failedSources} ${failedSources === 1 ? "source needs" : "sources need"} attention. Successful pages were kept; fix or remove the marked source, then retry.` : draftRef.current?.rows.length ? "Extraction finished. Check the rows before saving." : "No transactions were found. Check the source preview or try a clearer screenshot.");
    } catch (error) {
      setInfo(error instanceof Error ? error.message : "Could not process this page. Your progress is saved.");
    } finally { processingRef.current = false; setProcessing(false); setActivePage(null); setConsentTarget(""); }
  }
  async function updateRow(id: string, patch: Partial<ImportRow>) {
    if (!draftRef.current || savingRef.current) return;
    const row = draftRef.current.rows.find((item) => item.id === id);
    try { await save({ ...draftRef.current, sources: "date" in patch && row ? draftRef.current.sources.map((source) => source.id === row.sourceId ? { ...source, datesChecked: false } : source) : draftRef.current.sources, rows: draftRef.current.rows.map((item) => item.id === id ? { ...item, ...patch, confirmedSeparate: patch.confirmedSeparate ?? ("date" in patch || "amount" in patch || "direction" in patch || "name" in patch || "paymentMethod" in patch || "account" in patch ? false : item.confirmedSeparate) } : item) }); }
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
    if (!validDate(date) || date > today()) { setInfo("Choose a valid transaction date that is not in the future."); return; }
    const rows = applySharedSourceDate(draftRef.current.rows, sourceId, date, draftRef.current.month, (row) => importRowAlreadySaved(row, draftRef.current, data));
    const changed = rows.filter((row, index) => row !== draftRef.current?.rows[index]).length;
    if (!changed) return;
    try {
      await save({ ...draftRef.current, rows, sources: draftRef.current.sources.map((source) => source.id === sourceId ? { ...source, datesChecked: false } : source) });
      setSharedDates((current) => ({ ...current, [sourceId]: "" }));
      setInfo(`Date set for ${changed} ${changed === 1 ? "row" : "rows"}. Compare them with the source before confirming its dates.`);
    } catch { /* save explains the local storage problem */ }
  }
  async function updateAccount(id: string, account: string) {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    if (draftRef.current.rows.some((row) => row.sourceId === id && importRowAlreadySaved(row, draftRef.current, data))) return;
    try { await save({ ...draftRef.current, sources: draftRef.current.sources.map((source) => source.id === id ? { ...source, account, accountConfirmed: !!account } : source), rows: draftRef.current.rows.map((row) => row.sourceId === id ? { ...row, confirmedSeparate: false } : row) }); }
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
    if (!(await commit({ ...data, transactions: [...data.transactions, ...additions] }, "Reviewed import batch saved"))) return;
    if (draftRef.current?.id !== draftId) return;
    const saved = additions.map((transaction) => ({ id: transaction.id, fingerprint: JSON.stringify(transaction), pairedRowId: transaction.transferId ? pairedByTransfer.get(transaction.transferId) : undefined }));
    try { await save({ ...draftRef.current, rows: draftRef.current.rows.map((row) => paired.has(row.id) ? { ...row, decision: "skip" } : row), saved: [...draftRef.current.saved, ...saved] }); }
    catch { setInfo("Transactions were saved to Activity, but the local draft update failed. Check Activity before trying again; batch undo may be unavailable after a reload."); }
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
    if (!removable.length) { setInfo("Saved transactions have since changed; remove them individually from Activity."); return; }
    const ids = new Set(removable.map((t) => t.id));
    if (!(await commit({ ...data, transactions: data.transactions.filter((transaction) => !ids.has(transaction.id)) }, `${ids.size} imported transactions undone`))) return;
    if (draftRef.current?.id !== draftId) return;
    const transferIds = new Set(removable.map((transaction) => transaction.transferId).filter(Boolean));
    const pairedRowIds = new Set(draftRef.current.saved.filter((item) => ids.has(item.id)).map((item) => item.pairedRowId).filter(Boolean));
    try { await save({ ...draftRef.current, rows: draftRef.current.rows.map((row) => ids.has(row.id) || transferIds.has(row.id) || pairedRowIds.has(row.id) ? { ...row, decision: "later" } : row), saved: draftRef.current.saved.filter((item) => !ids.has(item.id)) }); }
    catch { setInfo("Ledger entries were undone, but the local draft update failed. Check Activity before saving again."); }
    } finally { savingRef.current = false; setSaving(false); }
  }
  async function confirmExactMatches() {
    const ids = new Set(matchesToConfirm.map((row) => row.matchId));
    if (!ids.size || selectedMatchesNeedDateCheck || busy || processingRef.current || savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      if (await commit({ ...data, transactions: data.transactions.map((transaction) => ids.has(transaction.id) ? { ...transaction, verified: true } : transaction) }, `${ids.size} statement matches checked`)) {
        setSelectedMatches((current) => current.filter((id) => !ids.has(id)));
      }
    }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function removeSource(id: string) {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    if (draftRef.current.rows.some((row) => row.sourceId === id && importRowAlreadySaved(row, draftRef.current, data))) {
      setInfo("This source has transactions in Activity. Undo its unchanged entries before removing it from the draft.");
      return;
    }
    try {
      await save({ ...draftRef.current, sources: draftRef.current.sources.filter((source) => source.id !== id), rows: draftRef.current.rows.filter((row) => row.sourceId !== id) });
      if (previewId === id) setPreviewId("");
      setInfo("Source removed from this local draft.");
    } catch { /* save explains the local storage problem */ }
  }
  async function newDraft() {
    if (processingRef.current || savingRef.current) return;
    const next: ImportDraft = { id: uid(), owner, month, sources: [], rows: [], saved: [], createdAt: Date.now() };
    try { await save(next); setDrafts(await listImportDrafts(owner)); setConsentTarget(""); setSelectedMatches([]); setInfo(""); setPreviewId(""); setDeleteConfirmationId(""); }
    catch { /* save explains the local storage problem */ }
  }
  async function deleteDraft() {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    const id = draftRef.current.id;
    await writeTail.current;
    if (draftRef.current?.id !== id || processingRef.current || savingRef.current) return;
    try {
      await deleteImportDraft(id); persisted.current.delete(id);
      const next = await listImportDrafts(owner); setDrafts(next); setDraft(next[0] || null); setConsentTarget(""); setSelectedMatches([]); draftRef.current = next[0] || null;
      setInfo(""); setPreviewId(""); setDeleteConfirmationId("");
    } catch { setInfo("Could not remove the local draft. Check available device storage and try again."); }
  }
  return <div className="catchup">
    <header className="catchup-hero"><div><p className="catchup-eyebrow">SAKU · {statementMode ? "MONTHLY CHECK" : "CATCH UP"}</p><h2>{statementMode ? "Check what you recorded." : "Missed a day? Add it together."}</h2><p>{statementMode ? "Compare a statement or transaction screenshot with your ledger. Confirm exact matches and review the rest." : "Choose screenshots or statements from your banks and wallets. Review one list, then save the clear rows in a batch."}</p></div><div className="catchup-hero-count"><strong>{statementMode ? exactMatches.length : draft?.rows.length || "—"}</strong><span>{statementMode ? "exact statement matches" : draft?.rows.length ? "transactions found in this draft" : "Your review starts when you add a file"}</span></div></header>
    <div className="catchup-steps"><span>Choose files</span><ArrowRight size={13} /><span>Check the list</span><ArrowRight size={13} /><span>Add to Saku</span></div>
    <section className="catchup-panel"><div className="catchup-panel-head"><div><h3>Your sources</h3><p>Up to ten files per draft · screenshots and PDFs</p></div><label className="button primary"><Upload size={16} /> Add files<input hidden disabled={!userId || processing || saving} type="file" accept=".pdf,image/png,image/jpeg,image/webp" multiple onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /></label></div>
      {drafts.length > 1 && <label className="field">Local draft<select disabled={processing || saving} value={draft?.id || ""} onChange={(event) => { const next = drafts.find((item) => item.id === event.target.value) || null; setDraft(next); setConsentTarget(""); setSelectedMatches([]); draftRef.current = next; setInfo(""); setPreviewId(""); setDeleteConfirmationId(""); }}><option value="">Select draft</option>{drafts.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleDateString("id-ID")} · {item.sources.length} sources · {item.rows.length} rows</option>)}</select></label>}
      {!!draft?.sources.length && <div className="catchup-sources">{draft.sources.map((source) => <div className="catchup-source" key={source.id}>{/\.pdf$/i.test(source.name) ? <FileText size={20} /> : <FileImage size={20} />}<div><strong>{source.name}</strong><small className={source.error ? "catchup-source-error" : undefined}>{activePage?.sourceId === source.id ? `Extracting page ${activePage.page} of ${activePage.total}` : source.error ? `Needs attention · ${source.error}` : source.pageCount ? `${source.processedPages} of ${source.pageCount} pages` : "Ready to process"}</small></div><button className="text-button" onClick={() => setPreviewId(source.id)}>Preview</button><label>Account<select disabled={processing || saving || source.mixedAccounts || sourceHasSavedRows(source.id)} value={source.mixedAccounts ? "" : confirmedImportAccount(source, data)} onChange={(event) => void updateAccount(source.id, event.target.value)}><option value="">{source.mixedAccounts ? "Choose on each row" : "Choose account"}</option>{[...data.accounts, ...data.creditCards.map((card) => card.name)].map((account) => <option key={account}>{account}</option>)}</select></label><label className="catchup-mixed"><input type="checkbox" disabled={processing || saving || sourceHasSavedRows(source.id)} checked={!!source.mixedAccounts} onChange={(event) => void updateMixedAccounts(source.id, event.target.checked)} /> This file shows multiple Saku accounts</label><button className="catchup-icon" disabled={processing || saving || sourceHasSavedRows(source.id)} title={sourceHasSavedRows(source.id) ? "Undo saved entries before removing this source" : "Remove source"} aria-label={`Remove ${source.name}`} onClick={() => void removeSource(source.id)}><X size={16} /></button></div>)}</div>}
      {!!draft?.sources.some((source) => sourceHasSavedRows(source.id)) && <p className="import-note">Source account choices are locked after saving. Undo unchanged entries before changing them.</p>}
      {hasFilesToProcess ? <><label className="catchup-consent"><input type="checkbox" checked={consent} disabled={processing} onChange={(event) => setConsentTarget(event.target.checked ? consentTargetFor(draft, owner) : "")} /><span>For this processing run, send these files’ page text and images to Cloudflare AI. Original files and review drafts stay on this device; saved transactions follow your existing backup and Sheet sync.</span></label>
      {draft?.sources.some((source) => !source.mixedAccounts && !confirmedImportAccount(source, data)) && <p className="import-note">Choose the account shown in each file, or mark it as mixed accounts, before processing it.</p>}
      <p className="import-note">For mixed-account files, choose an account on each row. Moves between pockets of one Saku account are not spending; mark those “Don't import.”</p></> : !!draft?.sources.length && <p className="catchup-processed"><Check size={16} /> {draft.rows.length ? "All files processed. Review the transactions below, or add another file." : "All files processed, but no transactions were found. Preview a file or add a clearer image."}</p>}
      <div className="catchup-actions">{hasFilesToProcess && <button className="button primary" disabled={!!draft?.sources.some((source) => !source.mixedAccounts && !confirmedImportAccount(source, data)) || processing || saving || !consent || !userId} onClick={() => void extract()}>{processing ? "Processing…" : draft?.sources.some((source) => source.error) ? "Retry unfinished sources" : "Extract transactions"}<ArrowRight size={16} /></button>}{processing && <button className="button secondary" onClick={() => { cancelled.current = true; }}>Pause after this page</button>}<button className="text-button" disabled={processing || saving} onClick={() => void newDraft()}>New draft</button>{draft && <button className="text-button" disabled={processing || saving} onClick={() => setDeleteConfirmationId(draft.id)}>Remove draft</button>}</div>
      {draft && deleteConfirmationId === draft.id && <div className="catchup-delete-confirm" role="group" aria-label="Confirm draft removal"><p>Remove this local draft and its source files? Transactions already added to Activity will stay there.</p><div><button className="button secondary" type="button" onClick={() => setDeleteConfirmationId("")}>Keep draft</button><button className="button danger" type="button" disabled={processing || saving} onClick={() => void deleteDraft()}>Remove this draft</button></div></div>}
      {!userId && <p className="catchup-message">Sign in to use cloud extraction.</p>}{info && <p className="catchup-message" role="status">{info}</p>}
    </section>
    {statementMode && !!draft?.rows.length && <section className="catchup-panel"><div className="catchup-panel-head"><div><h3>Statement comparison</h3><p>{exactMatches.length} exact matches · {comparisons.filter((row) => row.status === "missing").length} only in source · {comparisons.filter((row) => row.status === "different" || row.status === "review").length} to inspect</p></div></div>
      {!!dateCheckSources.length && <div className="catchup-date-check"><strong>Check source dates</strong><p>Compare the dates with each file before confirming matches or adding transactions.</p>{dateCheckSources.map((source) => <div key={source.id}><label><input type="checkbox" checked={!!source.datesChecked} disabled={processing || saving} onChange={(event) => void updateDatesChecked(source.id, event.target.checked)} /><span>Dates checked in {source.name}</span></label><button className="text-button" type="button" onClick={() => setPreviewId(source.id)}>Preview source</button></div>)}</div>}
      {!!unverifiedMatches.length && <details className="catchup-match-review"><summary>Review {unverifiedMatches.length} exact {unverifiedMatches.length === 1 ? "match" : "matches"} before confirming</summary><p>Choose the Saku entries you recognize from the source. Only selected entries will be marked checked.</p><div className="catchup-match-list">{unverifiedMatches.map((row) => <label className="catchup-match" key={row.id}><input type="checkbox" checked={selectedMatches.includes(row.matchId)} disabled={busy || processing || saving} onChange={(event) => setSelectedMatches((current) => event.target.checked ? [...current, row.matchId] : current.filter((id) => id !== row.matchId))} /><span><strong>{row.name}</strong><small>{row.date} · {row.account} · {row.file}</small></span><b>{row.type === "expense" ? "−" : "+"}{money(row.amount)}</b></label>)}</div>{selectedMatchesNeedDateCheck && <p className="catchup-issue">Check the selected source dates above before confirming these matches.</p>}<button className="button secondary" disabled={!matchesToConfirm.length || selectedMatchesNeedDateCheck || busy || processing || saving} onClick={() => void confirmExactMatches()}>Confirm {matchesToConfirm.length} selected {matchesToConfirm.length === 1 ? "match" : "matches"}</button></details>}
      {!unverifiedMatches.length && !!exactMatches.length && <p className="catchup-match-done"><Check size={16} /> All exact matches are already checked.</p>}
      <p className="import-note">Incomplete screenshots and partial statements cannot prove a ledger entry is missing. No deletions are suggested.</p></section>}
    {!!draft?.rows.length && <section className="catchup-panel catchup-review"><div className="catchup-panel-head"><div><h3>Make this list yours</h3><p>Check the uncertain ones. You can add the clear transactions now and return to the rest later.</p></div><span className="catchup-private"><LockKeyhole size={13} /> Saved on this device</span></div>
      <div className="catchup-review-overview"><div><strong>{ready.length}</strong><span>to add to Saku</span></div><div><strong>{needsReview.length}</strong><span>need a closer look</span></div><div><strong>{setAside.length}</strong><span>won't be imported</span></div></div><p className="catchup-review-guide">Account = where money moved. Pocket = optional budget for spending.</p>
      {!!undatedSources.length && <div className="catchup-missing-dates"><strong>Some dates could not be read</strong><p>If every undated row in a source happened on one day, set that date here. Otherwise, open those rows and set their dates separately.</p>{undatedSources.map((source) => { const count = draft.rows.filter((row) => row.sourceId === source.id && !row.date && row.decision !== "skip" && !rowSaved(row)).length; return <div key={source.id}><b>{source.name} · {count} {count === 1 ? "row" : "rows"}</b><div><label>Shared date<input type="date" value={sharedDates[source.id] || ""} max={today()} disabled={processing || saving} onChange={(event) => setSharedDates((current) => ({ ...current, [source.id]: event.target.value }))} /></label><button type="button" className="button secondary" disabled={!validDate(sharedDates[source.id] || "") || (sharedDates[source.id] || "") > today() || processing || saving} onClick={() => void applySharedDate(source.id)}>Set date for {count} {count === 1 ? "row" : "rows"}</button></div></div>; })}</div>}
      {!statementMode && !!ready.length && <div className="catchup-date-check"><strong>Check dates before adding</strong><p>Compare the listed dates with each source. When they all look right, confirm that file once.</p>{dateCheckSources.map((source) => <div key={source.id}><label><input type="checkbox" checked={!!source.datesChecked} disabled={processing || saving} onChange={(event) => void updateDatesChecked(source.id, event.target.checked)} /><span>Dates checked in {source.name}</span></label><button className="text-button" type="button" onClick={() => setPreviewId(source.id)}>Preview source</button></div>)}</div>}
      <div className="catchup-review-tabs" role="group" aria-label="Show transactions"><button type="button" aria-pressed={reviewView === "attention"} onClick={() => setReviewView("attention")}>Needs a look <span>{needsReview.length}</span></button><button type="button" aria-pressed={reviewView === "adding"} onClick={() => setReviewView("adding")}>Adding <span>{ready.length}</span></button><button type="button" aria-pressed={reviewView === "setAside"} onClick={() => setReviewView("setAside")}>Not importing <span>{setAside.length}</span></button><button type="button" aria-pressed={reviewView === "all"} onClick={() => setReviewView("all")}>All <span>{draft.rows.length}</span></button></div>
      {reviewView === "attention" && !needsReview.length && <p className="catchup-review-empty"><Check size={18} /> Nothing needs your attention. Check “Adding” or save the clear transactions below.</p>}
      {draft.sources.map((source) => {
        const rows = draft.rows.filter((row) => row.sourceId === source.id && (reviewView === "all" || reviewView === "attention" && needsReview.includes(row) || reviewView === "adding" && ready.includes(row) || reviewView === "setAside" && setAside.includes(row)));
        return rows.length ? <div className="catchup-group" key={source.id}>
          <h4>{source.mixedAccounts ? "Mixed accounts" : confirmedImportAccount(source, data) || "Choose account"} <span>· {source.name}</span></h4>
          {rows.map((row) => {
            const alreadySaved = rowSaved(row);
            const account = accountForRow(row);
            const duplicate = needsSeparateConfirmation(row);
            const pair = ["transfer", "topup"].includes(row.activity) ? draft.rows.find((candidate) => candidate.id !== row.id && ["transfer", "topup"].includes(candidate.activity) && candidate.date === row.date && candidate.amount === row.amount && candidate.direction !== row.direction && accountForRow(candidate) && accountForRow(candidate) !== account) : undefined;
            const card = data.creditCards.find((item) => item.name === account);
            const rowReady = ready.includes(row);
            const expanded = expandedRows[row.id] ?? false;
            const status = alreadySaved ? "In Activity" : row.decision === "skip" ? "Not importing" : rowReady ? "Will add" : "Open to review";
            const hint = !alreadySaved && !rowReady && row.decision !== "skip" ? importRowReviewIssue(row, account, data, duplicate) : "";
            return <div className="catchup-row" key={row.id}>
              <button type="button" className="catchup-row-summary" aria-expanded={expanded} aria-controls={expanded ? `catchup-details-${row.id}` : undefined} onClick={() => setExpandedRows((current) => ({ ...current, [row.id]: !expanded }))}>
                <span className="catchup-row-identity"><span className="catchup-row-kicker"><time dateTime={row.date || undefined}>{row.date || "Check date"}</time><small>{activityOptions.find((item) => item.value === row.activity)?.label}</small></span><strong>{row.name || "Unnamed transaction"}</strong>{hint && <small className="catchup-row-hint">{hint}</small>}</span>
                <span className="catchup-row-figure"><strong>{row.direction === "expense" ? "−" : row.direction === "income" ? "+" : "?"}{money(row.amount || 0)}</strong><small className={rowReady ? "is-ready" : alreadySaved ? "is-saved" : ""}>{status}</small></span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              {expanded && <div id={`catchup-details-${row.id}`} className="catchup-row-details">
              <div className="catchup-row-main"><label className="catchup-field">Description<input value={row.name} maxLength={100} readOnly={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { name: event.target.value })} /></label><label className="catchup-field">Date<input type="date" value={row.date} readOnly={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { date: event.target.value })} /></label><label className="catchup-field">Amount in rupiah<span className="catchup-amount"><span>Rp</span><input type="number" min="1" step="1" value={row.amount || ""} readOnly={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { amount: Number(event.target.value) })} /></span></label></div>
              <div className="catchup-row-meta">
                <label className="catchup-field">Money movement<select value={row.direction} disabled={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { direction: event.target.value as ImportRow["direction"] })}><option value="expense">Money went out</option><option value="income">Money came in</option><option value="unknown">I'm not sure</option></select></label>
                <label className="catchup-field">{row.activity === "pay_later" ? "PayLater or credit account" : "Saku account"}<select value={row.activity === "pay_later" && !card ? "" : account} disabled={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { account: source.mixedAccounts || event.target.value !== confirmedImportAccount(source, data) ? event.target.value : undefined, counterparty: undefined })}><option value="">{row.activity === "pay_later" ? "Choose a credit account" : "Choose the account used"}</option>{(row.activity === "pay_later" ? data.creditCards.map((item) => item.name) : [...data.accounts, ...data.creditCards.map((item) => item.name)]).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label className="catchup-field">What happened?<select value={row.activity} disabled={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { activity: event.target.value as ImportRow["activity"] })}>{activityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                {(row.paymentMethod || row.activity === "pay_later") && <label className="catchup-field">Payment method shown in source<input value={row.paymentMethod || ""} maxLength={60} readOnly={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { paymentMethod: event.target.value })} /></label>}
                {["transfer", "topup"].includes(row.activity) && <label className="catchup-field">Other Saku account<select value={row.counterparty || ""} disabled={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { counterparty: event.target.value })}><option value="">Choose the other account</option>{data.accounts.filter((item) => item !== account).map((item) => <option key={item}>{item}</option>)}</select></label>}
                {row.activity === "card_payment" && <label className="catchup-field">Credit card paid<select value={row.cardId || ""} disabled={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { cardId: event.target.value })}><option value="">Choose the card</option>{data.creditCards.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
                {card && ["purchase", "pay_later"].includes(row.activity) && <label className="catchup-field">First due month<input type="month" min={row.date.slice(0, 7)} value={row.firstDueMonth || ""} readOnly={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { firstDueMonth: event.target.value })} /></label>}
                {row.direction === "expense" && !card && !["transfer", "topup", "card_payment"].includes(row.activity) && <label className="catchup-field">Budget pocket (optional)<select value={row.pocketId} disabled={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { pocketId: event.target.value })}><option value="">No pocket</option>{data.pockets.map((pocket) => <option key={pocket.id} value={pocket.id}>{pocket.name}</option>)}</select></label>}
                <p className="catchup-row-note">From page {row.page}{row.dateEvidence ? ` · Printed date: ${row.dateEvidence}` : ""}{alreadySaved ? " · Saved to Activity; edit it there." : ""}{row.date && !row.date.startsWith(draft.month) && !alreadySaved ? " · This date is outside the selected month." : ""}{pair && !alreadySaved ? ` · This might be the other side of a transfer from ${accountForRow(pair)}.` : ""}{duplicate && !alreadySaved ? " · A similar transaction exists. Confirm below only if both happened." : ""}</p>
                {duplicate && !alreadySaved && <label className="catchup-confirm"><input type="checkbox" checked={!!row.confirmedSeparate} onChange={(event) => void updateRow(row.id, { confirmedSeparate: event.target.checked })} /> This is a separate transaction</label>}
                {row.decision === "ready" && !rowReady && !alreadySaved && <p className="catchup-issue" role="status">{importRowReviewIssue(row, account, data, duplicate)}</p>}
                {!alreadySaved && <div className="catchup-decision"><strong>What should Saku do with this?</strong><div role="group" aria-label={`Import choice for ${row.name || "transaction"}`}><button type="button" className={row.decision === "ready" ? "selected" : ""} aria-pressed={row.decision === "ready"} disabled={saving} onClick={() => void updateRow(row.id, { decision: "ready" })}>Add to Saku<small>Include when details are complete</small></button><button type="button" className={row.decision === "later" ? "selected" : ""} aria-pressed={row.decision === "later"} disabled={saving} onClick={() => void updateRow(row.id, { decision: "later" })}>Review later<small>Keep in this local draft</small></button><button type="button" className={row.decision === "skip" ? "selected" : ""} aria-pressed={row.decision === "skip"} disabled={saving} onClick={() => void updateRow(row.id, { decision: "skip" })}>Don't import<small>Leave out of Saku</small></button></div></div>}
              </div></div>}
            </div>;
          })}
        </div> : null;
      })}
      <div className="catchup-save"><div><strong>{ready.length} {ready.length === 1 ? "source row" : "source rows"} {uncheckedDateSources.length ? "ready after date check" : "can be added now"}</strong><span>{readySpending > 0 && `Purchases and fees: ${money(readySpending)}. `}{readyIncome > 0 && `Money received: ${money(readyIncome)}. `}{readyMovementCount > 0 && `${readyMovementCount} transfer or card-payment ${readyMovementCount === 1 ? "row" : "rows"}. `}{needsReview.length} kept for later in this local draft.</span>{!!uncheckedDateSources.length && <p id="catchup-save-gate" className="catchup-save-gate">First, check dates in {uncheckedDateSources.length} {uncheckedDateSources.length === 1 ? "source" : "sources"} above.</p>}</div><button className="button primary" aria-describedby={uncheckedDateSources.length ? "catchup-save-gate" : undefined} disabled={!ready.length || !!uncheckedDateSources.length || busy || processing || saving} onClick={() => void saveReady()}>Add {ready.length} to Saku <ArrowRight size={16} /></button></div></section>}
    {!!draft?.saved.length && <section className="catchup-finish"><div><strong>{draft.saved.length} saved from this draft</strong><span>They are in Activity and follow your existing sync.</span></div><button className="button secondary" disabled={busy || processing || saving} onClick={() => void undo()}><RotateCcw size={15} /> Undo unchanged entries</button></section>}
    {preview && previewUrl && <Modal title={preview.name} subtitle="Source file on this device" onClose={() => setPreviewId("")}><div className="catchup-preview">{/\.pdf$/i.test(preview.name) ? <iframe title={preview.name} src={previewUrl} /> : <img alt={`Preview of ${preview.name}`} src={previewUrl} />}</div></Modal>}
  </div>;
}
