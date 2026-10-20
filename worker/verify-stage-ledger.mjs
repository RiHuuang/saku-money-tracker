// Read a staging backup and print only its count, revision and checksum.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
const uid = process.argv[2];
assert.match(uid || "", /^\d{20,30}$/);
const wrangler = path.resolve("node_modules/wrangler/bin/wrangler.js");
function d1(command) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "saku-stage", "--remote", "--config", "wrangler.stage.jsonc", "--command", command, "--json"], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, "Staging verification query failed");
  return JSON.parse(result.stdout)[0].results;
}
assert.equal(d1(`SELECT COUNT(*) AS n FROM users WHERE uid='${uid}' AND snapshot_path IS NOT NULL`)[0].n, 1);
const id = crypto.randomUUID(), secret = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(secret).digest("hex"), now = Date.now();
d1(`INSERT INTO sessions(id,uid,access_hash,refresh_hash,access_expires_at,refresh_expires_at,updated_at) VALUES('${id}','${uid}','${hash}','${hash}',${now + 600000},${now + 600000},${now})`);
try {
  const response = await fetch("https://stage.sakumoney.my.id/v2/sync", { headers: { authorization: `Bearer ${id}.${secret}`, "x-saku-user-id": uid } });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer()), ledger = JSON.parse(bytes);
  assert.equal(ledger.version, 3);
  console.log(JSON.stringify({ uid, revision: Number(response.headers.get("x-saku-revision")), transactions: ledger.transactions.length, pockets: ledger.pockets.length, demo: ledger.demo, onlyOpeningBalances: ledger.transactions.every((row) => row.kind === "opening_balance"), sha256: crypto.createHash("sha256").update(bytes).digest("hex") }));
} finally {
  d1(`DELETE FROM sessions WHERE id='${id}' AND uid='${uid}'`);
}
