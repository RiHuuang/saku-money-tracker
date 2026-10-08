// Compare the current private production backup with the pre-install phone export.
// Never print account identifiers or financial records.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';

const recovery = path.resolve('output/phone-recovery-2026-10-08T02-59-42-964Z');
const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function run(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Production read failed (${args[0]} ${args[1]})`);
  return result.stdout;
}

async function objectBytes(key) {
  if (!/^ledgers\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(key)) throw new Error('Unexpected backup path');
  const file = path.join(recovery, `.verify-${crypto.randomUUID()}`);
  try {
    run(['r2', 'object', 'get', `saku-data/${key}`, '--file', file, '--remote', '--config', 'wrangler.jsonc']);
    return await fs.readFile(file);
  } finally {
    await fs.rm(file, { force: true });
  }
}

async function snapshot(key) {
  let bytes = await objectBytes(key);
  if (key.endsWith('.manifest.json')) {
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(manifest.parts) || !Number.isSafeInteger(manifest.size) || manifest.size > 10_000_000) throw new Error('Invalid backup manifest');
    const parts = [];
    for (const part of manifest.parts) {
      const chunk = await objectBytes(part.key);
      if (chunk.length !== part.size) throw new Error('Backup part size differs');
      parts.push(chunk);
    }
    bytes = Buffer.concat(parts);
    if (bytes.length !== manifest.size) throw new Error('Backup size differs');
    if (manifest.encoding === 'gzip') bytes = gunzipSync(bytes);
    else if (manifest.encoding !== 'identity') throw new Error('Invalid backup encoding');
  } else if (key.endsWith('.gz')) bytes = gunzipSync(bytes);
  return JSON.parse(bytes.toString('utf8'));
}

try {
  const originalBytes = await fs.readFile(path.join(recovery, 'ledger.json'));
  const original = JSON.parse(originalBytes.toString('utf8'));
  const manifest = JSON.parse(await fs.readFile(path.join(recovery, 'manifest.json'), 'utf8'));
  if (sha256(originalBytes) !== manifest.sha256) throw new Error('Phone recovery checksum differs');
  const response = run(['d1', 'execute', 'saku', '--remote', '--config', 'wrangler.jsonc',
    '--command', 'SELECT uid,revision,snapshot_path,data FROM users', '--json']);
  const rows = JSON.parse(response)[0].results;
  const matches = rows.filter((row) => sha256(`saku-ledger-v3-${row.uid}`).slice(0, 12) === manifest.userKeySha256);
  if (matches.length !== 1) throw new Error('Expected one matching production account');
  const row = matches[0];
  const current = await snapshot(row.snapshot_path);
  const metadata = JSON.parse(row.data);
  const testPresent = current.transactions.some((tx) => JSON.stringify(tx).includes('SakuWidgetSyncTest'));
  const originalById = new Map(original.transactions.map((tx) => [tx.id, tx]));
  const currentById = new Map(current.transactions.map((tx) => [tx.id, tx]));
  const retainedOriginal = original.transactions.filter((tx) => currentById.has(tx.id)).length;
  const changedOriginal = original.transactions.filter((tx) => currentById.has(tx.id) && !isDeepStrictEqual(tx, currentById.get(tx.id))).length;
  const newTransactions = current.transactions.filter((tx) => !originalById.has(tx.id)).length;
  console.log(JSON.stringify({
    revision: row.revision,
    transactions: current.transactions.length,
    pockets: current.pockets.length,
    testPresent,
    retainedOriginal,
    changedOriginal,
    newTransactions,
    transactionsMatchOriginal: isDeepStrictEqual(current.transactions, original.transactions),
    pocketsMatchOriginal: isDeepStrictEqual(current.pockets, original.pockets),
    sheetPending: Boolean(metadata.sheetPending),
  }));
} catch (error) {
  console.error(`Production ledger verification failed: ${error.message}`);
  process.exitCode = 1;
}
