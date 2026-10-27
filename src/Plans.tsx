import { localeTag, t as translate } from "./i18n";
import { useState, type FormEvent } from "react";
import { CalendarDays, CreditCard as CreditCardIcon, HandCoins, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  accountBalance, cardBalance, cardDue, dueRules, installmentAmounts, money, shiftMonth, today, uid, validAmount, validDate,
  type CreditCard, type Data, type RecurringRule, type Transaction,
} from "./domain";
import { ChoiceField, Modal, MoneyInput, SegmentedChoice } from "./components";
import { owedByPerson } from "./owed";

type Props = {
  data: Data;
  month: string;
  busy: boolean;
  commit: (next: Data, message: string) => Promise<boolean>;
  notify: (message: string) => void;
  onNewPurchase: (cardId: string) => void;
  onOpenOwed: (source: Transaction, person: string) => void;
};

export default function Plans({ data, month, busy, commit, notify, onNewPurchase, onOpenOwed }: Props) {
  const [tab, setTab] = useState<"cards" | "bills" | "owed">("cards");
  const [loanOpen, setLoanOpen] = useState(false);
  const [loanDirection, setLoanDirection] = useState<"loan_given" | "loan_received">("loan_given");
  const [loanPerson, setLoanPerson] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [loanAccount, setLoanAccount] = useState(data.accounts[0]);
  const [loanDate, setLoanDate] = useState(today());
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
  const paymentCard = data.creditCards.find((card) => card.id === payCard);
  const paymentBalance = paymentCard ? cardBalance(data, paymentCard.id) : 0;
  const paymentAmount = Number(payAmount);
  const paymentCreditAfter = validAmount(paymentAmount) ? Math.max(0, paymentAmount - paymentBalance) : 0;
  const owed = owedByPerson(data);

  async function saveLoan(e: FormEvent) {
    e.preventDefault();
    if (!loanPerson.trim() || loanPerson.trim().length > 80 || !validAmount(Number(loanAmount)) || !data.accounts.includes(loanAccount) || !validDate(loanDate) || loanDate > today()) {
      notify(translate("checkLoanDetails")); return;
    }
    const row: Transaction = { id: uid(), name: loanDirection === "loan_given" ? translate("loanToName", { name: loanPerson.trim() }) : translate("loanFromName", { name: loanPerson.trim() }), amount: Number(loanAmount), type: loanDirection === "loan_given" ? "expense" : "income", kind: loanDirection, person: loanPerson.trim(), date: loanDate, pocketId: "", account: loanAccount, note: "" };
    if (await commit({ ...data, transactions: [...data.transactions, row] }, translate("loanRecorded"))) { setLoanOpen(false); setLoanAmount(""); setLoanPerson(""); }
  }

  function openPayment(cardId: string) {
    setPayCard(cardId);
    setPayAmount("");
    setPayAccount(data.accounts.includes(payAccount) ? payAccount : data.accounts[0]);
    setPayDate(today());
  }

  function editCard(card?: CreditCard) {
    setCardDraft(card || { id: "", name: "", limit: 0, openingDebt: 0, dueDay: 15 });
    setCardName(card?.name || ""); setLimit(card ? String(card.limit) : "");
    setOpeningDebt(card ? String(card.openingDebt) : "0"); setDueDay(String(card?.dueDay || 15));
  }
  async function saveCard(e: FormEvent) {
    e.preventDefault();
    const next: CreditCard = { id: cardDraft?.id || uid(), name: cardName.trim(), limit: Number(limit), openingDebt: Number(openingDebt), dueDay: Number(dueDay) };
    if (!next.name || !validAmount(next.limit) || !Number.isSafeInteger(next.openingDebt) || next.openingDebt < 0 || next.dueDay < 1 || next.dueDay > 28) {
      notify(translate("checkTheCardNameLimit")); return;
    }
    if (data.accounts.some((a) => a.toLowerCase() === next.name.toLowerCase()) || data.creditCards.some((c) => c.id !== next.id && c.name.toLowerCase() === next.name.toLowerCase())) {
      notify(translate("chooseACardNameThat")); return;
    }
    const previousName = data.creditCards.find((c) => c.id === next.id)?.name;
    if (await commit({ ...data,
      creditCards: cardDraft?.id ? data.creditCards.map((c) => c.id === next.id ? next : c) : [...data.creditCards, next],
      transactions: previousName && previousName !== next.name ? data.transactions.map((t) => t.cardId === next.id && t.kind === "card_purchase" ? { ...t, account: next.name } : t) : data.transactions,
      recurring: previousName && previousName !== next.name ? data.recurring.map((r) => r.cardId === next.id ? { ...r, account: next.name } : r) : data.recurring,
      favorites: previousName && previousName !== next.name ? data.favorites.map((f) => f.cardId === next.id ? { ...f, account: next.name } : f) : data.favorites,
    }, cardDraft?.id ? translate("cardUpdated") : translate("cardAdded"))) setCardDraft(null);
  }
  async function deleteCard(card: CreditCard) {
    if (data.transactions.some((t) => t.cardId === card.id) || data.recurring.some((r) => r.cardId === card.id) || data.favorites.some((f) => f.cardId === card.id)) {
      notify(translate("removeCardTransactionsBillsAnd")); return;
    }
    if (await commit({ ...data, creditCards: data.creditCards.filter((c) => c.id !== card.id) }, translate("cardRemoved"))) setDeleteId("");
  }
  async function makePayment(e: FormEvent) {
    e.preventDefault();
    const amount = Number(payAmount);
    const card = data.creditCards.find((c) => c.id === payCard);
    if (!card) { notify(translate("chooseACardToPay")); return; }
    if (!validAmount(amount)) { notify(translate("enterAPaymentAmountIn")); return; }
    if (!data.accounts.includes(payAccount)) { notify(translate("chooseASourceAccountFor")); return; }
    if (!validDate(payDate) || payDate > today()) { notify(translate("chooseAValidPaymentDate")); return; }
    const transaction: Transaction = { id: uid(), name: `Payment to ${card.name}`, amount, type: "expense", kind: "card_payment", cardId: card.id, date: payDate, pocketId: "", account: payAccount, note: "" };
    if (await commit({ ...data, transactions: [...data.transactions, transaction] }, translate("cardPaymentRecorded"))) { setPayAmount(""); setPayCard(""); }
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
      notify(translate("checkTheBillNameAmount")); return;
    }
    if (await commit({ ...data, recurring: ruleDraft?.id ? data.recurring.map((r) => r.id === rule.id ? rule : r) : [...data.recurring, rule] }, ruleDraft?.id ? translate("billUpdated") : translate("billAdded"))) setRuleDraft(null);
  }
  async function postRule(rule: RecurringRule, scheduledDate: string) {
    const date = scheduledDate > today() ? scheduledDate : today();
    if (rule.type === "expense" && !data.pockets.some((p) => p.id === rule.pocketId && p.createdMonth <= date.slice(0, 7))) {
      notify(translate("thisBillNeedsAPocket")); return;
    }
    const transaction: Transaction = {
      id: uid(), name: rule.name, amount: rule.amount, type: rule.type, pocketId: rule.type === "income" ? "" : rule.pocketId,
      account: rule.account, date, note: translate("recordedFromRecurringBill"), recurringRuleId: rule.id,
      occurrenceMonth: scheduledDate.slice(0, 7),
      ...(rule.cardId ? { kind: "card_purchase" as const, cardId: rule.cardId, installments: rule.installments || 1, firstDueMonth: shiftMonth(date.slice(0, 7), 1) } : {}),
    };
    await commit({ ...data, transactions: [...data.transactions, transaction] }, rule.cardId ? translate("cardChargeRecorded") : translate("billRecorded"));
  }
  async function toggleRule(rule: RecurringRule) {
    await commit({ ...data, recurring: data.recurring.map((r) => r.id === rule.id ? { ...r, active: !r.active } : r) }, rule.active ? translate("billPaused") : translate("billResumed"));
  }
  async function skipRule(rule: RecurringRule, date: string) {
    await commit({ ...data, recurring: data.recurring.map((r) => r.id === rule.id ? { ...r, skippedMonths: [...(r.skippedMonths || []), date.slice(0, 7)] } : r) }, translate("thisOccurrenceSkipped"));
  }
  async function deleteRule(rule: RecurringRule) {
    if (await commit({ ...data,
      recurring: data.recurring.filter((r) => r.id !== rule.id),
      transactions: data.transactions.map((t) => t.recurringRuleId === rule.id ? { ...t, recurringRuleId: undefined, occurrenceMonth: undefined } : t),
    }, translate("recurringItemRemoved"))) { setRuleDraft(null); setDeleteId(""); }
  }

  return <div className="plans-view">
    <div className="segmented plans-tabs" role="tablist" aria-label={translate("plansTabs")}>
      <button role="tab" aria-selected={tab === "cards"} className={tab === "cards" ? "selected" : ""} onClick={() => setTab("cards")}><CreditCardIcon size={16} /> {translate("creditCards")}</button>
      <button role="tab" aria-selected={tab === "bills"} className={tab === "bills" ? "selected" : ""} onClick={() => setTab("bills")}><RotateCcw size={16} /> {translate("recurring")}</button>
      <button role="tab" aria-selected={tab === "owed"} className={tab === "owed" ? "selected" : ""} onClick={() => setTab("owed")}><HandCoins size={16} /> {translate("owed")}</button>
    </div>
    {tab === "cards" ? <>
      <div className="section-heading plans-heading"><div><h2>{translate("yourCards")}</h2><p>{translate("purchasesCountAgainstPocketsWhen")}</p></div><button className="button secondary" onClick={() => editCard()}><Plus size={16} /> {translate("addCard")}</button></div>
      {!data.creditCards.length && <p className="plans-empty">{translate("addACardToTrack")}</p>}
      <div className="card-list">{data.creditCards.map((card) => {
        const debt = cardBalance(data, card.id);
        const purchases = data.transactions.filter((t) => t.cardId === card.id && t.kind === "card_purchase");
        const payments = data.transactions.filter((t) => t.cardId === card.id && t.kind === "card_payment");
        const existing = data.existingInstallments.filter((item) => item.cardId === card.id);
        return <section className="credit-card-item" key={card.id}>
          <div className="credit-card-top"><span className="credit-card-icon"><CreditCardIcon size={22} /></span><div><h3>{card.name}</h3><small>{translate("paymentDayEachMonth", { day: card.dueDay })}</small></div><button className="text-button" onClick={() => editCard(card)}>{translate("edit")}</button></div>
          <div className="credit-card-values"><div><span>{translate("outstandingNow")}</span><strong>{money(Math.max(0, debt))}</strong></div><div><span>{translate("availableCreditNow")}</span><strong>{money(Math.max(0, card.limit - debt))}</strong></div><div><span>{translate("scheduledThisMonth")}</span><strong>{money(cardDue(data, card.id, month))}</strong></div>{debt < 0 && <div><span>{translate("creditFromExtraPayments")}</span><strong>{money(-debt)}</strong></div>}</div>
          <div className="credit-card-actions"><button className="button primary" onClick={() => onNewPurchase(card.id)}><Plus size={16} /> {translate("purchase")}</button><button className="button secondary" onClick={() => openPayment(card.id)}>{translate("recordPayment")}</button></div>
          {!!purchases.length && <details className="card-purchases"><summary>{translate("purchasesInstallmentDetails", { count: purchases.length })}</summary>{purchases.slice().sort((a,b) => b.date.localeCompare(a.date)).map((t) => <div key={t.id}><span>{t.date} · {t.name}{t.recurringRuleId ? ` · ${translate("recurringLower")}` : ""}<small>{installmentAmounts(t.amount, t.installments || 1).map((a, i) => `${shiftMonth(t.firstDueMonth || shiftMonth(t.date.slice(0, 7), 1), i)} ${money(a)}`).join(" · ")}</small></span><strong>{money(t.amount)} · {t.installments === 1 ? translate("onePayment") : translate("paymentsCount", { count: t.installments ?? 1 })}</strong></div>)}</details>}
          {!!payments.length && <details className="card-purchases"><summary>{payments.length} payments recorded</summary>{payments.slice().sort((a,b) => b.date.localeCompare(a.date)).map((t) => <div key={t.id}><span>{t.date} · {t.account}</span><strong>{money(t.amount)}</strong></div>)}</details>}
          {!!existing.length && <details className="card-purchases"><summary>{translate("installmentsUnderway", { count: existing.length })}</summary>{existing.map((item) => <div key={item.id}><span>{item.name}<small>{translate("nextDuePaymentsLeft", { month: item.nextDueMonth, count: item.paymentsLeft })}</small></span><strong>{translate("perMonthAmount", { amount: money(item.monthlyAmount) })}</strong></div>)}</details>}
          {deleteId === card.id && <div className="inline-confirm"><span>{translate("remove")} {card.name}?</span><button className="button danger" disabled={busy} onClick={() => void deleteCard(card)}>{translate("remove")}</button><button className="text-button" onClick={() => setDeleteId("")}>{translate("cancel")}</button></div>}
          {deleteId !== card.id && <button className="text-button muted-action" onClick={() => setDeleteId(card.id)}><Trash2 size={14} /> {translate("removeCard")}</button>}
        </section>;
      })}</div>
      {cardDraft && <Modal title={cardDraft.id ? translate("editCard") : translate("addACreditCard")} subtitle={translate("keepTheCardNameLimit")} onClose={() => setCardDraft(null)}><form className="plans-form" onSubmit={(e) => void saveCard(e)}><div className="plans-fields">
        <label className="field">{translate("cardName")}<input value={cardName} maxLength={50} required placeholder="e.g. CC BCA" onChange={(e) => setCardName(e.target.value)} /></label>
        <label className="field">{translate("creditLimitRp")}<MoneyInput min={1} required value={limit} onValueChange={setLimit} /></label>
        <label className="field">{translate("alreadyOwedRp")}<MoneyInput min={0} required value={openingDebt} onValueChange={setOpeningDebt} /></label>
        <label className="field">{translate("paymentDay")}<input type="number" min={1} max={28} required value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></label>
      </div><div className="plans-form-actions"><button className="button primary" disabled={busy}>{translate("saveCard")}</button><button type="button" className="button secondary" onClick={() => setCardDraft(null)}>{translate("cancel")}</button></div></form></Modal>}
      {paymentCard && <Modal title={translate("recordCardPayment")} subtitle={translate("payDownThisCardFrom")} onClose={() => setPayCard("")}><form className="plans-form" onSubmit={(e) => void makePayment(e)}><div className="plans-payment-balance"><span>{translate("outstandingNow")}</span><strong>{money(Math.max(0, paymentBalance))}</strong><small>{translate("thisPaymentMovesCashTo")}</small></div><div className="plans-fields">
        <ChoiceField label={translate("card")} value={payCard} onValueChange={setPayCard} options={data.creditCards.map((card) => ({ value: card.id, label: card.name, description: translate("amountOutstanding", { amount: money(Math.max(0, cardBalance(data, card.id))) }) }))} />
        <label className="field">{translate("amountRp")}<MoneyInput min={1} required value={payAmount} onValueChange={setPayAmount} /></label>
        <ChoiceField label={translate("paidFrom")} value={payAccount} onValueChange={setPayAccount} options={data.accounts.map((account) => ({ value: account, label: account, description: translate("recordedBalanceAmount", { amount: money(accountBalance(data, account)) }) }))} />
        <label className="field">{translate("date")}<input type="date" max={today()} required value={payDate} onChange={(e) => setPayDate(e.target.value)} /></label>
      </div>{paymentCreditAfter > 0 && <p className="plans-payment-credit">This payment will leave {money(paymentCreditAfter)} as card credit. Available credit will be {money(paymentCard.limit - paymentBalance + paymentAmount)}.</p>}<div className="plans-form-actions"><button className="button primary" disabled={busy}>{translate("recordPayment")}</button><button type="button" className="button secondary" onClick={() => setPayCard("")}>{translate("cancel")}</button></div></form></Modal>}
    </> : tab === "owed" ? <>
      <div className="section-heading plans-heading"><div><h2>{translate("owed")}</h2><p>{translate("owedHelp")}</p></div><button className="button secondary" onClick={() => setLoanOpen(true)}><Plus size={16} /> {translate("addLoan")}</button></div>
      {!owed.length && <p className="plans-empty">{translate("owedEmpty")}</p>}
      <div className="rule-list">{owed.map((group) => <section className="credit-card-item" key={group.person || "legacy"}>
        <div className="credit-card-top"><span className="credit-card-icon"><HandCoins size={20} /></span><div><h3>{group.person || translate("unnamedPeople")}</h3><small>{group.net >= 0 ? translate("theyOweYou") : translate("youOweThem")}</small></div><strong>{money(Math.abs(group.net))}</strong></div>
        <div className="card-purchases">{group.entries.map((entry) => <div key={`${entry.source.id}:${entry.person}`}><span className="owed-entry-details"><span>{entry.source.date} · {entry.source.name}</span><small>{entry.direction === "they_owe_me" ? translate("theyOweYou") : translate("youOweThem")}</small></span><strong>{money(entry.remaining)}</strong><button className="button secondary" onClick={() => onOpenOwed(entry.source, entry.person)}>{translate("recordRepayment")}</button></div>)}</div>
      </section>)}</div>
      {loanOpen && <Modal title={translate("addLoan")} subtitle={translate("loanHelp")} onClose={() => setLoanOpen(false)}><form className="plans-form" onSubmit={(e) => void saveLoan(e)}><div className="plans-fields">
        <SegmentedChoice label={translate("direction")} value={loanDirection} onValueChange={(value) => setLoanDirection(value as "loan_given" | "loan_received")} options={[{ value: "loan_given", label: translate("iLentMoney") }, { value: "loan_received", label: translate("iBorrowedMoney") }]} />
        <label className="field">{translate("personName")}<input required maxLength={80} value={loanPerson} onChange={(e) => setLoanPerson(e.target.value)} /></label>
        <label className="field">{translate("amountRp")}<MoneyInput min={1} required value={loanAmount} onValueChange={setLoanAmount} /></label>
        <ChoiceField label={translate("account")} value={loanAccount} onValueChange={setLoanAccount} options={data.accounts.map((account) => ({ value: account, label: account }))} />
        <label className="field">{translate("date")}<input type="date" max={today()} required value={loanDate} onChange={(e) => setLoanDate(e.target.value)} /></label>
      </div><div className="plans-form-actions"><button className="button primary" disabled={busy}>{translate("addLoan")}</button><button type="button" className="button secondary" onClick={() => setLoanOpen(false)}>{translate("cancel")}</button></div></form></Modal>}
    </> : <>
      <div className="section-heading plans-heading"><div><h2>{translate("recurringBills")}</h2><p>{money(data.recurring.filter((r) => r.active && r.type === "expense").reduce((n, r) => n + r.amount * 12, 0))} planned per year · Record each charge only when it happens.</p></div><button className="button secondary" onClick={() => editRule()}><Plus size={16} /> {translate("addBill")}</button></div>
      {pending.length > 0 && <section className="due-list"><h3>{translate("readyToRecord")}</h3>{pending.map(({ rule, date }) => <div key={`${rule.id}:${date}`} className="due-row"><CalendarDays size={17} /><div><strong>{rule.name}</strong><small>Due {date} · {rule.account}</small></div><strong>{money(rule.amount)}</strong><button className="button primary" disabled={busy} onClick={() => void postRule(rule, date)}>{rule.cardId ? translate("markCharged") : rule.type === "income" ? translate("recordIncome") : translate("markPaid")}</button><button className="text-button" disabled={busy} onClick={() => void skipRule(rule, date)}>{translate("skip")}</button></div>)}</section>}
      {!data.recurring.length && <p className="plans-empty">{translate("addRentSubscriptionsSalaryOr")}</p>}
      <div className="rule-list">{data.recurring.map((rule) => <article className="rule-row" key={rule.id}><span className="rule-symbol"><RotateCcw size={17} /></span><div className="rule-description"><strong>{rule.name}</strong><small>{translate("dayNumber", { day: rule.day })} · {rule.account} · {rule.active ? translate("active") : translate("paused")}</small></div><div className="rule-money"><strong>{money(rule.amount)}</strong><small>{money(rule.amount * 12)} per year</small></div><div className="rule-actions"><button className="text-button" onClick={() => editRule(rule)}>{translate("edit")}</button><button className="text-button" disabled={busy} onClick={() => void toggleRule(rule)}>{rule.active ? translate("pause") : translate("resume")}</button><button className="text-button" aria-label={translate("removeNamed", { name: rule.name })} title={translate("removeNamed", { name: rule.name })} onClick={() => setDeleteId(rule.id)}><Trash2 size={15} /></button></div></article>)}</div>
      {deleteId && (() => { const rule = data.recurring.find((item) => item.id === deleteId); return rule && <Modal title={translate("removeNamedQuestion", { name: rule.name })} subtitle={translate("pastTransactionsStayInYour")} onClose={() => setDeleteId("")}><div className="plans-form-actions"><button className="button danger" disabled={busy} onClick={() => void deleteRule(rule)}>{translate("removeRecurringItem")}</button><button className="button secondary" onClick={() => setDeleteId("")}>{translate("cancel")}</button></div></Modal>; })()}
      {ruleDraft && <Modal title={ruleDraft.id ? translate("editRecurringItem") : translate("addRecurringItem")} subtitle={translate("reviewTheAmountScheduleAnd")} onClose={() => setRuleDraft(null)}><form className="plans-form" onSubmit={(e) => void saveRule(e)}><div className="plans-fields">
        <label className="field">{translate("name")}<input value={ruleName} required maxLength={100} onChange={(e) => setRuleName(e.target.value)} /></label>
        <label className="field">{translate("amountRp")}<MoneyInput min={1} value={ruleAmount} required onValueChange={setRuleAmount} /></label>
        <SegmentedChoice label={translate("direction")} value={ruleType} onValueChange={(value) => { const next = value as "income" | "expense"; setRuleType(next); if (next === "income") setRuleMethod(`bank:${data.accounts[0]}`); }} options={[{ value: "expense", label: translate("moneyOut") }, { value: "income", label: translate("moneyIn") }]} />
        <ChoiceField label={ruleType === "income" ? translate("receivedIn") : translate("paidWith")} value={ruleMethod} onValueChange={setRuleMethod} options={[...data.accounts.map((account) => ({ value: `bank:${account}`, label: account, description: translate("accountBalanceAmount", { amount: money(accountBalance(data, account)) }) })), ...(ruleType === "expense" ? data.creditCards.map((card) => ({ value: `card:${card.id}`, label: card.name, description: translate("creditAvailableAmount", { amount: money(Math.max(0, card.limit - cardBalance(data, card.id))) }) })) : [])]} />
        {ruleMethod.startsWith("card:") && ruleType === "expense" && <label className="field">{translate("paymentsPerCharge")}<input type="number" min={1} max={60} step={1} value={ruleInstallments} onChange={(e) => setRuleInstallments(e.target.value)} /></label>}
        {ruleType === "expense" && <ChoiceField label={translate("pocket")} placeholder={translate("choosePocket")} value={rulePocket} onValueChange={setRulePocket} options={data.pockets.map((pocket) => ({ value: pocket.id, label: pocket.name }))} />}
        <label className="field">{translate("dayEachMonth")}<input type="number" min={1} max={31} value={ruleDay} required onChange={(e) => setRuleDay(e.target.value)} /></label>
        <label className="field">{translate("fromMonth")}<input type="month" value={ruleMonth} required onChange={(e) => setRuleMonth(e.target.value)} /></label>
      </div><div className="plans-form-actions"><button className="button primary" disabled={busy}>{translate("saveRecurringItem")}</button><button type="button" className="button secondary" onClick={() => setRuleDraft(null)}>{translate("cancel")}</button></div></form></Modal>}
    </>}
  </div>;
}
