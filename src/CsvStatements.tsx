import { t } from "./i18n";
import { useMemo, useState } from "react";
import { ArrowRight, Check, Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { bankRows, money, monthLabel, readCSV, reconcile, today, uid, type Data, type Mapping, type Statement, type Transaction } from "./domain";
import { download } from "./storage";
import { ChoiceField, SegmentedChoice } from "./components";

const columnLabels = { date: "columnDate", name: "columnName", amount: "columnAmount", type: "columnType", debit: "columnDebit", credit: "columnCredit" } as const;

export default function Statements({ data, month, commit, busy, notify, cloudImportEnabled }: {
  data: Data; month: string; commit: (data: Data, message: string) => Promise<boolean>; busy: boolean; notify: (message: string) => void; cloudImportEnabled: boolean;
}) {
  const [files, setFiles] = useState<Statement[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, "add" | "skip" | "update" | "keep">>({});
  const [pockets, setPockets] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const rows = useMemo(() => reconcile(files.flatMap(bankRows), data.transactions, month), [files, data.transactions, month]);
  const matches = rows.filter((row) => row.status === "matched");
  const actionable = rows.filter((row) => row.status === "missing" || row.status === "different");
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
    {review && <section className="reconciliation"><div className="section-heading"><h2>{t("yourMonthlyCheck")}</h2><span className="subtle-badge">{monthLabel(month)}</span></div><div className="check-stats"><div><Check size={18} /><strong>{matches.length}</strong><span>{t("exactMatches2")}</span></div><div><ArrowRight size={18} /><strong>{actionable.length}</strong><span>{t("review")}</span></div><div><FileSpreadsheet size={18} /><strong>{uncertain.length}</strong><span>{t("uncertainOrOutsideMonth")}</span></div></div><p className="import-note">{t("aCsvMayShowOnly")}</p>{!!matches.length && <button className="button secondary" disabled={busy} onClick={() => void confirmMatches()}>{t("confirmExactMatches", { count: matches.length })}</button>}{actionable.map((row) => <div className="review-row" key={row.id}><div><strong>{row.name || t("unnamedTransaction")}</strong><small>{row.date} · {row.account} · {row.status === "different" ? t("detailsDiffer") : t("onlyInCsv")}</small></div><strong>{row.type === "income" ? "+" : "−"}{money(row.amount)}</strong><ChoiceField label={t("decisionFor", { name: row.name || t("transactionLower") })} value={decisions[row.id] || ""} onValueChange={(value) => setDecisions((old) => ({ ...old, [row.id]: value as typeof decisions[string] }))} options={[{ value: "", label: t("decideLater"), description: t("keepThisRowUnchangedFor") }, { value: row.status === "different" ? "update" : "add", label: row.status === "different" ? t("useCsvDetails") : t("addToSaku") }, { value: row.status === "different" ? "keep" : "skip", label: row.status === "different" ? t("keepSakuDetails") : t("doNotImport") }]} />{row.status === "missing" && row.type === "expense" && <ChoiceField label={t("pocketFor", { name: row.name || t("transactionLower") })} value={pockets[row.id] || ""} onValueChange={(value) => setPockets((old) => ({ ...old, [row.id]: value }))} options={[{ value: "", label: t("unassigned") }, ...data.pockets.filter((pocket) => pocket.createdMonth <= row.date.slice(0, 7)).map((pocket) => ({ value: pocket.id, label: pocket.name }))]} />}</div>)}{!!Object.values(decisions).filter((decision) => decision === "add" || decision === "update").length && <div className="review-action"><button className="button primary" disabled={busy} onClick={() => void apply()}>{t("applySelectedChanges")}</button></div>}</section>}
  </div>;
}
