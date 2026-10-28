import { t } from "./i18n";
import { useMemo, useState } from "react";
import { ArrowRight, Check, Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { bankRows, money, monthLabel, readCSV, reconcile, today, uid, type Data, type Mapping, type Statement, type Transaction } from "./domain";
import { download } from "./storage";
import { ChoiceField, Modal, SegmentedChoice } from "./components";
import { useRowGestures } from "./rowGestures";
import { RowStatus, type RowState } from "./RowStatus";

const columnLabels = { date: "columnDate", name: "columnName", amount: "columnAmount", type: "columnType", debit: "columnDebit", credit: "columnCredit" } as const;

export default function Statements({ data, month, commit, busy, notify, cloudImportEnabled }: {
  data: Data; month: string; commit: (data: Data, message: string) => Promise<boolean>; busy: boolean; notify: (message: string) => void; cloudImportEnabled: boolean;
}) {
  const [files, setFiles] = useState<Statement[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, "add" | "skip" | "update" | "keep">>({});
  const [editingRow, setEditingRow] = useState("");
  const [pockets, setPockets] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const rows = useMemo(() => reconcile(files.flatMap(bankRows), data.transactions, month), [files, data.transactions, month]);
  const matches = rows.filter((row) => row.status === "matched");
  const actionable = rows.filter((row) => row.status === "missing" || row.status === "different");
  // Swipe right takes the CSV row, left leaves it out; hold opens it, as in the other Catch up lists.
  const swipeTo = (id: string, take: boolean) => {
    const row = actionable.find((item) => item.id === id);
    if (!row) return;
    gestures.announce(t(take ? "rowWillAdd" : "rowSkipped", { name: row.name || t("unnamedTransaction") }));
    setDecisions((old) => ({ ...old, [id]: row.status === "different" ? (take ? "update" : "keep") : (take ? "add" : "skip") }));
  };
  const gestures = useRowGestures({ onAdd: (id) => swipeTo(id, true), onSkip: (id) => swipeTo(id, false), onOpen: setEditingRow });
  const uncertain = rows.filter((row) => row.status === "review" || row.status === "invalid" || row.status === "outside");
  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const next: Statement[] = [], problems: string[] = [];
    for (const file of Array.from(list)) {
      try {
        if (!/\.csv$/i.test(file.name) || file.size > 5_000_000) throw new Error(t("chooseACsvFileUnder"));
        if (files.length + next.length >= 10) throw new Error(t("checkUpToTenFiles"));
        next.push({ id: uid(), file: file.name, account: data.accounts[0] || "", format: "id", dateOrder: "dmy", ...readCSV(await file.text()) });
      } catch (error) { problems.push(`${file.name}: ${error instanceof Error ? error.message : t("couldNotReadFile")}`); }
    }
    setFiles((old) => [...old, ...next]); setErrors(problems); setReview(false); setDecisions({});
  }
  function changeFile(id: string, patch: Partial<Statement>) { setFiles((old) => old.map((file) => file.id === id ? { ...file, ...patch } : file)); setReview(false); setDecisions({}); }
  async function confirmMatches() {
    const ids = new Set(matches.map((row) => row.matchId));
    if (ids.size && await commit({ ...data, transactions: data.transactions.map((transaction) => ids.has(transaction.id) ? { ...transaction, verified: true } : transaction) }, t("csvTransactionsChecked", { count: ids.size }))) notify(t("csvMatchesConfirmed", { count: ids.size }));
  }
  async function apply() {
    const additions = actionable.filter((row) => row.status === "missing" && decisions[row.id] === "add");
    if (additions.some((row) => row.date > today())) { notify(t("futureDatedRowsCannotBe")); return; }
    if (additions.some((row) => pockets[row.id] && !data.pockets.some((pocket) => pocket.id === pockets[row.id] && pocket.createdMonth <= row.date.slice(0, 7)))) { notify(t("chooseAPocketThatExisted")); return; }
    const added: Transaction[] = additions.map((row) => ({ id: uid(), name: row.name, amount: row.amount, type: row.type, date: row.date, account: row.account, pocketId: row.type === "income" ? "" : pockets[row.id] || "", note: "Imported from CSV", verified: true }));
    const updates = new Map(actionable.filter((row) => row.status === "different" && decisions[row.id] === "update").map((row) => [row.matchId, row]));
    const transactions = data.transactions.map((transaction) => { const row = updates.get(transaction.id); return row ? { ...transaction, name: row.name, amount: row.amount, type: row.type, date: row.date, verified: true } : transaction; });
    if (!added.length && !updates.size) return;
    if (await commit({ ...data, transactions: [...transactions, ...added] }, t("csvAddedUpdated", { added: added.length, updated: updates.size }))) setDecisions({});
  }
  return <div className="csv-check">
    <div className="check-intro"><span className="check-intro-icon"><FileSpreadsheet size={26} /></span><div><h2>{t("importACsvOnThis")}</h2><p>{t("csvIntroBody", { month: monthLabel(month) })}</p></div></div>
    <div className="import-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}><span className="upload-symbol"><Upload size={24} /></span><h3>{t("addCsvExports")}</h3><p>{t("csvFileLimits")} {cloudImportEnabled ? t("screenshotsAndPdfsUseCatch") : t("screenshotAndPdfCatchUp")}</p><label className="button primary">{t("chooseCsvFiles")}<input type="file" accept=".csv,text/csv" multiple hidden onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /></label><button className="text-button" onClick={() => void download("saku-statement-example.csv", `date,description,debit,credit\r\n${month}-01,Monthly salary,,10000000\r\n${month}-02,Apartment rent,1500000,\r\n`, "text/csv").catch(() => notify(t("couldNotSaveExample")))}><Download size={14} /> {t("exampleCsv")}</button></div>
    {!!errors.length && <div className="import-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
    {files.map((file) => <section className="statement-file" key={file.id}><div className="file-heading"><FileSpreadsheet size={20} /><div><strong>{file.file}</strong><small>{t("rowCount", { count: file.raw.length })}</small></div><button className="text-button" aria-label={t("removeNamed", { name: file.file })} onClick={() => setFiles((old) => old.filter((item) => item.id !== file.id))}><X size={16} /></button></div><div className="mapping-grid"><ChoiceField label={t("account")} value={file.account} onValueChange={(value) => changeFile(file.id, { account: value })} options={data.accounts.map((account) => ({ value: account, label: account }))} /><SegmentedChoice label={t("amountFormat")} value={file.format} onValueChange={(value) => changeFile(file.id, { format: value as Statement["format"] })} options={[{ value: "id", label: "1.000,00" }, { value: "en", label: "1,000.00" }]} /><SegmentedChoice label={t("dateOrder")} value={file.dateOrder} onValueChange={(value) => changeFile(file.id, { dateOrder: value as Statement["dateOrder"] })} options={[{ value: "dmy", label: t("dayMonthYear") }, { value: "mdy", label: t("monthDayYear") }]} /></div><details><summary>{t("mapColumns")}</summary><div className="mapping-grid">{(["date", "name", "amount", "type", "debit", "credit"] as (keyof Mapping)[]).map((field) => <ChoiceField key={field} label={t(columnLabels[field])} value={file.mapping[field]} onValueChange={(value) => changeFile(file.id, { mapping: { ...file.mapping, [field]: value } })} options={[{ value: "", label: t("none") }, ...file.headers.map((header) => ({ value: header, label: header }))]} />)}</div></details></section>)}
    {!!files.length && <div className="review-action"><button className="button primary" onClick={() => setReview(true)}>{t("compareTransactions")} <ArrowRight size={16} /></button></div>}
    {review && <section className="reconciliation"><div className="section-heading"><h2>{t("yourMonthlyCheck")}</h2><span className="subtle-badge">{monthLabel(month)}</span></div><div className="check-stats"><div><Check size={18} /><strong>{matches.length}</strong><span>{t("exactMatches2")}</span></div><div><ArrowRight size={18} /><strong>{actionable.length}</strong><span>{t("review")}</span></div><div><FileSpreadsheet size={18} /><strong>{uncertain.length}</strong><span>{t("uncertainOrOutsideMonth")}</span></div></div><p className="import-note">{t("aCsvMayShowOnly")}</p>{!!matches.length && <button className="button secondary" disabled={busy} onClick={() => void confirmMatches()}>{t("confirmExactMatches", { count: matches.length })}</button>}{!!actionable.length && <p className="catchup-swipe-hint">{t("swipeHint")}</p>}<p className="sr-only" aria-live="polite">{gestures.announcement}</p>{actionable.map((row) => {
      const take = row.status === "different" ? "update" : "add", leave = row.status === "different" ? "keep" : "skip";
      const decide = (decision: typeof decisions[string] | "") => { setEditingRow(""); setDecisions((old) => { const next = { ...old }; if (decision) next[row.id] = decision; else delete next[row.id]; return next; }); };
      const decision = decisions[row.id], offset = gestures.offset(row.id);
      const state: RowState = decision === take ? "ready" : decision === leave ? "skip" : "later";
      return <div className="catchup-row" key={row.id} data-state={state} data-swipe={offset > 40 ? "add" : offset < -40 ? "skip" : undefined} data-add-label={t("swipeAdd")} data-skip-label={t("swipeSkip")}>
        <button type="button" className="catchup-row-summary" aria-haspopup="dialog" style={offset ? { transform: `translateX(${offset}px)` } : undefined} {...gestures.handlers(row.id, busy)}>
          <span className="catchup-row-identity"><span className="catchup-row-kicker"><time dateTime={row.date}>{row.date}</time><small className="catchup-row-account">{row.account}</small></span><strong>{row.name || t("unnamedTransaction")}</strong><small className="catchup-row-hint">{row.status === "different" ? t("detailsDiffer") : t("onlyInCsv")}</small></span>
          <span className="catchup-row-figure"><strong>{row.type === "income" ? "+" : "−"}{money(row.amount)}</strong><RowStatus state={state} label={decision === take ? (take === "update" ? t("useCsvDetails") : t("willAdd")) : decision === leave ? (leave === "keep" ? t("keepSakuDetails") : t("notImporting")) : t("decideLater")} /></span>
        </button>
        {editingRow === row.id && <Modal title={row.name || t("unnamedTransaction")} subtitle={`${row.date} · ${row.type === "income" ? "+" : "−"}${money(row.amount)}`} onClose={() => setEditingRow("")}><div className="catchup-row-details"><div className="catchup-row-meta">
          {row.status === "missing" && row.type === "expense" && <ChoiceField className="catchup-field" label={t("budgetPocket")} value={pockets[row.id] || ""} onValueChange={(value) => setPockets((old) => ({ ...old, [row.id]: value }))} options={[{ value: "", label: t("unassigned") }, ...data.pockets.filter((pocket) => pocket.createdMonth <= row.date.slice(0, 7)).map((pocket) => ({ value: pocket.id, label: pocket.name }))]} />}
          <div className="catchup-decision"><div role="group" aria-label={t("decisionFor", { name: row.name || t("transactionLower") })}>
            <button type="button" className={decision === take ? "selected" : ""} aria-pressed={decision === take} onClick={() => decide(take)}>{take === "update" ? t("useCsvDetails") : t("addToSaku")}</button>
            <button type="button" className={!decision ? "selected" : ""} aria-pressed={!decision} onClick={() => decide("")}>{t("decideLater")}</button>
            <button type="button" className={decision === leave ? "selected" : ""} aria-pressed={decision === leave} onClick={() => decide(leave)}>{leave === "keep" ? t("keepSakuDetails") : t("doNotImport")}</button>
          </div></div>
        </div></div></Modal>}
      </div>;
    })}{!!Object.values(decisions).filter((decision) => decision === "add" || decision === "update").length && <div className="review-action"><button className="button primary" disabled={busy} onClick={() => void apply()}>{t("applySelectedChanges")}</button></div>}</section>}
  </div>;
}
