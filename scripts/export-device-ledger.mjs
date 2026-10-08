// Save the connected debug app's local ledger before replacing its signature.
// The output is private financial data and must stay in the ignored output folder.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const xml = execFileSync('adb', ['exec-out', 'run-as', 'id.saku.money', 'cat', 'shared_prefs/CapacitorStorage.xml'], {
  encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true,
});
const decode = (value) => value.replace(/&#(\d+);|&#x([0-9a-f]+);|&(amp|lt|gt|quot|apos);/gi, (match, decimal, hex, named) => {
  if (decimal) return String.fromCodePoint(Number(decimal));
  if (hex) return String.fromCodePoint(parseInt(hex, 16));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named] || match;
});
const ledgers = [...xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)]
  .filter((match) => match[1].startsWith('saku-ledger-v3-'));
if (ledgers.length !== 1) throw new Error(`Expected exactly one phone ledger, found ${ledgers.length}`);
const [entry] = ledgers;
const keyHash = crypto.createHash('sha256').update(entry[1]).digest('hex').slice(0, 12);
if (process.env.SAKU_EXPECTED_USER_KEY_HASH && keyHash !== process.env.SAKU_EXPECTED_USER_KEY_HASH) throw new Error('Phone ledger belongs to a different Saku account');
const raw = decode(entry[2]);
const data = JSON.parse(raw);
if (data.demo || !Array.isArray(data.transactions) || !Array.isArray(data.pockets)) throw new Error('Phone ledger is not a valid real workspace');
const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.resolve(process.env.SAKU_PHONE_RECOVERY_DIR || `output/phone-recovery-${stamp}`);
if (!dir.startsWith(path.resolve('output') + path.sep)) throw new Error('Phone recovery export must remain inside ignored output');
await fs.mkdir(dir, { recursive: false, mode: 0o700 });
await fs.writeFile(path.join(dir, 'ledger.json'), raw, { flag: 'wx', mode: 0o600 });
await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({
  exportedAt: new Date().toISOString(), userKeySha256: keyHash,
  sha256, transactions: data.transactions.length, pockets: data.pockets.length, demo: false,
}, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ directory: dir, userKeySha256: keyHash, sha256,
  transactions: data.transactions.length, pockets: data.pockets.length }));
