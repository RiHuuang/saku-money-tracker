// Resume deletion of an interrupted synthetic staging test account.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";

const uid = process.argv[2];
assert.match(uid || "", /^(mirror-test|capacity|smoke)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const wrangler = path.resolve("node_modules/wrangler/bin/wrangler.js");
function d1(command) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "saku-stage", "--remote", "--config", "wrangler.stage.jsonc", "--command", command, "--json"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`Staging D1 command failed: ${result.stderr.slice(0, 300)}`);
  return JSON.parse(result.stdout)[0].results;
}

const row = d1(`SELECT data FROM users WHERE uid='${uid}'`)[0];
if (!row) throw new Error("Synthetic test account is already gone");
const user = JSON.parse(row.data);
const expectedEmail = uid.startsWith("mirror-test-") ? "mirror@example.invalid" : uid.startsWith("capacity-") ? "capacity@example.invalid" : "smoke@example.invalid";
assert.equal(user.email, expectedEmail);
assert.equal(user.googleRefreshToken, undefined, "Detach the borrowed Google grant before cleanup");
assert.equal(user.googleIdentityRefreshToken, undefined);

const id = crypto.randomUUID();
const secret = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(secret).digest("hex");
const now = Date.now();
d1(`INSERT INTO sessions(id,uid,access_hash,refresh_hash,access_expires_at,refresh_expires_at,updated_at) VALUES('${id}','${uid}','${hash}','${hash}',${now + 900_000},${now + 900_000},${now})`);
const headers = { authorization: `Bearer ${id}.${secret}`, "x-saku-user-id": uid };
let status = 0;
for (let step = 0; step < 100; step++) {
  let response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch("https://saku-stage.saku-money-manager.workers.dev/v1/me", { method: "DELETE", headers, signal: AbortSignal.timeout(60_000) });
      break;
    } catch (error) {
      if (error?.name !== "TypeError" || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  status = response.status;
  if (status === 200) break;
  assert.equal(status, 202, `Deletion stopped: ${await response.text()}`);
}
assert.equal(status, 200, "Staging test account deletion did not complete");
assert.equal(d1(`SELECT count(*) AS n FROM users WHERE uid='${uid}'`)[0].n, 0);
assert.equal(d1(`SELECT count(*) AS n FROM sessions WHERE uid='${uid}'`)[0].n, 0);
assert.equal(d1(`SELECT count(*) AS n FROM sheet_jobs WHERE uid='${uid}'`)[0].n, 0);
assert.equal(d1(`SELECT count(*) AS n FROM snapshot_uploads WHERE uid='${uid}'`)[0].n, 0);
console.log(`Removed synthetic staging account ${uid}`);
