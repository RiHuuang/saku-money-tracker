import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["src/snapshotTransfer.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { uploadSnapshot, downloadSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);

const stage = process.env.SAKU_STAGE === "1";
const coldMaximum = process.env.SAKU_COLD_MAXIMUM === "1";
const deletionProfile = process.env.SAKU_DELETE_PROFILE === "1" || process.env.SAKU_DELETE_PROFILE === "large";
const repeats = Number(process.env.SAKU_CAPACITY_REPEATS || 2);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10 || (coldMaximum && !stage)) throw new Error("Invalid isolated capacity test options");
const origin = stage ? "https://stage.sakumoney.my.id" : "https://saku.saku-money-manager.workers.dev";
const uid = `capacity-${crypto.randomUUID()}`;
const id = crypto.randomUUID();
const secret = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(secret).digest("hex");
const wrangler = path.resolve("node_modules/wrangler/bin/wrangler.js");
const now = Date.now();
// Session expiry/rotation has its own safety suite. Give only this synthetic
// staging benchmark enough time for a slow local network to finish its load.
const testExpiresAt = now + (stage ? 2 * 3600_000 : 900000);

// Retry transport failures only when repeating the request cannot commit a new
// revision. Keep failed test accounts recoverable until R2 deletion succeeds.
async function request(url, options = {}) {
  const method = options.method || "GET";
  const retryable = stage && (method === "GET" || method === "DELETE" ||
    (method === "PUT" && new URL(url).pathname === "/v2/sync/chunk"));
  for (let attempt = 0; ; attempt++) {
    try { return await fetch(url, options); }
    catch (error) {
      if (!retryable || attempt >= 3 || error?.name !== "TypeError") throw error;
      console.log(`Network interruption: retrying ${method} (${attempt + 1}/3)`);
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    }
  }
}

function sql(command) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", stage ? "saku-stage" : "saku", "--remote", ...(stage ? ["--config", "wrangler.stage.jsonc"] : []), "--command", command, "--json"], { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error("Temporary D1 benchmark operation failed");
}

function snapshot(count, noteLength = 0) {
  return {
    version: 3, accounts: [], pockets: [], creditCards: [], recurring: [], favorites: [], pocketTransfers: [], existingInstallments: [],
    transactions: Array.from({ length: count }, (_, n) => ({ id: `t${n}`, date: "2026-10-03", name: "Capacity test", type: "expense", amount: n, note: "x".repeat(noteLength) })),
  };
}

async function check(label, data, baseRevision) {
  const bytes = Buffer.byteLength(JSON.stringify(data));
  const headers = { authorization: `Bearer ${id}.${secret}`, "content-type": "application/json", "x-saku-version": "3", "x-saku-user-id": uid };
  const send = async (pathname, options = {}) => {
    const at = new Date().toISOString();
    const response = await request(`${origin}${pathname}`, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(120_000) });
    console.log(`${at} ${options.method || "GET"} ${pathname.split("?")[0]} ${response.status}`);
    assert.equal(response.status, 200, `${pathname} failed: ${await response.clone().text().then((text) => text.slice(0, 200))}`);
    if (process.env.SAKU_SPACED === "1") await new Promise((resolve) => setTimeout(resolve, 3_000));
    return response;
  };
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const write = await uploadSnapshot(JSON.stringify(data), baseRevision, send);
  const writeMs = Math.round(performance.now() - started);
  const writeStatus = 200;
  assert.equal(write.revision, baseRevision + 1);
  if (stage) await new Promise((resolve) => setTimeout(resolve, 5_000));
  const readStarted = performance.now();
  const readAt = new Date().toISOString();
  const response = await send("/v2/sync?format=manifest");
  const readMs = Math.round(performance.now() - readStarted);
  const readStatus = response.status;
  const body = await downloadSnapshot(response, send);
  if (readStatus === 200) {
    assert.equal(response.headers.get("x-saku-revision"), String(baseRevision + 1));
    assert.deepEqual(body, data);
  }
  console.log(`${startedAt} ${label}: ${bytes} bytes, PUT ${writeStatus} in ${writeMs} ms; ${readAt} GET ${readStatus} in ${readMs} ms, sheetPending=${write.sheetPending}`);
  assert.equal(readStatus, 200, `${label} restore failed`);
  return true;
}

const user = JSON.stringify({ name: "Capacity Test", email: "capacity@example.invalid", sheetPending: true });
sql(`INSERT INTO users(uid,data,revision,snapshot_path,updated_at) VALUES ('${uid}','${user}',0,NULL,${now}); INSERT INTO sessions(id,uid,access_hash,refresh_hash,access_expires_at,refresh_expires_at,updated_at) VALUES ('${id}','${uid}','${hash}','${hash}',${testExpiresAt},${testExpiresAt},${now});`);
console.log(`Synthetic capacity account: ${uid}`);
let completedDeletion = false;
try {
  let revision = 0;
  if (process.env.SAKU_DELETE_PROFILE === "large") {
    const data = snapshot(99000);
    const target = 9_800_000;
    const extra = Math.floor((target - Buffer.byteLength(JSON.stringify(data)) - data.transactions.length * 10) / data.transactions.length);
    if (extra > 0) for (const transaction of data.transactions) transaction.note = "x".repeat(extra);
    const headers = { authorization: `Bearer ${id}.${secret}`, "content-type": "application/json", "x-saku-version": "3", "x-saku-user-id": uid };
    const send = async (pathname, options = {}) => {
      const response = await fetch(`${origin}${pathname}`, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(120_000) });
      assert.equal(response.status, 200, `${pathname}: ${await response.clone().text().then((text) => text.slice(0, 100))}`);
      return response;
    };
    for (let revision = 0; revision < 2; revision++) {
      const result = await uploadSnapshot(JSON.stringify(data), revision, send);
      assert.equal(result.revision, revision + 1);
    }
    const at = new Date().toISOString();
    let response;
    for (let step = 0; step < 50; step++) {
      if (process.env.SAKU_TRACE_DELETE === "1") await new Promise((resolve) => setTimeout(resolve, 3_000));
      const stepAt = new Date().toISOString();
      response = await fetch(`${origin}/v1/me`, { method: "DELETE", headers });
      if (process.env.SAKU_TRACE_DELETE === "1") console.log(`${stepAt} DELETE /v1/me step ${step + 1}: ${response.status}`);
      if (response.status === 200) break;
      assert.equal(response.status, 202);
    }
    console.log(`${at} DELETE /v1/me after two large backups: ${response.status} at ${new Date().toISOString()}`);
    assert.equal(response.status, 200);
    completedDeletion = true;
  } else if (deletionProfile) {
    const body = '{"version":3}', headers = { authorization: `Bearer ${id}.${secret}`, "content-type": "application/json", "x-saku-version": "3", "x-saku-user-id": uid };
    for (let index = 0; index < 22; index++) {
      const response = await fetch(`${origin}/v2/sync?baseRevision=${index}`, { method: "PUT", headers, body });
      assert.equal(response.status, 200, `History setup ${index}: ${await response.text()}`);
    }
    const at = new Date().toISOString();
    let response;
    for (let step = 0; step < 50; step++) {
      response = await fetch(`${origin}/v1/me`, { method: "DELETE", headers });
      if (response.status === 200) break;
      assert.equal(response.status, 202);
    }
    console.log(`${at} DELETE /v1/me after 22 backups: ${response.status} at ${new Date().toISOString()}`);
    assert.equal(response.status, 200);
    completedDeletion = true;
  } else if (coldMaximum || await check("representative", snapshot(1000), revision++)) {
    const maximum = snapshot(99000);
    const target = 9_800_000;
    const extra = Math.floor((target - Buffer.byteLength(JSON.stringify(maximum)) - maximum.transactions.length * 10) / maximum.transactions.length);
    if (extra > 0) for (const transaction of maximum.transactions) transaction.note = "x".repeat(extra);
    for (let index = 0; index < (stage ? repeats : 1); index++) {
      await check(`maximum ${index + 1}`, maximum, revision++);
      if (stage) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
} finally {
  let cleaned = completedDeletion;
  if (!cleaned) {
    let response;
    for (let step = 0; step < 50; step++) {
      response = await request(`${origin}/v1/me`, { method: "DELETE", headers: { authorization: `Bearer ${id}.${secret}` } }).catch(() => null);
      if (!response || response.status === 200) break;
      if (response.status !== 202) break;
    }
    cleaned = response?.status === 200;
    if (!cleaned) console.error(`Automatic benchmark deletion failed; preserve ${uid} for resumable cleanup`);
  }
  if (cleaned) sql(`DELETE FROM sessions WHERE uid='${uid}'; DELETE FROM users WHERE uid='${uid}';`);
}
