import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ArrowRight, Check, FileImage, FileText, Link2, LockKeyhole, RotateCcw, Sparkles, Unlink, Upload, X } from "lucide-react";
import { compareImportNames, extractImportPage } from "./cloud";
import { accountForBank, bankById, bankOfAccount, detectBank } from "../worker/banks.js";
import { analyzeStatement, applyVerdict, balanceMismatch, type Verdict } from "./statementMatch";
import { parseStatementPage, statementTotals } from "./statementLines";
import { money, today, uid, validAmount, validDate, type Data, type Transaction } from "./domain";
import { deleteImportDraft, importConsentKey, listImportDrafts, putImportDraft, type ImportDraft, type ImportRow } from "./importDraft";
import { runImportSources } from "./importFlow";
import { learnMerchant, suggestMerchant } from "./merchants";
import { openImportPages } from "./importPages";
import { ChoiceField, Modal } from "./components";
import { useRowGestures } from "./rowGestures";
import { useHiddenWhileScrollingUp } from "./scrollReveal";
import { RowStatus, type RowState } from "./RowStatus";
import { CountUp } from "./motion";
import { localeTag, t } from "./i18n";
import { applySharedSourceDate, withoutOverlap, bcaAccount, confirmedImportAccount, detectImportAccount, prepareImportRow, importRowName, importedTransactions, importPatchNeedsSourceRecheck, importRowAccount, importRowAlreadySaved, importRowReady, importRowReviewIssue, importRowsNeedingDuplicateConfirmation, suggestImportDecision, usesDeferredFunding } from "./importTransactions";

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
  const [confirmRemove, setConfirmRemove] = useState("");
  const [comparing, setComparing] = useState(false);
  const decide = (id: string, decision: ImportRow["decision"]) => {
    const row = draft?.rows.find((item) => item.id === id);
    // A row that still can't be added opens (or stays open) so its missing detail is right there to fix.
    const blocked = decision === "ready" && !!row && !(importRowReady({ ...row, decision }, accountForRow(row), data) && (!needsSeparateConfirmation(row) || row.confirmedSeparate));
    setEditingRow(blocked ? id : "");
    gestures.announce(t(blocked ? "rowNeedsLook" : decision === "ready" ? "rowWillAdd" : decision === "skip" ? "rowSkipped" : "rowLater", { name: row ? importRowName(row) || t("unnamedTransaction") : "" }));
    // In Monthly check, adding a row the user was asked about means "it's a new one, not a match or a transfer".
    const verdict = row ? analysis?.verdicts.get(row.id) : undefined;
    const patch: Partial<ImportRow> = { decision, userDecided: true, ...(statementMode && decision === "ready" && verdict?.kind === "look" ? { confirmedSeparate: true, ...(verdict.reason === "transfer_tie" ? { unpaired: true } : {}) } : {}) };
    // Monthly check counts each choice for its tuning line; Catch up keeps its own row update.
    if (statementMode) void patchRows({ [id]: patch }, "decisions");
    else void updateRow(id, patch);
  };
  const gestures = useRowGestures({ onAdd: (id) => decide(id, "ready"), onSkip: (id) => decide(id, "skip"), onOpen: setEditingRow });
  const saveBarHidden = useHiddenWhileScrollingUp((draft?.rows.filter((row) => !importRowAlreadySaved(row, draft, data)).length || 0) > 4);
  // Rows keep the place they first appeared in, so choosing one never makes the list jump.
  const rowOrder = useRef(new Map<string, number>());
  const [sharedDates, setSharedDates] = useState<Record<string, string>>({});
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
    void listImportDrafts(owner).then((items) => { if (live) { persisted.current = new Map(items.map((item) => [item.id, item])); setDrafts(items); setDraft(items[0] || null); draftRef.current = items[0] || null; } }).catch(() => { if (live) setInfo(t("draftUnavailable")); });
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
  // Monthly check (3.0): statementMatch links rows already in Saku, pairs moves between the user's own accounts and
  // decides what still needs the user; the draft keeps only what was read and what the user chose.
  const analysis = useMemo(() => {
    if (!statementMode || !draft) return null;
    const flagged = new Set(draft.sources.filter((source) => bankById(source.bank || "")?.beta || balanceMismatch(draft.rows.filter((row) => row.sourceId === source.id), source.totals)).map((source) => source.id));
    const draftIds = new Set([...draft.rows.map((row) => row.id), ...draft.saved.map((item) => item.id)]);
    const open = draft.rows.filter((row) => row.decision !== "skip" && !importRowAlreadySaved(row, draft, data)).map((row) => ({ ...row, account: importRowAccount(row, draft.sources.find((source) => source.id === row.sourceId), data) }));
    return analyzeStatement(open, data, { flagged, draftIds });
  }, [statementMode, draft, data]);
  const verdictOf = (row: ImportRow): Verdict | undefined => analysis?.verdicts.get(row.id);
  const rowsView = useMemo(() => (draft?.rows || []).map((row) => analysis?.verdicts.has(row.id) ? applyVerdict(row, analysis.verdicts.get(row.id)) : row), [draft, analysis]);
  const duplicateRows = useMemo(() => statementMode ? new Set<string>() : importRowsNeedingDuplicateConfirmation(draft?.rows || [], data.transactions, (row) => importRowAccount(row, draft?.sources.find((source) => source.id === row.sourceId), data), (row) => importRowAlreadySaved(row, draft, data)), [draft, data, statementMode]);
  const needsSeparateConfirmation = (row: ImportRow) => duplicateRows.has(row.id);
  const ready = rowsView.filter((row) => importRowReady(row, accountForRow(row), data) && !rowSaved(row) && (!needsSeparateConfirmation(row) || row.confirmedSeparate));
  // Screenshots crop and scroll, so their rows are compared once by eye; statement pages are complete documents.
  const uncheckedDateSources = (draft?.sources || []).filter((source) => !source.datesChecked && isImage(source.name) && ready.some((row) => row.sourceId === source.id));
  const needsReview = rowsView.filter((row) => !rowSaved(row) && (row.decision === "later" || (row.decision === "ready" && !ready.includes(row))));
  const undatedSources = (draft?.sources || []).filter((source) => draft?.rows.some((row) => row.sourceId === source.id && !row.date && row.decision !== "skip" && !rowSaved(row)));
  const setAside = rowsView.filter((row) => !rowSaved(row) && row.decision === "skip" && verdictOf(row)?.kind !== "linked");
  const linkedVerdicts = [...(analysis?.verdicts.values() || [])].flatMap((verdict) => verdict.kind === "linked" ? [verdict] : []);
  const toVerify = linkedVerdicts.filter((verdict) => data.transactions.some((transaction) => transaction.id === verdict.transactionId && !transaction.verified));
  const groups = statementMode ? {
    look: rowsView.filter((row) => !rowSaved(row) && row.decision !== "skip" && (verdictOf(row)?.kind === "look" || (!ready.includes(row) && verdictOf(row)?.kind !== "linked"))),
    fresh: rowsView.filter((row) => !rowSaved(row) && ready.includes(row) && verdictOf(row)?.kind !== "transfer"),
    transfers: rowsView.filter((row) => !rowSaved(row) && ready.includes(row) && verdictOf(row)?.kind === "transfer"),
    linked: rowsView.filter((row) => verdictOf(row)?.kind === "linked"),
    saved: rowsView.filter((row) => rowSaved(row)),
  } : null;
  const hasFilesToProcess = !!draft?.sources.some((source) => !source.pageCount || source.processedPages < source.pageCount);
  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    // Copy the list now: the input is cleared as soon as this returns its first promise.
    const picked = Array.from(files);
    if (processingRef.current || savingRef.current) { setInfo(t("waitImport")); return; }
    if (!userId) { setInfo(t("signInSources")); return; }
    let next = draftRef.current;
    if (!next || next.owner !== owner || next.month !== month) next = { id: uid(), owner, month, sources: [], rows: [], saved: [], createdAt: Date.now() };
    // The same screenshot added twice is ignored.
    const hashes = await Promise.all(picked.map(async (file) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("")));
    const known = new Set(next.sources.map((source) => source.hash).filter(Boolean));
    const chosen = picked.filter((_, index) => !known.has(hashes[index]) && hashes.indexOf(hashes[index]) === index);
    const repeated = picked.length - chosen.length;
    const eligible = chosen.filter((file) => /\.pdf$/i.test(file.name) ? file.size <= 20_000_000 : /\.(png|jpe?g|webp)$/i.test(file.name) && file.size <= 12_000_000);
    const accepted = eligible.slice(0, Math.max(0, 10 - next.sources.length));
    const skipped = chosen.length - accepted.length;
    // A file named after a bank ("Jago_Okt.pdf") preselects that account; otherwise screenshots keep the 2.4.0 BCA
    // default. Either guess is replaced by the bank the page itself names.
    const guess = (file: File) => accountForBank(data.accounts, bankOfAccount(file.name.replace(/[_.\-]+/g, " "))) || (isImage(file.name) ? bcaAccount(data) : "");
    const sources = accepted.map((file) => ({ id: uid(), name: file.name, hash: hashes[picked.indexOf(file)], account: guess(file), accountConfirmed: !!guess(file), accountDetected: !!guess(file), file, processedPages: 0, pageCount: 0 }));
    if (!sources.length) { setInfo(repeated ? t("duplicateFilesSkipped", { count: repeated }) : next.sources.length >= 10 ? t("draftFull") : t("chooseValidFiles")); return; }
    try { await save({ ...next, sources: [...next.sources, ...sources] }); }
    catch { setInfo(t("filesSaveError")); return; }
    setDrafts(await listImportDrafts(owner));
    setInfo([t(sources.length === 1 ? "sourceAddedOne" : "sourcesAdded", { count: sources.length }), skipped ? t("sourcesSkipped", { count: skipped }) : "", repeated ? t("duplicateFilesSkipped", { count: repeated }) : ""].filter(Boolean).join(" "));
    // Picking files is the intent to read them: start right away (the one-time consent still asks first).
    void extract();
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
          const reviewMonth = draftRef.current.month;
          const known = draftRef.current.sources.find((item) => item.id === current.id) || current;
          // Text statements name their bank in the header and may be proven line by line from the running balance,
          // in which case no AI is needed; screenshots and unproven pages go to the Worker.
          let bank = known.bank || "";
          let local: ReturnType<typeof parseStatementPage> = null;
          let totals = known.totals;
          if (page.content.kind === "text") {
            bank = detectBank(page.content.text) || bank;
            if (!bank) throw new Error("unsupported_bank");
            const printed = statementTotals(page.content.text);
            totals = { opening: totals?.opening ?? printed.opening, closing: printed.closing ?? totals?.closing };
            local = parseStatementPage(page.content.text, reviewMonth, known.carry);
          }
          const guessed = bank ? accountForBank(data.accounts, bank) : "";
          const userChose = known.accountConfirmed && !known.accountDetected;
          const account = userChose ? confirmedImportAccount(known, data) : guessed || confirmedImportAccount(known, data) || (isImage(known.name) ? bcaAccount(data) : "");
          let read: { rows: Omit<ImportRow, "id" | "sourceId" | "page" | "pocketId" | "decision">[]; bank?: string };
          if (local) read = { rows: local.rows, bank };
          else read = await extractImportPage(userId, { month: reviewMonth, source: bank || bankOfAccount(account) || "auto", ...page.content });
          // A pause requested during inference still keeps the completed page.
          if (draftRef.current?.id !== draftId || draftRef.current.owner !== owner) break;
          bank = read.bank || bank;
          const settled = userChose ? account : (bank && accountForBank(data.accounts, bank)) || account;
          const rows: ImportRow[] = read.rows.map((result) => {
            const remembered = suggestMerchant(data, result.name) || (result.cleanName ? suggestMerchant(data, result.cleanName) : null);
            const row = { ...result, ...(remembered ? { cleanName: remembered.name } : {}), ...(local ? { proven: true } : {}), id: uid(), sourceId: current.id, page: page.number, pocketId: remembered?.pocketId || "" } as Omit<ImportRow, "decision">;
            return prepareImportRow({ ...row, decision: suggestImportDecision(row, reviewMonth) } as ImportRow, data, settled, { checkLedger: !statementMode });
          });
          const latest = draftRef.current;
          const fresh = withoutOverlap(rows, latest.rows.filter((row) => row.sourceId !== current.id)).rows;
          const sourceRows = [...latest.rows, ...fresh].filter((row) => row.sourceId === current.id);
          await save({ ...latest, rows: [...latest.rows, ...fresh], sources: latest.sources.map((item) => {
            if (item.id !== current.id) return item;
            const progress = { ...item, processedPages: page.number, pageCount: documentPages.count, datesChecked: false, error: undefined, ...(bank ? { bank } : {}), ...(totals ? { totals } : {}), carry: local?.balance, localPages: (item.localPages || 0) + (local ? 1 : 0) };
            if (item.accountConfirmed && !item.accountDetected) return progress;
            const detected = (bank && accountForBank(data.accounts, bank)) || detectImportAccount(sourceRows, item, data) || (item.mixedAccounts ? "" : settled);
            return detected ? { ...progress, account: detected, accountConfirmed: true, accountDetected: true } : item.accountDetected ? { ...progress, account: "", accountConfirmed: false, accountDetected: false } : progress;
          }) });
        }
      }, async (source, error) => {
        if (error instanceof LocalDraftWriteError) throw error;
        const message = error instanceof Error ? error.message === "not_bca" ? t("bcaOnly") : error.message === "unsupported_bank" ? t("bankUnsupported") : error.message : t("processFileFailed");
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
  // One tap for the whole list: every row not yet in Saku gets the same choice (rows missing details still need a look).
  async function decideAll(decision: "ready" | "skip") {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    const current = draftRef.current;
    gestures.announce(t(decision === "ready" ? "allMarkedAdd" : "allMarkedSkip"));
    // Rows Saku found already in the ledger stay skipped, so "Add all" never adds a duplicate.
    const linked = new Set(rowsView.filter((row) => row.alreadyInSaku).map((row) => row.id));
    try { await save({ ...current, rows: current.rows.map((row) => importRowAlreadySaved(row, current, data) || (decision === "ready" && linked.has(row.id)) ? row : { ...row, decision, userDecided: true }) }); }
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
    if (!draftRef.current || busy || processingRef.current || savingRef.current || (!ready.length && !toVerify.length) || uncheckedDateSources.length) return;
    const draftId = draftRef.current.id;
    savingRef.current = true; setSaving(true);
    try {
    const additions: Transaction[] = [];
    const paired = new Set<string>();
    const pairedByTransfer = new Map<string, string>();
    for (const row of ready) {
      if (paired.has(row.id)) continue;
      // Monthly check pairs the two sides itself (their dates may differ by a day or two); Catch up looks for them.
      const verdict = verdictOf(row);
      const other = verdict?.kind === "transfer" ? ready.find((candidate) => candidate.id === verdict.partnerRowId && !paired.has(candidate.id))
        : ["transfer", "topup"].includes(row.activity)
        ? ready.find((candidate) => candidate.id !== row.id && !paired.has(candidate.id) && ["transfer", "topup"].includes(candidate.activity) && candidate.date === row.date && candidate.amount === row.amount && candidate.direction !== row.direction && accountForRow(candidate) === row.counterparty && candidate.counterparty === accountForRow(row))
        : undefined;
      additions.push(...importedTransactions(row, accountForRow(row), draftRef.current.sources.find((source) => source.id === row.sourceId)?.name || "source", data, other?.id));
      if (other) { paired.add(other.id); pairedByTransfer.set(row.id, other.id); }
    }
    const learned = ready.reduce((rules, row) => row.direction === "expense" && ["purchase", "pay_later"].includes(row.activity) ? learnMerchant({ ...data, merchantRules: rules }, row.name, { name: importRowName(row), pocketId: row.pocketId }) : rules, data.merchantRules);
    // A link between differently named rows teaches Saku the user's name for it ("BERNADETTA" = "ci bebe").
    const merchantRules = rowsView.reduce((rules, row) => {
      const verdict = verdictOf(row);
      const entry = verdict?.kind === "linked" && verdict.alias ? data.transactions.find((transaction) => transaction.id === verdict.transactionId) : undefined;
      return entry ? learnMerchant({ ...data, merchantRules: rules }, row.name, { name: entry.name, pocketId: entry.pocketId }) : rules;
    }, learned);
    const verify = new Set(toVerify.map((verdict) => verdict.transactionId));
    const transactions = data.transactions.map((transaction) => verify.has(transaction.id) ? { ...transaction, verified: true } : transaction);
    if (!(await commit({ ...data, transactions: [...transactions, ...additions], merchantRules }, additions.length ? t("importBatchSaved") : t("statementMatchesChecked", { count: verify.size })))) return;
    if (draftRef.current?.id !== draftId) return;
    const saved = additions.map((transaction) => ({ id: transaction.id, fingerprint: JSON.stringify(transaction), pairedRowId: transaction.transferId ? pairedByTransfer.get(transaction.transferId) : undefined }));
    try { await save({ ...draftRef.current, rows: draftRef.current.rows.map((row) => paired.has(row.id) ? { ...row, decision: "skip" } : row), saved: [...draftRef.current.saved, ...saved], verified: [...new Set([...(draftRef.current.verified || []), ...verify])] }); }
    catch { setInfo(t("savedButDraftFailed")); }
    } finally { savingRef.current = false; setSaving(false); }
  }
  async function undo() {
    if ((!draftRef.current?.saved.length && !draftRef.current?.verified?.length) || busy || processingRef.current || savingRef.current) return;
    const draftId = draftRef.current.id;
    savingRef.current = true; setSaving(true);
    try {
    const saved = new Map(draftRef.current.saved.map((item) => [item.id, item.fingerprint]));
    const unchanged = data.transactions.filter((transaction) => saved.get(transaction.id) === JSON.stringify(transaction));
    const unchangedIds = new Set(unchanged.map((transaction) => transaction.id));
    const removable = unchanged.filter((transaction) => !transaction.transferId || data.transactions.filter((part) => part.transferId === transaction.transferId).every((part) => unchangedIds.has(part.id)));
    // Links this check marked as checked lose the mark again.
    const unverify = new Set(draftRef.current.verified || []);
    if (!removable.length && !unverify.size) { setInfo(t("savedTransactionsChanged")); return; }
    const ids = new Set(removable.map((t) => t.id));
    const kept = data.transactions.filter((transaction) => !ids.has(transaction.id)).map((transaction) => unverify.has(transaction.id) ? (({ verified: _, ...rest }) => rest)(transaction) : transaction);
    if (!(await commit({ ...data, transactions: kept }, t("importedUndone", { count: ids.size + unverify.size })))) return;
    if (draftRef.current?.id !== draftId) return;
    const transferIds = new Set(removable.map((transaction) => transaction.transferId).filter(Boolean));
    const pairedRowIds = new Set(draftRef.current.saved.filter((item) => ids.has(item.id)).map((item) => item.pairedRowId).filter(Boolean));
    try { await save({ ...draftRef.current, rows: draftRef.current.rows.map((row) => ids.has(row.id) || transferIds.has(row.id) || pairedRowIds.has(row.id) ? { ...row, decision: "later" } : row), saved: draftRef.current.saved.filter((item) => !ids.has(item.id)), verified: [] }); }
    catch { setInfo(t("undoneButDraftFailed")); }
    } finally { savingRef.current = false; setSaving(false); }
  }
  async function patchRows(patches: Record<string, Partial<ImportRow>>, count?: "decisions" | "unlinks") {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    const stats = draftRef.current.stats || { decisions: 0, unlinks: 0 };
    try { await save({ ...draftRef.current, rows: draftRef.current.rows.map((row) => patches[row.id] ? { ...row, ...patches[row.id] } : row), ...(count ? { stats: { ...stats, [count]: stats[count] + 1 } } : {}) }); }
    catch { /* save explains the local storage problem */ }
  }
  // The entry was logged under another account: move it to the statement's account and link the two.
  async function moveAndLink(row: ImportRow, transactionId: string) {
    const entry = data.transactions.find((transaction) => transaction.id === transactionId);
    const account = accountForRow(row);
    if (!entry || !account || busy || savingRef.current) return;
    if (!(await commit({ ...data, transactions: data.transactions.map((transaction) => transaction.id === transactionId ? { ...transaction, account } : transaction) }, t("movedToAccount", { account })))) return;
    await patchRows({ [row.id]: { matchId: transactionId, unlinked: false, userDecided: true } });
  }
  async function removeOnlyInSaku(transaction: Transaction) {
    if (busy || savingRef.current) return;
    const ids = new Set(transaction.transferId ? data.transactions.filter((item) => item.transferId === transaction.transferId).map((item) => item.id) : [transaction.id]);
    if (await commit({ ...data, transactions: data.transactions.filter((item) => !ids.has(item.id)) }, t("removedFromSaku"))) setConfirmRemove("");
  }
  // One bounded call for the rows Saku can't tell apart; the answer is a hint the user still taps.
  async function askCompare() {
    if (!userId || !draftRef.current || comparing) return;
    const items = (groups?.look || []).flatMap((row) => {
      const verdict = verdictOf(row);
      if (verdict?.kind !== "look" || verdict.reason !== "ambiguous" || verdict.candidates.length < 2) return [];
      const candidates = verdict.candidates.slice(0, 5).flatMap((id) => data.transactions.filter((transaction) => transaction.id === id)).map((transaction) => ({ id: transaction.id, name: transaction.name, note: transaction.note.slice(0, 80), date: transaction.date }));
      return candidates.length >= 2 ? [{ id: row.id, name: importRowName(row), date: row.date, candidates }] : [];
    }).slice(0, 20);
    if (!items.length) return;
    setComparing(true);
    try {
      const picks = await compareImportNames(userId, items);
      const hints = Object.fromEntries(picks.filter((pick) => pick.candidateId !== "none").map((pick) => [pick.id, { aiPick: pick.candidateId }]));
      await patchRows(hints);
      setInfo(Object.keys(hints).length ? t("compareDone", { count: Object.keys(hints).length }) : t("compareNothing"));
    } catch (error) { setInfo(error instanceof Error ? error.message : t("compareFailed")); }
    finally { setComparing(false); }
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
    try { await save(next); setDrafts(await listImportDrafts(owner)); setInfo(""); setPreviewId(""); setDeleteConfirmationId(""); }
    catch { /* save explains the local storage problem */ }
  }
  async function deleteDraft() {
    if (!draftRef.current || processingRef.current || savingRef.current) return;
    const id = draftRef.current.id;
    await writeTail.current;
    if (draftRef.current?.id !== id || processingRef.current || savingRef.current) return;
    try {
      await deleteImportDraft(id); persisted.current.delete(id);
      const next = await listImportDrafts(owner); setDrafts(next); setDraft(next[0] || null); draftRef.current = next[0] || null;
      setInfo(""); setPreviewId(""); setDeleteConfirmationId("");
    } catch { setInfo(t("localDraftRemoveError")); }
  }
  const renderRow = (row: ImportRow) => {
    if (!draft) return null;
    const source = draft.sources.find((item) => item.id === row.sourceId)!;
            const alreadySaved = rowSaved(row);
            const account = accountForRow(row);
            const accountHint = !account ? t("chooseAccount") : account !== confirmedImportAccount(source, data) ? `${t("sakuAccount")}: ${account}` : "";
            const duplicate = needsSeparateConfirmation(row);
            const pair = ["transfer", "topup"].includes(row.activity) ? draft.rows.find((candidate) => candidate.id !== row.id && ["transfer", "topup"].includes(candidate.activity) && candidate.date === row.date && candidate.amount === row.amount && candidate.direction !== row.direction && accountForRow(candidate) && accountForRow(candidate) !== account) : undefined;
            const card = data.creditCards.find((item) => item.name === account);
            const rowReady = ready.includes(row);
            const editing = editingRow === row.id;
            const offset = gestures.offset(row.id);
            const state: RowState = alreadySaved ? "saved" : row.decision === "skip" ? "skip" : rowReady ? "ready" : row.decision === "later" ? "later" : "review";
            const status = alreadySaved ? t("inActivity") : row.alreadyInSaku && row.decision === "skip" ? t("alreadyInSaku") : row.decision === "skip" ? t("notImporting") : rowReady ? t("willAdd") : row.decision === "later" ? t("reviewLater") : t("openReview");
            // In Monthly check a look row carries its own question below, so the generic hint would only repeat it.
            const hint = !alreadySaved && !rowReady && row.decision !== "skip" && verdictOf(row)?.kind !== "look" ? importRowReviewIssue(row, account, data, duplicate) : "";
            return <div className="catchup-row" key={row.id} data-state={state} data-swipe={offset > 40 ? "add" : offset < -40 ? "skip" : undefined} data-add-label={t("swipeAdd")} data-skip-label={t("swipeSkip")}>
              <button type="button" className="catchup-row-summary" aria-haspopup="dialog" style={offset ? { transform: `translateX(${offset}px)` } : undefined}
                {...gestures.handlers(row.id, alreadySaved || saving)}>
                <span className="catchup-row-identity"><span className="catchup-row-kicker"><time dateTime={row.date || undefined}>{validDate(row.date) ? friendlyDate(row.date) : t("checkDate")}</time>{accountHint && <small className="catchup-row-account">{accountHint}</small>}<small>{activityOptions().find((item) => item.value === row.activity)?.label}</small></span><strong>{importRowName(row) || t("unnamedTransaction")}</strong>{row.note && <small className="catchup-row-note-text">{row.note}</small>}{hint && <small className="catchup-row-hint">{hint}</small>}</span>
                <span className="catchup-row-figure"><strong>{row.activity === "reward" ? `${row.amount || 0} ${t("pointsCoinsShort")}` : `${row.direction === "expense" ? "−" : row.direction === "income" ? "+" : "?"}${money(row.amount || 0)}`}</strong><RowStatus state={state} label={status} /></span>
                
              </button>
              {editing && <Modal title={importRowName(row) || t("unnamedTransaction")} subtitle={`${validDate(row.date) ? friendlyDate(row.date) : t("checkDate")} · ${row.direction === "expense" ? "−" : row.direction === "income" ? "+" : "?"}${money(row.amount || 0)}`} onClose={() => setEditingRow("")}><div className="catchup-row-details">
              <div className="catchup-row-main"><label className="catchup-field">{t("description")}<input value={row.cleanName ?? importRowName(row)} placeholder={row.name} maxLength={100} readOnly={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { cleanName: event.target.value })} /></label><label className="catchup-field">{t("date")}<input type="date" value={row.date} readOnly={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { date: event.target.value })} /></label><label className="catchup-field">{row.activity === "reward" ? t("pointsCoins") : t("amountRupiah")}<span className="catchup-amount">{row.activity !== "reward" && <span>Rp</span>}<input type="number" min="1" step="1" value={row.amount || ""} readOnly={alreadySaved || saving} onChange={(event) => void updateRow(row.id, { amount: Number(event.target.value) })} /></span></label></div>
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
                {!alreadySaved && <div className="catchup-decision"><div role="group" aria-label={t("importChoiceFor", { name: row.name || t("unnamedTransaction") })}><button type="button" className={row.decision === "ready" ? "selected" : ""} aria-pressed={row.decision === "ready"} disabled={saving} onClick={() => decide(row.id, "ready")}>{t("addToSaku")}</button><button type="button" className={row.decision === "later" ? "selected" : ""} aria-pressed={row.decision === "later"} disabled={saving} onClick={() => decide(row.id, "later")}>{t("reviewLater")}</button><button type="button" className={row.decision === "skip" ? "selected" : ""} aria-pressed={row.decision === "skip"} disabled={saving} onClick={() => decide(row.id, "skip")}>{t("dontImport")}</button></div></div>}
              </div></div></Modal>}
            </div>;
  };
  const gates = draft ? <>{!!uncheckedDateSources.length && <div className="catchup-source-check"><p id="catchup-save-gate">{t("checkDatesFirst")} <button className="text-button" type="button" onClick={() => setPreviewId(uncheckedDateSources[0].id)}>{t("preview")}</button></p><button className="button secondary" type="button" disabled={processing || saving} onClick={() => void markSourcesChecked(uncheckedDateSources.map((source) => source.id))}><Check size={16} /> {t("looksRight")}</button></div>}
      {!!undatedSources.length && <div className="catchup-missing-dates"><strong>{t("someDatesMissing")}</strong><p>{t("sharedDateHelp")}</p>{undatedSources.map((source) => { const count = draft.rows.filter((row) => row.sourceId === source.id && !row.date && row.decision !== "skip" && !rowSaved(row)).length; return <div key={source.id}><b>{source.name} · {count} {count === 1 ? t("row") : t("rows")}</b><div><label>{t("sharedDate")}<input type="date" value={sharedDates[source.id] || ""} max={today()} disabled={processing || saving} onChange={(event) => setSharedDates((current) => ({ ...current, [source.id]: event.target.value }))} /></label><button type="button" className="button secondary" disabled={!validDate(sharedDates[source.id] || "") || (sharedDates[source.id] || "") > today() || processing || saving} onClick={() => void applySharedDate(source.id)}>{t("setDateFor", { count, unit: count === 1 ? t("row") : t("rows") })}</button></div></div>; })}</div>}</> : null;
  const entry = (id: string) => data.transactions.find((transaction) => transaction.id === id);
  const signed = (row: { direction?: string; type?: string; amount: number }) => `${(row.direction || row.type) === "income" ? "+" : "−"}${money(row.amount || 0)}`;
  const transferItems = (groups?.transfers || []).filter((row) => { const verdict = verdictOf(row); return verdict?.kind === "transfer" && (!verdict.partnerRowId || row.direction === "expense"); });
  const flaggedNotes = statementMode && draft ? draft.sources.flatMap((source) => {
    const rowsOf = draft.rows.filter((row) => row.sourceId === source.id);
    if (balanceMismatch(rowsOf, source.totals)) return [<p className="catchup-issue" key={`b-${source.id}`}>{t("balanceMismatch", { name: source.name })}</p>];
    const bank = bankById(source.bank || "");
    return bank?.beta && rowsOf.some((row) => !row.proven) ? [<p className="import-note" key={`beta-${source.id}`}>{t("bankBeta", { bank: bank.name })}</p>] : [];
  }) : [];
  const renderLook = (row: ImportRow) => {
    const verdict = verdictOf(row);
    const choices = verdict?.kind === "look" ? (() => {
      if (verdict.reason === "ambiguous") return <><p>{t("whichOneIsIt")}</p><div className="monthly-choice-list">{verdict.candidates.flatMap((id) => { const item = entry(id); return item ? [<button type="button" key={id} className={row.aiPick === id ? "is-suggested" : undefined} disabled={saving || processing} onClick={() => void patchRows({ [row.id]: { matchId: id, unlinked: false, userDecided: true } }, "decisions")}><Link2 size={14} aria-hidden="true" /><span><strong>{item.name}</strong><small>{friendlyDate(item.date)} · {item.account}</small></span>{row.aiPick === id && <em><Sparkles size={12} aria-hidden="true" /> {t("sakuThinks")}</em>}</button>] : []; })}</div><button type="button" className="text-button" disabled={saving || processing} onClick={() => void patchRows({ [row.id]: { confirmedSeparate: true, userDecided: true, decision: "ready" } }, "decisions")}>{t("itsNewOne")}</button></>;
      if (verdict.reason === "other_account") { const item = entry(verdict.candidates[0]); return item ? <><p>{t("loggedElsewhere", { name: item.name, account: item.account, statement: accountForRow(row) })}</p><div className="monthly-choice-row"><button type="button" className="button secondary" disabled={saving || busy} onClick={() => void moveAndLink(row, item.id)}>{t("moveToAccount", { account: accountForRow(row) })}</button><button type="button" className="text-button" disabled={saving} onClick={() => void patchRows({ [row.id]: { confirmedSeparate: true, userDecided: true, decision: "ready" } }, "decisions")}>{t("itsDifferentOne")}</button></div></> : null; }
      if (verdict.reason === "transfer_tie") return <><p>{t("transferWhich")}</p><div className="monthly-choice-row">{(verdict.partnerRowIds || []).flatMap((id) => { const partner = rowsView.find((item) => item.id === id); return partner ? [<button type="button" key={id} className="button secondary" disabled={saving} onClick={() => void patchRows({ [row.id]: { pairRowId: id, unpaired: false, userDecided: true } }, "decisions")}><ArrowLeftRight size={14} aria-hidden="true" /> {accountForRow(partner)}</button>] : []; })}<button type="button" className="text-button" disabled={saving} onClick={() => void patchRows({ [row.id]: { unpaired: true, userDecided: true } }, "decisions")}>{t("notATransfer")}</button></div></>;
      return <><p>{t("checkThisRow")}</p><div className="monthly-choice-row"><button type="button" className="button secondary" disabled={saving} onClick={() => decide(row.id, "ready")}><Check size={14} aria-hidden="true" /> {t("addToSaku")}</button><button type="button" className="text-button" disabled={saving} onClick={() => decide(row.id, "skip")}>{t("dontImport")}</button></div></>;
    })() : null;
    return <div className="monthly-look" key={row.id}>{renderRow(row)}{choices && <div className="monthly-choices">{choices}</div>}</div>;
  };
  const renderTransfer = (row: ImportRow) => {
    const verdict = verdictOf(row);
    if (verdict?.kind !== "transfer") return null;
    const partner = verdict.partnerRowId ? rowsView.find((item) => item.id === verdict.partnerRowId) : undefined;
    const from = row.direction === "expense" ? accountForRow(row) : verdict.counterparty, to = row.direction === "expense" ? verdict.counterparty : accountForRow(row);
    return <div className="monthly-transfer" key={row.id}><span className="monthly-transfer-icon" aria-hidden="true"><ArrowLeftRight size={16} /></span><span><strong>{from} → {to}</strong><small>{friendlyDate(row.date)}{partner ? ` · ${t("bothStatements")}` : ` · ${t("oneStatement", { account: accountForRow(row) })}`}</small></span><b>{money(row.amount)}</b><button type="button" className="text-button" disabled={saving || processing} onClick={() => void patchRows({ [row.id]: { unpaired: true, decision: "later" }, ...(partner ? { [partner.id]: { unpaired: true, decision: "later" } } : {}) })}>{t("notATransfer")}</button></div>;
  };
  const renderLinked = (row: ImportRow) => {
    const verdict = verdictOf(row);
    const item = verdict?.kind === "linked" ? entry(verdict.transactionId) : undefined;
    if (verdict?.kind !== "linked" || !item) return null;
    return <div className="monthly-linked" key={row.id}><span className="monthly-linked-icon" aria-hidden="true"><Link2 size={15} /></span><span><strong>{item.name}</strong><small>{friendlyDate(row.date)} · {accountForRow(row)}{item.verified ? ` · ${t("checkedMark")}` : ""}</small>{verdict.alias && <em className="monthly-alias">{t("aliasChip", { from: verdict.alias.from, to: verdict.alias.to })}</em>}</span><b>{signed(row)}</b><button type="button" className="text-button" aria-label={t("unlinkRow", { name: item.name })} disabled={saving || processing} onClick={() => void patchRows({ [row.id]: { unlinked: true, matchId: undefined, aiPick: undefined } }, "unlinks")}><Unlink size={14} aria-hidden="true" /> {t("unlink")}</button></div>;
  };
  const ambiguousCount = (groups?.look || []).filter((row) => { const verdict = verdictOf(row); return verdict?.kind === "look" && verdict.reason === "ambiguous" && verdict.candidates.length >= 2; }).length;
  const monthlyReview = groups && draft ? <section className="catchup-panel catchup-review monthly-check">
    <div className="catchup-panel-head"><div><h3>{t("monthlyResult")}</h3><p className="monthly-summary" aria-live="polite">
      <span><CountUp value={draft.sources.length} /> {t(draft.sources.length === 1 ? "statementShortOne" : "statementsShort")}</span>
      <span><CountUp value={groups.linked.length} /> {t("alreadyInSakuShort")}</span>
      <span><CountUp value={transferItems.length} /> {t(transferItems.length === 1 ? "transferShortOne" : "transfersShort")}</span>
      <span><CountUp value={groups.fresh.length} /> {t("newShort")}</span>
      <span className={groups.look.length ? "is-attention" : undefined}><CountUp value={groups.look.length} /> {t("needLookShort")}</span>
    </p></div><span className="catchup-private"><LockKeyhole size={13} /> {t("savedDevice")}</span></div>
    {flaggedNotes}
    {import.meta.env.DEV && <p className="import-note" data-testid="monthly-stats">{`dev · ${draft.rows.length} rows · ${(draft.stats?.decisions || 0)} decisions (${draft.rows.length ? ((draft.stats?.decisions || 0) / draft.rows.length).toFixed(2) : "0"}/row) · ${draft.stats?.unlinks || 0} unlinks · ${draft.sources.reduce((sum, source) => sum + (source.localPages || 0), 0)} pages read without AI`}</p>}
    {gates}
    <p className="sr-only" aria-live="polite">{gestures.announcement}</p>
    {!!groups.look.length && <div className="monthly-group" data-group="look"><div className="monthly-group-head"><h4>{t("needsLookGroup")} <span>{groups.look.length}</span></h4>{!!ambiguousCount && userId && <button type="button" className="text-button" disabled={comparing || saving || processing} onClick={() => void askCompare()}><Sparkles size={14} aria-hidden="true" /> {comparing ? t("comparing") : t("askSakuCompare")}</button>}</div>{groups.look.map(renderLook)}</div>}
    {!!groups.fresh.length && <details className="monthly-group" data-group="new" open><summary><h4>{t("newGroup")} <span>{groups.fresh.length}</span></h4></summary><p className="catchup-swipe-hint">{t("swipeHint")}</p>{groups.fresh.map(renderRow)}</details>}
    {!!transferItems.length && <details className="monthly-group" data-group="transfer" open><summary><h4>{t("transfersGroup")} <span>{transferItems.length}</span></h4></summary>{transferItems.map(renderTransfer)}</details>}
    {!!groups.linked.length && <details className="monthly-group" data-group="linked"><summary><h4>{t("linkedGroup")} <span>{groups.linked.length}</span></h4></summary><p className="import-note">{t("linkedHelp")}</p>{groups.linked.map(renderLinked)}</details>}
    {!!analysis?.onlyInSaku.length && <details className="monthly-group" data-group="only"><summary><h4>{t("onlyInSakuGroup")} <span>{analysis.onlyInSaku.length}</span></h4></summary><p className="import-note">{t("onlyInSakuHelp")}</p>{analysis.onlyInSaku.map((item) => <div className="monthly-linked" key={item.id}><span className="monthly-linked-icon" aria-hidden="true"><FileText size={15} /></span><span><strong>{item.name}</strong><small>{friendlyDate(item.date)} · {item.account}</small></span><b>{signed(item)}</b>{confirmRemove === item.id ? <button type="button" className="button danger" disabled={busy || saving} onClick={() => void removeOnlyInSaku(item)}>{t("removeForGood")}</button> : <button type="button" className="text-button" disabled={busy || saving} onClick={() => setConfirmRemove(item.id)}>{t("removeFromSaku")}</button>}</div>)}</details>}
    {!!setAside.length && <details className="monthly-group" data-group="skipped"><summary><h4>{t("notImported")} <span>{setAside.length}</span></h4></summary>{setAside.map(renderRow)}</details>}
    {!!groups.saved.length && <details className="monthly-group" data-group="saved"><summary><h4>{t("savedGroup")} <span>{groups.saved.length}</span></h4></summary>{groups.saved.map(renderRow)}</details>}
    <div className={`catchup-save is-compact${saveBarHidden ? " is-hidden" : ""}`}><p><strong>{t(transferItems.length === 1 ? "monthlySaveSummaryOne" : "monthlySaveSummary", { fresh: groups.fresh.length, transfers: transferItems.length })}</strong>{!!toVerify.length && <small>{t(toVerify.length === 1 ? "linksToConfirmOne" : "linksToConfirm", { count: toVerify.length })}</small>}</p><button className="button primary" aria-describedby={uncheckedDateSources.length ? "catchup-save-gate" : undefined} disabled={(!ready.length && !toVerify.length) || !!uncheckedDateSources.length || busy || processing || saving} onClick={() => void saveReady()}>{uncheckedDateSources.length ? t("checkDatesShort") : ready.length ? t("saveMonthly") : t("confirmLinks", { count: toVerify.length })} <ArrowRight size={16} /></button></div>
  </section> : null;
  return <div className="catchup">
    <header className="catchup-hero"><div><p className="catchup-eyebrow">{statementMode ? t("catchUpMonthly") : t("catchUp")}</p><h2>{statementMode ? t("catchUpMonthlyTitle") : t("catchUpTitle")}</h2><p>{statementMode ? t("catchUpMonthlyHelp") : t("catchUpHelp")}</p></div><div className="catchup-hero-count"><strong>{statementMode ? groups?.linked.length || 0 : draft?.rows.length || "0"}</strong><span>{statementMode ? t("alreadyInSakuShort") : draft?.rows.length ? t("foundDraft") : t("foundAfterFile")}</span></div></header>
    <div className="catchup-steps"><span>{t("chooseFiles")}</span><ArrowRight size={13} /><span>{t("checkList")}</span><ArrowRight size={13} /><span>{t("addToSaku")}</span></div>
    <section className="catchup-panel"><div className="catchup-panel-head"><div><h3>{t("yourSources")}</h3><p>{t("sourcesHelp")}</p></div><label className="button primary"><Upload size={16} /> {t("addFiles")}<input hidden disabled={!userId || processing || saving} type="file" accept=".pdf,image/png,image/jpeg,image/webp" multiple onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /></label></div>
      {drafts.length > 1 && <ChoiceField label={t("localDraft")} disabled={processing || saving} value={draft?.id || ""} onValueChange={(value) => { const next = drafts.find((item) => item.id === value) || null; setDraft(next); draftRef.current = next; setInfo(""); setPreviewId(""); setDeleteConfirmationId(""); }} options={[{ value: "", label: t("selectDraft") }, ...drafts.map((item) => ({ value: item.id, label: new Date(item.createdAt).toLocaleDateString(localeTag()), description: t("sourceCount", { count: item.sources.length, rows: item.rows.length }) }))]} />}
      {!!draft?.sources.length && <div className="catchup-sources">{draft.sources.map((source) => <div className="catchup-source" key={source.id}>{/\.pdf$/i.test(source.name) ? <FileText size={20} /> : <FileImage size={20} />}<div className="catchup-source-identity"><strong>{source.name}</strong><small className={source.error ? "catchup-source-error" : undefined}>{activePage?.sourceId === source.id ? t("extractingPage", { page: activePage.page, total: activePage.total }) : source.error ? t("needsAttentionDetail", { detail: source.error }) : source.pageCount ? `${t("pagesProcessed", { count: source.processedPages, total: source.pageCount })}${source.accountDetected && confirmedImportAccount(source, data) ? ` · ${t("detectedAccount", { account: source.account })}` : ""}` : t("readyProcess")}</small></div><button className="text-button" onClick={() => setPreviewId(source.id)}>{t("preview")}</button><ChoiceField className="catchup-source-account" label={t("account")} disabled={processing || saving || source.mixedAccounts || sourceHasSavedRows(source.id)} value={source.mixedAccounts ? "" : confirmedImportAccount(source, data)} onValueChange={(value) => void updateAccount(source.id, value)} placeholder={source.mixedAccounts ? t("accountPerRow") : t("accountRequired")} options={[...data.accounts.map((account) => ({ value: account, label: account, description: t("bankCashWallet") })), ...data.creditCards.map((card) => ({ value: card.name, label: card.name, description: t("creditCard") }))]} /><button className="catchup-icon" disabled={processing || saving || sourceHasSavedRows(source.id)} title={sourceHasSavedRows(source.id) ? t("undoBeforeRemove") : t("removeSourceTitle")} aria-label={t("removeSource", { name: source.name })} onClick={() => void removeSource(source.id)}><X size={16} /></button></div>)}</div>}
      {!!draft?.sources.some((source) => sourceHasSavedRows(source.id)) && <p className="import-note">{t("sourceLocked")}</p>}
      {hasFilesToProcess ? <>
      </> : !!draft?.sources.length && <p className="catchup-processed"><Check size={16} /> {draft.rows.length ? t("processedWithRows") : t("processedEmpty")}</p>}
      <div className="catchup-actions">{hasFilesToProcess && <button className="button primary" disabled={processing || saving || !userId} onClick={() => void extract()}>{processing ? t("processing") : draft?.sources.some((source) => source.error) ? t("retrySources") : t("extractCloudflare")}<ArrowRight size={16} /></button>}{processing && <button className="button secondary" onClick={() => { cancelled.current = true; }}>{t("pauseAfterPage")}</button>}<button className="text-button" disabled={processing || saving} onClick={() => void newDraft()}>{t("newDraft")}</button>{draft && <button className="text-button" disabled={processing || saving} onClick={() => setDeleteConfirmationId(draft.id)}>{t("removeDraft")}</button>}</div>
      {draft && deleteConfirmationId === draft.id && <div className="catchup-delete-confirm" role="group" aria-label={t("confirmDraftRemoval")}><p>{t("removeDraftQuestion")}</p><div><button className="button secondary" type="button" onClick={() => setDeleteConfirmationId("")}>{t("keepDraft")}</button><button className="button danger" type="button" disabled={processing || saving} onClick={() => void deleteDraft()}>{t("removeThisDraft")}</button></div></div>}
      {!userId && <p className="catchup-message">{t("signInExtract")}</p>}{info && <p className="catchup-message" role="status">{info}</p>}
    </section>
    {statementMode && groups && !!draft?.rows.length && monthlyReview}
    {!statementMode && !!draft?.rows.length && <section className="catchup-panel catchup-review"><div className="catchup-panel-head"><div><h3>{t("reviewTitle")}</h3><p>{t("reviewHelp")}</p></div><span className="catchup-private"><LockKeyhole size={13} /> {t("savedDevice")}</span></div>
      <div className="catchup-review-overview"><div><strong>{ready.length}</strong><span>{t("toAdd")}</span></div><div><strong>{needsReview.length}</strong><span>{t("needLook")}</span></div><div><strong>{setAside.length}</strong><span>{t("notImported")}</span></div></div><div className="catchup-bulk"><p className="catchup-swipe-hint">{t("swipeHint")}</p><div><button type="button" className="text-button" disabled={processing || saving || !draft.rows.some((row) => !rowSaved(row) && !row.alreadyInSaku && row.decision !== "ready")} onClick={() => void decideAll("ready")}><Check size={14} /> {t("addAll")}</button><button type="button" className="text-button" disabled={processing || saving || !draft.rows.some((row) => !rowSaved(row) && row.decision !== "skip")} onClick={() => void decideAll("skip")}><X size={14} /> {t("skipAll")}</button></div></div><p className="sr-only" aria-live="polite">{gestures.announcement}</p>
      {gates}
      {draft.sources.map((source) => {
        const order = (row: ImportRow) => needsReview.includes(row) ? 0 : ready.includes(row) ? 1 : 2;
        for (const row of draft.rows) if (row.sourceId === source.id && !rowOrder.current.has(row.id)) rowOrder.current.set(row.id, order(row) * 1_000_000 + rowOrder.current.size);
        const rows = draft.rows.filter((row) => row.sourceId === source.id).sort((a, b) => rowOrder.current.get(a.id)! - rowOrder.current.get(b.id)!);
        return rows.length ? <div className="catchup-group" key={source.id}>
          <h4>{source.mixedAccounts ? t("mixedAccountLabel") : confirmedImportAccount(source, data) || t("chooseAccount")} <span>· {source.name}</span></h4>
          {rows.map(renderRow)}
        </div> : null;
      })}
      <div className={`catchup-save is-compact${saveBarHidden ? " is-hidden" : ""}`}><p><strong>{t("readyCount", { count: ready.length })}</strong>{needsReview.length > 0 && <small>{t("laterCount", { count: needsReview.length })}</small>}</p><button className="button primary" aria-describedby={uncheckedDateSources.length ? "catchup-save-gate" : undefined} disabled={!ready.length || !!uncheckedDateSources.length || busy || processing || saving} onClick={() => void saveReady()}>{uncheckedDateSources.length ? t("checkDatesShort") : t("addCount", { count: ready.length })} <ArrowRight size={16} /></button></div></section>}
    {!!draft?.saved.length && <section className="catchup-finish"><div><strong>{draft.saved.length} {t("savedDraft")}</strong><span>{t("existingSync")}</span></div><button className="button secondary" disabled={busy || processing || saving} onClick={() => void undo()}><RotateCcw size={15} /> {t("undoEntries")}</button></section>}
    {consentAsk && <Modal title={t("sendFiles")} subtitle={t("asksOnce")} onClose={() => setConsentAsk(false)}><p className="catchup-consent-text">{t("consentText")}</p><div className="form-footer"><button className="button secondary" type="button" onClick={() => setConsentAsk(false)}>{t("cancel")}</button><button className="button primary" type="button" onClick={() => { try { localStorage.setItem(importConsentKey(owner), "granted"); } catch { /* Without storage, Saku asks again next time. */ } setConsented(true); setConsentAsk(false); void extract(true); }}>{t("continue")}<ArrowRight size={16} /></button></div></Modal>}
    {preview && previewUrl && <Modal title={preview.name} subtitle={t("sourceFile")} onClose={() => setPreviewId("")}><div className="catchup-preview">{/\.pdf$/i.test(preview.name) ? <iframe title={preview.name} src={previewUrl} /> : <img alt={`${t("preview")} ${preview.name}`} src={previewUrl} />}</div></Modal>}
  </div>;
}
