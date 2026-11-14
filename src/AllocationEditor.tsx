import type { CSSProperties } from "react";
import { Sparkles, Wand2, X } from "lucide-react";
import { amountFromPercent, percentOf, planTotal, unpocketedCommitments, type PlanRow } from "./allocation";
import { COLORS, money, type Data } from "./domain";
import { MoneyInput, PocketIcon } from "./components";
import { CountUp } from "./motion";
import { t } from "./i18n";

export type SuggestionState = "rules" | "thinking" | "ai" | "basic";

// One editor for setup and for the pocket planner. Editing a pocket never moves the others: the bar at the bottom
// says how much is left (or over), and "Spread the rest" fills only the pockets the person hasn't set.
export default function AllocationEditor({ income, rows, data, state, previous, onChange, onSpread, onRemove, disabled = false }: {
  income: number;
  rows: PlanRow[];
  data: Data;
  state: SuggestionState;
  // Planner only: each existing pocket's current amount, to show what changes.
  previous?: Record<string, number>;
  onChange: (rows: PlanRow[]) => void;
  onSpread: () => void;
  onRemove?: (key: string) => void;
  disabled?: boolean;
}) {
  const committed = unpocketedCommitments(data);
  const available = Math.max(0, income - committed);
  const total = planTotal(rows);
  const left = available - total;
  const colorOf = (row: PlanRow, index: number) => (row.pocketId && data.pockets.find((pocket) => pocket.id === row.pocketId)?.color) || COLORS[index % COLORS.length];
  const set = (key: string, amount: number) => onChange(rows.map((row) => row.key === key ? { ...row, amount: Math.max(0, Math.min(1e12, Math.round(amount))), userSet: true, reason: { kind: "user" } } : row));
  const reasonText = (row: PlanRow) => {
    if (row.reason.kind === "ai" && row.reason.text) return row.reason.text;
    if (row.reason.kind === "spend") return t("reasonSpend", { amount: money(row.reason.amount || 0) });
    if (row.reason.kind === "fixed") return t("reasonFixed", { amount: money(row.reason.amount || 0) });
    if (row.reason.kind === "savings") return t("reasonSavings");
    if (row.reason.kind === "user") return t("reasonUser");
    return t(`group_${row.group}` as "group_needs");
  };
  return <div className="allocation-editor">
    <div className="allocation-head">
      <div><strong><CountUp value={total} format={money} /></strong><span>{t("ofIncome", { income: money(available) })}</span></div>
      <span className={`allocation-state is-${state}`} role="status">{state === "thinking" ? <><span className="allocation-pulse" aria-hidden="true" />{t("sakuThinking")}</> : state === "ai" ? <><Sparkles size={13} aria-hidden="true" />{t("sakuSuggestion")}</> : state === "basic" ? t("basicSuggestion") : t("rulesSuggestion")}</span>
    </div>
    <div className="allocation-bar" role="img" aria-label={t("allocationBarLabel", { allocated: money(total), income: money(available) })}>
      {rows.map((row, index) => <i key={row.key} style={{ width: `${available ? Math.min(100, row.amount / Math.max(available, total) * 100) : 0}%`, background: colorOf(row, index) }} />)}
    </div>
    {committed > 0 && <p className="allocation-note">{t("committedFirst", { amount: money(committed) })}</p>}
    <div className="allocation-rows">
      {rows.map((row, index) => {
        const percent = percentOf(row.amount, income);
        const before = row.pocketId ? previous?.[row.pocketId] : undefined;
        return <section className="allocation-row" key={row.key} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }} aria-label={row.name}>
          <div className="allocation-row-head">
            <PocketIcon name={row.icon} color={colorOf(row, index)} size={17} />
            <div className="allocation-row-name"><strong>{row.name}</strong><small>{reasonText(row)}</small></div>
            {previous && !row.pocketId && <em className="allocation-badge">{t("newBadge")}</em>}
            {row.userSet && <em className="allocation-badge is-user">{t("setByYou")}</em>}
            {onRemove && !row.pocketId && <button type="button" className="icon-button" aria-label={t("removePocketFromPlan", { name: row.name })} disabled={disabled} onClick={() => onRemove(row.key)}><X size={15} /></button>}
          </div>
          <div className="allocation-row-inputs">
            <div className="amount-input"><span>Rp</span><MoneyInput aria-label={t("amountFor", { name: row.name })} value={row.amount || ""} disabled={disabled} onValueChange={(value) => set(row.key, Number(value || 0))} /></div>
            <label className="allocation-percent"><input type="number" inputMode="decimal" min={0} max={100} step={1} aria-label={t("percentFor", { name: row.name })} value={income ? Math.round(percent) : 0} disabled={disabled || !income} onChange={(event) => set(row.key, amountFromPercent(Math.min(100, Math.max(0, Number(event.target.value) || 0)), income))} /><span>%</span></label>
          </div>
          <input className="allocation-slider" type="range" min={0} max={100} step={1} value={Math.min(100, Math.round(percent))} disabled={disabled || !income} aria-label={t("percentFor", { name: row.name })} style={{ "--fill": `${Math.min(100, percent)}%`, "--slider": colorOf(row, index) } as CSSProperties} onChange={(event) => set(row.key, amountFromPercent(Number(event.target.value), income))} />
          {before !== undefined && before !== row.amount && <small className="allocation-diff">{t("wasAmount", { amount: money(before) })} → {money(row.amount)}</small>}
        </section>;
      })}
    </div>
    <div className={`allocation-left${left < 0 ? " is-over" : left === 0 ? " is-done" : ""}`} role="status">
      <span>{left < 0 ? t("overIncome", { amount: money(-left) }) : left === 0 ? t("allAllocated") : t("notAllocated", { amount: money(left) })}</span>
      {left > 0 && rows.some((row) => !row.userSet) && <button type="button" className="text-button" disabled={disabled} onClick={onSpread}><Wand2 size={14} aria-hidden="true" /> {t("spreadRest")}</button>}
    </div>
  </div>;
}
