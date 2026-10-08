import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { build } from "esbuild";
import { avatar } from "./avatar.test.mjs";
const bundle = await build({ entryPoints: ["src/snapshotTransfer.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { uploadSnapshot, downloadSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

const stage = process.env.SAKU_STAGE === "1";
const origin = process.env.SAKU_TEST_WORKER || (stage ? "https://saku-stage.saku-money-manager.workers.dev" : "http://127.0.0.1:8787");
const originalFetch = globalThis.fetch;
if (process.env.SAKU_SPACED === "1") globalThis.fetch = async (url, options = {}) => {
  await new Promise((resolve) => setTimeout(resolve, 3000));
  console.log(`${new Date().toISOString()} ${options.method || "GET"} ${new URL(url).pathname}`);
  return originalFetch(url, options);
};
const uid = `smoke-${crypto.randomUUID()}`;
const id = crypto.randomUUID(), secret = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(secret).digest("hex");
const now = Date.now();
const user = { name: "Smoke Test", email: "smoke@example.invalid", avatarPath: null, spreadsheetUrl: "", sheetPending: true };
const sql = `INSERT INTO users(uid,data,revision,snapshot_path,updated_at) VALUES ('${uid}','${JSON.stringify(user)}',0,NULL,${now}); INSERT INTO sessions(id,uid,access_hash,refresh_hash,access_expires_at,refresh_expires_at,updated_at) VALUES ('${id}','${uid}','${hash}','${hash}',${now + 900000},${now + 900000},${now});`;
const wrangler = path.resolve("node_modules/wrangler/bin/wrangler.js");
function d1(command) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", stage ? "saku-stage" : "saku", stage ? "--remote" : "--local", ...(stage ? ["--config", "wrangler.stage.jsonc"] : []), "--command", command], { stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) throw new Error("Smoke D1 operation failed");
}
d1(sql);
console.log(`Synthetic safety account: ${uid}`);
let accountDeleted = false;

const headers = { authorization: `Bearer ${id}.${secret}`, "content-type": "application/json", "x-saku-user-id": uid };
const snapshot = { version: 3, accounts: [], pockets: [], transactions: [], creditCards: [], recurring: [], favorites: [], pocketTransfers: [], existingInstallments: [] };
try {
  let response = await fetch(`${origin}/v1/me`, { headers });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, uid);
  d1(`UPDATE sessions SET access_expires_at=0 WHERE id='${id}'`);
  assert.equal((await fetch(`${origin}/v1/me`, { headers })).status, 401, "expired access must be rejected");
  const refreshes = await Promise.all(Array.from({ length: 2 }, () => fetch(`${origin}/v1/auth/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: `${id}.${secret}` }) })));
  assert.deepEqual(refreshes.map((response) => response.status).sort(), [200, 401], "only one concurrent refresh may rotate the session");
  const refresh = refreshes.find((response) => response.status === 200);
  const renewed = await refresh.json();
  headers.authorization = `Bearer ${renewed.accessToken}`;
  assert.equal((await fetch(`${origin}/v1/me`, { headers })).status, 200, "refreshed access must work");
  assert.equal((await fetch(`${origin}/v1/me`, { headers: { ...headers, authorization: `Bearer ${id}.${secret}` } })).status, 401, "old access must stay revoked");
  response = await fetch(`${origin}/v1/me`, { method: "PUT", headers, body: JSON.stringify({ name: "Avatar Test", image: `data:image/webp;base64,${avatar.toString("base64")}` }) });
  assert.equal(response.status, 200, "static avatar upload must work");
  assert.equal((await response.json()).user.avatarSource, "custom");
  response = await fetch(`${origin}/v1/me/avatar`, { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), avatar);
  const badAvatar = Buffer.from(avatar); badAvatar.writeUInt16LE(513, 26);
  assert.equal((await fetch(`${origin}/v1/me`, { method: "PUT", headers, body: JSON.stringify({ name: "Avatar Test", image: `data:image/webp;base64,${badAvatar.toString("base64")}` }) })).status, 400);
  assert.deepEqual(Buffer.from(await (await fetch(`${origin}/v1/me/avatar`, { headers })).arrayBuffer()), avatar, "rejected upload must preserve the old avatar");
  response = await fetch(`${origin}/v2/me/avatar?name=Binary%20Avatar`, { method: "PUT", headers: { ...headers, "content-type": "image/webp" }, body: avatar });
  assert.equal(response.status, 200, "binary avatar upload must work");
  assert.equal((await response.json()).user.name, "Binary Avatar");
  assert.equal((await fetch(`${origin}/v2/me/avatar?name=Test`, { method: "PUT", headers: { ...headers, "content-type": "image/webp" }, body: badAvatar })).status, 400, "binary upload must enforce dimensions");
  if (process.env.SAKU_AVATAR_FIXTURE) {
    const maximumAvatar = await fs.readFile(process.env.SAKU_AVATAR_FIXTURE);
    if (maximumAvatar.length > 150_000) assert.equal((await fetch(`${origin}/v1/me`, { method: "PUT", headers, body: JSON.stringify({ name: "Maximum Avatar Test", image: `data:image/webp;base64,${maximumAvatar.toString("base64")}` }) })).status, 413, "large photos must use the binary route instead of expensive JSON parsing");
    console.log(`${new Date().toISOString()} Maximum resized avatar PUT: ${maximumAvatar.length} bytes`);
    response = await fetch(`${origin}/v2/me/avatar?name=Maximum%20Avatar%20Test`, { method: "PUT", headers: { ...headers, "content-type": "image/webp" }, body: maximumAvatar });
    assert.equal(response.status, 200, "maximum resized avatar upload must work");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log(`${new Date().toISOString()} Maximum resized avatar GET`);
    response = await fetch(`${origin}/v1/me/avatar`, { headers });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), maximumAvatar);
  }
  if (stage) {
    const browserHeaders = { "content-type": "application/json", origin, cookie: `saku_access=${renewed.accessToken}; saku_csrf=smoke-csrf`, "x-saku-user-id": uid };
    assert.equal((await fetch(`${origin}/v1/me`, { method: "PUT", headers: browserHeaders, body: '{"name":"Browser profile"}' })).status, 403, "missing CSRF header must fail");
    assert.equal((await fetch(`${origin}/v1/me`, { method: "PUT", headers: { ...browserHeaders, "x-saku-csrf": "smoke-csrf" }, body: '{"name":"Browser profile"}' })).status, 200, "authenticated cookie mutation failed");
  }
  response = await fetch(`${origin}/v2/sync?baseRevision=0`, { method: "PUT", headers: { ...headers, "x-saku-version": "3" }, body: JSON.stringify(snapshot) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 1);
  response = await fetch(`${origin}/v2/sync`, { headers });
  assert.deepEqual(await response.json(), snapshot);
  assert.equal((await fetch(`${origin}/v2/sync`, { headers: { ...headers, "x-saku-user-id": "other-user" } })).status, 409, "account switch must stop a transfer");
  const send = async (pathname, options = {}) => {
    const result = await fetch(`${origin}${pathname}`, { ...options, headers: { ...headers, ...options.headers } });
    assert.equal(result.status, 200, `${pathname}: ${await result.clone().text().then((value) => value.slice(0, 100))}`);
    return result;
  };
  const large = { ...snapshot, transactions: [{ note: "x".repeat(1_500_000) }] };
  const staged = await (await send("/v2/sync/start", { method: "POST", body: JSON.stringify({ baseRevision: 1, size: 1_500_001 }) })).json();
  response = await fetch(`${origin}/v2/sync/finish`, { method: "POST", headers, body: JSON.stringify({ id: staged.id }) });
  assert.equal(response.status, 409, "an incomplete upload must not become current");
  assert.deepEqual(await downloadSnapshot(await send("/v2/sync?format=manifest"), send), snapshot);
  const result = await uploadSnapshot(JSON.stringify(large), 1, send);
  assert.equal(result.revision, 2);
  assert.deepEqual(await downloadSnapshot(await send("/v2/sync?format=manifest"), send), large);
  assert.equal((await fetch(`${origin}/v2/sync?baseRevision=3`, { method: "PUT", headers: { ...headers, "x-saku-version": "3" }, body: JSON.stringify(large) })).status, 413, "unbounded transfers must stay closed");
  response = await fetch(`${origin}/v2/sync?baseRevision=0`, { method: "PUT", headers: { ...headers, "x-saku-version": "3" }, body: JSON.stringify(snapshot) });
  assert.equal(response.status, 409);
  response = await fetch(`${origin}/v2/sync?baseRevision=2`, { method: "PUT", headers: { ...headers, "x-saku-version": "3" }, body: JSON.stringify(snapshot) });
  assert.equal(response.status, 200, "streaming backup failed");
  assert.equal((await response.json()).revision, 3);
  response = await fetch(`${origin}/v2/sync`, { headers });
  assert.equal(response.status, 200, "streaming restore failed");
  assert.equal(response.headers.get("x-saku-revision"), "3");
  assert.deepEqual(await response.json(), snapshot);
  response = await fetch(`${origin}/v2/sheets/current`, { headers });
  assert.equal(response.status, 409, "missing Drive consent must stay recoverable");
  response = await fetch(`${origin}/v1/sync`, { headers });
  assert.equal(response.status, 404, "old CPU-heavy sync route should stay closed");
  response = await fetch(`${origin}/v1/me`, { method: "PUT", headers: { "content-type": "application/json", cookie: `saku_access=${id}.${secret}` }, body: JSON.stringify({ name: "Attack" }) });
  assert.equal(response.status, 403);
  for (let step = 0; step < 30; step++) {
    response = await fetch(`${origin}/v1/me`, { method: "DELETE", headers });
    if (response.status === 200) break;
    assert.equal(response.status, 202, "Account deletion must be resumable");
  }
  assert.equal(response.status, 200);
  accountDeleted = true;
  response = await fetch(`${origin}/v1/me`, { headers });
  assert.equal(response.status, 401);
  console.log("Worker local smoke: auth, chunked restore, incomplete-upload safety, account isolation, conflict, CSRF, and deletion passed");
} finally {
  globalThis.fetch = originalFetch;
  if (stage && !accountDeleted) {
    const cleanup = spawnSync(process.execPath, ["worker/cleanup-stage-test.mjs", uid], { stdio: "inherit", windowsHide: true });
    if (cleanup.status !== 0) console.error(`Preserved ${uid} for resumable cleanup; its metadata must not be deleted before its objects`);
  } else if (!stage) {
    d1(`DELETE FROM sessions WHERE uid='${uid}'; DELETE FROM snapshot_upload_parts WHERE id IN (SELECT id FROM snapshot_uploads WHERE uid='${uid}'); DELETE FROM snapshot_uploads WHERE uid='${uid}'; DELETE FROM sheet_jobs WHERE uid='${uid}'; DELETE FROM users WHERE uid='${uid}';`);
  }
}
