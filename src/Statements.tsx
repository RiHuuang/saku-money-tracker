import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  LockKeyhole,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  bankRows,
  money,
  monthLabel,
  readCSV,
  reconcile,
  today,
  uid,
  validAmount,
  validDate,
  type Data,
  type Mapping,
  type Statement,
  type Transaction,
} from "./domain";
import { balanceIssue, evidenceIssues, extractionPrompt, hasTransactionEvidence, parseDeterministicBankRows, parseModelRows, statementContext, type PdfCandidate, type PdfDraft } from "./pdfStatement";
import { readPdf } from "./pdfReader";
import { localStatementAI, nativeAIAvailable, type ModelProgress, type ModelStatus } from "./localStatementAI";
import { download } from "./storage";
import { ChoiceField, IconButton, Modal, MoneyInput, SegmentedChoice } from "./components";

export default function Statements({
  data,
  month,
  commit,
  busy,
  notify,
}: {
  data: Data;
  month: string;
  commit: (data: Data, message: string) => Promise<boolean>;
  busy: boolean;
  notify: (message: string) => void;
}) {
  const [files, setFiles] = useState<Statement[]>([]),
    [reading, setReading] = useState(false),
    [review, setReview] = useState(false),
    [selection, setSelection] = useState<Record<string, string>>({}),
    [decisions, setDecisions] = useState<Record<string, "add" | "skip" | "update" | "keep" | "delete">>({}),
    [errors, setErrors] = useState<string[]>([]),
    [deckOpen, setDeckOpen] = useState(false),
    [dragX, setDragX] = useState(0);
  const [pdfs, setPdfs] = useState<PdfDraft[]>([]);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [modelProgress, setModelProgress] = useState<ModelProgress | null>(null);
  const [processing, setProcessing] = useState(false);
  const cancelled = useRef(false);
  const swipeStart = useRef<number | null>(null);
  const candidateValid = (c: PdfCandidate) => validDate(c.date) && validAmount(c.amount) && !!c.name.trim() && c.name.length <= 100;
  useEffect(() => {
    if (!nativeAIAvailable) return;
    void localStatementAI.getStatus().then(setModel).catch(() => setModel(null));
    let handle: { remove: () => Promise<void> } | undefined;
    void localStatementAI.addListener("modelProgress", setModelProgress).then((h) => { handle = h; });
    return () => { void handle?.remove(); };
  }, []);
  const rows = useMemo(
    () => reconcile([
      ...files.flatMap(bankRows),
      ...pdfs.flatMap((p) => p.stage === "Ready for review" ? p.candidates.filter((c) => c.accepted && candidateValid(c) && (!c.issues.length || c.manualConfirmed)) : []),
    ], data.transactions, month),
    [files, pdfs, data.transactions, month],
  );
  const matches = rows.filter((r) => r.status === "matched"),
    missing = rows.filter((r) => r.status === "missing"),
    different = rows.filter((r) => r.status === "different"),
    uncertain = rows.filter((r) => ["review", "invalid"].includes(r.status));
  const fileAccounts = new Set([...files.map((f) => f.account), ...pdfs.map((p) => p.account)]);
  const unmatched = data.transactions.filter(
    (t) =>
      t.date.startsWith(month) &&
      fileAccounts.has(t.account) &&
      !rows.some((r) => r.matchId === t.id),
  );
  const reviewItems = [
    ...rows.filter((row) => row.status === "missing" || row.status === "different")
      .map((row) => ({ key: row.id, kind: "statement" as const, row })),
    ...unmatched.map((transaction) => ({ key: `ledger:${transaction.id}`, kind: "ledger" as const, transaction })),
  ];
  const pendingReviewItems = reviewItems.filter((item) => !decisions[item.key]);
  const currentReview = pendingReviewItems[0];
  const decideCurrent = (accept: boolean) => {
    if (!currentReview) return;
    const decision = currentReview.kind === "ledger" ? (accept ? "keep" : "delete")
      : currentReview.row.status === "different" ? (accept ? "update" : "keep")
        : accept ? "add" : "skip";
    setDecisions((value) => ({ ...value, [currentReview.key]: decision }));
    setDragX(0);
  };
  const deckSwipe = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      swipeStart.current = event.clientX;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (swipeStart.current !== null) setDragX(Math.max(-130, Math.min(130, event.clientX - swipeStart.current)));
    },
    onPointerUp: () => {
      if (Math.abs(dragX) >= 75) decideCurrent(dragX > 0);
      else setDragX(0);
      swipeStart.current = null;
    },
  };
  async function readFiles(list: FileList | null) {
    if (!list?.length) return;
    setReading(true);
    setReview(false);
    const added: Statement[] = [],
      failures: string[] = [];
    for (const file of Array.from(list)) {
      try {
        if (!/\.csv$/i.test(file.name))
          throw new Error(
            "Choose a CSV export.",
          );
        if (file.size > 5000000)
          throw new Error("Use a file smaller than 5 MB.");
        if (files.length + pdfs.length + added.length >= 10)
          throw new Error("Check up to 10 files at a time.");
        const parsed = readCSV(await file.text());
        added.push({
          id: uid(),
          file: file.name,
          account: data.accounts[0],
          format: "id",
          dateOrder: "dmy",
          ...parsed,
        });
      } catch (e) {
        failures.push(
          `${file.name}: ${e instanceof Error ? e.message : "Could not read file."}`,
        );
      }
    }
    setFiles((prev) => [...prev, ...added]);
    setErrors(failures);
    setReading(false);
    setSelection({});
  }
  function updatePdf(id: string, patch: Partial<PdfDraft>) {
    setPdfs((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p));
    setReview(false);
    setSelection({});
  }
  function editCandidate(pdfId: string, candidateId: string, patch: Partial<PdfCandidate>) {
    setPdfs((prev) => prev.map((p) => {
      if (p.id !== pdfId) return p;
      const candidates = p.candidates.map((c) => {
        if (c.id !== candidateId) return c;
        const next = { ...c, ...patch, account: p.account };
        return { ...next, issues: evidenceIssues(next), manualConfirmed: patch.manualConfirmed ?? (patch.accepted !== undefined ? c.manualConfirmed : false), accepted: patch.accepted ?? false };
      });
      return { ...p, candidates, balanceIssue: balanceIssue(p.lines, candidates) };
    }));
    setReview(false);
    setSelection({});
  }
  async function readPdfs(list: FileList | null) {
    if (!list?.length || !model?.installed || processing) return;
    cancelled.current = false;
    setProcessing(true); setReview(false); setErrors([]);
    const failures: string[] = [];
    let addedCount = 0;
    for (const file of Array.from(list)) {
      if (cancelled.current) break;
      if (files.length + pdfs.length + addedCount >= 10) { failures.push(`${file.name}: Check up to 10 files at a time.`); break; }
      addedCount++;
      const id = uid();
      const draft: PdfDraft = { id, file: file.name, account: data.accounts[0], lines: [], candidates: [], stage: "Reading", progress: 0 };
      setPdfs((prev) => [...prev, draft]);
      try {
        if (!/\.pdf$/i.test(file.name)) throw new Error("Choose a PDF statement");
        let password = "";
        let lines;
        try {
          lines = await readPdf(file, password, (stage, fraction) => {
            if (cancelled.current) throw new Error("Cancelled");
            updatePdf(id, { stage, progress: Math.round(fraction * 50) });
          });
        } catch (e) {
          if (!(e instanceof Error) || !/password/i.test(e.message)) throw e;
          password = window.prompt(`Password for ${file.name} (not saved):`) || "";
          if (!password) throw new Error("Password required");
          lines = await readPdf(file, password, (stage, fraction) => updatePdf(id, { stage, progress: Math.round(fraction * 50) }));
        }
        password = "";
        updatePdf(id, { lines, stage: "Extracting transactions", progress: 50 });
        const candidates = parseDeterministicBankRows(lines, file.name, draft.account, month);
        const documentContext = statementContext(lines);
        let skippedSections = 0;
        const parsedIds = new Set(candidates.map((candidate) => candidate.sourceId));
        const likely = lines.filter((line) => !parsedIds.has(line.id)
          && /\b\d{1,2}[/-](?:\d{1,2}|[A-Z]{3})\b/i.test(line.text)
          && /[.,]|\d{4,}/.test(line.text));
        for (let offset = 0; offset < likely.length; offset += 8) {
          if (cancelled.current) throw new Error("Cancelled");
          const chunk = likely.slice(offset, offset + 8);
          try {
            const answer = await localStatementAI.generate({ prompt: extractionPrompt(chunk, month, documentContext) });
            candidates.push(...parseModelRows(answer.text, chunk, file.name, draft.account, month).filter(hasTransactionEvidence));
          } catch (e) {
            if (cancelled.current || (e instanceof Error && /cancel/i.test(e.message))) throw e;
            let recovered = true;
            for (const retry of [chunk.slice(0, 4), chunk.slice(4)]) {
              if (!retry.length) continue;
              try {
                const answer = await localStatementAI.generate({ prompt: extractionPrompt(retry, month, documentContext) });
                candidates.push(...parseModelRows(answer.text, retry, file.name, draft.account, month).filter(hasTransactionEvidence));
              } catch (retryError) {
                if (cancelled.current || (retryError instanceof Error && /cancel/i.test(retryError.message))) throw retryError;
                recovered = false;
              }
            }
            if (!recovered) skippedSections++;
          }
          updatePdf(id, {
            candidates: [...candidates],
            balanceIssue: balanceIssue(lines, candidates),
            progress: 50 + Math.round((offset + chunk.length) / likely.length * 50),
          });
        }
        updatePdf(id, {
          candidates,
          balanceIssue: balanceIssue(lines, candidates),
          stage: "Ready for review",
          progress: 100,
          error: skippedSections
            ? `Local AI skipped ${skippedSections} section${skippedSections === 1 ? "" : "s"}. Review the source lines and add any missing rows manually.`
            : undefined,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not process PDF";
        failures.push(`${file.name}: ${message}`);
        updatePdf(id, { stage: "Needs attention", error: message });
      }
    }
    setErrors(failures); setProcessing(false);
  }
  async function refreshModel() {
    try { setModel(await localStatementAI.getStatus()); }
    catch { notify("Could not read model status."); }
  }
  function update(id: string, patch: Partial<Statement>) {
    setFiles(files.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setReview(false);
    setSelection({});
  }
  async function confirmMatches() {
    const ids = new Set(matches.map((r) => r.matchId));
    await commit(
      {
        ...data,
        transactions: data.transactions.map((t) =>
          ids.has(t.id) ? { ...t, verified: true } : t,
        ),
      },
      `${ids.size} matching transactions checked`,
    );
  }
  async function applyDecisions() {
    const selected = missing.filter((r) => decisions[r.id] === "add");
    if (!selected.length) return;
    if (selected.some((r) => r.date > today())) {
      notify("Future-dated rows cannot be added yet.");
      return;
    }
    if (
      selected.some(
        (r) =>
          r.type === "expense" && selection[r.id] &&
          !data.pockets.some(
            (p) =>
              p.id === selection[r.id] && p.createdMonth <= r.date.slice(0, 7),
          ),
      )
    ) {
      notify("Choose a pocket that exists for the transaction month.");
      return;
    }
    const added: Transaction[] = selected.map((r) => ({
      id: uid(),
      name: r.name,
      amount: r.amount,
      type: r.type,
      date: r.date,
      pocketId: r.type === "income" ? "" : (selection[r.id] || ""),
      account: r.account,
      note: `Imported from ${r.file}${pdfs.flatMap((p) => p.candidates).find((c) => c.id === r.id)?.page ? `, page ${pdfs.flatMap((p) => p.candidates).find((c) => c.id === r.id)?.page}` : ""}`.slice(0, 500),
      verified: true,
    }));
    const updates = new Map(different.filter((r) => decisions[r.id] === "update").map((r) => [r.matchId, r]));
    const requestedDeletes = unmatched.filter((t) => decisions[`ledger:${t.id}`] === "delete");
    const transferIds = new Set(requestedDeletes.map((t) => t.transferId).filter(Boolean));
    const deletes = new Set([...requestedDeletes.map((t) => t.id), ...data.transactions.filter((t) => t.transferId && transferIds.has(t.transferId)).map((t) => t.id)]);
    const transactions = data.transactions.filter((t) => !deletes.has(t.id)).map((t) => {
      const row = updates.get(t.id);
      return row ? { ...t, name: row.name, amount: row.amount, type: row.type, date: row.date, verified: true } : t;
    });
    if (await commit({ ...data, transactions: [...transactions, ...added] }, `${added.length} added · ${updates.size} updated · ${deletes.size} deleted`)) { setSelection({}); setDecisions({}); }
  }
  return (
    <>
      <div className="check-steps" aria-label="Monthly check progress">
        <span className={!review && !Object.keys(decisions).length ? "active" : ""}>1 Import</span>
        <span className={review && !Object.keys(decisions).length ? "active" : ""}>2 Review</span>
        <span className={Object.keys(decisions).length ? "active" : ""}>3 Confirm</span>
      </div>
      <div className="check-intro">
        <span className="check-intro-icon">
          <FileCheck2 size={28} />
        </span>
        <div>
          <h2>A second look at your month.</h2>
          <p>
            Compare your bank exports with your {monthLabel(month)}{" "}
            transactions.
          </p>
        </div>
        <span className="private-pill">
          <LockKeyhole size={13} />
          Stays on your device
        </span>
      </div>
      <section className="pdf-import" aria-label="PDF statements">
        <div className="section-heading"><h2>PDF statements</h2><span className="subtle-badge">On-device AI</span></div>
        {!nativeAIAvailable ? (
          <p className="import-note">PDF AI is available in the installed Android app. The browser preview supports CSV checks only.</p>
        ) : !model ? (
          <p className="import-note">Checking this device for local PDF processing...</p>
        ) : !model.supported ? (
          <p className="import-note" role="alert">This device cannot run local PDF AI: {model.reason}.</p>
        ) : (
          <>
            <div className="model-controls">
              <div><strong>{model.installed ? "Model ready offline" : "One-time model setup"}</strong><p>Qwen3 0.6B mixed INT4 · 475 MiB download. Statements and prompts stay on this device.</p></div>
              {model.installed ? (
                <button className="button secondary" disabled={processing} onClick={() => void localStatementAI.removeModel().then(refreshModel).catch((e) => notify(String(e)))}>Remove model</button>
              ) : (
                <button className="button secondary" disabled={model.downloading} onClick={() => { setModel({ ...model, downloading: true }); void localStatementAI.downloadModel().then(refreshModel).catch((e) => { notify(String(e)); void refreshModel(); }); }}>Download model</button>
              )}
              {(model.downloading || modelProgress?.stage === "downloading") && <button className="text-button" onClick={() => void localStatementAI.cancel().then(refreshModel)}>Cancel</button>}
            </div>
            {modelProgress && <p className="import-note" role="status">{modelProgress.stage}: {Math.round(modelProgress.bytes / Math.max(1, modelProgress.total) * 100)}%</p>}
            <div className="pdf-actions">
              <label className={`button primary ${!model.installed || processing ? "disabled" : ""}`}><FileText size={17} />Choose PDF files
                <input type="file" accept=".pdf,application/pdf" multiple hidden disabled={!model.installed || processing} onChange={(e) => { void readPdfs(e.target.files); e.target.value = ""; }} />
              </label>
              {processing && <button className="button secondary" onClick={() => { cancelled.current = true; void localStatementAI.cancel(); }}>Cancel processing</button>}
            </div>
          </>
        )}
        {pdfs.map((pdf) => <div className="pdf-file" key={pdf.id}>
          <div className="file-heading"><FileText size={20} /><div><strong>{pdf.file}</strong><small>{pdf.stage} · {pdf.progress}% · {pdf.candidates.length} suggestions</small></div>
            <IconButton label={`Remove ${pdf.file}`} onClick={() => setPdfs((prev) => prev.filter((p) => p.id !== pdf.id))}><Trash2 size={17} /></IconButton></div>
          <progress max={100} value={pdf.progress} aria-label={`${pdf.file} progress`} />
          <ChoiceField label="Account" value={pdf.account} onValueChange={(value) => updatePdf(pdf.id, { account: value, candidates: pdf.candidates.map((c) => ({ ...c, account: value, accepted: false })) })} options={[...data.accounts, ...data.creditCards.map((card) => card.name)].map((account) => ({ value: account, label: account }))} />
          {pdf.error && <p className="negative">{pdf.error}</p>}
          {pdf.balanceIssue && <p className="inline-warning" role="status">{pdf.balanceIssue}</p>}
          {pdf.candidates.map((c) => <div className="pdf-candidate" key={c.id}>
            <div className="pdf-source"><strong>Page {c.page}</strong><span>{c.sourceLine}</span></div>
            <div className="pdf-fields">
              <label className="field">Date<input type="date" value={c.date} onChange={(e) => editCandidate(pdf.id, c.id, { date: e.target.value })} /></label>
              <label className="field">Description<input value={c.name} maxLength={100} onChange={(e) => editCandidate(pdf.id, c.id, { name: e.target.value })} /></label>
              <label className="field">Amount (Rp)<MoneyInput min={1} value={c.amount || ""} onValueChange={(value) => editCandidate(pdf.id, c.id, { amount: Number(value) })} /></label>
              <SegmentedChoice label="Direction" value={c.type} onValueChange={(value) => editCandidate(pdf.id, c.id, { type: value as "income" | "expense" })} options={[{ value: "expense", label: "Money out" }, { value: "income", label: "Money in" }]} />
            </div>
            {c.issues.length > 0 && <><p className="negative">{c.issues.join(" · ")}</p><label className="checkbox-label"><input type="checkbox" checked={!!c.manualConfirmed} onChange={(e) => editCandidate(pdf.id, c.id, { manualConfirmed: e.target.checked })} />I checked flagged fields against the PDF</label></>}
            <label className="checkbox-label"><input type="checkbox" checked={c.accepted} disabled={pdf.stage !== "Ready for review" || !candidateValid(c) || (c.issues.length > 0 && !c.manualConfirmed)} onChange={(e) => editCandidate(pdf.id, c.id, { accepted: e.target.checked })} />Accept for comparison</label>
          </div>)}
          {pdf.lines.length > 0 && <details className="pdf-source-list"><summary>Source lines and manual review ({pdf.lines.length})</summary>
            {pdf.lines.filter((line) => !pdf.candidates.some((c) => c.sourceId === line.id)).map((line) => <div key={line.id}><span>Page {line.page}: {line.text}</span><button className="text-button" onClick={() => {
              const c: PdfCandidate = { id: uid(), file: pdf.file, account: pdf.account, page: line.page, sourceId: line.id, sourceLine: line.text, date: "", name: "", amount: 0, type: "expense", issues: ["Check the date", "Check the description", "Check the amount"], accepted: false };
              updatePdf(pdf.id, { candidates: [...pdf.candidates, c] });
            }}>Add row</button></div>)}
          </details>}
        </div>)}
      </section>
      <div
        className="import-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void readFiles(e.dataTransfer.files);
        }}
      >
        <span className="upload-symbol">
          <Upload size={26} />
        </span>
        <h3>Bring your statements together</h3>
        <p>Bank and e-wallet CSV exports. Up to 10 files, 5 MB each.</p>
        <label className={`button primary ${reading ? "disabled" : ""}`}>
          <Plus size={17} />
          {reading ? "Reading files..." : "Choose CSV files"}
          <input
            type="file"
            accept=".csv,text/csv"
            multiple
            hidden
            disabled={reading}
            aria-label="Choose CSV files"
            onChange={(e) => {
              void readFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <button
          className="text-button"
          onClick={() =>
            void download(
              "saku-statement-example.csv",
              `date,description,debit,credit\r\n${month}-01,Monthly salary,,10000000\r\n${month}-02,Apartment rent,1500000,\r\n${month}-27,Bookshop,125000,\r\n`,
              "text/csv",
            ).catch(() => notify("Could not save example."))
          }
        >
          <Download size={14} />
          Example CSV
        </button>
      </div>
      <p className="import-note">
        CSV exports with date, description, and amount or debit/credit columns
        are supported. PDF imports are reviewed above in the Android app.
      </p>
      {errors.length > 0 && (
        <div className="import-errors" role="alert">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
          <button className="text-button" onClick={() => setErrors([])}>
            <X size={14} />
            Dismiss
          </button>
        </div>
      )}
      {files.length > 0 && (
        <>
          <div className="section-heading import-heading">
            <h2>
              Your statements <span>{files.length}</span>
            </h2>
            <button
              className="text-button"
              onClick={() => {
                setFiles([]);
                setReview(false);
                setSelection({});
              }}
            >
              Clear files <X size={15} />
            </button>
          </div>
          <div className="statement-files">
            {files.map((f) => (
              <div className="statement-file" key={f.id}>
                <div className="file-heading">
                  <FileSpreadsheet size={22} />
                  <div>
                    <strong>{f.file}</strong>
                    <small>{f.raw.length} rows</small>
                  </div>
                  <IconButton
                    label={`Remove ${f.file}`}
                    onClick={() => {
                      setFiles(files.filter((x) => x.id !== f.id));
                      setReview(false);
                      setSelection({});
                    }}
                  >
                    <Trash2 size={17} />
                  </IconButton>
                </div>
                <div className="mapping-grid">
                  <ChoiceField label="Account" value={f.account} onValueChange={(value) => update(f.id, { account: value })} options={[...data.accounts, ...data.creditCards.map((card) => card.name)].map((account) => ({ value: account, label: account }))} />
                  <SegmentedChoice label="Amount format" value={f.format} onValueChange={(value) => update(f.id, { format: value as "id" | "en" })} options={[{ value: "id", label: "1.000,00" }, { value: "en", label: "1,000.00" }]} />
                  <SegmentedChoice label="Date order" value={f.dateOrder} onValueChange={(value) => update(f.id, { dateOrder: value as "dmy" | "mdy" })} options={[{ value: "dmy", label: "Day / month / year" }, { value: "mdy", label: "Month / day / year" }]} />
                </div>
                <details
                  className="column-mapping"
                  open={
                    !f.mapping.date ||
                    !f.mapping.name ||
                    !(f.mapping.amount || f.mapping.debit || f.mapping.credit)
                  }
                >
                  <summary>Column mapping</summary>
                  <div className="mapping-grid">
                    {(
                      [
                        "date",
                        "name",
                        "amount",
                        "type",
                        "debit",
                        "credit",
                      ] as (keyof Mapping)[]
                    ).map((field) => (
                      <ChoiceField key={field} label={field === "name" ? "Description" : field.charAt(0).toUpperCase() + field.slice(1)} value={f.mapping[field]} onValueChange={(value) => update(f.id, { mapping: { ...f.mapping, [field]: value } })} options={[{ value: "", label: "Not used" }, ...f.headers.map((header) => ({ value: header, label: header }))]} />
                    ))}
                  </div>
                  <p>
                    Debit/credit columns take priority. Without a type column,
                    negative amounts are expenses and positive amounts are
                    income. ISO dates (YYYY-MM-DD) are also accepted.
                  </p>
                </details>
              </div>
            ))}
          </div>
          <div className="review-action">
            <button
              className="button primary"
              disabled={reading || busy}
              onClick={() => {
                setReview(true);
                setSelection({});
              }}
            >
              Compare transactions <ArrowRight size={17} />
            </button>
          </div>
        </>
      )}
      {(review || pdfs.some((p) => p.candidates.some((c) => c.accepted))) && (
        <section className="reconciliation">
          <div className="section-heading">
            <h2>Your monthly check</h2>
            <span className="subtle-badge">{monthLabel(month)}</span>
          </div>
          <div className="check-stats">
            <div>
              <CheckCheck size={21} />
              <strong>{matches.length}</strong>
              <span>Exact matches</span>
            </div>
            <div>
              <Plus size={21} />
              <strong>{missing.length}</strong>
              <span>Missing from tracker</span>
            </div>
            <div>
              <FileCheck2 size={21} />
              <strong>{uncertain.length + different.length}</strong>
              <span>Need a closer look</span>
            </div>
          </div>
          <p className="import-note">
            Matches require the same account, date, direction, and amount.
            Repeated payments are held for manual review.{" "}
            {rows.filter((r) => r.status === "outside").length} rows fall
            outside this month.
          </p>
          {matches.length > 0 && (
            <div className="match-confirm">
              <span>
                <Check size={17} />
                {
                  matches.filter(
                    (r) =>
                      data.transactions.find((t) => t.id === r.matchId)
                        ?.verified,
                  ).length
                }{" "}
                of {matches.length} matches confirmed
              </span>
              <button
                className="button secondary"
                disabled={
                  busy ||
                  matches.every(
                    (r) =>
                      data.transactions.find((t) => t.id === r.matchId)
                        ?.verified,
                  )
                }
                onClick={() => void confirmMatches()}
              >
                Confirm exact matches
              </button>
            </div>
          )}
          {reviewItems.length > 0 && <div className="review-deck-launch"><div><strong>{pendingReviewItems.length ? `${pendingReviewItems.length} decisions left` : "Review sorted"}</strong><span>Open one focused card at a time. Swipe right to accept, left to decline.</span></div><button className="button primary" onClick={() => setDeckOpen(true)}>{pendingReviewItems.length ? "Review cards" : "Review decisions"}<ArrowRight size={16} /></button></div>}
          {uncertain.length > 0 && <p className="inline-warning">{uncertain.length} ambiguous or incomplete rows remain in the source review and cannot be decided by swiping.</p>}
          {deckOpen && <Modal title="Sort monthly check" subtitle={`${reviewItems.length - pendingReviewItems.length} of ${reviewItems.length} decisions staged`} onClose={() => { setDeckOpen(false); setDragX(0); }}>
            {currentReview ? (() => {
              const row = currentReview.kind === "statement" ? currentReview.row : undefined;
              const transaction = currentReview.kind === "ledger" ? currentReview.transaction : undefined;
              const original = row?.matchId ? data.transactions.find((item) => item.id === row.matchId) : undefined;
              const source = row ? pdfs.flatMap((pdf) => pdf.candidates).find((candidate) => candidate.id === row.id) : undefined;
              const acceptLabel = currentReview.kind === "ledger" ? "Keep in Saku" : row?.status === "different" ? "Use statement" : "Add to Saku";
              const declineLabel = currentReview.kind === "ledger" ? "Delete from Saku" : row?.status === "different" ? "Keep Saku" : "Skip";
              return <div className="review-deck"><div className="review-deck-hints"><span><ArrowLeft size={14} />{declineLabel}</span><span>{acceptLabel}<ArrowRight size={14} /></span></div><div className="review-swipe-card" style={{ transform: `translateX(${dragX}px) rotate(${dragX / 28}deg)` }} {...deckSwipe}>
                <span className="subtle-badge">{currentReview.kind === "ledger" ? "Only in Saku" : row?.status === "different" ? "Details differ" : "Only on statement"}</span>
                <h3>{row?.name || transaction?.name || "Unnamed transaction"}</h3>
                <strong className={row?.type === "income" || transaction?.type === "income" ? "positive" : "negative"}>{row?.type === "income" || transaction?.type === "income" ? "+" : "−"}{money(row?.amount || transaction?.amount || 0)}</strong>
                <p>{row?.date || transaction?.date} · {row?.account || transaction?.account}</p>
                {source && <div className="review-source"><span>Statement page {source.page}</span><p>{source.sourceLine}</p></div>}
                {original && <div className="review-source comparison"><span>Currently in Saku</span><p>{original.date} · {original.name} · {money(original.amount)}</p></div>}
                {row?.status === "missing" && row.type === "expense" && !data.creditCards.some((card) => card.name === row.account) && <ChoiceField label="Pocket" value={selection[row.id] || ""} onValueChange={(value) => setSelection((current) => ({ ...current, [row.id]: value }))} options={[{ value: "", label: "Unassigned" }, ...data.pockets.filter((pocket) => pocket.createdMonth <= row.date.slice(0, 7)).map((pocket) => ({ value: pocket.id, label: pocket.name }))]} />}
              </div><div className="review-deck-actions"><button className="button secondary" onClick={() => decideCurrent(false)}><X size={17} />{declineLabel}</button><button className="button primary" onClick={() => decideCurrent(true)}><Check size={17} />{acceptLabel}</button></div></div>;
            })() : <div className="review-deck-done"><CheckCheck size={34} /><h3>All cards sorted</h3><p>Review the staged summary below before anything changes.</p><button className="button primary" onClick={() => setDeckOpen(false)}>Done</button></div>}
          </Modal>}
          {Object.keys(decisions).length > 0 && <div className="review-action"><span>{Object.keys(decisions).length} decisions staged</span><button className="button primary" disabled={busy} onClick={() => void applyDecisions()}><Check size={16} />Apply review decisions</button></div>}
        </section>
      )}
    </>
  );
}
