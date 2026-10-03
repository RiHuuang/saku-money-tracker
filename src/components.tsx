import { useEffect, useLayoutEffect, useRef, type ReactNode, type CSSProperties, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Car,
  Check,
  ChevronDown,
  ChevronRight,
  Coffee,
  Gamepad2,
  Gift,
  Heart,
  Home,
  Plane,
  Plus,
  ShoppingBag,
  Utensils,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { compact, isIncome, isSpending, money, personalAmount, type Pocket, type Transaction } from "./domain";

const icons: Record<string, LucideIcon> = {
  utensils: Utensils,
  shopping: ShoppingBag,
  car: Car,
  game: Gamepad2,
  home: Home,
  heart: Heart,
  plane: Plane,
  book: BookOpen,
  coffee: Coffee,
  gift: Gift,
};
export function MoneyInput({ value, onValueChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & { value: string | number; onValueChange: (value: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const digits = String(value ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const shown = digits ? Number(digits).toLocaleString("en-US") : "";
  return <input {...props} ref={ref} type="text" inputMode="numeric" value={shown} onChange={(event) => {
    const caret = event.currentTarget.selectionStart || 0;
    const digitCaret = event.currentTarget.value.slice(0, caret).replace(/\D/g, "").length;
    const next = event.currentTarget.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    onValueChange(next);
    requestAnimationFrame(() => {
      const input = ref.current;
      if (!input) return;
      let seen = 0, position = input.value.length;
      for (let index = 0; index < input.value.length; index++) if (/\d/.test(input.value[index]) && ++seen === digitCaret) { position = index + 1; break; }
      input.setSelectionRange(position, position);
    });
  }} />;
}
export function ChoicePicker({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className="choice-picker"><select {...props}>{children}</select><ChevronDown size={17} aria-hidden="true" /></span>;
}
export function FitMoney({ amount }: { amount: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    let lastWidth = 0;
    const fit = () => {
      const width = element.clientWidth;
      if (!width || width === lastWidth) return;
      lastWidth = width;
      element.style.fontSize = '';
      const fontSize = parseFloat(getComputedStyle(element).fontSize);
      element.style.fontSize = `${Math.min(fontSize, fontSize * width / Math.max(1, element.scrollWidth))}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    void document.fonts.ready.then(() => { lastWidth = 0; fit(); });
    return () => observer.disconnect();
  }, [amount]);
  return <span ref={ref} className="fit-money">{money(amount)}</span>;
}
export function PocketIcon({
  name,
  color,
  size = 20,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  const Icon = icons[name] || Wallet;
  return (
    <span
      className="pocket-icon"
      style={{ "--pocket-color": color } as CSSProperties}
    >
      <Icon size={size} />
    </span>
  );
}
export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Empty({
  title,
  detail,
  action,
  onClick,
}: {
  title: string;
  detail: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="empty">
      <Wallet size={28} />
      <h3>{title}</h3>
      <p>{detail}</p>
      {action && (
        <button className="button primary" onClick={onClick}>
          <Plus size={16} />
          {action}
        </button>
      )}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-content">
        <div className="modal-title">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function PocketCard({
  p,
  onClick,
}: {
  p: Pocket & { limit: number; spent: number };
  onClick: () => void;
}) {
  const remaining = p.limit - p.spent,
    percent = p.limit
      ? Math.round((p.spent / p.limit) * 100)
      : p.spent
        ? 100
        : 0;
  return (
    <button
      className="pocket-card"
      onClick={onClick}
      style={{ "--pocket-color": p.color } as CSSProperties}
      aria-label={`Edit ${p.name} pocket`}
    >
      <div className="pocket-card-top">
        <PocketIcon name={p.icon} color={p.color} />
        <ChevronRight size={17} className="muted" />
      </div>
      <h3>{p.name}</h3>
      <div className={`pocket-value ${remaining < 0 ? "negative" : ""}`}>
        <strong className="pocket-money"><FitMoney amount={Math.abs(remaining)} /></strong>
        <span>{remaining < 0 ? "over budget" : "left"}</span>
      </div>
      <div className="progress">
        <i
          style={{
            width: `${Math.min(100, percent)}%`,
            background: remaining < 0 ? "#c64f60" : p.color,
          }}
        />
      </div>
      <div className="pocket-card-bottom">
        <span>{money(p.spent)} spent</span>
        <span>{percent}%</span>
      </div>
    </button>
  );
}
export function TransactionList({
  transactions,
  pockets,
  onEdit,
  compactView = false,
  groupDates = false,
}: {
  transactions: Transaction[];
  pockets: Pocket[];
  onEdit: (t: Transaction) => void;
  compactView?: boolean;
  groupDates?: boolean;
}) {
  if (!transactions.length)
    return (
      <Empty
        title="A clean slate"
        detail="Your transactions will appear here."
      />
    );
  return (
    <div className={`transaction-list ${compactView ? "compact" : ""}`}>
      {transactions.map((t, index) => {
        const p = pockets.find((p) => p.id === t.pocketId);
        return (
          <div className="transaction-group-entry" key={t.id}>
          {groupDates && (index === 0 || transactions[index - 1].date !== t.date) && <h3 className="transaction-date-heading">{new Date(`${t.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h3>}
          <button
            className="transaction-row"
            onClick={() => onEdit(t)}
            aria-label={`Edit ${t.name}`}
          >
            <PocketIcon
              name={t.type === "income" ? "income" : p?.icon || "home"}
              color={t.type === "income" ? "#15786e" : p?.color || "#888"}
            />
            <span className="transaction-description">
              <strong>
                {t.name}
                {t.verified && (
                  <Check
                    size={13}
                    className="verified"
                    aria-label="Statement checked"
                  />
                )}
              </strong>
              <span>
                {t.kind === "account_transfer" ? "Account transfer" : t.kind === "opening_balance" ? "Opening balance" : t.kind === "card_payment" ? "Card payment" : t.kind === "reimbursement" ? "Repaid by friend" : t.type === "income" ? "Income" : p?.name || "Unassigned"}{" "}
                <span className="dot">·</span> {t.account}
              </span>
            </span>
            <span className="transaction-date">
              {new Date(`${t.date}T12:00:00`).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              })}
            </span>
            <span
              className={`transaction-amount ${t.type === "income" ? "positive" : ""}`}
            >
              {t.type === "income" ? "+" : "−"}
              {money(isSpending(t) ? personalAmount(t) : t.amount)}
              {t.split && <small>of {money(t.amount)} paid</small>}
              <small>
                {new Date(`${t.date}T12:00:00`).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                })}
              </small>
            </span>
            <ChevronRight className="row-chevron" size={15} />
          </button>
          </div>
        );
      })}
    </div>
  );
}
export function FlowChart({
  transactions,
  month,
}: {
  transactions: Transaction[];
  month: string;
}) {
  const days = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0,
  ).getDate();
  const weekly = Array.from({ length: Math.ceil(days / 7) }, (_, i) => ({
    income: transactions
      .filter(
        (t) =>
          isIncome(t) &&
          Math.min(4, Math.floor((Number(t.date.slice(-2)) - 1) / 7)) === i,
      )
      .reduce((s, t) => s + t.amount, 0),
    expense: transactions
      .filter(
        (t) =>
          isSpending(t) &&
          Math.min(4, Math.floor((Number(t.date.slice(-2)) - 1) / 7)) === i,
      )
      .reduce((s, t) => s + personalAmount(t), 0),
  }));
  const max = Math.max(100000, ...weekly.flatMap((w) => [w.income, w.expense]));
  return (
    <div className="flow-chart">
      <div className="chart-scale">
        {[1, 0.75, 0.5, 0.25, 0].map((n) => (
          <span key={n}>{compact(max * n)}</span>
        ))}
      </div>
      <div className="plot">
        <div className="grid-lines">
          {[0, 1, 2, 3, 4].map((n) => (
            <i key={n} />
          ))}
        </div>
        <div className="bar-groups">
          {weekly.map((w, i) => (
            <div className="bar-group" key={i}>
              <div className="bars">
                <div
                  className="chart-bar income-bar"
                  style={{ height: `${(w.income / max) * 100}%` }}
                  title={`Week ${i + 1} income: ${money(w.income)}`}
                >
                  <span>{money(w.income)}</span>
                </div>
                <div
                  className="chart-bar expense-bar"
                  style={{ height: `${(w.expense / max) * 100}%` }}
                  title={`Week ${i + 1} expenses: ${money(w.expense)}`}
                >
                  <span>{money(w.expense)}</span>
                </div>
              </div>
              <label>
                {i * 7 + 1}–{Math.min(days, (i + 1) * 7)}
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
export function SpendingRing({
  pockets,
  total,
}: {
  pockets: (Pocket & { spent: number })[];
  total: number;
}) {
  let offset = 0;
  const parts = pockets
    .filter((p) => p.spent > 0)
    .sort((a, b) => b.spent - a.spent);
  return (
    <div className="spending-content">
      <div className="donut">
        <svg
          viewBox="0 0 180 180"
          role="img"
          aria-label={`Spending by pocket, ${money(total)} total`}
        >
          <circle
            cx="90"
            cy="90"
            r="72"
            fill="none"
            stroke="#eef1f3"
            strokeWidth="21"
          />
          {parts.map((p) => {
            const size = (p.spent / Math.max(1, total)) * 452.39;
            const start = offset;
            offset += size;
            return (
              <circle
                key={p.id}
                cx="90"
                cy="90"
                r="72"
                fill="none"
                stroke={p.color}
                strokeWidth="21"
                strokeDasharray={`${Math.max(0, size - 4)} ${452.39 - Math.max(0, size - 4)}`}
                strokeDashoffset={-start}
                transform="rotate(-90 90 90)"
              />
            );
          })}
        </svg>
        <div className="donut-center">
          <span>Total spent</span>
          <strong>{compact(total)}</strong>
          <small>IDR this month</small>
        </div>
      </div>
      <div className="ring-legend">
        {parts.length ? (
          parts.slice(0, 5).map((p) => (
            <div key={p.id}>
              <span className="legend-dot" style={{ background: p.color }} />
              <span>{p.name}</span>
              <strong>{Math.round((p.spent / total) * 100)}%</strong>
            </div>
          ))
        ) : (
          <p className="muted">No spending yet.</p>
        )}
        {parts.length > 5 && (
          <small className="muted">+ {parts.length - 5} other pockets</small>
        )}
      </div>
    </div>
  );
}
export function DirectionIcon({ income }: { income: boolean }) {
  return (
    <span className={`direction-icon ${income ? "in" : "out"}`}>
      {income ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
    </span>
  );
}
