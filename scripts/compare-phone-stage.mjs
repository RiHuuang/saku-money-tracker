// Confirm the connected phone's exported ledger contains every existing staging record unchanged.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { validateSnapshot } from '../server/src/core.js';

const phoneDir = path.resolve(process.env.SAKU_PHONE_RECOVERY_DIR || '');
const stageDir = path.resolve(process.env.SAKU_STAGE_ARCHIVE || 'output/cloudflare-stage-recovery');
if (!process.env.SAKU_PHONE_RECOVERY_DIR) throw new Error('Set SAKU_PHONE_RECOVERY_DIR');
const phoneManifest = JSON.parse(await fs.readFile(path.join(phoneDir, 'manifest.json'), 'utf8'));
const phoneBytes = await fs.readFile(path.join(phoneDir, 'ledger.json'));
const phoneHash = crypto.createHash('sha256').update(phoneBytes).digest('hex');
if (phoneHash !== phoneManifest.sha256) throw new Error('Phone recovery checksum changed');
const phone = JSON.parse(phoneBytes.toString('utf8'));
validateSnapshot(phone);
const stageManifest = JSON.parse(await fs.readFile(path.join(stageDir, 'manifest.json'), 'utf8'));
const matching = stageManifest.users.filter(({ uid }) => crypto.createHash('sha256').update(`saku-ledger-v3-${uid}`).digest('hex').slice(0, 12) === phoneManifest.userKeySha256);
if (matching.length !== 1) throw new Error('Phone account does not match exactly one staging account');
const stageUser = matching[0];
function objectPath(key) {
  if (key.includes('..') || !/^ledgers\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+$/.test(key)) throw new Error('Unsafe backup object key');
  return path.join(stageDir, 'objects', ...key.split('/'));
}
let bytes = await fs.readFile(objectPath(stageUser.snapshot_path));
if (stageUser.snapshot_path.endsWith('.manifest.json')) {
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(manifest.parts) || !Number.isSafeInteger(manifest.size) || manifest.size > 10_000_000) throw new Error('Invalid staging backup manifest');
  bytes = Buffer.concat(await Promise.all(manifest.parts.map(async (part) => {
    const chunk = await fs.readFile(objectPath(part.key));
    if (chunk.length !== part.size) throw new Error('Staging backup part size mismatch');
    return chunk;
  })));
  if (bytes.length !== manifest.size) throw new Error('Staging backup size mismatch');
  if (manifest.encoding === 'gzip') bytes = gunzipSync(bytes);
  else if (manifest.encoding !== 'identity') throw new Error('Invalid staging backup encoding');
} else if (stageUser.snapshot_path.endsWith('.gz')) bytes = gunzipSync(bytes);
const stage = JSON.parse(bytes.toString('utf8'));
validateSnapshot(stage);
const stageHash = crypto.createHash('sha256').update(bytes).digest('hex');
const exactLedgerMatch = isDeepStrictEqual(stage, phone);
const fields = ['accounts', 'pockets', 'transactions', 'creditCards', 'recurring', 'favorites', 'pocketTransfers', 'existingInstallments'];
const conflicts = fields.filter((field) => {
  const key = (item) => item && typeof item === 'object' && typeof item.id === 'string' ? `id:${item.id}` : `value:${JSON.stringify(item)}`;
  const latest = new Map(phone[field].map((item) => [key(item), item]));
  return stage[field].some((item) => !latest.has(key(item)) || !isDeepStrictEqual(item, latest.get(key(item))));
});
if (conflicts.length) {
  const details = conflicts.map((field) => {
    const key = (item) => item && typeof item === 'object' && typeof item.id === 'string' ? `id:${item.id}` : `value:${JSON.stringify(item)}`;
    const latest = new Map(phone[field].map((item) => [key(item), item]));
    return { field, stageCount: stage[field].length, phoneCount: phone[field].length,
      missing: stage[field].filter((item) => !latest.has(key(item))).length,
      changed: stage[field].filter((item) => latest.has(key(item)) && !isDeepStrictEqual(item, latest.get(key(item)))).length };
  });
  throw new Error(`Phone differs from staging: ${JSON.stringify(details)}`);
}
console.log(JSON.stringify({ phoneTransactions: phone.transactions.length, stageTransactions: stage.transactions.length,
  phonePockets: phone.pockets.length, stagePockets: stage.pockets.length, phoneSha256: phoneHash,
  stageSha256: stageHash, exactLedgerMatch, stagingRecordsPreserved: true }));
