// End-to-end mirror check against a disposable Google Sheet and local or staging
// D1/R2. It never modifies the migrated spreadsheet or production user metadata.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { build } from "esbuild";
import { decrypt, encryptionKey } from "../server/src/core.js";

const root = path.resolve(".");
const stage = process.env.SAKU_STAGE === "1";
const large = process.env.SAKU_LARGE_SHEET === "1";
const maximum = process.env.SAKU_MAX_SHEET === "1";
const setupOnly = process.env.SAKU_SETUP_ONLY === "1";
const resumeUid = process.env.SAKU_RESUME_UID;
if (resumeUid && (!stage || !maximum || !/^mirror-test-[0-9a-f-]{36}$/.test(resumeUid))) throw new Error("Only an isolated maximum staging mirror can be resumed");
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
if (maximum && !stage) throw new Error("The maximum Sheet test is reserved for isolated staging");
if (setupOnly && (!maximum || !stage)) throw new Error("Spaced setup diagnostics require the isolated maximum staging test");
const manifest = JSON.parse(await fs.readFile(path.resolve(process.env.SAKU_MIGRATION_DIR || "output/cloudflare-migration", "manifest.json"), "utf8"));
const source = manifest.users.find(({ data }) => data.googleRefreshToken);
if (!source) throw new Error("No migrated Google grant for a disposable Sheet test");
const bundled = await build({ entryPoints: [path.join(root, "src/sheetMirror.ts")], bundle: true, platform: "node", format: "esm", write: false });
const { sheetChanges, sheetGridRows, sheetTables } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`);
const transferBundle = await build({ entryPoints: [path.join(root, "src/snapshotTransfer.ts")], bundle: true, platform: "node", format: "esm", write: false });
const { uploadSnapshot, downloadSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(transferBundle.outputFiles[0].contents).toString("base64")}`);
function secret(name) {
  const result = spawnSync("gcloud.cmd", ["secrets", "versions", "access", "latest", `--secret=${name}`, "--project=saku-money-tracker"], { encoding: "utf8", windowsHide: true, shell: true });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`Could not read ${name}`);
  return result.stdout.trimEnd();
}
const encryptionSecret = secret("saku-token-encryption-key"), oauthSecret = secret("saku-google-oauth-client-secret");
const refreshToken = decrypt(source.data.googleRefreshToken, encryptionKey(encryptionSecret));
async function googleToken() {
  const response = await retryNetwork("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({
    client_id: "213129330817-578l0t3n12ctd9uja57ad2bcf22t5o7l.apps.googleusercontent.com", client_secret: oauthSecret, refresh_token: refreshToken, grant_type: "refresh_token",
  }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error("Could not refresh the migrated Google grant");
  return result;
}
let token = await googleToken();
async function retryNetwork(url, options = {}, retry = true) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (!retry || attempt >= 3 || error?.name !== "TypeError") throw error;
      console.log(`Network interruption: retrying an idempotent request (${attempt + 1}/3)`);
      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    }
  }
}
async function google(url, options = {}, renew = true) {
  const response = await retryNetwork(url, { ...options, headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" } }, options.method !== "POST");
  const result = await response.json().catch(() => ({}));
  if (response.status === 401 && renew) {
    token = await googleToken();
    return google(url, options, false);
  }
  if (!response.ok) throw new Error(`Disposable Google API returned ${response.status}`);
  return result;
}
const names = ["Transactions", "Pockets", "Accounts", "Cards", "Recurring", "Quick_entries", "Pocket_transfers", "Existing_installments"];
const resumedUser = resumeUid ? JSON.parse(d1(`SELECT data FROM users WHERE uid='${resumeUid}'`)[0].results[0].data) : null;
const resumedRevision = resumeUid ? Number(d1(`SELECT revision FROM users WHERE uid='${resumeUid}'`)[0].results[0].revision) : 0;
if (resumeUid && ![1, 2].includes(resumedRevision)) throw new Error("The interrupted Sheet test has no resumable snapshot");
const created = resumedUser || await google("https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId,spreadsheetUrl", { method: "POST", body: JSON.stringify({
  properties: { title: `Saku mirror integration check ${Date.now()}` }, sheets: names.map((title) => ({ properties: { title } })),
}) });
if (!created.spreadsheetId) throw new Error("Disposable Sheet creation failed");

const uid = resumeUid || `mirror-test-${crypto.randomUUID()}`, id = crypto.randomUUID(), secretPart = crypto.randomBytes(32).toString("base64url");
const hash = crypto.createHash("sha256").update(secretPart).digest("hex"), now = Date.now();
const testUser = { name: "Mirror test", email: "mirror@example.invalid", spreadsheetId: created.spreadsheetId, spreadsheetUrl: created.spreadsheetUrl, googleRefreshToken: source.data.googleRefreshToken, sheetPending: true };
const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
function d1(command) {
  const args = stage ? [wrangler, "d1", "execute", "saku-stage", "--remote", "--config", "wrangler.stage.jsonc", "--command", command] : [wrangler, "d1", "execute", "saku", "--local", "--command", command];
  let result = spawnSync(process.execPath, [...args, "--json"], { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.status !== 0 && stage) {
    // A maximum mirror can outlive Wrangler's short-lived OAuth token.
    const refreshed = spawnSync(process.execPath, [wrangler, "whoami"], { cwd: root, encoding: "utf8", windowsHide: true });
    if (refreshed.status === 0) result = spawnSync(process.execPath, [...args, "--json"], { cwd: root, encoding: "utf8", windowsHide: true });
  }
  if (result.status !== 0) throw new Error(`Isolated D1 test setup or cleanup failed (exit=${result.status}, signal=${result.signal || 'none'}): ${result.error?.message || result.stderr.slice(0, 300)}`);
  return JSON.parse(result.stdout);
}
async function cleanupD1(command) {
  for (let attempt = 0; ; attempt++) {
    try { return d1(command); }
    catch (error) {
      if (attempt >= 3) throw error;
      console.log(`Disposable staging cleanup: retrying D1 (${attempt + 1}/3)`);
      await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** attempt));
    }
  }
}
let worker;
const varsFile = path.join(root, ".dev.vars");
const origin = stage ? "https://saku-stage.saku-money-manager.workers.dev" : "http://127.0.0.1:8787";
const headers = { authorization: `Bearer ${id}.${secretPart}`, "content-type": "application/json", "x-saku-user-id": uid };
const traceRequest = async (pathname, options = {}) => {
  if (setupOnly) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    console.log(`${new Date().toISOString()} ${options.method || "GET"} ${pathname.split("?")[0]}`);
  }
  let response = await retryNetwork(`${origin}${pathname}`, { ...options, headers: { ...headers, ...options.headers } }, !options.method || pathname === "/v2/sheets/batch" || (options.method === "PUT" && pathname.startsWith("/v2/sync/chunk?")));
  if (pathname === "/v2/sheets/batch" && response.status === 428) {
    console.log(`${new Date().toISOString()} Separate Google token refresh`);
    const refreshed = await retryNetwork(`${origin}/v2/sheets/refresh`, { method: "POST", headers, body: "{}" });
    assert.equal(refreshed.status, 200, "Separate Sheet access refresh failed");
    response = await retryNetwork(`${origin}${pathname}`, { ...options, headers: { ...headers, ...options.headers } });
  }
  return response;
};
const send = async (pathname, options = {}) => {
  const response = await traceRequest(pathname, options);
  assert.equal(response.status, 200, `${pathname}: ${await response.clone().text().then((text) => text.slice(0, 200))}`);
  return response;
};
async function call(pathname, options = {}) {
  const response = await traceRequest(pathname, options);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}
const empty = () => ({ version: 3, accounts: ["Cash"], pockets: [], transactions: [], creditCards: [], recurring: [], favorites: [], pocketTransfers: [], existingInstallments: [] });
const transaction = (id, name) => ({ id, date: "2026-10-04", name, type: "expense", amount: 100, account: "Cash" });
async function value(range, values) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(created.spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  return google(url, { method: "PUT", body: JSON.stringify({ range, values }) });
}
async function mirror(conflict = false, stopAfterSetup = false, stopAfterOne = false, requireResume = false) {
  const pause = async () => { if (stopAfterSetup) await new Promise((resolve) => setTimeout(resolve, 5_000)); };
  if (stopAfterSetup) console.log(`${new Date().toISOString()} POST /v2/sheets/start`);
  const started = await call("/v2/sheets/start", { method: "POST", body: "{}" });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  async function snapshot(kind) {
    const response = await traceRequest(`/v2/sheets/snapshot?kind=${kind}&format=manifest`);
    if (response.status === 204) return null;
    assert.equal(response.status, 200);
    return downloadSnapshot(response, send);
  }
  await pause();
  if (stopAfterSetup) console.log(`${new Date().toISOString()} GET baseline snapshot`);
  const before = await snapshot("baseline");
  await pause();
  if (stopAfterSetup) console.log(`${new Date().toISOString()} GET target snapshot`);
  const after = await snapshot("target");
  const changes = sheetChanges(before, after);
  await pause();
  if (stopAfterSetup) console.log(`${new Date().toISOString()} POST /v2/sheets/plan (${changes.length} batches)`);
  const planned = await call("/v2/sheets/plan", { method: "POST", body: JSON.stringify({ targetRevision: started.body.targetRevision, total: changes.length }) });
  assert.equal(planned.status, 200, JSON.stringify(planned.body));
  if (requireResume) assert.ok(planned.body.cursor > 0, "interrupted mirror did not retain its cursor");
  await pause();
  if (stopAfterSetup) console.log(`${new Date().toISOString()} POST /v2/sheets/grid`);
  const grid = await call("/v2/sheets/grid", { method: "POST", body: JSON.stringify({ targetRevision: started.body.targetRevision, rows: sheetGridRows(before, after) }) });
  assert.equal(grid.status, 200, JSON.stringify(grid.body));
  if (stopAfterSetup) { console.log("Spaced maximum Sheet setup passed without writing any target rows"); return; }
  for (let index = planned.body.cursor; index < changes.length; index++) {
    const payload = JSON.stringify({ targetRevision: started.body.targetRevision, index, ...changes[index] });
    if (conflict && index === planned.body.cursor) {
      await value("'Transactions'!B2", [["external edit"]]);
      const blocked = await call("/v2/sheets/batch", { method: "POST", body: payload });
      assert.equal(blocked.status, 409, "manual edit should prevent a mirror overwrite");
      await value("'Transactions'!B2", [[before.transactions[0].date]]);
    }
    if (maximum && index > planned.body.cursor) await new Promise((resolve) => setTimeout(resolve, 1_200));
    let applied;
    for (let attempt = 0; ; attempt++) {
      applied = await call("/v2/sheets/batch", { method: "POST", body: payload });
      if (![429, 502, 503, 504].includes(applied.status) || attempt >= 4) break;
      console.log(`Maximum Sheet mirror: transient HTTP ${applied.status}; retrying batch ${index + 1}`);
      await new Promise((resolve) => setTimeout(resolve, 5_000 * 2 ** attempt));
    }
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    if (!maximum || index === planned.body.cursor) {
      const repeated = await call("/v2/sheets/batch", { method: "POST", body: payload });
      assert.equal(repeated.status, 200, "repeating a completed batch should be safe");
    }
    if (stopAfterOne) return;
    if (maximum && (index + 1) % 50 === 0) console.log(`Maximum Sheet mirror: ${index + 1}/${changes.length} batches applied`);
  }
  const finished = await call("/v2/sheets/finish", { method: "POST", body: JSON.stringify({ targetRevision: started.body.targetRevision }) });
  assert.equal(finished.status, 200, JSON.stringify(finished.body));
  assert.equal(finished.body.sheetPending, false);
}
try {
  d1(`${resumeUid ? "" : `INSERT INTO users(uid,data,revision,snapshot_path,updated_at) VALUES (${sql(uid)},${sql(JSON.stringify(testUser))},0,NULL,${now});`} INSERT INTO sessions(id,uid,access_hash,refresh_hash,access_expires_at,refresh_expires_at,updated_at) VALUES (${sql(id)},${sql(uid)},${sql(hash)},${sql(hash)},${now + (maximum ? 2 * 3600_000 : 900000)},${now + (maximum ? 2 * 3600_000 : 900000)},${now});`);
  if (!stage) {
    await fs.writeFile(varsFile, `GOOGLE_OAUTH_CLIENT_SECRET=${JSON.stringify(oauthSecret)}\nTOKEN_ENCRYPTION_KEY=${JSON.stringify(encryptionSecret)}\n`, { flag: "wx", mode: 0o600 });
    worker = spawn(process.execPath, [wrangler, "dev", "--var", "WRITE_ENABLED:true"], { cwd: root, windowsHide: true, stdio: "ignore" });
  }
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try { if ((await fetch(`${origin}/health`)).ok) { ready = true; break; } } catch {}
  }
  if (!ready) throw new Error("Local Worker did not become ready");
  const first = empty(); first.transactions.push(transaction("t1", "Lunch"));
  if (!resumeUid) {
    await uploadSnapshot(JSON.stringify(first), 0, send);
    await mirror();
    await value("'Transactions'!S2", [["preserve this manual column"]]);
  } else if (resumedRevision === 1) {
    const prior = d1(`SELECT baseline_path FROM sheet_jobs WHERE uid=${sql(uid)}`)[0].results[0];
    if (!prior?.baseline_path) await mirror();
    await value("'Transactions'!S2", [["preserve this manual column"]]);
  }
  const second = empty(); second.transactions.push(transaction("t1", "Dinner"), transaction("t2", "Tea"));
  if (large) for (let number = 3; number <= 250; number++) second.transactions.push({ ...transaction(`t${number}`, `Entry ${number}`), note: "n".repeat(500) });
  if (maximum) for (let number = 3; number <= 92000; number++) second.transactions.push({ ...transaction(`t${number}`, "Entry"), note: "" });
  if (maximum) console.log(`Maximum Sheet mirror: ${Buffer.byteLength(JSON.stringify(second))} backup bytes, ${second.transactions.length} rows`);
  if (!resumeUid || resumedRevision === 1) {
    await uploadSnapshot(JSON.stringify(second), 1, send);
    await mirror(true, setupOnly, !setupOnly);
  }
  if (!setupOnly) await mirror(false, false, false, true);
  if (!setupOnly) {
  const final = await google(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(created.spreadsheetId)}/values/${encodeURIComponent("'Transactions'!A1:S3")}?valueRenderOption=UNFORMATTED_VALUE`);
  assert.equal(final.values[1][2], "Dinner");
  assert.equal(final.values[2][0], "t2");
  assert.equal(final.values[1][18], "preserve this manual column");
  if (maximum) {
    const expected = sheetTables(second).Transactions;
    for (let start = 1; start <= expected.length; start += 5_000) {
      const end = Math.min(start + 4_999, expected.length);
      const range = `'Transactions'!A${start}:R${end}`;
      const page = await google(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(created.spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
      assert.equal(page.values?.length, end - start + 1, `Missing Sheet rows ${start}-${end}`);
      for (let row = 0; row < page.values.length; row++) {
        for (let column = 0; column < 18; column++) assert.equal(String(page.values[row]?.[column] ?? ""), expected[start + row - 1][column] || "", `Sheet mismatch at row ${start + row}, column ${column + 1}`);
      }
    }
    console.log(`Maximum Sheet mirror: all ${expected.length} transaction rows verified against the backup`);
  }
  console.log(`${stage ? "Deployed staging" : "Local"} Worker mirror: backup, bounded Sheet writes${maximum ? " (92,000 rows)" : large ? " (250 rows)" : ""}, conflict, retry, adjacent data, and completion passed`);
  await fs.mkdir(path.join(root, "output"), { recursive: true });
  await fs.writeFile(path.join(root, "output/mirror-verification.json"), JSON.stringify({ passed: true, at: new Date().toISOString(), stage, maximum, resumed: Boolean(resumeUid), rows: second.transactions.length + 1 }, null, 2));
  }
} finally {
  try {
    // The test borrows a production Google grant. Detach it before deleting
    // the synthetic account, so cleanup cannot revoke the real grant.
    await cleanupD1(`UPDATE users SET data=json_remove(data,'$.googleRefreshToken') WHERE uid=${sql(uid)}`);
    const detached = (await cleanupD1(`SELECT json_extract(data,'$.googleRefreshToken') AS grant FROM users WHERE uid=${sql(uid)}`))[0].results;
    assert.ok(!detached.length || detached[0].grant === null, "Google grant must be detached before test account deletion");
    if (detached.length) {
      let cleanup;
      for (let step = 0; step < 100; step++) {
        cleanup = await retryNetwork(`${origin}/v1/me`, { method: "DELETE", headers, signal: AbortSignal.timeout(60_000) });
        if (cleanup.status === 200) break;
        assert.equal(cleanup.status, 202, "Test account cleanup must be resumable");
      }
      assert.equal(cleanup.status, 200, "Test account and R2 cleanup failed");
    }
  } finally {
    worker?.kill();
    if (!stage) await fs.rm(varsFile, { force: true });
    await google(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(created.spreadsheetId)}?fields=id,trashed`, { method: "PATCH", body: JSON.stringify({ trashed: true }) });
  }
}
