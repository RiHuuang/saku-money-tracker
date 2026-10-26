import { type Data, type Transaction, validateData } from "./domain";

function content(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(content).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${content(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

const same = (left: unknown, right: unknown) => content(left) === content(right);
// Editors write `verified: false` where older rows omit it; both mean unverified.
const comparable = (row: Transaction | undefined) => row?.verified === false ? { ...row, verified: undefined } : row;
const sameRow = (left: Transaction | undefined, right: Transaction | undefined) => same(comparable(left), comparable(right));

type Item = unknown;
/** Lists merge item by item: records by `id` or `key`, plain values by value. */
const itemKey = (item: Item) => item && typeof item === "object"
  ? (item as { id?: unknown }).id ?? (item as { key?: unknown }).key
  : item;
const keyed = (items: unknown) => Array.isArray(items) && items.every((item) => ["string", "number"].includes(typeof itemKey(item)));
const updatedAt = (item: Item) => item && typeof item === "object" && typeof (item as { updatedAt?: unknown }).updatedAt === "string" ? (item as { updatedAt: string }).updatedAt : undefined;

function mergeItems<T>(base: readonly T[], local: readonly T[], remote: readonly T[], equal: (a: T | undefined, b: T | undefined) => boolean, deleted: ReadonlySet<string> = new Set()) {
  const byKey = (items: readonly T[]) => new Map(items.map((item) => [String(itemKey(item)), item]));
  const before = byKey(base), here = byKey(local), there = byKey(remote);
  const merged = new Map<string, T>(), conflicts: string[] = [];
  for (const key of new Set([...before.keys(), ...here.keys(), ...there.keys(), ...deleted])) {
    const was = before.get(key), mine = here.get(key), theirs = there.get(key);
    if (deleted.has(key) && mine) { conflicts.push(key); continue; }
    const localChanged = deleted.has(key) || !equal(mine, was), remoteChanged = !equal(theirs, was);
    let chosen: T | undefined;
    if (!localChanged) chosen = theirs;
    else if (!remoteChanged || equal(mine, theirs)) chosen = mine;
    // Learned rules carry a timestamp; the newer one wins instead of asking.
    else if (mine && theirs && updatedAt(mine) && updatedAt(theirs)) chosen = updatedAt(mine)! >= updatedAt(theirs)! ? mine : theirs;
    else { conflicts.push(key); continue; }
    if (chosen !== undefined) merged.set(key, chosen);
  }
  const order = [...new Set([...local.map((item) => String(itemKey(item))), ...remote.map((item) => String(itemKey(item)))])];
  return { items: order.flatMap((key) => merged.has(key) ? [merged.get(key)!] : []), conflicts };
}

export function mergeTransactionSnapshots(base: Data | null, local: Data, remote: Data, tombstones: ReadonlySet<string> = new Set()): { data: Data | null; conflicts: string[] } {
  if (!base) return { data: null, conflicts: ["workspace"] };
  const rows = mergeItems(base.transactions, local.transactions, remote.transactions, sameRow, tombstones);
  const conflicts = [...rows.conflicts];
  const metadata: Record<string, unknown> = {};
  const fields = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  fields.delete("transactions");
  for (const field of fields) {
    const was = (base as Record<string, unknown>)[field], mine = (local as Record<string, unknown>)[field], theirs = (remote as Record<string, unknown>)[field];
    if (same(mine, was)) metadata[field] = theirs;
    else if (same(theirs, was) || same(mine, theirs)) metadata[field] = mine;
    else if (keyed(was ?? []) && keyed(mine) && keyed(theirs)) {
      const merged = mergeItems((was ?? []) as Item[], mine as Item[], theirs as Item[], same);
      if (merged.conflicts.length) conflicts.push("workspace");
      metadata[field] = merged.items;
    } else conflicts.push("workspace");
  }
  if (conflicts.length) return { data: null, conflicts: [...new Set(conflicts)] };
  try {
    return { data: validateData({ ...metadata, transactions: rows.items } as Data), conflicts: [] };
  } catch { return { data: null, conflicts: ["workspace"] }; }
}
