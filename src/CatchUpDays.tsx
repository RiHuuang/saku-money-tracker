import { Check, Plus } from "lucide-react";
import { dayLabel, frequentExpenses, money, type Data, type Favorite, type Transaction } from "./domain";
import { Modal } from "./components";

type Props = {
  data: Data;
  days: string[];
  index: number;
  busy: boolean;
  onIndex: (index: number) => void;
  onAdd: (day: string, favorite?: Favorite) => void;
  onEdit: (transaction: Transaction) => void;
  onNothingSpent: (day: string) => Promise<boolean>;
  onClose: () => void;
};

export default function CatchUpDays({ data, days, index, busy, onIndex, onAdd, onEdit, onNothingSpent, onClose }: Props) {
  const day = days[index], last = index === days.length - 1;
  const chips = [...data.favorites.filter((f) => f.type === "expense"), ...frequentExpenses(data, days[days.length - 1])];
  const entries = data.transactions.filter((t) => t.date === day && t.kind !== "opening_balance");
  const checked = data.checkedDays.includes(day);
  const next = () => last ? onClose() : onIndex(index + 1);
  return <Modal title={`${dayLabel(day)} (${index + 1} of ${days.length})`} subtitle="Add what you spent this day, or mark it as nothing spent." onClose={onClose}>
    <div className="catch-up-day">
      <div className="quick-entry-list">
        {chips.map((f) => <div className="quick-entry" key={f.id}><button type="button" disabled={busy} onClick={() => onAdd(day, f)}><Plus size={16} /><span>{f.name}</span><strong>{money(f.amount)}</strong></button></div>)}
        <div className="quick-entry"><button type="button" disabled={busy} onClick={() => onAdd(day)}><Plus size={16} /><span>Something else</span></button></div>
      </div>
      {entries.length ? <ul className="catch-up-day-list" aria-label={`Entries on ${dayLabel(day)}`}>{entries.map((t) => <li key={t.id}><button type="button" onClick={() => onEdit(t)}><span>{t.name}</span><strong>{t.type === "income" ? "+" : "−"}{money(t.amount)}</strong></button></li>)}</ul>
        : <p className="catch-up-day-empty">{checked ? <><Check size={15} /> Marked as nothing spent.</> : "Nothing recorded for this day yet."}</p>}
    </div>
    <div className="form-footer">
      {!last && <button type="button" className="button text-button" onClick={onClose}>Done</button>}
      <button type="button" className="button secondary" disabled={busy || checked || entries.length > 0} onClick={() => void onNothingSpent(day).then((saved) => { if (saved) next(); })}>Nothing spent this day</button>
      <button type="button" className="button primary" onClick={next}>{last ? "Done" : "Next day"}</button>
    </div>
  </Modal>;
}
