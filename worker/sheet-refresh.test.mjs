import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { encrypt, decrypt, encryptionKey } from "./crypto.js";

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const db = new DatabaseSync(":memory:");
db.exec(await fs.readFile("worker/schema.sql", "utf8"));
const env = {
  WRITE_ENABLED: "true", TOKEN_ENCRYPTION_KEY: nodeCrypto.randomBytes(32).toString("base64"),
  DB: { prepare(sql) {
    const statement = db.prepare(sql);
    return { bind(...values) { return {
      first: async () => statement.get(...values) || null,
      run: async () => ({ meta: { changes: Number(statement.run(...values).changes) } }),
    }; } };
  } },
};
const originalFetch = globalThis.fetch;
const originalCompare = crypto.subtle.timingSafeEqual;
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
const key = encryptionKey(env.TOKEN_ENCRYPTION_KEY);
async function seed(uid) {
  const grant = await encrypt(`refresh-${uid}`, key);
  const user = { name: "Synthetic", email: "synthetic@example.invalid", spreadsheetId: "test-sheet", googleRefreshToken: grant };
  db.prepare("INSERT INTO users VALUES(?,?,1,'snapshot',?)").run(uid, JSON.stringify(user), Date.now());
  const secret = nodeCrypto.randomBytes(32).toString("base64url"), hash = nodeCrypto.createHash("sha256").update(secret).digest("hex");
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run(uid, uid, hash, hash, Date.now() + 600000, Date.now() + 600000, Date.now());
  db.prepare("INSERT INTO sheet_jobs VALUES(?,NULL,0,'snapshot',1,0,1,?)").run(uid, Date.now());
  return { authorization: `Bearer ${uid}.${secret}`, "content-type": "application/json", "x-saku-user-id": uid };
}
const data = (uid) => JSON.parse(db.prepare("SELECT data FROM users WHERE uid=?").get(uid).data);
const patch = (uid, changes) => db.prepare("UPDATE users SET data=? WHERE uid=?").run(JSON.stringify({ ...data(uid), ...changes }), uid);
const cells = Array(18).fill(""); cells[0] = "synthetic";
const batch = JSON.stringify({ targetRevision: 1, index: 0, range: "'Transactions'!A1:R1", before: [Array(18).fill("")], after: [cells] });
const call = (headers, path, body = "{}", overrides = {}) => worker.fetch(new Request(`https://saku.example${path}`, {
  method: "POST", headers: { ...headers, "content-length": String(Buffer.byteLength(body)) }, body,
}), { ...env, ...overrides });
try {
  const headers = await seed("sheet-cache");
  const urls = [];
  globalThis.fetch = async (url, options = {}) => {
    urls.push(String(url));
    if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "private-access", expires_in: 3600 });
    assert.ok(String(url).startsWith("https://sheets.googleapis.com/"));
    assert.equal(options.headers.authorization, "Bearer private-access");
    return Response.json(options.method === "PUT" ? {} : { values: [] });
  };
  assert.equal((await call(headers, "/v2/sheets/batch", batch)).status, 428);
  assert.equal(urls.length, 0, "cold batch must defer OAuth exchange");
  assert.equal((await call(headers, "/v2/sheets/refresh", "{}", { WRITE_ENABLED: undefined })).status, 503);
  assert.equal(urls.length, 0, "closed write gate must reject refresh");
  const refreshed = await call(headers, "/v2/sheets/refresh");
  assert.equal(refreshed.status, 200);
  assert.deepEqual(await refreshed.json(), { refreshed: true }, "access token must never reach the client");
  assert.equal(await decrypt(data("sheet-cache").googleSheetsAccessToken, key), "private-access");
  assert.ok(!JSON.stringify(data("sheet-cache")).includes("private-access"));
  assert.equal(data("sheet-cache").googleSheetsAccessGrant, data("sheet-cache").googleRefreshToken);
  assert.equal((await call(headers, "/v2/sheets/batch", batch)).status, 200);
  assert.equal(urls.length, 3, "separate exchange followed by only Sheet read/write");
  assert.equal((await call(headers, "/v2/sheets/batch", batch)).status, 200);
  assert.equal(urls.length, 3, "retry must preserve the completed cursor");

  db.prepare("UPDATE sheet_jobs SET cursor=0 WHERE uid='sheet-cache'").run();
  patch("sheet-cache", { googleSheetsAccessExpiresAt: 0 });
  assert.equal((await call(headers, "/v2/sheets/batch", batch)).status, 428);
  patch("sheet-cache", { googleSheetsAccessExpiresAt: Date.now() + 600000, googleRefreshToken: await encrypt("changed-grant", key) });
  assert.equal((await call(headers, "/v2/sheets/batch", batch)).status, 428, "old grant cache must be rejected");
  assert.equal(urls.length, 3);

  for (const mutation of ["logout", "grant", "deleting"]) {
    const uid = `race-${mutation}`, raceHeaders = await seed(uid);
    let release, began;
    const started = new Promise((resolve) => { began = resolve; });
    const paused = new Promise((resolve) => { release = resolve; });
    globalThis.fetch = async () => { began(); await paused; return Response.json({ access_token: "late-access", expires_in: 3600 }); };
    const pending = call(raceHeaders, "/v2/sheets/refresh");
    await started;
    if (mutation === "logout") db.prepare("DELETE FROM sessions WHERE uid=?").run(uid);
    else patch(uid, mutation === "grant" ? { googleRefreshToken: await encrypt("new-grant", key) } : { deleting: true });
    release();
    assert.equal((await pending).status, 409);
    assert.equal(data(uid).googleSheetsAccessToken, undefined, `${mutation} must prevent late token persistence`);
  }
  console.log("Sheet refresh: separated exchange, encrypted cache, expiry, grant/session races and retry passed");
} finally {
  globalThis.fetch = originalFetch;
  crypto.subtle.timingSafeEqual = originalCompare;
  db.close();
}
