import { useState, type FormEvent } from "react";
import { CalendarDays, CreditCard as CreditCardIcon, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  cardBalance, cardDue, dueRules, installmentAmounts, money, shiftMonth, today, uid, validAmount,
  type CreditCard, type Data, type RecurringRule, type Transaction,
} from "./domain";
import { MoneyInput } from "./components";

type Props = {
  data: Data;
  month: string;
  busy: boolean;
  commit: (next: Data, message: string) => Promise<boolean>;
  notify: (message: string) => void;
  onNewPurchase: (cardId: string) => void;
};

export default function Plans({ data, month, busy, commit, notify, onNewPurchase }: Props) {
  const [tab, setTab] = useState<"cards" | "bills">("cards");
  const [cardDraft, setCardDraft] = useState<CreditCard | null>(null);
  const [cardName, setCardName] = useState("");
  const [limit, setLimit] = useState("");
  const [openingDebt, setOpeningDebt] = useState("0");
  const [dueDay, setDueDay] = useState("15");
  const [payCard, setPayCard] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payAccount, setPayAccount] = useState(data.accounts[0]);
  const [payDate, setPayDate] = useState(today());
  const [ruleDraft, setRuleDraft] = useState<RecurringRule | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleAmount, setRuleAmount] = useState("");
  const [ruleType, setRuleType] = useState<"income" | "expense">("expense");
  const [rulePocket, setRulePocket] = useState(data.pockets[0]?.id || "");
  const [ruleMethod, setRuleMethod] = useState(`bank:${data.accounts[0]}`);
  const [ruleInstallments, setRuleInstallments] = useState("1");
  const [ruleDay, setRuleDay] = useState(String(Number(today().slice(-2))));
  const [ruleMonth, setRuleMonth] = useState(month);
  const [deleteId, setDeleteId] = useState("");
  const pending = dueRules(data);

  function editCard(card?: CreditCard) {
    setCardDraft(card || { id: "", name: "", limit: 0, openingDebt: 0, dueDay: 15 });
    setCardName(card?.name || ""); setLimit(card ? String(card.limit) : "");
    setOpeningDebt(card ? String(card.openingDebt) : "0"); setDueDay(String(card?.dueDay || 15));
  }
  async function saveCard(e: FormEvent) {
    e.preventDefault();
    const next: CreditCard = { id: cardDraft?.id || uid(), name: cardName.trim(), limit: Number(limit), openingDebt: Number(openingDebt), dueDay: Number(dueDay) };
    if (!next.name || !validAmount(next.limit) || !Number.isSafeInteger(next.openingDebt) || next.openingDebt < 0 || next.dueDay < 1 || next.dueDay > 28) {
      notify("Check the card name, limit, opening debt, and due day."); return;
    }
    if (data.accounts.some((a) => a.toLowerCase() === next.name.toLowerCase()) || data.creditCards.some((c) => c.id !== next.id && c.name.toLowerCase() === next.name.toLowerCase())) {
      notify("Choose a card name that is not already used by an account or card."); return;
    }
    const previousName = data.creditCards.find((c) => c.id === next.id)?.name;
    if (await commit({ ...data,
      creditCards: cardDraft?.id ? data.creditCards.map((c) => c.id === next.id ? next : c) : [...data.creditCards, next],
      transactions: previousName && previousName !== next.name ? data.transactions.map((t) => t.cardId === next.id && t.kind === "card_purchase" ? { ...t, account: next.name } : t) : data.transactions,
      recurring: previousName && previousName !== next.name ? data.recurring.map((r) => r.cardId === next.id ? { ...r, account: next.name } : r) : data.recurring,
      favorites: previousName && previousName !== next.name ? data.favorites.map((f) => f.cardId === next.id ? { ...f, account: next.name } : f) : data.favorites,
    }, cardDraft?.id ? "Card updated" : "Card added")) setCardDraft(null);
  }
  async function deleteCard(card: CreditCard) {
    if (data.transactions.some((t) => t.cardId === card.id) || data.recurring.some((r) => r.cardId === card.id) || data.favorites.some((f) => f.cardId === card.id)) {
      notify("Remove card transactions, bills, and quick entries before deleting this card."); return;
    }
    if (await commit({ ...data, creditCards: data.creditCards.filter((c) => c.id !== card.id) }, "Card removed")) setDeleteId("");
  }
  async function makePayment(e: FormEvent) {
    e.preventDefault();
    const amount = Number(payAmount);
    const card = data.creditCards.find((c) => c.id === payCard);
    if (!card || !validAmount(amount) || amount > cardBalance(data, card.id) || !data.accounts.includes(payAccount) || payDate > today()) {
      notify("Check the card, amount, source account, and date."); return;
    }
    const transaction: Transaction = { id: uid(), name: `Payment to ${card.name}`, amount, type: "expense", kind: "card_payment", cardId: card.id, date: payDate, pocketId: "", account: payAccount, note: "" };
    if (await commit({ ...data, transactions: [...data.transactions, transaction] }, "Card payment recorded")) { setPayAmount(""); setPayCard(""); }
  }
  function editRule(rule?: RecurringRule) {
    setRuleDraft(rule || { id: "", name: "", amount: 0, type: "expense", pocketId: data.pockets[0]?.id || "", account: data.accounts[0], day: Number(today().slice(-2)), startMonth: month, active: true });
    setRuleName(rule?.name || ""); setRuleAmount(rule ? String(rule.amount) : "");
    setRuleType(rule?.type || "expense"); setRulePocket(rule?.pocketId || data.pockets[0]?.id || "");
    setRuleMethod(rule?.cardId ? `card:${rule.cardId}` : `bank:${rule?.account || data.accounts[0]}`);
    setRuleInstallments(String(rule?.installments || 1));
    setRuleDay(String(rule?.day || Number(today().slice(-2)))); setRuleMonth(rule?.startMonth || month);
  }
  async function saveRule(e: FormEvent) {
    e.preventDefault();
    const cardId = ruleMethod.startsWith("card:") && ruleType === "expense" ? ruleMethod.slice(5) : undefined;
    const card = data.creditCards.find((c) => c.id === cardId);
    const rule: RecurringRule = {
      id: ruleDraft?.id || uid(), name: ruleName.trim(), amount: Number(ruleAmount), type: ruleType,
      pocketId: ruleType === "income" ? "" : rulePocket,
      account: card ? card.name : ruleMethod.startsWith("bank:") ? ruleMethod.slice(5) : data.accounts[0],
      cardId, installments: cardId ? Number(ruleInstallments) : undefined, skippedMonths: ruleDraft?.skippedMonths,
      day: Number(ruleDay), startMonth: ruleMonth, active: ruleDraft?.active ?? true,
    };
    if (!rule.name || !validAmount(rule.amount) || rule.day < 1 || rule.day > 31 || (cardId && (!Number.isInteger(rule.installments) || rule.installments! < 1 || rule.installments! > 60)) || (rule.type === "expense" && !data.pockets.some((p) => p.id === rule.pocketId)) || !/^\d{4}-\d{2}$/.test(rule.startMonth)) {
      notify("Check the bill name, amount, pocket, day, and start month."); return;
    }
    if (await commit({ ...data, recurring: ruleDraft?.id ? data.recurring.map((r) => r.id === rule.id ? rule : r) : [...data.recurring, rule] }, ruleDraft?.id ? "Bill updated" : "Bill added")) setRuleDraft(null);
  }
  async function postRule(rule: RecurringRule, scheduledDate: string) {
    const date = scheduledDate > today() ? scheduledDate : today();
    if (rule.type === "expense" && !data.pockets.some((p) => p.id === rule.pocketId && p.createdMonth <= date.slice(0, 7))) {
      notify("This bill needs a pocket active for its transaction month."); return;
    }
    const transaction: Transaction = {
      id: uid(), name: rule.name, amount: rule.amount, type: rule.type, pocketId: rule.type === "income" ? "" : rule.pocketId,
      account: rule.account, date, note: "Recorded from recurring bill", recurringRuleId: rule.id,
      occurrenceMonth: scheduledDate.slice(0, 7),
      ...(rule.cardId ? { kind: "card_purchase" as const, cardId: rule.cardId, installments: rule.installments || 1, firstDueMonth: shiftMonth(date.slice(0, 7), 1) } : {}),
    };
    await commit({ ...data, transactions: [...data.transactions, transaction] }, rule.cardId ? "Card charge recorded" : "Bill recorded");
  }
  async function toggleRule(rule: RecurringRule) {
    await commit({ ...data, recurring: data.recurring.map((r) => r.id === rule.id ? { ...r, active: !r.active } : r) }, rule.active ? "Bill paused" : "Bill resumed");
  }
  async function skipRule(rule: RecurringRule, date: string) {
    await commit({ ...data, recurring: data.recurring.map((r) => r.id === rule.id ? { ...r, skippedMonths: [...(r.skippedMonths || []), date.slice(0, 7)] } : r) }, "This occurrence skipped");
  }
  async function deleteRule(rule: RecurringRule) {
    if (await commit({ ...data,
      recurring: data.recurring.filter((r) => r.id !== rule.id),
      transactions: data.transactions.map((t) => t.recurringRuleId === rule.id ? { ...t, recurringRuleId: undefined, occurrenceMonth: undefined } : t),
    }, "Recurring item removed")) { setRuleDraft(null); setDeleteId(""); }
  }

  return <div className="plans-view">
    <div className="segmented plans-tabs" role="tablist" aria-label="Cards and bills">
      <button role="tab" aria-selected={tab === "cards"} className={tab === "cards" ? "selected" : ""} onClick={() => setTab("cards")}><CreditCardIcon size={16} /> Credit cards</button>
      <button role="tab" aria-selected={tab === "bills"} className={tab === "bills" ? "selected" : ""} onClick={() => setTab("bills")}><RotateCcw size={16} /> Recurring</button>
    </div>
    {tab === "cards" ? <>
      <div className="section-heading plans-heading"><div><h2>Your cards</h2><p>Purchases count against pockets when made. Payments restore available credit.</p></div><button className="button secondary" onClick={() => editCard()}><Plus size={16} /> Add card</button></div>
      {!data.creditCards.length && <p className="plans-empty">Add a card to track purchases, installments, and payments.</p>}
      <div className="card-list">{data.creditCards.map((card) => {
        const debt = cardBalance(data, card.id);
        const purchases = data.transactions.filter((t) => t.cardId === card.id && t.kind === "card_purchase");
        const payments = data.transactions.filter((t) => t.cardId === card.id && t.kind === "card_payment");
        const existing = data.existingInstallments.filter((item) => item.cardId === card.id);
        return <section className="credit-card-item" key={card.id}>
          <div className="credit-card-top"><span className="credit-card-icon"><CreditCardIcon size={22} /></span><div><h3>{card.name}</h3><small>Payment day {card.dueDay} each month</small></div><button className="text-button" onClick={() => editCard(card)}>Edit</button></div>
          <div className="credit-card-values"><div><span>Outstanding now</span><strong>{money(debt)}</strong></div><div><span>Available credit now</span><strong>{money(Math.max(0, card.limit - debt))}</strong></div><div><span>Scheduled this month</span><strong>{money(cardDue(data, card.id, month))}</strong></div></div>
          <div className="credit-card-actions"><button className="button primary" onClick={() => onNewPurchase(card.id)}><Plus size={16} /> Purchase</button><button className="button secondary" onClick={() => { setPayCard(card.id); setPayAmount(""); }}>Record payment</button></div>
          {!!purchases.length && <details className="card-purchases"><summary>{purchases.length} purchases · installment details</summary>{purchases.slice().sort((a,b) => b.date.localeCompare(a.date)).map((t) => <div key={t.id}><span>{t.date} · {t.name}{t.recurringRuleId ? " · recurring" : ""}<small>{installmentAmounts(t.amount, t.installments || 1).map((a, i) => `${shiftMonth(t.firstDueMonth || shiftMonth(t.date.slice(0, 7), 1), i)} ${money(a)}`).join(" · ")}</small></span><strong>{money(t.amount)} · {t.installments === 1 ? "one payment" : `${t.installments} payments`}</strong></div>)}</details>}
          {!!payments.length && <details className="card-purchases"><summary>{payments.length} payments recorded</summary>{payments.slice().sort((a,b) => b.date.localeCompare(a.date)).map((t) => <div key={t.id}><span>{t.date} · {t.account}</span><strong>{money(t.amount)}</strong></div>)}</details>}
          {!!existing.length && <details className="card-purchases"><summary>{existing.length} installments already underway</summary>{existing.map((item) => <div key={item.id}><span>{item.name}<small>Next due {item.nextDueMonth} · {item.paymentsLeft} payments left</small></span><strong>{money(item.monthlyAmount)} / month</strong></div>)}</details>}
          {deleteId === card.id && <div className="inline-confirm"><span>Remove {card.name}?</span><button className="button danger" disabled={busy} onClick={() => void deleteCard(card)}>Remove</button><button className="text-button" onClick={() => setDeleteId("")}>Cancel</button></div>}
          {deleteId !== card.id && <button className="text-button muted-action" onClick={() => setDeleteId(card.id)}><Trash2 size={14} /> Remove card</button>}
        </section>;
      })}</div>
      {cardDraft && <form className="plans-form" onSubmit={(e) => void saveCard(e)}><h3>{cardDraft.id ? "Edit card" : "Add a credit card"}</h3><div className="plans-fields">
        <label className="field">Card name<input value={cardName} maxLength={50} required placeholder="e.g. CC BCA" onChange={(e) => setCardName(e.target.value)} /></label>
        <label className="field">Credit limit (Rp)<MoneyInput min={1} required value={limit} onValueChange={setLimit} /></label>
        <label className="field">Already owed (Rp)<MoneyInput min={0} required value={openingDebt} onValueChange={setOpeningDebt} /></label>
        <label className="field">Payment day<input type="number" min={1} max={28} required value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></label>
      </div><div className="plans-form-actions"><button className="button primary" disabled={busy}>Save card</button><button type="button" className="button secondary" onClick={() => setCardDraft(null)}>Cancel</button></div></form>}
      {payCard && <form className="plans-form" onSubmit={(e) => void makePayment(e)}><h3>Record card payment</h3><p>The card debt goes down. This does not count as new spending.</p><div className="plans-fields">
        <label className="field">Card<select value={payCard} onChange={(e) => setPayCard(e.target.value)}>{data.creditCards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field">Amount (Rp)<MoneyInput min={1} max={Math.max(0, cardBalance(data, payCard))} required value={payAmount} onValueChange={setPayAmount} /></label>
        <label className="field">Paid from<select value={payAccount} onChange={(e) => setPayAccount(e.target.value)}>{data.accounts.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="field">Date<input type="date" max={today()} required value={payDate} onChange={(e) => setPayDate(e.target.value)} /></label>
      </div><div className="plans-form-actions"><button className="button primary" disabled={busy}>Record payment</button><button type="button" className="button secondary" onClick={() => setPayCard("")}>Cancel</button></div></form>}
    </> : <>
      <div className="section-heading plans-heading"><div><h2>Recurring bills</h2><p>{money(data.recurring.filter((r) => r.active && r.type === "expense").reduce((n, r) => n + r.amount * 12, 0))} planned per year · Record each charge only when it happens.</p></div><button className="button secondary" onClick={() => editRule()}><Plus size={16} /> Add bill</button></div>
      {pending.length > 0 && <section className="due-list"><h3>Ready to record</h3>{pending.map(({ rule, date }) => <div key={`${rule.id}:${date}`} className="due-row"><CalendarDays size={17} /><div><strong>{rule.name}</strong><small>Due {date} · {rule.account}</small></div><strong>{money(rule.amount)}</strong><button className="button primary" disabled={busy} onClick={() => void postRule(rule, date)}>{rule.cardId ? "Mark charged" : rule.type === "income" ? "Record income" : "Mark paid"}</button><button className="text-button" disabled={busy} onClick={() => void skipRule(rule, date)}>Skip</button></div>)}</section>}
      {!data.recurring.length && <p className="plans-empty">Add rent, subscriptions, salary, or another monthly item.</p>}
      <div className="rule-list">{data.recurring.map((rule) => <div className="rule-row" key={rule.id}><span className="rule-symbol"><RotateCcw size={17} /></span><div><strong>{rule.name}</strong><small>Day {rule.day} · {rule.account} · {rule.active ? "Active" : "Paused"}</small></div><div className="rule-money"><strong>{money(rule.amount)}</strong><small>{money(rule.amount * 12)} per year</small></div><button className="text-button" onClick={() => editRule(rule)}>Edit</button><button className="text-button" disabled={busy} onClick={() => void toggleRule(rule)}>{rule.active ? "Pause" : "Resume"}</button><button className="text-button" aria-label={`Remove ${rule.name}`} title={`Remove ${rule.name}`} onClick={() => setDeleteId(rule.id)}><Trash2 size={15} /></button>{deleteId === rule.id && <div className="inline-confirm"><span>Stop repeating {rule.name}? Past transactions stay.</span><button className="button danger" disabled={busy} onClick={() => void deleteRule(rule)}>Remove</button><button className="text-button" onClick={() => setDeleteId("")}>Cancel</button></div>}</div>)}</div>
      {ruleDraft && <form className="plans-form" onSubmit={(e) => void saveRule(e)}><h3>{ruleDraft.id ? "Edit recurring item" : "Add recurring item"}</h3><div className="plans-fields">
        <label className="field">Name<input value={ruleName} required maxLength={100} onChange={(e) => setRuleName(e.target.value)} /></label>
        <label className="field">Amount (Rp)<MoneyInput min={1} value={ruleAmount} required onValueChange={setRuleAmount} /></label>
        <label className="field">Direction<select value={ruleType} onChange={(e) => { setRuleType(e.target.value as "income" | "expense"); if (e.target.value === "income") setRuleMethod(`bank:${data.accounts[0]}`); }}><option value="expense">Money out</option><option value="income">Money in</option></select></label>
        <label className="field">Paid with<select value={ruleMethod} onChange={(e) => setRuleMethod(e.target.value)}>{data.accounts.map((a) => <option key={a} value={`bank:${a}`}>{a}</option>)}{ruleType === "expense" && data.creditCards.map((c) => <option key={c.id} value={`card:${c.id}`}>{c.name}</option>)}</select></label>
        {ruleMethod.startsWith("card:") && ruleType === "expense" && <label className="field">Payments per charge<input type="number" min={1} max={60} step={1} value={ruleInstallments} onChange={(e) => setRuleInstallments(e.target.value)} /></label>}
        {ruleType === "expense" && <label className="field">Pocket<select value={rulePocket} required onChange={(e) => setRulePocket(e.target.value)}><option value="">Choose pocket</option>{data.pockets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <label className="field">Day each month<input type="number" min={1} max={31} value={ruleDay} required onChange={(e) => setRuleDay(e.target.value)} /></label>
        <label className="field">From month<input type="month" value={ruleMonth} required onChange={(e) => setRuleMonth(e.target.value)} /></label>
      </div><div className="plans-form-actions"><button className="button primary" disabled={busy}>Save recurring item</button><button type="button" className="button secondary" onClick={() => setRuleDraft(null)}>Cancel</button></div></form>}
    </>}
  </div>;
}
