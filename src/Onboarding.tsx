import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, CreditCard, LockKeyhole, Plus, Sparkles, Wallet, X } from "lucide-react";
import { applyPocketPlan, COLORS, compact, emptyData, groupDigits, money, shiftMonth, today, uid, validAmount, type Data } from "./domain";
import { iconFor, planTotal } from "./allocation";
import AllocationEditor from "./AllocationEditor";
import { MoneyInput, PocketIcon, SakuMark, SegmentedChoice } from "./components";
import { usePlanSuggestion } from "./usePlanSuggestion";
import { CountUp, reducedMotion } from "./motion";
import { t } from "./i18n";

// First run, as a page: you & accounts → income → pockets & split → anything else → your plan. One decision per
// step, good defaults everywhere, and every step after the first can be skipped. Nothing is saved until the end.
const STEPS = 4;
const suggestedPockets = () => [t("defaultFood"), t("pocketRent"), t("pocketTransport"), t("pocketSavings"), t("defaultFun"), t("pocketBills"), t("pocketParents"), t("pocketInstalment")];
const quickIncomes = [3_000_000, 5_000_000, 8_000_000, 12_000_000];

export default function Onboarding({ busy, suggestedName, userId, onClose, onStart }: {
  busy: boolean;
  suggestedName?: string;
  userId?: string;
  onClose: () => void;
  onStart: (data: Data) => Promise<void>;
}) {
  const month = today().slice(0, 7);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [error, setError] = useState("");
  const [name, setName] = useState(suggestedName?.trim().slice(0, 40) || "");
  const [accounts, setAccounts] = useState([{ name: "BCA", balance: "" }, { name: "Jago", balance: "" }]);
  const [income, setIncome] = useState("");
  const [incomeKind, setIncomeKind] = useState<"fixed" | "variable">("fixed");
  const [payday, setPayday] = useState("25");
  const [repeatIncome, setRepeatIncome] = useState(true);
  const [pocketNames, setPocketNames] = useState<string[]>(() => [t("defaultFood"), t("pocketRent"), t("pocketTransport"), t("pocketSavings"), t("defaultFun")]);
  const [plainBudgets, setPlainBudgets] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState("");
  const [hasCard, setHasCard] = useState(false), [cardName, setCardName] = useState(""), [cardLimit, setCardLimit] = useState(""), [cardDebt, setCardDebt] = useState("0"), [dueDay, setDueDay] = useState("15");
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const incomeValue = Number(income || 0);
  const chosenAccounts = accounts.map((item) => ({ ...item, name: item.name.trim() })).filter((item) => item.name);
  // Keys follow the name (so a pocket set by hand keeps its amount while others are toggled) and stay unique even
  // when two names differ only in punctuation.
  const planPockets = pocketNames.reduce<{ key: string; name: string; icon: string }[]>((list, value) => {
    const base = value.toLocaleLowerCase("id-ID").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 56) || "pocket";
    let key = base;
    for (let n = 2; list.some((item) => item.key === key); n++) key = `${base}-${n}`;
    return [...list, { key, name: value, icon: iconFor(value) }];
  }, []);
  const plan = usePlanSuggestion({ income: incomeValue, kind: incomeKind, pockets: planPockets, data: emptyData(), month, userId });
  const asked = useRef(false);
  // The AI refines once, when the split first shows; "Ask Saku again" repeats it on request.
  useEffect(() => { if (step === 2 && incomeValue >= 100_000 && plan.rows.length && !asked.current) { asked.current = true; void plan.refine(); } }, [step, plan.rows.length, incomeValue]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); root.current?.scrollTo?.({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" }); }, [step]);
  // Android back steps back through setup instead of closing it.
  useEffect(() => {
    const node = root.current;
    const back = () => step > 0 ? go(step - 1) : onClose();
    node?.addEventListener("saku-back", back);
    return () => node?.removeEventListener("saku-back", back);
  });
  function go(next: number) {
    if (next > step && step === 0) {
      if (!name.trim() || !chosenAccounts.length || new Set(chosenAccounts.map((item) => item.name.toLowerCase())).size !== chosenAccounts.length) { setError(t("setupError")); return; }
    }
    if (next > step && step === 2 && new Set(pocketNames.map((value) => value.toLocaleLowerCase("id-ID"))).size !== pocketNames.length) { setError(t("pocketNamesUnique")); return; }
    setError(""); setDirection(next > step ? "forward" : "back"); setStep(next);
  }
  function togglePocket(value: string) {
    setPocketNames((current) => current.some((item) => item.toLocaleLowerCase("id-ID") === value.toLocaleLowerCase("id-ID")) ? current.filter((item) => item.toLocaleLowerCase("id-ID") !== value.toLocaleLowerCase("id-ID")) : [...current, value].slice(0, 20));
  }
  function addCustom(event?: FormEvent) {
    event?.preventDefault();
    const value = custom.trim().slice(0, 40);
    if (!value) return;
    if (!pocketNames.some((item) => item.toLocaleLowerCase("id-ID") === value.toLocaleLowerCase("id-ID"))) setPocketNames([...pocketNames, value].slice(0, 20));
    setCustom("");
  }
  async function finish() {
    if (busy) return;
    let next = emptyData();
    next.name = name.trim();
    next.accounts = chosenAccounts.map((item) => item.name);
    next.transactions = chosenAccounts.filter((item) => Number(item.balance) > 0).map((item) => ({ id: uid(), name: t("openingBalance"), amount: Number(item.balance), type: "income" as const, kind: "opening_balance" as const, date: today(), pocketId: "", account: item.name, note: "Opening balance when starting Saku" }));
    if (hasCard && cardName.trim() && validAmount(Number(cardLimit))) next.creditCards = [{ id: uid(), name: cardName.trim(), limit: Number(cardLimit), openingDebt: Number(cardDebt || 0), dueDay: Math.min(28, Math.max(1, Number(dueDay) || 15)) }];
    if (incomeValue > 0 && plan.rows.length) {
      // Setup is the first plan, not a change to undo: no snapshot is kept.
      next = { ...applyPocketPlan(next, { income: incomeValue, kind: incomeKind, items: plan.rows.map((row) => ({ name: row.name, icon: row.icon, amount: row.amount })) }, month), pocketPlans: [] };
    } else {
      next.pockets = pocketNames.map((value, index) => ({ id: uid(), name: value, budget: Number(plainBudgets[value] || 0), budgets: {}, createdMonth: month, icon: iconFor(value), color: COLORS[index % COLORS.length] }));
      if (incomeValue > 0) { next.monthlyIncome = incomeValue; next.incomeKind = incomeKind; }
    }
    if (incomeValue > 0 && repeatIncome && next.accounts.length) {
      const day = Math.min(31, Math.max(1, Number(payday) || 25));
      next.recurring = [{ id: uid(), name: t("salaryName"), amount: incomeValue, type: "income", pocketId: "", account: next.accounts[0], day, startMonth: day >= Number(today().slice(8)) ? month : shiftMonth(month, 1), active: true }];
    }
    await onStart(next);
  }
  const titles = [[t("onboardYouTitle"), t("onboardYouHelp")], [t("onboardIncomeTitle"), t("onboardIncomeHelp")], [t("onboardPocketsTitle"), incomeValue ? t("onboardSplitHelp") : t("onboardPocketsHelp")], [t("onboardElseTitle"), t("onboardElseHelp")], [t("onboardDoneTitle", { name: name.trim() || t("friend") }), t("onboardDoneHelp")]];
  const allocated = plan.rows.length && incomeValue ? planTotal(plan.rows) : pocketNames.reduce((sum, value) => sum + Number(plainBudgets[value] || 0), 0);
  return <main className="onboarding" ref={root} data-back-step aria-labelledby="onboarding-title">
    <div className="onboarding-shell">
      <header className="onboarding-top">
        <span className="onboarding-brand"><SakuMark size={26} /> Saku</span>
        <ol className="onboarding-progress" aria-label={t("setupStep", { step: Math.min(step + 1, STEPS), total: STEPS })}>{Array.from({ length: STEPS }, (_, index) => <li key={index} className={index < step ? "is-done" : index === step ? "is-current" : undefined} />)}</ol>
        <button type="button" className="icon-button" aria-label={t("closeSetup")} onClick={onClose}><X size={18} /></button>
      </header>
      <section className="onboarding-hero" key={`hero-${step}`} data-direction={direction}>
        <p className="onboarding-eyebrow">{step < STEPS ? t("stepOf", { step: step + 1, total: STEPS }) : t("readyEyebrow")}</p>
        <h1 id="onboarding-title" ref={heading} tabIndex={-1}>{titles[step][0]}</h1>
        <p>{titles[step][1]}</p>
      </section>
      <div className="onboarding-step" key={`step-${step}`} data-direction={direction}>
        {step === 0 && <>
          <label className="field">{t("yourName")}<input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} placeholder={suggestedName?.trim() || t("namePrompt")} /></label>
          <div className="setup-account-heading"><div><h3>{t("moneyLives")}</h3><p>{t("balanceHelp")}</p></div></div>
          <div className="setup-account-list">{accounts.map((item, index) => <section className="setup-account-card onboarding-pop" key={index} aria-label={item.name ? t("namedAccount", { name: item.name }) : t("accountNumber", { number: index + 1 })}>
            <span className="setup-account-icon" aria-hidden="true"><Wallet size={18} /></span>
            <label className="field setup-account-name">{t("accountName")}<input value={item.name} maxLength={50} onChange={(event) => setAccounts(accounts.map((x, i) => i === index ? { ...x, name: event.target.value } : x))} /></label>
            <label className="field setup-opening-balance">{t("openingBalance")}<div className="amount-input"><span>Rp</span><MoneyInput aria-label={`${item.name || t("account")} ${t("openingBalance")}`} placeholder={index === 0 ? groupDigits(2450000) : index === 1 ? groupDigits(875000) : "0"} value={item.balance} onValueChange={(balance) => setAccounts(accounts.map((x, i) => i === index ? { ...x, balance } : x))} /></div></label>
            {accounts.length > 1 && <button type="button" className="icon-button onboarding-remove" aria-label={t("removeAccountNamed", { name: item.name || t("account") })} onClick={() => setAccounts(accounts.filter((_, i) => i !== index))}><X size={15} /></button>}
          </section>)}</div>
          <button type="button" className="button secondary" onClick={() => setAccounts([...accounts, { name: "", balance: "" }])}><Plus size={16} />{t("addAccount")}</button>
        </>}
        {step === 1 && <>
          <label className="onboarding-income"><span className="sr-only">{t("monthlyIncome")}</span><span aria-hidden="true">Rp</span><MoneyInput autoFocus aria-label={t("monthlyIncome")} placeholder={groupDigits(8_000_000)} value={income} onValueChange={setIncome} /></label>
          <div className="onboarding-chips" role="group" aria-label={t("aboutIncome")}>{quickIncomes.map((value) => <button type="button" key={value} className={incomeValue === value ? "is-selected" : undefined} aria-pressed={incomeValue === value} onClick={() => setIncome(String(value))}>{t("aboutAmount", { amount: compact(value) })}</button>)}</div>
          <SegmentedChoice label={t("incomeKind")} value={incomeKind} onValueChange={(value) => setIncomeKind(value as "fixed" | "variable")} options={[{ value: "fixed", label: t("incomeFixed") }, { value: "variable", label: t("incomeVariable") }]} />
          <p className="field-help">{incomeKind === "variable" ? t("incomeVariableHelp") : t("incomeFixedHelp")}</p>
          {incomeValue > 0 && <div className="onboarding-card onboarding-pop">
            <label className="checkbox-label"><input type="checkbox" checked={repeatIncome} onChange={(event) => setRepeatIncome(event.target.checked)} />{t("addAsMonthlyIncome")}</label>
            {repeatIncome && <label className="field">{t("payday")}<input type="number" min={1} max={31} value={payday} onChange={(event) => setPayday(event.target.value)} /><small>{t("paydayHelp", { account: chosenAccounts[0]?.name || t("account") })}</small></label>}
          </div>}
          <p className="privacy-copy"><LockKeyhole size={16} />{t("incomePrivate")}</p>
        </>}
        {step === 2 && <>
          <div className="onboarding-chips is-pockets" role="group" aria-label={t("pocketIdeas")}>{[...new Set([...suggestedPockets(), ...pocketNames])].map((value) => { const on = pocketNames.some((item) => item.toLocaleLowerCase("id-ID") === value.toLocaleLowerCase("id-ID")); return <button type="button" key={value} className={on ? "is-selected" : undefined} aria-pressed={on} onClick={() => togglePocket(value)}>{on ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}{value}</button>; })}</div>
          <form className="onboarding-custom" onSubmit={addCustom}><input value={custom} maxLength={40} placeholder={t("customPocket")} aria-label={t("customPocket")} onChange={(event) => setCustom(event.target.value)} /><button className="button secondary" type="submit" disabled={!custom.trim()}><Plus size={16} />{t("addPocket")}</button></form>
          {incomeValue > 0 && plan.rows.length > 0 && <>
            <AllocationEditor income={incomeValue} rows={plan.rows} data={emptyData()} state={plan.state} onChange={plan.setRows} onSpread={plan.spread} />
            {userId && <button type="button" className="text-button onboarding-ask" disabled={plan.state === "thinking"} onClick={() => void plan.refine()}><Sparkles size={14} aria-hidden="true" />{t("askSakuAgain")}</button>}
          </>}
          {!incomeValue && pocketNames.length > 0 && <div className="onboarding-plain">{pocketNames.map((value, index) => <div className="setup-row onboarding-pop" key={value}><PocketIcon name={iconFor(value)} color={COLORS[index % COLORS.length]} size={16} /><span>{value}</span><div className="amount-input"><span>Rp</span><MoneyInput aria-label={`${value} ${t("monthlyBudget")}`} placeholder={t("monthlyBudget")} value={plainBudgets[value] || ""} onValueChange={(budget) => setPlainBudgets({ ...plainBudgets, [value]: budget })} /></div></div>)}<p className="field-help">{t("noIncomeSplitHelp")}</p></div>}
        </>}
        {step === 3 && <>
          <label className="checkbox-label editor-option"><input type="checkbox" checked={hasCard} onChange={(event) => setHasCard(event.target.checked)} />{t("useCard")}</label>
          {hasCard && <div className="setup-section onboarding-pop"><label className="field">{t("cardName")}<input value={cardName} onChange={(event) => setCardName(event.target.value)} placeholder="mis. BCA Visa" /></label><label className="field">{t("creditLimit")}<div className="amount-input"><span>Rp</span><MoneyInput value={cardLimit} onValueChange={setCardLimit} /></div></label><label className="field">{t("currentlyOwed")}<div className="amount-input"><span>Rp</span><MoneyInput value={cardDebt} onValueChange={setCardDebt} /></div></label><label className="field">{t("paymentDay")}<input type="number" min={1} max={28} value={dueDay} onChange={(event) => setDueDay(event.target.value)} /></label></div>}
          <p className="field-help">{t("laterInSettings")}</p>
        </>}
        {step === 4 && <div className="onboarding-summary">
          <div className="onboarding-summary-hero"><span>{incomeValue ? t("monthlyIncome") : t("monthlyPockets")}</span><strong><CountUp value={incomeValue || allocated} format={money} fromZero /></strong>{incomeValue > 0 && <small>{t("allocatedOf", { amount: money(allocated) })}</small>}</div>
          {incomeValue > 0 && plan.rows.length > 0 && <div className="allocation-bar is-summary" aria-hidden="true">{plan.rows.map((row, index) => <i key={row.key} style={{ width: `${Math.min(100, row.amount / Math.max(incomeValue, allocated) * 100)}%`, background: COLORS[index % COLORS.length] }} />)}</div>}
          <ul className="onboarding-summary-list">
            <li><Wallet size={16} aria-hidden="true" /><span>{t("summaryAccounts", { count: chosenAccounts.length })}</span><b>{chosenAccounts.map((item) => item.name).join(", ")}</b></li>
            <li><Sparkles size={16} aria-hidden="true" /><span>{t("summaryPockets", { count: pocketNames.length })}</span><b>{pocketNames.slice(0, 4).join(", ")}{pocketNames.length > 4 ? "…" : ""}</b></li>
            {incomeValue > 0 && repeatIncome && <li><Check size={16} aria-hidden="true" /><span>{t("summaryPayday", { day: payday })}</span><b>{money(incomeValue)}</b></li>}
            {hasCard && cardName.trim() && <li><CreditCard size={16} aria-hidden="true" /><span>{t("cards")}</span><b>{cardName}</b></li>}
          </ul>
          <p className="field-help">{t("planEditableLater")}</p>
        </div>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <footer className="onboarding-footer">
        {step > 0 ? <button type="button" className="button secondary" onClick={() => go(step - 1)}><ArrowLeft size={17} />{t("back")}</button> : <span />}
        <div>
          {step > 0 && step < 4 && <button type="button" className="text-button" onClick={() => { if (step === 1) setIncome(""); if (step === 3) setHasCard(false); go(step + 1); }}>{t("skipForNow")}</button>}
          {step < 4 ? <button type="button" className="button primary" onClick={() => go(step + 1)}>{t("continue")}<ArrowRight size={17} /></button>
            : <button type="button" className="button primary" disabled={busy} onClick={() => void finish()}>{busy ? t("creating") : t("startTracker")}<ArrowRight size={17} /></button>}
        </div>
      </footer>
    </div>
  </main>;
}
