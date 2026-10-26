import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import { type Data, emptyData, validateData } from "./domain";

const sqlite = new SQLiteConnection(CapacitorSQLite);
let connection: Promise<SQLiteDBConnection> | undefined;
let pending: Promise<unknown> = Promise.resolve();

function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const next = pending.then(work, work);
  pending = next.catch(() => {});
  return next;
}

async function database() {
  connection ||= (async () => {
    const existing = await sqlite.isConnection("saku-ledger", false);
    const db = existing.result
      ? await sqlite.retrieveConnection("saku-ledger", false)
      : await sqlite.createConnection("saku-ledger", false, "no-encryption", 1, false);
    if (!(await db.isDBOpen()).result) await db.open();
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ledger_meta (
        user_id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        synced_revision INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS ledger_transaction (
        user_id TEXT NOT NULL,
        transaction_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (user_id, transaction_id)
      );
      CREATE INDEX IF NOT EXISTS ledger_transaction_order
        ON ledger_transaction (user_id, position);
    `);
    return db;
  })().catch((error) => { connection = undefined; throw error; });
  return connection;
}

function metadata(data: Data) {
  const { transactions: _transactions, ...rest } = data;
  return JSON.stringify(rest);
}

async function read(db: SQLiteDBConnection, userId: string): Promise<{ data: Data; revision: number; syncedRevision: number } | null> {
  const head = (await db.query("SELECT data_json, revision, synced_revision FROM ledger_meta WHERE user_id = ?", [userId])).values?.[0];
  if (!head) return null;
  const rows = (await db.query("SELECT payload FROM ledger_transaction WHERE user_id = ? ORDER BY position", [userId])).values || [];
  return {
    data: validateData({ ...JSON.parse(head.data_json), transactions: rows.map((row) => JSON.parse(row.payload)) }),
    revision: Number(head.revision),
    syncedRevision: Number(head.synced_revision),
  };
}

async function write(db: SQLiteDBConnection, userId: string, data: Data, expectedRevision: number | null, verify = false) {
  const valid = validateData(data);
  await db.beginTransaction();
  try {
    const current = await read(db, userId);
    if (expectedRevision !== null && current?.revision !== expectedRevision) throw new Error("Ledger changed on this device. Reopen Saku and try again.");
    const oldRows = new Map(current?.data.transactions.map((row, index) => [row.id, { index, json: JSON.stringify(row) }]) || []);
    const newIds = new Set(valid.transactions.map((row) => row.id));
    let changed = !current || metadata(current.data) !== metadata(valid);
    for (const id of oldRows.keys()) if (!newIds.has(id)) {
      await db.run("DELETE FROM ledger_transaction WHERE user_id = ? AND transaction_id = ?", [userId, id], false);
      changed = true;
    }
    for (const [index, row] of valid.transactions.entries()) {
      const json = JSON.stringify(row), old = oldRows.get(row.id);
      if (old?.index === index && old.json === json) continue;
      await db.run(`INSERT INTO ledger_transaction (user_id, transaction_id, position, payload)
        VALUES (?, ?, ?, ?) ON CONFLICT(user_id, transaction_id)
        DO UPDATE SET position = excluded.position, payload = excluded.payload`, [userId, row.id, index, json], false);
      changed = true;
    }
    const revision = (current?.revision || 0) + (changed ? 1 : 0);
    if (changed) await db.run(`INSERT INTO ledger_meta (user_id, data_json, revision)
      VALUES (?, ?, ?) ON CONFLICT(user_id)
      DO UPDATE SET data_json = excluded.data_json, revision = excluded.revision`, [userId, metadata(valid), revision], false);
    if (verify && JSON.stringify((await read(db, userId))?.data) !== JSON.stringify(valid)) throw new Error("Ledger migration did not verify");
    await db.commitTransaction();
    return revision;
  } catch (error) {
    await db.rollbackTransaction();
    throw error;
  }
}

export function loadNativeLedger(userId: string, legacyJson: string | null, legacySynced: boolean) {
  return exclusive(async () => {
    const db = await database();
    const current = await read(db, userId);
    if (current) return current;
    const source = legacyJson ? validateData(JSON.parse(legacyJson)) : emptyData();
    await write(db, userId, source, null, true);
    if (legacySynced) await db.run("UPDATE ledger_meta SET synced_revision = revision WHERE user_id = ?", [userId]);
    return (await read(db, userId))!;
  });
}

export function saveNativeLedger(userId: string, data: Data, expectedRevision: number) {
  return exclusive(async () => write(await database(), userId, data, expectedRevision));
}

export function hasNativeLedger(userId: string) {
  return exclusive(async () => Boolean((await (await database()).query("SELECT 1 FROM ledger_meta WHERE user_id = ?", [userId])).values?.length));
}

export function acknowledgeNativeLedger(userId: string, snapshot?: Data) {
  return exclusive(async () => {
    const db = await database();
    const current = await read(db, userId);
    if (!current || snapshot && JSON.stringify(current.data) !== JSON.stringify(validateData(snapshot))) return false;
    const result = await db.run("UPDATE ledger_meta SET synced_revision = revision WHERE user_id = ? AND revision = ?", [userId, current.revision]);
    return Boolean(result.changes?.changes);
  });
}

export function removeNativeLedger(userId: string) {
  return exclusive(async () => {
    const db = await database();
    await db.beginTransaction();
    try {
      await db.run("DELETE FROM ledger_transaction WHERE user_id = ?", [userId], false);
      await db.run("DELETE FROM ledger_meta WHERE user_id = ?", [userId], false);
      await db.commitTransaction();
    } catch (error) {
      await db.rollbackTransaction();
      throw error;
    }
  });
}
