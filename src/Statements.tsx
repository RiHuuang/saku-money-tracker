import { useMemo, useState } from "react";
import { ArrowRight, Check, Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { bankRows, money, monthLabel, readCSV, reconcile, today, uid, type Data, type Mapping, type Statement, type Transaction } from "./domain";
import { download } from "./storage";

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
        if (!/\.csv$/i.test(file.name) || file.size > 5_000_000) throw new Error("Choose a CSV file under 5 MB");
        if (files.length + next.length >= 10) throw new Error("Check up to ten files at a time");
        next.push({ id: uid(), file: file.name, account: data.accounts[0] || "", format: "id", dateOrder: "dmy", ...readCSV(await file.text()) });
      } catch (error) { problems.push(`${file.name}: ${error instanceof Error ? error.message : "Could not read file"}`); }
    }
    setFiles((old) => [...old, ...next]); setErrors(problems); setReview(false); setDecisions({});
  }
  function changeFile(id: string, patch: Partial<Statement>) { setFiles((old) => old.map((file) => file.id === id ? { ...file, ...patch } : file)); setReview(false); setDecisions({}); }
  async function confirmMatches() {
    const ids = new Set(matches.map((row) => row.matchId));
    if (ids.size && await commit({ ...data, transactions: data.transactions.map((transaction) => ids.has(transaction.id) ? { ...transaction, verified: true } : transaction) }, `${ids.size} transactions checked`)) notify(`${ids.size} exact matches confirmed`);
  }
  async function apply() {
    const additions = actionable.filter((row) => row.status === "missing" && decisions[row.id] === "add");
    if (additions.some((row) => row.date > today())) { notify("Future-dated rows cannot be added yet."); return; }
    if (additions.some((row) => pockets[row.id] && !data.pockets.some((pocket) => pocket.id === pockets[row.id] && pocket.createdMonth <= row.date.slice(0, 7)))) { notify("Choose a pocket that existed during this month."); return; }
    const added: Transaction[] = additions.map((row) => ({ id: uid(), name: row.name, amount: row.amount, type: row.type, date: row.date, account: row.account, pocketId: row.type === "income" ? "" : pockets[row.id] || "", note: "Imported from CSV", verified: true }));
    const updates = new Map(actionable.filter((row) => row.status === "different" && decisions[row.id] === "update").map((row) => [row.matchId, row]));
    const transactions = data.transactions.map((transaction) => { const row = updates.get(transaction.id); return row ? { ...transaction, name: row.name, amount: row.amount, type: row.type, date: row.date, verified: true } : transaction; });
    if (!added.length && !updates.size) return;
    if (await commit({ ...data, transactions: [...transactions, ...added] }, `${added.length} added · ${updates.size} updated`)) setDecisions({});
  }
  return <div className="csv-check">
    <div className="check-intro"><span className="check-intro-icon"><FileSpreadsheet size={26} /></span><div><h2>Import a CSV on this device.</h2><p>Review {monthLabel(month)} transactions and add missing entries today. CSV files stay on this device.</p></div></div>
    <div className="import-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(event.dataTransfer.files); }}><span className="upload-symbol"><Upload size={24} /></span><h3>Add CSV exports</h3><p>Up to ten files, 5 MB each. {cloudImportEnabled ? "Screenshots and PDFs use Catch up or Statement check." : "Screenshot and PDF catch-up is still being tested."}</p><label className="button primary">Choose CSV files<input type="file" accept=".csv,text/csv" multiple hidden onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} /></label><button className="text-button" onClick={() => void download("saku-statement-example.csv", `date,description,debit,credit\r\n${month}-01,Monthly salary,,10000000\r\n${month}-02,Apartment rent,1500000,\r\n`, "text/csv").catch(() => notify("Could not save example."))}><Download size={14} /> Example CSV</button></div>
    {!!errors.length && <div className="import-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
    {files.map((file) => <section className="statement-file" key={file.id}><div className="file-heading"><FileSpreadsheet size={20} /><div><strong>{file.file}</strong><small>{file.raw.length} rows</small></div><button className="text-button" aria-label={`Remove ${file.file}`} onClick={() => setFiles((old) => old.filter((item) => item.id !== file.id))}><X size={16} /></button></div><div className="mapping-grid"><label className="field">Account<select value={file.account} onChange={(event) => changeFile(file.id, { account: event.target.value })}>{data.accounts.map((account) => <option key={account}>{account}</option>)}</select></label><label className="field">Amount format<select value={file.format} onChange={(event) => changeFile(file.id, { format: event.target.value as Statement["format"] })}><option value="id">1.000,00</option><option value="en">1,000.00</option></select></label><label className="field">Date order<select value={file.dateOrder} onChange={(event) => changeFile(file.id, { dateOrder: event.target.value as Statement["dateOrder"] })}><option value="dmy">Day / month / year</option><option value="mdy">Month / day / year</option></select></label></div><details><summary>Map columns</summary><div className="mapping-grid">{(["date", "name", "amount", "type", "debit", "credit"] as (keyof Mapping)[]).map((field) => <label className="field" key={field}>{field}<select value={file.mapping[field]} onChange={(event) => changeFile(file.id, { mapping: { ...file.mapping, [field]: event.target.value } })}><option value="">None</option>{file.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div></details></section>)}
    {!!files.length && <div className="review-action"><button className="button primary" onClick={() => setReview(true)}>Compare transactions <ArrowRight size={16} /></button></div>}
    {review && <section className="reconciliation"><div className="section-heading"><h2>Your monthly check</h2><span className="subtle-badge">{monthLabel(month)}</span></div><div className="check-stats"><div><Check size={18} /><strong>{matches.length}</strong><span>Exact matches</span></div><div><ArrowRight size={18} /><strong>{actionable.length}</strong><span>Review</span></div><div><FileSpreadsheet size={18} /><strong>{uncertain.length}</strong><span>Uncertain or outside month</span></div></div><p className="import-note">A CSV may show only part of an account. Ledger entries absent from this export are never proposed for deletion.</p>{!!matches.length && <button className="button secondary" disabled={busy} onClick={() => void confirmMatches()}>Confirm {matches.length} exact matches</button>}{actionable.map((row) => <div className="review-row" key={row.id}><div><strong>{row.name || "Unnamed transaction"}</strong><small>{row.date} · {row.account} · {row.status === "different" ? "Details differ" : "Only in CSV"}</small></div><strong>{row.type === "income" ? "+" : "−"}{money(row.amount)}</strong><select aria-label={`Decision for ${row.name}`} value={decisions[row.id] || ""} onChange={(event) => setDecisions((old) => ({ ...old, [row.id]: event.target.value as typeof decisions[string] }))}><option value="">Decide later</option><option value={row.status === "different" ? "update" : "add"}>{row.status === "different" ? "Use CSV details" : "Add to Saku"}</option><option value={row.status === "different" ? "keep" : "skip"}>{row.status === "different" ? "Keep Saku details" : "Skip"}</option></select>{row.status === "missing" && row.type === "expense" && <select aria-label={`Pocket for ${row.name}`} value={pockets[row.id] || ""} onChange={(event) => setPockets((old) => ({ ...old, [row.id]: event.target.value }))}><option value="">Unassigned</option>{data.pockets.filter((pocket) => pocket.createdMonth <= row.date.slice(0, 7)).map((pocket) => <option key={pocket.id} value={pocket.id}>{pocket.name}</option>)}</select>}</div>)}{!!Object.values(decisions).filter((decision) => decision === "add" || decision === "update").length && <div className="review-action"><button className="button primary" disabled={busy} onClick={() => void apply()}>Apply selected changes</button></div>}</section>}
  </div>;
}
