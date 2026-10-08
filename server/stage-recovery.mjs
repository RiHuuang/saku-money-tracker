// Private staging recovery export. Never prints account IDs, profile data or ledger contents.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { validateSnapshot } from './src/core.js';

const archive = path.resolve(process.env.SAKU_STAGE_ARCHIVE || 'output/cloudflare-stage-recovery');
const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js');
const accountId = '0a69784f6f665813a15e6ab31e958692';
const bucket = 'saku-stage-data';
const mode = process.argv[2];
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function keyPath(key) {
  if (key.includes('..') || !/^(?:ledgers\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+|avatars\/[a-zA-Z0-9_-]+(?:\.webp|\/[a-zA-Z0-9_.-]+))$/.test(key)) {
    throw new Error('Unexpected staging object key');
  }
  return path.join(archive, 'objects', ...key.split('/'));
}

function run(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Staging read failed: ${args[0]} ${args[1]}`);
  return result.stdout;
}

function stageUsers() {
  const json = run(['d1', 'execute', 'saku-stage', '--remote', '--config', 'wrangler.stage.jsonc', '--command', 'SELECT uid,data,revision,snapshot_path,updated_at FROM users', '--json']);
  return JSON.parse(json)[0].results;
}

function stageSheetJobs() {
  const json = run(['d1', 'execute', 'saku-stage', '--remote', '--config', 'wrangler.stage.jsonc', '--command', 'SELECT uid,baseline_path,baseline_revision,target_path,target_revision,cursor,total,updated_at FROM sheet_jobs', '--json']);
  return JSON.parse(json)[0].results;
}

async function objects() {
  const config = await fs.readFile(path.join(os.homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'), 'utf8');
  const token = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  if (!token) throw new Error('Cloudflare login unavailable');
  const result = [];
  let cursor = '';
  do {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`);
    url.searchParams.set('per_page', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`R2 listing failed with HTTP ${response.status}`);
    const page = await response.json();
    if (!page.success || !Array.isArray(page.result)) throw new Error('R2 listing was rejected');
    result.push(...page.result);
    cursor = page.result_info?.is_truncated ? page.result_info.cursor : '';
    if (page.result_info?.is_truncated && !cursor) throw new Error('R2 listing omitted its next cursor');
  } while (cursor);
  return result;
}

function belongsToUser(key, users) {
  return users.some(({ uid }) => key.startsWith(`ledgers/${uid}/`) || key === `avatars/${uid}.webp` || key.startsWith(`avatars/${uid}/`));
}

async function exportData() {
  const users = stageUsers();
  if (!users.length || users.some(({ uid }) => !/^\d{20,30}$/.test(uid))) throw new Error('Staging has no confirmed real Google accounts or still contains synthetic users');
  const listed = await objects();
  const selected = listed.filter(({ key }) => belongsToUser(key, users));
  const copied = [];
  for (const item of selected) {
    const destination = keyPath(item.key);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    run(['r2', 'object', 'get', `${bucket}/${item.key}`, '--file', destination, '--remote']);
    const bytes = await fs.readFile(destination);
    if (bytes.length !== item.size) throw new Error('Staging object size changed during export');
    copied.push({ key: item.key, bytes: bytes.length, sha256: sha256(bytes), contentType: item.http_metadata?.contentType || null });
  }
  const sheetJobs = stageSheetJobs().filter(({ uid }) => users.some((user) => user.uid === uid));
  const manifest = { source: 'saku-stage', bucket, exportedAt: new Date().toISOString(), users, sheetJobs, objects: copied, excludedObjects: listed.length - selected.length };
  await fs.writeFile(path.join(archive, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(`Staging recovery export ready: ${users.length} real accounts, ${copied.length} account objects; ${manifest.excludedObjects} non-account objects excluded`);
}

async function verify() {
  const manifest = JSON.parse(await fs.readFile(path.join(archive, 'manifest.json'), 'utf8'));
  const indexed = new Map(manifest.objects.map((item) => [item.key, item]));
  for (const item of manifest.objects) {
    const bytes = await fs.readFile(keyPath(item.key));
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw new Error('Staging object checksum mismatch');
  }
  for (const row of manifest.users) {
    if (!row.snapshot_path || !indexed.has(row.snapshot_path)) throw new Error('Staging account snapshot missing from archive');
    const head = await fs.readFile(keyPath(row.snapshot_path));
    let bytes = head;
    if (row.snapshot_path.endsWith('.manifest.json')) {
      const parts = JSON.parse(head.toString('utf8'));
      if (!Array.isArray(parts.parts) || !Number.isSafeInteger(parts.size) || parts.size > 10_000_000) throw new Error('Invalid staging snapshot manifest');
      const chunks = [];
      for (const part of parts.parts) {
        if (!indexed.has(part.key)) throw new Error('Staging snapshot part missing from archive');
        const chunk = await fs.readFile(keyPath(part.key));
        if (chunk.length !== part.size) throw new Error('Staging snapshot part size mismatch');
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks);
      if (bytes.length !== parts.size) throw new Error('Staging snapshot size mismatch');
      if (parts.encoding === 'gzip') bytes = gunzipSync(bytes);
      else if (parts.encoding !== 'identity') throw new Error('Invalid staging snapshot encoding');
    } else if (row.snapshot_path.endsWith('.gz')) bytes = gunzipSync(head);
    validateSnapshot(JSON.parse(bytes.toString('utf8')));
  }
  return manifest;
}

async function compareSource() {
  const manifest = await verify();
  const current = stageUsers();
  if (!isDeepStrictEqual(current, manifest.users)) throw new Error('Staging account metadata or revisions changed after export');
  const sheetJobs = stageSheetJobs().filter(({ uid }) => current.some((user) => user.uid === uid));
  if (!isDeepStrictEqual(sheetJobs, manifest.sheetJobs)) throw new Error('Staging Sheet job changed after export');
  const listed = (await objects()).filter(({ key }) => belongsToUser(key, current));
  if (listed.length !== manifest.objects.length) throw new Error('Staging account object count changed after export');
  const indexed = new Map(manifest.objects.map((item) => [item.key, item]));
  for (const item of listed) {
    const original = indexed.get(item.key);
    if (!original || original.bytes !== item.size) throw new Error('Staging account object listing changed after export');
    const target = path.join(archive, 'comparison', crypto.randomUUID());
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      run(['r2', 'object', 'get', `${bucket}/${item.key}`, '--file', target, '--remote']);
      if (sha256(await fs.readFile(target)) !== original.sha256) throw new Error('Staging account object content changed after export');
    } finally { await fs.rm(target, { force: true }); }
  }
  console.log('Staging account rows and every account object still match the verified archive');
}

try {
  if (mode === 'probe') console.log(`Staging R2 listing available: ${(await objects()).length} objects`);
  else if (mode === 'export') await exportData();
  else if (mode === 'verify') {
    const manifest = await verify();
    console.log(`Staging recovery verified: ${manifest.users.length} accounts, ${manifest.objects.length} objects`);
  } else if (mode === 'compare-source') await compareSource();
  else throw new Error('Use probe|export|verify|compare-source');
} catch (error) {
  console.error(`Staging recovery ${mode || 'command'} failed: ${error.message}`);
  process.exitCode = 1;
}
