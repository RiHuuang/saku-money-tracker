// Build a private, reviewable production import from verified GCP and staging archives.
// This script does not change either cloud service.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { validateSnapshot } from './src/core.js';

const gcpDir = path.resolve(process.env.SAKU_MIGRATION_DIR || 'output/cloudflare-migration');
const stageDir = path.resolve(process.env.SAKU_STAGE_ARCHIVE || 'output/cloudflare-stage-recovery');
const resultDir = path.resolve(process.env.SAKU_RECONCILED_DIR || 'output/cloudflare-reconciled');
const previousStageDir = path.resolve(process.env.SAKU_STAGE_PREVIOUS_ARCHIVE || 'output/cloudflare-stage-preflight-20261006');
const phoneDir = path.resolve(process.env.SAKU_PHONE_RECOVERY_DIR || 'output/phone-recovery-2026-10-08T02-59-42-964Z');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function objectPath(dir, key) {
  if (key.includes('..') || !/^(?:ledgers\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+|avatars\/[a-zA-Z0-9_-]+(?:\.webp|\/[a-zA-Z0-9_.-]+))$/.test(key)) {
    throw new Error('Unsafe recovery object key');
  }
  return path.join(dir, 'objects', ...key.split('/'));
}

async function readArchive(dir) {
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  for (const item of manifest.objects) {
    const bytes = await fs.readFile(objectPath(dir, item.key));
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw new Error('Recovery archive checksum mismatch');
  }
  return manifest;
}

async function ledger(dir, key) {
  let bytes = await fs.readFile(objectPath(dir, key));
  if (key.endsWith('.manifest.json')) {
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(manifest.parts) || !Number.isSafeInteger(manifest.size) || manifest.size > 10_000_000) throw new Error('Invalid backup manifest');
    const parts = [];
    for (const part of manifest.parts) {
      const chunk = await fs.readFile(objectPath(dir, part.key));
      if (chunk.length !== part.size) throw new Error('Backup part size mismatch');
      parts.push(chunk);
    }
    bytes = Buffer.concat(parts);
    if (bytes.length !== manifest.size) throw new Error('Backup size mismatch');
    if (manifest.encoding === 'gzip') bytes = gunzipSync(bytes);
    else if (manifest.encoding !== 'identity') throw new Error('Invalid backup encoding');
  } else if (key.endsWith('.gz')) bytes = gunzipSync(bytes);
  const data = JSON.parse(bytes.toString('utf8'));
  validateSnapshot(data);
  return { bytes, data };
}

function compareCollection(oldRows, newRows) {
  const key = (item) => item && typeof item === 'object' && typeof item.id === 'string' ? `id:${item.id}` : `value:${JSON.stringify(item)}`;
  const newer = new Map(newRows.map((item) => [key(item), item]));
  return oldRows.filter((item) => !newer.has(key(item)) || !isDeepStrictEqual(item, newer.get(key(item)))).length;
}

function oldSheetJob(uid, old) {
  if (!old.spreadsheetId || !old.googleRefreshToken) return null;
  return { uid, baseline_path: old.snapshotPath, baseline_revision: old.revision, target_path: null, target_revision: null, cursor: 0, total: 0, updated_at: Date.now() };
}

function snapshotContentType(key) {
  if (key.startsWith('avatars/')) return 'image/webp';
  if (key.endsWith('.manifest.json')) return 'application/json';
  if (key.endsWith('.gz')) return 'application/gzip';
  return 'application/octet-stream';
}

const gcp = await readArchive(gcpDir);
const stage = await readArchive(stageDir);
const previousStage = await readArchive(previousStageDir);
const gcpUsers = new Map(gcp.users.map((item) => [item.uid, item.data]));
const stageUsers = new Map(stage.users.map((item) => [item.uid, item]));
if (gcpUsers.size !== gcp.users.length || stageUsers.size !== stage.users.length) throw new Error('Duplicate account IDs in recovery archives');
if ([...gcpUsers.keys(), ...stageUsers.keys()].some((uid) => !/^\d{20,30}$/.test(uid))) throw new Error('Unexpected test account in recovery archives');

const users = [];
const sheetJobs = [];
const comparisons = [];
let stageOnly = 0;
for (const [uid, old] of gcpUsers) {
  const latest = stageUsers.get(uid);
  if (!latest) {
    users.push({ uid, data: old });
    const job = oldSheetJob(uid, old);
    if (job && old.sheetPending) sheetJobs.push(job);
    comparisons.push({ kind: 'gcp-only', transactions: (await ledger(gcpDir, old.snapshotPath)).data.transactions.length });
    continue;
  }
  const previous = await ledger(gcpDir, old.snapshotPath);
  const current = await ledger(stageDir, latest.snapshot_path);
  const collections = ['accounts', 'pockets', 'transactions', 'creditCards', 'recurring', 'favorites', 'pocketTransfers', 'existingInstallments'];
  const conflicts = collections.filter((field) => compareCollection(previous.data[field], current.data[field]));
  let phoneFavoriteReplacement = false;
  if (conflicts.length === 1 && conflicts[0] === 'favorites') {
    const prior = previousStage.users.find((user) => user.uid === uid);
    if (!prior) throw new Error('Previous staging account missing for favorite reconciliation');
    const priorLedger = await ledger(previousStageDir, prior.snapshot_path);
    const phoneManifest = JSON.parse(await fs.readFile(path.join(phoneDir, 'manifest.json'), 'utf8'));
    const phoneBytes = await fs.readFile(path.join(phoneDir, 'ledger.json'));
    if (sha256(phoneBytes) !== phoneManifest.sha256 || sha256(current.bytes) !== phoneManifest.sha256) throw new Error('Current staging ledger does not exactly match the saved phone ledger');
    const phone = JSON.parse(phoneBytes.toString('utf8'));
    validateSnapshot(phone);
    if (!isDeepStrictEqual(phone, current.data) || !isDeepStrictEqual(previous.data.favorites, priorLedger.data.favorites)
      || previous.data.favorites.length !== 1 || current.data.favorites.length !== 1
      || isDeepStrictEqual(previous.data.favorites, current.data.favorites)) {
      throw new Error('Favorite replacement does not match the older staging and current phone evidence');
    }
    phoneFavoriteReplacement = true;
  } else if (conflicts.length) throw new Error(`GCP contains missing or changed ${conflicts.join(', ')}; reconcile before import`);
  const stageData = JSON.parse(latest.data);
  const merged = { ...old, name: stageData.name || old.name, revision: Math.max(old.revision || 0, latest.revision || 0) + 1, snapshotPath: latest.snapshot_path, sheetPending: Boolean(old.spreadsheetId) };
  for (const key of ['agreementVersion', 'agreementAcceptedAt']) if (stageData[key] != null) merged[key] = stageData[key];
  if (stageData.avatarSource === 'custom' && stageData.avatarPath) {
    for (const key of ['avatarSource', 'avatarPath', 'avatarVersion']) merged[key] = stageData[key];
  }
  users.push({ uid, data: merged });
  const job = oldSheetJob(uid, old);
  if (job) sheetJobs.push(job);
  comparisons.push({ kind: 'reconciled', gcpRevision: old.revision, stageRevision: latest.revision, productionRevision: merged.revision, gcpTransactions: previous.data.transactions.length, stageTransactions: current.data.transactions.length, pockets: current.data.pockets.length, stageSha256: sha256(current.bytes), phoneFavoriteReplacement, originalSheetPreserved: merged.spreadsheetId === old.spreadsheetId && merged.googleRefreshToken === old.googleRefreshToken });
}
for (const [uid, row] of stageUsers) {
  if (gcpUsers.has(uid)) continue;
  stageOnly++;
  if (stageOnly > 1) throw new Error('More than one staging-only account needs ownership review');
  const current = await ledger(stageDir, row.snapshot_path);
  const profile = JSON.parse(row.data);
  if (current.data.demo || current.data.transactions.some((item) => item.kind !== 'opening_balance')) throw new Error('Unexpected staging-only account; review before import');
  users.push({ uid, data: { ...profile, revision: row.revision, snapshotPath: row.snapshot_path } });
  const job = stage.sheetJobs?.find((item) => item.uid === uid);
  if (job) sheetJobs.push(job);
  comparisons.push({ kind: 'staging-only', revision: row.revision, transactions: current.data.transactions.length, pockets: current.data.pockets.length, stageSha256: sha256(current.bytes) });
}

const objects = [];
const sourceByKey = new Map();
for (const [source, dir, manifest] of [['gcp', gcpDir, gcp], ['staging', stageDir, stage]]) {
  for (const item of manifest.objects) {
    const existing = sourceByKey.get(item.key);
    if (existing) {
      if (existing.sha256 !== item.sha256) throw new Error('Different source objects use the same R2 key');
      continue;
    }
    sourceByKey.set(item.key, item);
    const destination = objectPath(resultDir, item.key);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(objectPath(dir, item.key), destination);
    objects.push({ key: item.key, bytes: item.bytes, sha256: item.sha256, contentType: item.contentType || snapshotContentType(item.key), provenance: source });
  }
}

for (const { data } of users) {
  if (!sourceByKey.has(data.snapshotPath)) throw new Error('Selected account backup missing from combined archive');
  if (data.avatarPath && !sourceByKey.has(data.avatarPath)) throw new Error('Selected account avatar missing from combined archive');
}
for (const job of sheetJobs) {
  if (job.baseline_path && !sourceByKey.has(job.baseline_path)) throw new Error('Sheet baseline backup missing from combined archive');
  if (job.target_path && !sourceByKey.has(job.target_path)) throw new Error('Sheet target backup missing from combined archive');
}

const manifest = { source: 'reconciled-gcp-and-staging', preparedAt: new Date().toISOString(), gcpExportedAt: gcp.exportedAt, stageExportedAt: stage.exportedAt, users, sheetJobs, objects, comparisons };
await fs.writeFile(path.join(resultDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ accounts: users.length, objects: objects.length, sheetJobs: sheetJobs.length, comparisons }, null, 2));
