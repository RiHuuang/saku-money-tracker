import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { localeTag, t as translate } from "./i18n";
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
  Search,
  MoreHorizontal,
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
  const shown = digits ? Number(digits).toLocaleString("id-ID") : "";
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
export type ChoiceOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  searchText?: string;
};

export function ChoiceField({
  value,
  options,
  onValueChange,
  label,
  placeholder = translate("chooseOption"),
  disabled = false,
  searchable,
  hideLabel = false,
  className = "",
}: {
  value: string;
  options: ChoiceOption[];
  onValueChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  hideLabel?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId(), selected = options.find((option) => option.value === value);
  const shouldSearch = searchable ?? options.length > 8;
  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("id-ID");
    if (!needle) return options;
    return options.filter((option) => `${option.label} ${option.description || ""} ${option.searchText || ""}`.toLocaleLowerCase("id-ID").includes(needle));
  }, [options, query]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const close = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); };
  const sheet = open ? createPortal(
    <dialog
      ref={dialog}
      className="choice-sheet"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === dialog.current) close(); }}
    >
      <div className="choice-sheet-shell">
        <div className="choice-sheet-handle" aria-hidden="true" />
        <header className="choice-sheet-header">
          <div><span>{translate("chooseOne")}</span><h2 id={titleId}>{label}</h2></div>
          <IconButton label="Close choices" onClick={close}><X size={19} /></IconButton>
        </header>
        {shouldSearch && <label className="choice-sheet-search"><Search size={17} aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLocaleLowerCase("en-US")}`} /></label>}
        <div className="choice-sheet-list" role="listbox" aria-label={label} tabIndex={-1} onKeyDown={(event) => {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "ArrowDown" ? Math.min(buttons.length - 1, index + 1) : event.key === "ArrowUp" ? Math.max(0, index - 1) : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
        }}>
          {visibleOptions.map((option) => <button
            type="button"
            role="option"
            aria-selected={option.value === value}
            className={option.value === value ? "selected" : ""}
            disabled={option.disabled}
            key={option.value}
            onClick={() => { onValueChange(option.value); close(); }}
          ><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>{option.value === value && <Check size={19} aria-hidden="true" />}</button>)}
          {!visibleOptions.length && <p className="choice-sheet-empty">{translate("noMatchingChoices")}</p>}
        </div>
      </div>
    </dialog>,
    document.body,
  ) : null;
  return <span className={`choice-picker ${className}`.trim()}>
    {!hideLabel && <span className="choice-label">{label}</span>}
    <button ref={trigger} type="button" className="choice-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
      <span><strong>{selected?.label || placeholder}</strong>{selected?.description && <small>{selected.description}</small>}</span><ChevronDown size={17} aria-hidden="true" />
    </button>
    {sheet}
  </span>;
}

export function SegmentedChoice({ value, options, onValueChange, label, disabled = false, compact = false }: {
  value: string;
  options: ChoiceOption[];
  onValueChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  return <div className={`adaptive-segmented-field${compact ? " compact" : ""}`}>
    <span className="choice-label">{label}</span>
    <div className="adaptive-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => <button type="button" role="radio" aria-checked={option.value === value} className={option.value === value ? "selected" : ""} disabled={disabled || option.disabled} key={option.value} onClick={() => onValueChange(option.value)}><span>{option.label}</span>{option.description && <small>{option.description}</small>}</button>)}
    </div>
  </div>;
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
  onEdit,
  onDelete,
}: {
  p: Pocket & { limit: number; spent: number };
  onClick: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const cancelHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };
  useEffect(() => cancelHold, []);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => { if (!shell.current?.contains(event.target as Node)) setMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);
  const remaining = p.limit - p.spent,
    percent = p.limit
      ? Math.round((p.spent / p.limit) * 100)
      : p.spent
        ? 100
        : 0;
  return (
    <div ref={shell} className={`pocket-card-shell ${menuOpen ? "menu-open" : ""}`} style={{ "--pocket-color": p.color } as CSSProperties}>
    <button className="pocket-card" onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onClick(); }}
      onPointerDown={(event) => { if (event.pointerType === "mouse" && event.button !== 0) return; cancelHold(); suppressClick.current = false; hold.current = setTimeout(() => { suppressClick.current = true; setMenuOpen(true); }, 500); }}
      onPointerUp={cancelHold} onPointerCancel={cancelHold} onPointerLeave={cancelHold}
      onContextMenu={(event) => { event.preventDefault(); cancelHold(); setMenuOpen(true); }}
      aria-label={`View ${p.name} pocket activity`}>
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
        <span>{money(p.spent)} {translate("spent")}</span>
        <span>{percent}%</span>
      </div>
    </button>
    {onEdit && <div className="pocket-card-actions"><button type="button" className="pocket-menu-trigger" aria-label={`Options for ${p.name}`} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={20} /></button>
      {menuOpen && <div className="pocket-menu"><button type="button" onClick={() => { setMenuOpen(false); onEdit(); }}>{translate("editPocket")}</button><button type="button" onClick={() => { setMenuOpen(false); (onDelete || onEdit)(); }}>{translate("deletePocketMenu")}</button></div>}
    </div>}
    </div>
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
        detail={translate("transactionsAppearHere")}
      />
    );
  return (
    <div className={`transaction-list ${compactView ? "compact" : ""}`}>
      {transactions.map((t, index) => {
        const p = pockets.find((p) => p.id === t.pocketId);
        return (
          <div className="transaction-group-entry" key={t.id}>
          {groupDates && (index === 0 || transactions[index - 1].date !== t.date) && <h3 className="transaction-date-heading">{new Date(`${t.date}T12:00:00`).toLocaleDateString(localeTag(), { weekday: "long", day: "numeric", month: "long" })}</h3>}
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
                {t.kind === "account_transfer" ? translate("accountTransfer") : t.kind === "balance_adjustment" ? translate("balanceAdjustmentLabel") : t.kind === "opening_balance" ? translate("openingBalance") : t.kind === "card_payment" ? translate("cardPayment") : t.kind === "reimbursement" ? translate("repaidByFriend") : t.type === "income" ? translate("income") : p?.name || translate("unassigned")}{" "}
                <span className="dot">·</span> {t.account}
              </span>
            </span>
            <span className="transaction-date">
              {new Date(`${t.date}T12:00:00`).toLocaleDateString(localeTag(), {
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
                {new Date(`${t.date}T12:00:00`).toLocaleDateString(localeTag(), {
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
  const unassigned = Math.max(0, total - parts.reduce((sum, pocket) => sum + pocket.spent, 0));
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
          <span>{translate("totalSpent")}</span>
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
          total === 0 && <p className="muted">{translate("noSpendingYet")}</p>
        )}
        {unassigned > 0 && <div><span className="legend-dot unassigned-dot" /><span>{translate("unassignedSpending")}</span><strong>{Math.round((unassigned / total) * 100)}%</strong></div>}
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
