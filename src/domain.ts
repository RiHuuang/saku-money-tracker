import Papa from "papaparse";

export type Pocket = {
  id: string;
  name: string;
  color: string;
  icon: string;
  budget: number;
  budgets: Record<string, number>;
  createdMonth: string;
};
export type Transaction = {
  id: string;
  name: string;
  amount: number;
  type: "income" | "expense";
  date: string;
  pocketId: string;
  account: string;
  note: string;
  verified?: boolean;
  kind?: "card_purchase" | "card_payment" | "reimbursement" | "opening_balance" | "account_transfer";
  cardId?: string;
  installments?: number;
  firstDueMonth?: string;
  recurringRuleId?: string;
  occurrenceMonth?: string;
  split?: { people: number; ownAmount: number };
  forTransactionId?: string;
  transferId?: string;
};
export type PocketTransfer = { id: string; fromPocketId: string; toPocketId: string; amount: number; month: string };
export type ExistingInstallment = { id: string; cardId: string; name: string; monthlyAmount: number; nextDueMonth: string; paymentsLeft: number };
export type CreditCard = {
  id: string;
  name: string;
  limit: number;
  openingDebt: number;
  dueDay: number;
};
export type RecurringRule = {
  id: string;
  name: string;
  amount: number;
  type: "income" | "expense";
  pocketId: string;
  account: string;
  cardId?: string;
  installments?: number;
  skippedMonths?: string[];
  day: number;
  startMonth: string;
  active: boolean;
};
export type Favorite = {
  id: string;
  name: string;
  amount: number;
  type: "income" | "expense";
  pocketId: string;
  account: string;
  cardId?: string;
};
export type Data = {
  version: 3;
  demo: boolean;
  name: string;
  pockets: Pocket[];
  transactions: Transaction[];
  accounts: string[];
  creditCards: CreditCard[];
  recurring: RecurringRule[];
  favorites: Favorite[];
  pocketTransfers: PocketTransfer[];
  existingInstallments: ExistingInstallment[];
};
export const COLORS = [
  "#15786e",
  "#8270ce",
  "#d18937",
  "#4b85c5",
  "#cf6b83",
  "#638447",
];
export const ICONS = [
  "utensils",
  "shopping",
  "car",
  "game",
  "home",
  "heart",
  "plane",
  "book",
  "coffee",
  "gift",
];
export const uid = () => crypto.randomUUID();
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const money = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
export const compact = (n: number) =>
  Math.abs(n) >= 1000000
    ? `${(n / 1000000).toLocaleString("en", { maximumFractionDigits: 1 })}m`
    : Math.abs(n) >= 1000
      ? `${(n / 1000).toLocaleString("en", { maximumFractionDigits: 0 })}k`
      : String(n);
export const monthLabel = (month: string, short = false) =>
  new Date(`${month}-01T12:00:00`).toLocaleDateString("en-GB", {
    month: short ? "short" : "long",
    year: "numeric",
  });
export function shiftMonth(month: string, delta: number) {
  const d = new Date(`${month}-01T12:00:00`);
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export const validDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) &&
  new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
export const validAmount = (n: number) =>
  Number.isSafeInteger(n) && n > 0 && n <= 1e12;
export const budgetFor = (p: Pocket, m: string) =>
  m < p.createdMonth ? 0 : (p.budgets[m] ?? p.budget);
export const isSpending = (t: Transaction) =>
  t.type === "expense" && !["card_payment", "account_transfer"].includes(t.kind || "");
export const personalAmount = (t: Transaction) =>
  t.split?.ownAmount ?? t.amount;
export const isIncome = (t: Transaction) =>
  t.type === "income" && !["reimbursement", "opening_balance", "account_transfer"].includes(t.kind || "");
export function accountBalance(data: Data, account: string) {
  return data.transactions.filter((t) => t.account === account && t.kind !== "card_purchase")
    .reduce((sum, t) => sum + (t.type === "income" ? t.amount : -t.amount), 0);
}
export function cardBalance(data: Data, cardId: string) {
  const card = data.creditCards.find((c) => c.id === cardId);
  if (!card) return 0;
  return card.openingDebt + data.transactions.reduce((total, t) =>
    total + (t.cardId === cardId
      ? t.kind === "card_purchase" ? t.amount : t.kind === "card_payment" ? -t.amount : 0
      : 0), 0);
}
export function installmentAmounts(amount: number, count: number) {
  const base = Math.floor(amount / count);
  return Array.from({ length: count }, (_, index) => base + (index < amount % count ? 1 : 0));
}
export function cardDue(data: Data, cardId: string, month: string) {
  const purchases = data.transactions.filter((t) => t.cardId === cardId && t.kind === "card_purchase")
    .reduce((sum, t) => {
      const start = t.firstDueMonth || shiftMonth(t.date.slice(0, 7), 1);
      const count = t.installments || 1;
      const index = (Number(month.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(month.slice(5, 7)) - Number(start.slice(5, 7));
      return sum + (index >= 0 && index < count ? installmentAmounts(t.amount, count)[index] : 0);
    }, 0);
  const existing = data.existingInstallments.filter((item) => item.cardId === cardId).reduce((sum, item) => {
    const index = (Number(month.slice(0, 4)) - Number(item.nextDueMonth.slice(0, 4))) * 12 + Number(month.slice(5, 7)) - Number(item.nextDueMonth.slice(5, 7));
    return sum + (index >= 0 && index < item.paymentsLeft ? item.monthlyAmount : 0);
  }, 0);
  return purchases + existing;
}
export function dueDate(rule: RecurringRule, month: string) {
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  return `${month}-${String(Math.min(rule.day, lastDay)).padStart(2, "0")}`;
}
export function dueRules(data: Data, through = today()) {
  const currentMonth = through.slice(0, 7);
  return data.recurring.filter((r) => r.active).flatMap((rule) => {
    const rows: { rule: RecurringRule; date: string }[] = [];
    for (let m = rule.startMonth > shiftMonth(currentMonth, -11) ? rule.startMonth : shiftMonth(currentMonth, -11); m <= currentMonth; m = shiftMonth(m, 1)) {
      const date = dueDate(rule, m);
      if (date <= through && !rule.skippedMonths?.includes(m) && !data.transactions.some((t) => t.recurringRuleId === rule.id && (t.occurrenceMonth || t.date.slice(0, 7)) === m))
        rows.push({ rule, date });
    }
    return rows;
  }).sort((a, b) => a.date.localeCompare(b.date));
}
export function summary(data: Data, month: string) {
  const transactions = data.transactions.filter((t) =>
    t.date.startsWith(month),
  );
  const income = transactions
    .filter(isIncome)
    .reduce((n, t) => n + t.amount, 0);
  const expenses = transactions
    .filter(isSpending)
    .reduce((n, t) => n + personalAmount(t), 0);
  const balance = data.transactions
    .filter((t) => t.date.slice(0, 7) <= month)
    .reduce((n, t) => n + (t.kind === "card_purchase" ? 0 : t.type === "income" ? t.amount : -t.amount), 0);
  const pockets = data.pockets
    .filter((p) => p.createdMonth <= month)
    .map((p) => ({
      ...p,
      limit: budgetFor(p, month) + data.pocketTransfers.reduce((sum, transfer) => transfer.month !== month ? sum : sum + (transfer.toPocketId === p.id ? transfer.amount : transfer.fromPocketId === p.id ? -transfer.amount : 0), 0),
      spent: transactions
        .filter((t) => isSpending(t) && t.pocketId === p.id)
        .reduce((n, t) => n + personalAmount(t), 0),
    }));
  const budget = pockets.reduce((n, p) => n + p.limit, 0);
  const remaining = pockets.reduce(
    (n, p) => n + Math.max(0, p.limit - p.spent),
    0,
  );
  return {
    transactions,
    income,
    expenses,
    balance,
    pockets,
    budget,
    remaining,
    available: Math.min(Math.max(0, balance), remaining),
    cardDebt: data.creditCards.reduce((n, c) => n + Math.max(0, cardBalance(data, c.id)), 0),
    unassigned: transactions.filter((t) => isSpending(t) && !t.pocketId).reduce((n, t) => n + personalAmount(t), 0),
    accounts: data.accounts.map((account) => ({ account, balance: accountBalance(data, account) })),
  };
}
export function emptyData(): Data {
  return {
    version: 3,
    demo: false,
    name: "My",
    accounts: ["Cash", "BCA", "Mandiri", "GoPay"],
    pockets: [],
    transactions: [],
    creditCards: [],
    recurring: [],
    favorites: [],
    pocketTransfers: [],
    existingInstallments: [],
  };
}
export function demoData(month = today().slice(0, 7)): Data {
  const definitions = [
    ["Food & drinks", "utensils", 1500000],
    ["Shopping", "shopping", 1000000],
    ["Transport", "car", 600000],
    ["Entertainment", "game", 500000],
    ["Home & bills", "home", 2000000],
    ["Wellbeing", "heart", 400000],
  ] as const;
  const pockets = definitions.map(([name, icon, budget], i) => ({
    id: `p${i}`,
    name,
    icon,
    budget,
    color: COLORS[i],
    budgets: {},
    createdMonth: shiftMonth(month, -2),
  }));
  const entries: [string, number, number, number, string][] = [
    ["Monthly salary", 10000000, -1, 1, "BCA"],
    ["Apartment rent", 1500000, 4, 2, "BCA"],
    ["Weekly groceries", 320000, 0, 3, "BCA"],
    ["Grab ride", 42000, 2, 4, "GoPay"],
    ["Morning coffee", 38000, 0, 5, "GoPay"],
    ["Uniqlo", 349000, 1, 6, "BCA"],
    ["Electricity", 250000, 4, 7, "Mandiri"],
    ["Freelance project", 1500000, -1, 9, "BCA"],
    ["Lunch with friends", 185000, 0, 11, "GoPay"],
    ["Cinema night", 150000, 3, 12, "BCA"],
    ["Fuel", 200000, 2, 13, "Mandiri"],
    ["Fresh market", 275000, 0, 15, "Cash"],
    ["Spotify Premium", 55000, 3, 16, "BCA"],
    ["Internet", 200000, 4, 17, "Mandiri"],
    ["Pilates class", 175000, 5, 19, "BCA"],
    ["New sneakers", 425000, 1, 20, "BCA"],
    ["Nasi goreng", 45000, 0, 22, "GoPay"],
    ["Grab ride", 38000, 2, 23, "GoPay"],
    ["Weekend dinner", 225000, 0, 24, "BCA"],
    ["Netflix", 65000, 3, 25, "BCA"],
    ["Kopi Tuku", 28000, 0, 26, "GoPay"],
    ["Daily essentials", 89000, 1, 27, "Mandiri"],
  ];
  const lastDay =
    month === today().slice(0, 7) ? Number(today().slice(-2)) : 28;
  const transactions: Transaction[] = entries.map(
    ([name, amount, p, day, account], i) => ({
      id: `t${i}`,
      name,
      amount,
      type: p < 0 ? "income" : "expense",
      date: `${month}-${String(Math.min(day, lastDay)).padStart(2, "0")}`,
      pocketId: p < 0 ? "" : `p${p}`,
      account,
      note: "",
    }),
  );
  return {
    version: 3,
    demo: true,
    name: "My",
    pockets,
    transactions,
    accounts: ["BCA", "Mandiri", "GoPay", "Cash"],
    creditCards: [],
    recurring: [],
    favorites: [],
    pocketTransfers: [],
    existingInstallments: [],
  };
}

export function validateData(input: unknown): Data {
  const legacy = input as Omit<Data, "version"> & { version?: number };
  const v2 = legacy?.version === 1
    ? { ...legacy, version: 2, creditCards: [], recurring: [], favorites: [] }
    : legacy;
  const d = (v2?.version === 2
    ? { ...v2, version: 3, pocketTransfers: [], existingInstallments: [] }
    : v2) as Data;
  if (
    !d ||
    d.version !== 3 ||
    typeof d.demo !== "boolean" ||
    typeof d.name !== "string" ||
    d.name.length > 40 ||
    !Array.isArray(d.accounts) ||
    !d.accounts.length ||
    d.accounts.length > 100 ||
    d.accounts.some(
      (a) => typeof a !== "string" || !a.trim() || a.length > 50,
    ) ||
    new Set(d.accounts).size !== d.accounts.length ||
    !Array.isArray(d.pockets) ||
    !Array.isArray(d.transactions) ||
    !Array.isArray(d.creditCards) ||
    !Array.isArray(d.recurring) ||
    !Array.isArray(d.favorites) ||
    !Array.isArray(d.pocketTransfers) ||
    !Array.isArray(d.existingInstallments) ||
    d.pockets.length > 1000 ||
    d.transactions.length > 100000 ||
    d.creditCards.length > 30 ||
    d.recurring.length > 500 ||
    d.favorites.length > 30 ||
    d.pocketTransfers.length > 10000 ||
    d.existingInstallments.length > 100
  )
    throw new Error("This is not a valid Saku backup.");
  const ids = new Set<string>();
  for (const p of d.pockets) {
    if (
      !p ||
      typeof p.id !== "string" ||
      !p.id ||
      ids.has(p.id) ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 40 ||
      !COLORS.includes(p.color) ||
      !ICONS.includes(p.icon) ||
      !Number.isSafeInteger(p.budget) ||
      p.budget < 0 ||
      p.budget > 1e12 ||
      !validDate(`${p.createdMonth}-01`) ||
      !p.budgets ||
      typeof p.budgets !== "object" ||
      Array.isArray(p.budgets) ||
      Object.entries(p.budgets).some(
        ([m, n]) =>
          !validDate(`${m}-01`) ||
          !Number.isSafeInteger(n) ||
          n < 0 ||
          n > 1e12,
      )
    )
      throw new Error("The backup contains an invalid pocket.");
    ids.add(p.id);
  }
  const txIds = new Set<string>();
  const cardIds = new Set<string>();
  for (const c of d.creditCards) {
    if (!c || typeof c.id !== "string" || !c.id || cardIds.has(c.id) ||
      typeof c.name !== "string" || !c.name.trim() || c.name.length > 50 ||
      d.accounts.some((a) => a.toLowerCase() === c.name.toLowerCase()) ||
      d.creditCards.some((other) => other !== c && other.name?.toLowerCase() === c.name.toLowerCase()) ||
      !Number.isSafeInteger(c.limit) || c.limit <= 0 || c.limit > 1e12 ||
      !Number.isSafeInteger(c.openingDebt) || c.openingDebt < 0 || c.openingDebt > 1e12 ||
      !Number.isInteger(c.dueDay) || c.dueDay < 1 || c.dueDay > 28)
      throw new Error("The backup contains an invalid credit card.");
    cardIds.add(c.id);
  }
  let absoluteTotal = 0;
  for (const t of d.transactions) {
    const card = d.creditCards.find((c) => c.id === t?.cardId);
    const special = ["card_purchase", "card_payment", "reimbursement", "opening_balance", "account_transfer"].includes(t?.kind || "");
    if (
      !t ||
      typeof t.id !== "string" ||
      !t.id ||
      txIds.has(t.id) ||
      typeof t.name !== "string" ||
      !t.name.trim() ||
      t.name.length > 100 ||
      !validAmount(t.amount) ||
      !validDate(t.date) ||
      !["income", "expense"].includes(t.type) ||
      (t.type === "expense" && !["card_payment", "account_transfer"].includes(t.kind || "") && t.pocketId !== "" && !ids.has(t.pocketId)) ||
      (t.kind === "card_payment" && (t.type !== "expense" || t.pocketId !== "" || !card)) ||
      (t.kind === "card_purchase" && (t.type !== "expense" || !card || t.account !== card.name)) ||
      (t.kind === "reimbursement" && (t.type !== "income" || !t.forTransactionId)) ||
      (t.kind === "opening_balance" && (t.type !== "income" || t.pocketId !== "")) ||
      (t.kind === "account_transfer" && (t.pocketId !== "" || !t.transferId)) ||
      (t.kind !== undefined && !special) ||
      (t.type === "income" && t.pocketId !== "") ||
      (t.kind === "card_purchase" ? !card : !d.accounts.includes(t.account)) ||
      (t.cardId !== undefined && (t.kind !== "card_purchase" && t.kind !== "card_payment" || !card)) ||
      (t.kind === "card_purchase" && (!Number.isInteger(t.installments) || (t.installments || 0) < 1 || (t.installments || 0) > 60 || !validDate(`${t.firstDueMonth}-01`) || t.firstDueMonth! < t.date.slice(0, 7))) ||
      (t.kind !== "card_purchase" && (t.installments !== undefined || t.firstDueMonth !== undefined)) ||
      (t.split !== undefined && (!isSpending(t) || !Number.isInteger(t.split.people) || t.split.people < 2 || t.split.people > 30 || !validAmount(t.split.ownAmount) || t.split.ownAmount > t.amount)) ||
      (t.forTransactionId !== undefined && t.kind !== "reimbursement") ||
      (t.transferId !== undefined && t.kind !== "account_transfer") ||
      (t.recurringRuleId !== undefined && (typeof t.recurringRuleId !== "string" || !t.recurringRuleId)) ||
      (t.occurrenceMonth !== undefined && (!t.recurringRuleId || !validDate(`${t.occurrenceMonth}-01`))) ||
      typeof t.note !== "string" ||
      t.note.length > 500 ||
      (t.verified !== undefined && typeof t.verified !== "boolean")
    )
      throw new Error("The backup contains an invalid transaction.");
    txIds.add(t.id);
    absoluteTotal += t.amount;
    if (!Number.isSafeInteger(absoluteTotal)) throw new Error('Ledger amounts exceed the supported integer range.');
    if (isSpending(t) && t.pocketId && t.date.slice(0, 7) < d.pockets.find(p => p.id === t.pocketId)!.createdMonth) throw new Error('A transaction predates its pocket.');
  }
  const transferGroups = new Map<string, Transaction[]>();
  for (const t of d.transactions.filter((t) => t.kind === "account_transfer")) {
    const group = transferGroups.get(t.transferId!) || [];
    group.push(t); transferGroups.set(t.transferId!, group);
  }
  if ([...transferGroups.values()].some((group) => group.length !== 2 || group[0].amount !== group[1].amount || group[0].date !== group[1].date || group[0].account === group[1].account || new Set(group.map((t) => t.type)).size !== 2))
    throw new Error("A bank transfer must have one matching money-out and money-in entry.");
  for (const t of d.transactions.filter((t) => t.kind === "reimbursement")) {
    const source = d.transactions.find((x) => x.id === t.forTransactionId);
    if (!source?.split || t.date < source.date)
      throw new Error("A reimbursement has no valid shared expense.");
  }
  for (const source of d.transactions.filter((t) => t.split)) {
    const repaid = d.transactions.filter((t) => t.forTransactionId === source.id).reduce((n, t) => n + t.amount, 0);
    if (repaid > source.amount - source.split!.ownAmount)
      throw new Error("Repayments exceed the amount owed.");
  }
  const ruleIds = new Set<string>();
  for (const r of d.recurring) {
    const card = d.creditCards.find((c) => c.id === r?.cardId);
    if (!r || typeof r.id !== "string" || !r.id || ruleIds.has(r.id) ||
      typeof r.name !== "string" || !r.name.trim() || r.name.length > 100 ||
      !validAmount(r.amount) || !["income", "expense"].includes(r.type) ||
      (r.type === "expense" ? r.pocketId !== "" && !ids.has(r.pocketId) : r.pocketId !== "") ||
      (r.cardId ? r.type !== "expense" || !card || r.account !== card.name : !d.accounts.includes(r.account)) ||
      (r.installments !== undefined && (!r.cardId || !Number.isInteger(r.installments) || r.installments < 1 || r.installments > 60)) ||
      (r.skippedMonths !== undefined && (!Array.isArray(r.skippedMonths) || r.skippedMonths.some((m) => typeof m !== "string" || !validDate(`${m}-01`)) || new Set(r.skippedMonths).size !== r.skippedMonths.length)) ||
      !Number.isInteger(r.day) || r.day < 1 || r.day > 31 ||
      !validDate(`${r.startMonth}-01`) || typeof r.active !== "boolean")
      throw new Error("The backup contains an invalid recurring bill.");
    ruleIds.add(r.id);
  }
  if (d.transactions.some((t) => t.recurringRuleId && !ruleIds.has(t.recurringRuleId)))
    throw new Error("A transaction references a missing recurring bill.");
  const favoriteIds = new Set<string>();
  for (const f of d.favorites) {
    const card = d.creditCards.find((c) => c.id === f?.cardId);
    if (!f || typeof f.id !== "string" || !f.id || favoriteIds.has(f.id) ||
      typeof f.name !== "string" || !f.name.trim() || f.name.length > 100 ||
      !validAmount(f.amount) || !["income", "expense"].includes(f.type) ||
      (f.type === "expense" ? f.pocketId !== "" && !ids.has(f.pocketId) : f.pocketId !== "") ||
      (f.cardId ? f.type !== "expense" || !card || f.account !== card.name : !d.accounts.includes(f.account)))
      throw new Error("The backup contains an invalid quick entry.");
    favoriteIds.add(f.id);
  }
  const moveIds = new Set<string>();
  for (const move of d.pocketTransfers) {
    if (!move || typeof move.id !== "string" || !move.id || moveIds.has(move.id) || move.fromPocketId === move.toPocketId || !ids.has(move.fromPocketId) || !ids.has(move.toPocketId) || !validAmount(move.amount) || !validDate(`${move.month}-01`))
      throw new Error("The backup contains an invalid pocket transfer.");
    moveIds.add(move.id);
  }
  const installmentIds = new Set<string>();
  for (const item of d.existingInstallments) {
    if (!item || typeof item.id !== "string" || !item.id || installmentIds.has(item.id) || !cardIds.has(item.cardId) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 100 || !validAmount(item.monthlyAmount) || !validDate(`${item.nextDueMonth}-01`) || !Number.isInteger(item.paymentsLeft) || item.paymentsLeft < 1 || item.paymentsLeft > 60)
      throw new Error("The backup contains an invalid existing installment.");
    installmentIds.add(item.id);
  }
  return d;
}

export type Mapping = {
  date: string;
  name: string;
  amount: string;
  type: string;
  debit: string;
  credit: string;
};
export type Statement = {
  id: string;
  file: string;
  account: string;
  headers: string[];
  raw: Record<string, string>[];
  mapping: Mapping;
  format: "id" | "en";
  dateOrder: "dmy" | "mdy";
};
export type BankRow = {
  id: string;
  file: string;
  name: string;
  amount: number;
  type: "income" | "expense";
  date: string;
  account: string;
  error?: string;
};
export function readCSV(text: string) {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().replace(/^\uFEFF/, ""),
  });
  if (result.errors.length)
    throw new Error(`CSV could not be read: ${result.errors[0].message}`);
  const headers = result.meta.fields || [];
  if (!headers.length || !result.data.length)
    throw new Error("This file has no transaction rows.");
  if (result.data.length > 10000)
    throw new Error("Use statements with fewer than 10,000 rows.");
  const find = (names: string[]) =>
    headers.find((h) => names.includes(h.toLowerCase())) || "";
  return {
    headers,
    raw: result.data,
    mapping: {
      date: find(["date", "tanggal", "transaction date"]),
      name: find(["description", "keterangan", "name", "uraian", "merchant"]),
      amount: find(["amount", "jumlah", "nominal"]),
      type: find(["type", "tipe", "jenis", "debit/credit", "db/cr"]),
      debit: find(["debit", "debet", "withdrawal"]),
      credit: find(["credit", "kredit", "deposit"]),
    },
  };
}
export function parseMoney(raw: string, format: "id" | "en"): number {
  let s = raw
    .trim()
    .replace(/^Rp\.?\s*/i, "")
    .replace(/\s/g, "");
  if (!s) return 0;
  const pattern =
    format === "id"
      ? /^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/
      : /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
  if (!pattern.test(s)) throw new Error("Invalid amount format");
  s =
    format === "id"
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e12)
    throw new Error("Use whole rupiah amounts");
  return n;
}
export function receiptSuggestion(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const totalLines = lines.filter((line) => /^(?:grand\s+total|total(?:\s+bayar)?|jumlah(?:\s+bayar)?|tagihan|amount\s+due)\b/i.test(line));
  const values = totalLines.flatMap((line) => {
    const match = line.match(/(?:Rp\.?\s*)?\d[\d.,]*/g)?.at(-1);
    if (!match) return [];
    const formats = /^\d{1,3}(?:,\d{3})+$/.test(match) ? ["en", "id"] as const : ["id", "en"] as const;
    for (const format of formats) {
      try { const amount = parseMoney(match, format); if (validAmount(amount)) return [amount]; } catch { /* Try the other common format. */ }
    }
    return [];
  });
  return { amount: values.at(-1) || null, merchant: lines.find((line) => /[A-Za-z]/.test(line) && !/^(?:total|jumlah|tanggal|date|receipt|struk)/i.test(line))?.slice(0, 100) || "" };
}
export function bankRows(s: Statement): BankRow[] {
  return s.raw.map((r, i) => {
    const row: BankRow = {
      id: `${s.id}:${i}`,
      file: s.file,
      name: r[s.mapping.name]?.trim() || "",
      amount: 0,
      type: "expense",
      date: "",
      account: s.account,
    };
    try {
      if (!s.mapping.date || !s.mapping.name)
        throw new Error("Map the date and description columns");
      let date = r[s.mapping.date]?.trim() || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const parts = date.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
        if (!parts) throw new Error("Unrecognized date");
        date = `${parts[3]}-${(s.dateOrder === "dmy" ? parts[2] : parts[1]).padStart(2, "0")}-${(s.dateOrder === "dmy" ? parts[1] : parts[2]).padStart(2, "0")}`;
      }
      if (!validDate(date)) throw new Error("Invalid calendar date");
      row.date = date;
      if (!row.name || row.name.length > 100)
        throw new Error("Description must be 1-100 characters");
      if (s.mapping.debit || s.mapping.credit) {
        const debit = parseMoney(r[s.mapping.debit] || "", s.format),
          credit = parseMoney(r[s.mapping.credit] || "", s.format);
        if (
          debit < 0 ||
          credit < 0 ||
          (debit > 0 && credit > 0) ||
          (!debit && !credit)
        )
          throw new Error("Expected one positive debit or credit");
        row.amount = debit || credit;
        row.type = debit ? "expense" : "income";
      } else {
        if (!s.mapping.amount) throw new Error("Map an amount column");
        const n = parseMoney(r[s.mapping.amount] || "", s.format),
          type = (r[s.mapping.type] || "").trim().toLowerCase();
        if (s.mapping.type) {
          if (
            ![
              "income",
              "credit",
              "cr",
              "kredit",
              "in",
              "expense",
              "debit",
              "db",
              "debet",
              "out",
            ].includes(type)
          )
            throw new Error("Unrecognized transaction type");
          row.type = ["income", "credit", "cr", "kredit", "in"].includes(type)
            ? "income"
            : "expense";
        } else row.type = n < 0 ? "expense" : "income";
        row.amount = Math.abs(n);
      }
      if (!validAmount(row.amount))
        throw new Error("Amount must be greater than zero");
    } catch (e) {
      row.error = e instanceof Error ? e.message : "Invalid row";
    }
    return row;
  });
}
export function reconcile(
  rows: BankRow[],
  transactions: Transaction[],
  month: string,
) {
  const key = (r: BankRow | Transaction) =>
    JSON.stringify([r.date, r.account, r.type, r.amount]);
  const nameKey = (name: string) => name.toLocaleLowerCase("id-ID").replace(/[^a-z0-9]+/g, " ").trim();
  const counts = new Map<string, number>();
  const indexed = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const k = key(transaction);
    const group = indexed.get(k) || [];
    group.push(transaction);
    indexed.set(k, group);
  }
  rows
    .filter((r) => !r.error)
    .forEach((r) => counts.set(key(r), (counts.get(key(r)) || 0) + 1));
  return rows.map((r) => {
    if (r.error) return { ...r, status: "invalid" as const, matchId: "" };
    if (!r.date.startsWith(month))
      return { ...r, status: "outside" as const, matchId: "" };
    const matches = indexed.get(key(r)) || [];
    // Repeated same-value payments need human review, including overlapping files.
    if ((counts.get(key(r)) || 0) > 1 || matches.length > 1)
      return { ...r, status: "review" as const, matchId: "" };
    if (matches.length) return {
      ...r,
      status: nameKey(r.name) && nameKey(r.name) === nameKey(matches[0].name) ? "matched" as const : "different" as const,
      matchId: matches[0].id,
    };
    const day = (date: string) => Date.parse(`${date}T12:00:00Z`) / 86400000;
    const words = (name: string) => {
      const generic = new Set(["expense", "payment", "transaction", "debit", "credit", "purchase", "transfer"]);
      return new Set(name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((word) => word.length > 2 && !generic.has(word)));
    };
    const sourceWords = words(r.name);
    const candidates = transactions.filter((t) => t.kind !== "account_transfer" && t.account === r.account && t.type === r.type && t.date.startsWith(month) && Math.abs(day(t.date) - day(r.date)) <= 3)
      .filter((t) => {
        const targetWords = words(t.name);
        const shared = [...sourceWords].filter((word) => targetWords.has(word)).length;
        const left = r.name.toLowerCase().replace(/[^a-z0-9]/g, ""), right = t.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return shared >= 2 || (Math.min(left.length, right.length) >= 6 && (left.includes(right) || right.includes(left)));
      });
    return candidates.length === 1
      ? { ...r, status: "different" as const, matchId: candidates[0].id }
      : { ...r, status: "missing" as const, matchId: "" };
  });
}
export function exportCSV(transactions: Transaction[], pockets: Pocket[]) {
  return Papa.unparse(
    transactions.map((t) => ({
      date: t.date,
      description: t.name,
      amount: t.amount,
      type: t.type,
      account: t.account,
      pocket: pockets.find((p) => p.id === t.pocketId)?.name || "",
      note: t.note,
      id: t.id,
      kind: t.kind || (t.type === "income" ? "income" : "expense"),
      personalAmount: isSpending(t) ? personalAmount(t) : "",
      cardId: t.cardId || "",
      installments: t.installments || "",
      firstDueMonth: t.firstDueMonth || "",
      recurringRuleId: t.recurringRuleId || "",
      occurrenceMonth: t.occurrenceMonth || "",
      splitPeople: t.split?.people || "",
      splitOwnAmount: t.split?.ownAmount || "",
      forTransactionId: t.forTransactionId || "",
      transferId: t.transferId || "",
      statementChecked: !!t.verified,
    })),
    { escapeFormulae: true },
  );
}
