import { validateData, type Data, type ReconciliationBatch, type ReconciliationChange } from "./domain";

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
};
const diff = <T,>(before: T[], after: T[], key: (item: T) => string): ReconciliationChange[] => {
  const a = new Map(before.map(item => [key(item), canonical(item)])), b = new Map(after.map(item => [key(item), canonical(item)]));
  return [...new Set([...a.keys(), ...b.keys()])].filter(id => a.get(id) !== b.get(id)).map(id => ({ id, ...(a.has(id) ? { before: a.get(id) } : {}), ...(b.has(id) ? { after: b.get(id) } : {}) }));
};
/** Attach the reversible ledger/rule diff to the same write as its financial effect. */
export function recordReconciliationBatch(before: Data, after: Data, meta: Pick<ReconciliationBatch, "id" | "createdAt" | "evidence">): Data {
  if (before.reconciliationBatches?.some(batch => batch.id === meta.id)) throw new Error("This monthly check was already saved");
  if ((before.reconciliationBatches?.length || 0) >= 100) throw new Error("Reconciliation history is full; export a backup before continuing");
  const batch: ReconciliationBatch = { ...meta, transactions: diff(before.transactions, after.transactions, item => item.id), merchantRules: diff(before.merchantRules, after.merchantRules, item => item.key), balanceObservations: diff(before.statementBalanceObservations || [], after.statementBalanceObservations || [], item => item.id), accountMappings: diff(before.statementAccountMappings || [], after.statementAccountMappings || [], item => item.id) };
  return validateData({ ...after, reconciliationBatches: [...(before.reconciliationBatches || []), batch] });
}

/** Reject the whole Undo when an owned record changed; never overwrite later edits. */
export function undoReconciliationBatch(data: Data, id: string): Data {
  const batch = data.reconciliationBatches?.find(item => item.id === id);
  if (!batch || batch.undone) throw new Error("This monthly check cannot be undone again");
  const revert = <T,>(items: T[], changes: ReconciliationChange[], key: (item: T) => string): T[] => {
    const current = new Map(items.map(item => [key(item), item]));
    for (const change of changes) {
      const item = current.get(change.id);
      if ((item === undefined ? undefined : canonical(item)) !== change.after) throw new Error("A monthly check entry changed afterwards; review it before Undo");
    }
    for (const change of changes) {
      if (change.before === undefined) current.delete(change.id);
      else current.set(change.id, JSON.parse(change.before));
    }
    return [...current.values()];
  };
  return validateData({ ...data,
    ...(batch.balanceObservations?.length ? { statementBalanceObservations: revert(data.statementBalanceObservations || [], batch.balanceObservations, item => item.id) } : {}),
    ...(batch.accountMappings?.length ? { statementAccountMappings: revert(data.statementAccountMappings || [], batch.accountMappings, item => item.id) } : {}),
    transactions: revert(data.transactions, batch.transactions, item => item.id), merchantRules: revert(data.merchantRules, batch.merchantRules, item => item.key), reconciliationBatches: data.reconciliationBatches!.map(item => item.id === id ? { ...item, undone: true } : item) });
}
