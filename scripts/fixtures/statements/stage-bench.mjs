// Runs the synthetic statement gate with a disposable Stage account and session.
// The account has no ledger and is removed even when a bank fails its gate.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
const uid = `synthetic-statement-bench-${randomUUID()}`;
const id = randomBytes(16).toString("hex");
const secret = randomBytes(32).toString("base64url");
const token = `${id}.${secret}`;
const hash = createHash("sha256").update(secret).digest("hex");
const now = Date.now();

function d1(sql) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "saku-stage", "--remote", "--config", "wrangler.stage.jsonc", "--command", sql], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Stage D1 operation failed: ${result.stderr || result.stdout}`);
}

let attempted = false;
try {
  attempted = true;
  d1(`INSERT INTO users(uid,data,revision,snapshot_path,updated_at) VALUES('${uid}','{"name":"Synthetic statement bench"}',0,NULL,${now});
INSERT INTO sessions(id,uid,access_hash,refresh_hash,access_expires_at,refresh_expires_at,updated_at) VALUES('${id}','${uid}','${hash}','${hash}',${now + 900000},${now + 900000},${now});`);
  const result = spawnSync(process.execPath, [join(root, "scripts/fixtures/statements/bench.mjs"), ...process.argv.slice(2)], {
    cwd: root, stdio: "inherit", env: { ...process.env, SAKU_BENCH_TOKEN: token, SAKU_BENCH_UID: uid },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (attempted) d1(`DELETE FROM sessions WHERE id='${id}'; DELETE FROM users WHERE uid='${uid}';`);
}
