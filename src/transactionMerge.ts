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
const withoutTransactions = (data: Data) => ({ ...data, transactions: [] });

export function mergeTransactionSnapshots(base: Data | null, local: Data, remote: Data, tombstones: ReadonlySet<string> = new Set()): { data: Data | null; conflicts: string[] } {
  if (!base) return { data: null, conflicts: ["workspace"] };
  const baseRows = new Map(base.transactions.map((row) => [row.id, row]));
  const localRows = new Map(local.transactions.map((row) => [row.id, row]));
  const remoteRows = new Map(remote.transactions.map((row) => [row.id, row]));
  const merged = new Map<string, Transaction>();
  const conflicts: string[] = [];
  const ids = new Set([...baseRows.keys(), ...localRows.keys(), ...remoteRows.keys(), ...tombstones]);
  for (const id of ids) {
    const before = baseRows.get(id), onPhone = localRows.get(id), inCloud = remoteRows.get(id);
    if (tombstones.has(id) && onPhone) { conflicts.push(id); continue; }
    const localChanged = tombstones.has(id) || !sameRow(onPhone, before);
    const remoteChanged = !sameRow(inCloud, before);
    let chosen: Transaction | undefined;
    if (!localChanged) chosen = inCloud;
    else if (!remoteChanged || sameRow(onPhone, inCloud)) chosen = onPhone;
    else { conflicts.push(id); continue; }
    if (chosen) merged.set(id, chosen);
  }
  const baseMeta = withoutTransactions(base), localMeta = withoutTransactions(local), remoteMeta = withoutTransactions(remote);
  const localMetaChanged = !same(localMeta, baseMeta), remoteMetaChanged = !same(remoteMeta, baseMeta);
  if (localMetaChanged && remoteMetaChanged && !same(localMeta, remoteMeta)) conflicts.push("workspace");
  if (conflicts.length) return { data: null, conflicts };
  const metadata = localMetaChanged ? localMeta : remoteMeta;
  const order = [...new Set([...local.transactions.map((row) => row.id), ...remote.transactions.map((row) => row.id)])];
  try {
    return { data: validateData({ ...metadata, transactions: order.flatMap((id) => merged.has(id) ? [merged.get(id)!] : []) }), conflicts: [] };
  } catch { return { data: null, conflicts: ["workspace"] }; }
}
