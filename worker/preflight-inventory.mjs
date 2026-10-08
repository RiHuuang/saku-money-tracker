// Read-only comparison of the current staging snapshots with a verified GCP export.
// Prints counts and conflicts only; no user identifiers, tokens, or ledger entries.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { validateSnapshot } from '../server/src/core.js';

const archive = path.resolve(process.env.SAKU_MIGRATION_DIR || 'output/cloudflare-migration');
const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function cli(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Read-only Wrangler command failed: ${args[0]} ${args[1]}`);
  return result.stdout;
}

function safeKey(key) {
  if (!/^ledgers\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+$/.test(key) || key.includes('..')) {
    throw new Error('Unexpected snapshot object key');
  }
  return key;
}

async function stageObject(key, tempDir) {
  const target = path.join(tempDir, crypto.randomUUID());
  cli(['r2', 'object', 'get', `saku-stage-data/${safeKey(key)}`, '--file', target, '--remote']);
  return fs.readFile(target);
}

async function stageSnapshot(snapshotPath, tempDir) {
  const first = await stageObject(snapshotPath, tempDir);
  if (snapshotPath.endsWith('.gz')) return gunzipSync(first);
  if (!snapshotPath.endsWith('.manifest.json')) return first;
  const manifest = JSON.parse(first.toString('utf8'));
  if (!Array.isArray(manifest.parts) || !Number.isSafeInteger(manifest.size) || manifest.size > 10_000_000) {
    throw new Error('Invalid staging snapshot manifest');
  }
  const chunks = [];
  for (const part of manifest.parts) {
    const bytes = await stageObject(part.key, tempDir);
    if (bytes.length !== part.size) throw new Error('Staging snapshot part size mismatch');
    chunks.push(bytes);
  }
  const joined = Buffer.concat(chunks);
  if (joined.length !== manifest.size) throw new Error('Staging snapshot size mismatch');
  return manifest.encoding === 'gzip' ? gunzipSync(joined) : joined;
}

function compareLedger(stage, gcp) {
  const oldTransactions = new Map(gcp.transactions.map((row) => [row.id, row]));
  const newTransactions = new Map(stage.transactions.map((row) => [row.id, row]));
  const gcpOnly = [...oldTransactions.keys()].filter((id) => !newTransactions.has(id)).length;
  const changedShared = [...oldTransactions].filter(([id, row]) => newTransactions.has(id) && !isDeepStrictEqual(row, newTransactions.get(id))).length;
  const oldPockets = new Map(gcp.pockets.map((row) => [row.id, row]));
  const newPockets = new Map(stage.pockets.map((row) => [row.id, row]));
  const gcpOnlyPockets = [...oldPockets.keys()].filter((id) => !newPockets.has(id)).length;
  const changedSharedPockets = [...oldPockets].filter(([id, row]) => newPockets.has(id) && !isDeepStrictEqual(row, newPockets.get(id))).length;
  return { gcpOnlyTransactions: gcpOnly, changedSharedTransactions: changedShared, gcpOnlyPockets, changedSharedPockets };
}

const manifest = JSON.parse(await fs.readFile(path.join(archive, 'manifest.json'), 'utf8'));
const gcpUsers = new Map(manifest.users.map((user) => [user.uid, user.data]));
const stageRows = JSON.parse(cli(['d1', 'execute', 'saku-stage', '--remote', '--config', 'wrangler.stage.jsonc', '--command', 'SELECT uid,data,revision,snapshot_path FROM users', '--json']))[0].results;
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'saku-stage-preflight-'));
try {
  const report = [];
  for (const row of stageRows) {
    if (!row.snapshot_path) throw new Error('Staging account has no snapshot');
    const stageBytes = await stageSnapshot(row.snapshot_path, tempDir);
    const stage = JSON.parse(stageBytes.toString('utf8'));
    validateSnapshot(stage);
    const old = gcpUsers.get(row.uid);
    let sourceComparison = null;
    if (old) {
      const source = await fs.readFile(path.join(archive, 'objects', ...safeKey(old.snapshotPath).split('/')));
      const gcpBytes = old.snapshotPath.endsWith('.gz') ? gunzipSync(source) : source;
      const gcp = JSON.parse(gcpBytes.toString('utf8'));
      validateSnapshot(gcp);
      sourceComparison = {
        gcpRevision: old.revision,
        gcpTransactions: gcp.transactions.length,
        gcpPockets: gcp.pockets.length,
        gcpSha256: sha256(gcpBytes),
        sameOriginalSheet: JSON.parse(row.data).spreadsheetId === old.spreadsheetId,
        ...compareLedger(stage, gcp),
      };
    }
    report.push({
      source: old ? 'matching-gcp-account' : 'staging-only-account',
      googleIdFormat: /^\d{20,30}$/.test(row.uid),
      revision: row.revision,
      transactions: stage.transactions.length,
      pockets: stage.pockets.length,
      demo: stage.demo,
      onlyOpeningBalances: stage.transactions.every((item) => item.kind === 'opening_balance'),
      sha256: sha256(stageBytes),
      sourceComparison,
    });
  }
  const missingFromStage = [...gcpUsers.keys()].filter((uid) => !stageRows.some((row) => row.uid === uid)).length;
  console.log(JSON.stringify({ gcpAccounts: gcpUsers.size, stagingAccounts: stageRows.length, gcpAccountsMissingFromStage: missingFromStage, accounts: report }, null, 2));
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
