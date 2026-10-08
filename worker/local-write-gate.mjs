import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";

const uid = `gate-${crypto.randomUUID()}`;
const id = crypto.randomUUID();
const secret = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(secret).digest("hex");
const now = Date.now();
const wrangler = path.resolve("node_modules/wrangler/bin/wrangler.js");
const origin = process.env.SAKU_TEST_WORKER || "http://127.0.0.1:8787";
const remote = origin.startsWith("https://");
function sql(command) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "saku", remote ? "--remote" : "--local", "--command", command], { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error("Could not seed or clean local gate account");
}
sql(`INSERT INTO users(uid,data,revision,snapshot_path,updated_at) VALUES('${uid}','{"name":"Gate","email":"gate@example.invalid"}',0,NULL,${now}); INSERT INTO sessions(id,uid,access_hash,refresh_hash,access_expires_at,refresh_expires_at,updated_at) VALUES('${id}','${uid}','${hash}','${hash}',${now + 600000},${now + 600000},${now})`);
try {
  for (const route of ["/auth/google/start", "/auth/google/callback", "/auth/google/finish", "/auth/google/drive/start", "/auth/google/drive/callback"]) assert.equal((await fetch(`${origin}${route}`, { redirect: "manual" })).status, 503, `OAuth gate is open for ${route}`);
  const headers = { authorization: `Bearer ${id}.${secret}`, "content-type": "application/json", "x-saku-version": "3", "x-saku-user-id": uid, origin: "https://localhost" };
  for (const route of ["/v1/auth/google", "/v2/sync", "/v2/sheets/batch"]) {
    const preflight = await fetch(`${origin}${route}`, { method: "OPTIONS", headers: { origin: "https://localhost", "access-control-request-method": "PUT", "access-control-request-headers": "authorization,content-type,x-saku-version" } });
    assert.equal(preflight.status, 204, `Android preflight failed for ${route}`);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://localhost");
    assert.ok(preflight.headers.get("access-control-allow-headers").includes("x-saku-version"));
    assert.ok(preflight.headers.get("access-control-allow-headers").includes("x-saku-user-id"));
  }
  const read = await fetch(`${origin}/v2/sync`, { headers });
  assert.equal(read.status, 204);
  for (const name of ["x-saku-revision", "x-saku-spreadsheet-url", "x-saku-sheet-pending", "x-saku-encoding"]) assert.ok(read.headers.get("access-control-expose-headers").includes(name), `Android cannot read ${name}`);
  assert.equal((await fetch(`${origin}/v2/sync`, { method: "OPTIONS", headers: { origin: "https://untrusted.invalid" } })).status, 403);
  assert.equal((await fetch(`${origin}/v2/sync?baseRevision=0`, { method: "PUT", headers, body: '{"version":3}' })).status, 503);
  assert.equal((await fetch(`${origin}/v2/sync/chunk`, { method: "PUT", headers, body: 'chunk' })).status, 503);
  assert.equal((await fetch(`${origin}/v2/me/avatar?name=Test`, { method: "PUT", headers: { ...headers, "content-type": "image/webp" }, body: 'photo' })).status, 503);
  for (const route of ["/v2/sync/start", "/v2/sync/finish"]) assert.equal((await fetch(`${origin}${route}`, { method: "POST", headers, body: '{}' })).status, 503);
  assert.equal((await fetch(`${origin}/v1/me`, { method: "DELETE", headers })).status, 503);
  assert.equal((await fetch(`${origin}/v1/me`, { method: "PUT", headers, body: '{"name":"Paused"}' })).status, 503);
  assert.equal((await fetch(`${origin}/v1/auth/google/drive`, { method: "POST", headers, body: '{}' })).status, 503);
  assert.equal((await fetch(`${origin}/v2/sheets/start`, { method: "POST", headers, body: '{}' })).status, 503);
  assert.equal((await fetch(`${origin}/v2/sheets/batch`, { method: "POST", headers, body: '{}' })).status, 503);
  console.log("Worker migration write gate: Android preflight and response headers work; untrusted origins and all writes are blocked");
} finally {
  sql(`DELETE FROM sessions WHERE uid='${uid}'; DELETE FROM users WHERE uid='${uid}'`);
}
