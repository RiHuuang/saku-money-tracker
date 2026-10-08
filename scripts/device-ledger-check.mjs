// Reads the connected debug app's local ledger in memory and prints counts/checksums only.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const xml = execFileSync('adb', ['exec-out', 'run-as', 'id.saku.money', 'cat', 'shared_prefs/CapacitorStorage.xml'], {
  encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true,
});
const decode = (value) => value.replace(/&#(\d+);|&#x([0-9a-f]+);|&(amp|lt|gt|quot|apos);/gi, (match, decimal, hex, named) => {
  if (decimal) return String.fromCodePoint(Number(decimal));
  if (hex) return String.fromCodePoint(parseInt(hex, 16));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[named] || match;
});
const ledgers = [];
for (const match of xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)) {
  if (!match[1].startsWith('saku-ledger-v3-')) continue;
  const raw = decode(match[2]);
  const data = JSON.parse(raw);
  ledgers.push({
    userKeySha256: crypto.createHash('sha256').update(match[1]).digest('hex').slice(0, 12),
    transactions: data.transactions?.length,
    pockets: data.pockets?.length,
    demo: data.demo,
    sha256: crypto.createHash('sha256').update(raw).digest('hex'),
  });
}
console.log(JSON.stringify({ ledgers }, null, 2));
