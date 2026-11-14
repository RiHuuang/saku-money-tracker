import { useMemo, useState, type FormEvent } from "react";
import { History, Plus, RotateCcw, Sparkles } from "lucide-react";
import { budgetFor, dayLabel, money, type Data, type PocketPlan } from "./domain";
import { iconFor } from "./allocation";
import AllocationEditor from "./AllocationEditor";
import { Modal, MoneyInput, SegmentedChoice } from "./components";
import { usePlanSuggestion, type PlanPocket } from "./usePlanSuggestion";
import { t } from "./i18n";

// For people who already have pockets: Saku suggests amounts from their income and real spending, shows what would
// change, and writes nothing until Apply. Apply can be undone from the toast, and the last three plans can be
// rolled back here.
const newKey = (name: string) => `new-${name.toLocaleLowerCase("id-ID").replace(/[^\p{L}\p{N}]+/gu, "-")}`.slice(0, 64);

export default function PocketPlanner({ data, month, userId, busy, onApply, onRollback, onClose }: {
  data: Data;
  month: string;
  userId?: string;
  busy: boolean;
  onApply: (plan: PocketPlan) => Promise<boolean>;
  onRollback: (planId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [income, setIncome] = useState(data.monthlyIncome ? String(data.monthlyIncome) : "");
  const [kind, setKind] = useState<"fixed" | "variable">(data.incomeKind || "fixed");
  const [added, setAdded] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [confirmRollback, setConfirmRollback] = useState("");
  const [asked, setAsked] = useState(false);
  const existing = data.pockets.filter((pocket) => pocket.createdMonth <= month);
  const pockets = useMemo<PlanPocket[]>(() => [
    ...existing.map((pocket) => ({ key: pocket.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64), pocketId: pocket.id, name: pocket.name, icon: pocket.icon })),
    ...added.map((name) => ({ key: newKey(name), name, icon: iconFor(name) })),
  ], [data.pockets, added, month]);
  const incomeValue = Number(income || 0);
  const plan = usePlanSuggestion({ income: incomeValue, kind, pockets, data, month, userId });
  const previous = Object.fromEntries(existing.map((pocket) => [pocket.id, budgetFor(pocket, month)]));
  const changes = plan.rows.filter((row) => !row.pocketId || previous[row.pocketId] !== row.amount).length;
  const ideas = [t("pocketSavings"), t("pocketParents"), t("pocketInstalment"), t("pocketTransport")].filter((name) => !pockets.some((pocket) => pocket.name.toLocaleLowerCase("id-ID") === name.toLocaleLowerCase("id-ID")));
  function add(name: string, event?: FormEvent) {
    event?.preventDefault();
    const value = name.trim().slice(0, 40);
    if (value && !pockets.some((pocket) => pocket.name.toLocaleLowerCase("id-ID") === value.toLocaleLowerCase("id-ID"))) setAdded([...added, value].slice(0, 10));
    setCustom("");
  }
  async function apply() {
    if (busy || !incomeValue || !plan.rows.length) return;
    if (await onApply({ income: incomeValue, kind, items: plan.rows.map((row) => ({ pocketId: row.pocketId, name: row.name, icon: row.icon, amount: row.amount })) })) onClose();
  }
  return <Modal title={t("planWithSaku")} subtitle={t("planWithSakuHelp")} onClose={onClose}>
    <div className="planner">
      <label className="field">{t("monthlyIncome")}<div className="amount-input"><span>Rp</span><MoneyInput value={income} placeholder="8.000.000" onValueChange={setIncome} /></div><small>{kind === "variable" ? t("incomeVariableHelp") : t("incomeFixedHelp")}</small></label>
      <SegmentedChoice compact label={t("incomeKind")} value={kind} onValueChange={(value) => setKind(value as "fixed" | "variable")} options={[{ value: "fixed", label: t("incomeFixed") }, { value: "variable", label: t("incomeVariable") }]} />
      <div className="onboarding-chips is-pockets" role="group" aria-label={t("pocketIdeas")}>{ideas.map((name) => <button type="button" key={name} onClick={() => add(name)}><Plus size={14} aria-hidden="true" />{name}</button>)}</div>
      <form className="onboarding-custom" onSubmit={(event) => add(custom, event)}><input value={custom} maxLength={40} placeholder={t("customPocket")} aria-label={t("customPocket")} onChange={(event) => setCustom(event.target.value)} /><button className="button secondary" type="submit" disabled={!custom.trim()}><Plus size={16} />{t("addPocket")}</button></form>
      {incomeValue > 0 && plan.rows.length > 0 ? <>
        <AllocationEditor income={incomeValue} rows={plan.rows} data={data} state={plan.state} previous={previous} disabled={busy} onChange={plan.setRows} onSpread={plan.spread} onRemove={(key) => setAdded(added.filter((name) => newKey(name) !== key))} />
        {userId && <button type="button" className="text-button onboarding-ask" disabled={plan.state === "thinking"} onClick={() => { setAsked(true); void plan.refine(); }}><Sparkles size={14} aria-hidden="true" />{asked ? t("askSakuAgain") : t("askSakuRefine")}</button>}
      </> : <p className="field-help">{t("plannerNeedsIncome")}</p>}
      {!!data.pocketPlans?.length && <section className="planner-history" aria-label={t("earlierPlans")}>
        <h3><History size={15} aria-hidden="true" /> {t("earlierPlans")}</h3>
        {data.pocketPlans.map((item) => <div className="planner-history-row" key={item.id}>
          <span><strong>{t("planApplied", { date: dayLabel(item.appliedAt.slice(0, 10)) })}</strong><small>{item.createdPocketIds.length ? t("planCreated", { count: item.createdPocketIds.length }) : t("planAmountsOnly")}</small></span>
          {confirmRollback === item.id
            ? <button type="button" className="button danger" disabled={busy} onClick={() => void onRollback(item.id).then(onClose)}><RotateCcw size={14} aria-hidden="true" />{t("rollbackConfirm")}</button>
            : <button type="button" className="text-button" disabled={busy} onClick={() => setConfirmRollback(item.id)}>{t("rollbackTo")}</button>}
        </div>)}
        {confirmRollback && <p className="field-help">{t("rollbackHelp")}</p>}
      </section>}
      <div className="form-footer planner-footer">
        <button type="button" className="button secondary" onClick={onClose}>{t("keepMyPockets")}</button>
        <button type="button" className="button primary" disabled={busy || !incomeValue || !plan.rows.length || plan.state === "thinking"} onClick={() => void apply()}>{changes && incomeValue ? t("applyChanges", { count: changes }) : t("applyPlan")}</button>
      </div>
    </div>
  </Modal>;
}
