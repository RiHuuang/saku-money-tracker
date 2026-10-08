import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { avatar } from "./avatar.test.mjs";
import { decrypt, encryptionKey } from "./crypto.js";

// Exercise real Worker requests and SQLite while an R2 photo write is interrupted.
const bundled = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`);
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(await fs.readFile("worker/schema.sql", "utf8"));
function prepare(sql, values = []) {
  const statement = sqlite.prepare(sql);
  return {
    bind: (...args) => prepare(sql, args),
    first: async () => { try { if (holdSignIn && sql.startsWith("INSERT INTO users (uid,data,revision")) await holdSignIn(); return statement.get(...values) ?? null; } catch (error) { throw new Error(`${sql}: ${values.length} bindings: ${error.message}`); } },
    run: async () => { try { return { meta: { changes: Number(statement.run(...values).changes) } }; } catch (error) { throw new Error(`${sql}: ${values.length} bindings: ${error.message}`); } },
    all: async () => ({ results: statement.all(...values) }),
  };
}
const objects = new Map();
let holdPhoto, holdSignIn;
const env = {
  WRITE_ENABLED: "true",
  PUBLIC_LOGIN_ENABLED: "true",
  GOOGLE_OAUTH_CLIENT_ID: "profile-test-client",
  TOKEN_ENCRYPTION_KEY: nodeCrypto.randomBytes(32).toString("base64"),
  DB: {
    prepare,
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  },
  BUCKET: {
    put: async (key, body, options) => {
      if (holdPhoto && key.startsWith(holdPhoto.prefix)) await holdPhoto();
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      objects.set(key, { bytes, ...options });
      return { size: bytes.length };
    },
    delete: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
    list: async ({ prefix, limit }) => ({ objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).slice(0, limit).map((key) => ({ key })) }),
  },
};
function seed(uid, sessionId, name = "Original") {
  const now = Date.now(), secret = nodeCrypto.randomBytes(32).toString("base64url");
  const hash = nodeCrypto.createHash("sha256").update(secret).digest("hex");
  sqlite.prepare("INSERT INTO users VALUES(?,?,0,NULL,?)").run(uid, JSON.stringify({ name, email: "race@example.invalid", spreadsheetId: "preserved-sheet", spreadsheetUrl: "preserved-link", sheetPending: false }), now);
  sqlite.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run(sessionId, uid, hash, hash, now + 600000, now + 600000, now);
  return { authorization: `Bearer ${sessionId}.${secret}`, "x-saku-user-id": uid };
}
const request = async (path, method, headers, body) => {
  if (path === "/v1/auth/google") body = JSON.stringify({ ...JSON.parse(body), bounded: true });
  const response = await worker.fetch(new Request(`https://saku.example${path}`, { method, headers, body }), env);
  if (path === "/v1/auth/google" && response.status === 202) {
    const { pendingToken } = await response.json();
    return request("/v1/auth/google/finish", "POST", headers, JSON.stringify({ pendingToken }));
  }
  return response;
};
function pausePhoto(prefix = "avatars/") {
  let started, release;
  const began = new Promise((resolve) => { started = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  holdPhoto = () => { holdPhoto = null; started(); return pending; };
  holdPhoto.prefix = prefix;
  return { began, release: () => { holdPhoto = null; release(); } };
}
function pauseSignIn() {
  let started, release;
  const began = new Promise((resolve) => { started = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  holdSignIn = () => { holdSignIn = null; started(); return pending; };
  return { began, release: () => { holdSignIn = null; release(); } };
}
const upload = (headers) => request("/v2/me/avatar?name=Updated", "PUT", { ...headers, "content-type": "image/webp", "content-length": String(avatar.length) }, avatar);
async function deleteUntilDone(headers) {
  for (let step = 0; step < 30; step++) {
    const response = await request("/v1/me", "DELETE", headers);
    if (response.status === 200) return response;
    assert.equal(response.status, 202, "Deletion must either finish or remain resumable");
  }
  throw new Error("Account deletion did not finish within 30 bounded steps");
}
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
const originalFetch = globalThis.fetch;
try {
  const headers = seed("race-user", "original-session");
  const pause = pausePhoto(), profile = upload(headers);
  await pause.began;
  const ledger = '{"version":3,"transactions":[]}';
  assert.equal((await request("/v2/sync?baseRevision=0", "PUT", { ...headers, "content-type": "application/json", "content-length": String(Buffer.byteLength(ledger)), "x-saku-version": "3" }, ledger)).status, 200);
  pause.release();
  assert.equal((await profile).status, 200);
  const current = await (await request("/v1/me", "GET", headers)).json();
  assert.equal(current.user.name, "Updated");
  assert.equal(current.sync.revision, 1);
  assert.equal(current.sync.sheetPending, true, "Profile writes must retain the newer backup's pending mirror");
  assert.equal(current.sync.spreadsheetUrl, "preserved-link");
  assert.match(sqlite.prepare("SELECT snapshot_path FROM users WHERE uid=?").get("race-user").snapshot_path, /^ledgers\/race-user\//);

  const secondPause = pausePhoto(), lateProfile = upload(headers);
  await secondPause.began;
  assert.equal((await deleteUntilDone(headers)).status, 200);
  assert.equal(objects.size, 0, "Deletion must remove legacy and new avatar paths and ledgers");
  const newHeaders = seed("race-user", "new-session", "Recreated");
  objects.set("avatars/race-user.google", { bytes: avatar });
  secondPause.release();
  assert.equal((await lateProfile).status, 401, "An old upload must not mutate a recreated account");
  assert.deepEqual([...objects.keys()], ["avatars/race-user.google"], "Rejected late upload must clean only its own object");
  const recreated = await (await request("/v1/me", "GET", newHeaders)).json();
  assert.equal(recreated.user.name, "Recreated");
  assert.equal(recreated.sync.revision, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM sessions").get().count, 1);

  const backupPause = pausePhoto("ledgers/");
  const lateBackup = request("/v2/sync?baseRevision=0", "PUT", { ...newHeaders, "content-type": "application/json", "content-length": String(Buffer.byteLength(ledger)), "x-saku-version": "3" }, ledger);
  await backupPause.began;
  assert.equal((await deleteUntilDone(newHeaders)).status, 200);
  const nextHeaders = seed("race-user", "next-session", "After backup deletion");
  backupPause.release();
  assert.equal((await lateBackup).status, 409);
  assert.equal(sqlite.prepare("SELECT revision FROM users WHERE uid=?").get("race-user").revision, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM sheet_jobs").get().count, 0);
  assert.equal(objects.size, 0);

  const starting = await request("/v2/sync/start", "POST", { ...nextHeaders, "content-type": "application/json" }, JSON.stringify({ baseRevision: 0, size: 8 }));
  assert.equal(starting.status, 200);
  const { id: uploadId } = await starting.json();
  const chunkPause = pausePhoto("ledgers/");
  const lateChunk = request(`/v2/sync/chunk?id=${uploadId}&index=0`, "PUT", { ...nextHeaders, "content-length": "8" }, "12345678");
  await chunkPause.began;
  assert.equal((await deleteUntilDone(nextHeaders)).status, 200);
  seed("race-user", "final-session", "After chunk deletion");
  chunkPause.release();
  assert.equal((await lateChunk).status, 401);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM snapshot_upload_parts").get().count, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM snapshot_uploads").get().count, 0);
  assert.equal(objects.size, 0);

  const interruptedHeaders = seed("cron-user", "cron-session");
  for (let index = 0; index < 7; index++) objects.set(`ledgers/cron-user/${index}.json`, { bytes: avatar });
  assert.equal((await request("/v1/me", "DELETE", interruptedHeaders)).status, 202);
  assert.equal([...objects.keys()].filter((key) => key.startsWith("ledgers/cron-user/")).length, 7, "The first step must only lock the account");
  assert.equal((await request("/v1/me", "DELETE", interruptedHeaders)).status, 202);
  assert.equal([...objects.keys()].filter((key) => key.startsWith("ledgers/cron-user/")).length, 2, "One deletion step must remove no more than five objects");
  assert.equal((await request("/v1/me", "GET", interruptedHeaders)).status, 410);
  assert.equal((await request("/v1/me", "PUT", { ...interruptedHeaders, "content-type": "application/json" }, '{"name":"Resurrected"}')).status, 410);
  for (let step = 0; step < 20 && sqlite.prepare("SELECT count(*) AS count FROM users WHERE uid='cron-user'").get().count; step++) await worker.scheduled({}, env);
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM users WHERE uid='cron-user'").get().count, 0, "Scheduled cleanup must finish after the client leaves");
  assert.equal(sqlite.prepare("SELECT count(*) AS count FROM sessions WHERE uid='cron-user'").get().count, 0);
  assert.equal([...objects.keys()].filter((key) => key.includes("cron-user")).length, 0);

  const signInHeaders = seed("sign-in-user", "sign-in-session");
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "profile-test", alg: "RS256", use: "sig" };
  const idToken = await new SignJWT({ iss: "https://accounts.google.com", aud: env.GOOGLE_OAUTH_CLIENT_ID, sub: "sign-in-user", email: "fixture@example.invalid", email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600, picture: "https://lh3.googleusercontent.com/test-avatar" }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
  const revoked = new Set();
  let driveGranted = false;
  let googlePhotoCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url) === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
    if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({ id_token: idToken, access_token: "local-fixture", refresh_token: driveGranted ? "drive-fixture" : "identity-only-fixture", scope: `openid email profile${driveGranted ? " https://www.googleapis.com/auth/drive.file" : ""}` });
    if (String(url) === "https://www.googleapis.com/drive/v3/files/preserved-sheet?fields=id,trashed") return Response.json({ id: "preserved-sheet", trashed: true });
    if (String(url) === "https://oauth2.googleapis.com/revoke") {
      assert.ok(["identity-only-fixture", "drive-fixture"].includes(options.body.get("token")));
      revoked.add(options.body.get("token"));
      return new Response(null);
    }
    assert.equal(String(url), "https://lh3.googleusercontent.com/test-avatar");
    googlePhotoCalls++;
    return new Response(avatar, { headers: { "content-type": "image/webp" } });
  };
  const signInPause = pauseSignIn();
  const signingIn = request("/v1/auth/google", "POST", { "content-type": "application/json" }, JSON.stringify({ code: "local-test-code", agreementVersion: "2026-10-03" }));
  await signInPause.began;
  assert.equal((await request("/v2/sync?baseRevision=0", "PUT", { ...signInHeaders, "content-type": "application/json", "content-length": String(Buffer.byteLength(ledger)), "x-saku-version": "3" }, ledger)).status, 200);
  assert.equal((await request("/v1/me", "PUT", { ...signInHeaders, "content-type": "application/json" }, JSON.stringify({ name: "Changed during sign-in", image: `data:image/webp;base64,${avatar.toString("base64")}` }))).status, 200);
  signInPause.release();
  const signInResponse = await signingIn;
  assert.equal(signInResponse.status, 200);
  const signedIn = await signInResponse.json();
  assert.equal(signedIn.sync.sheetPending, true);
  assert.equal(signedIn.sync.revision, 1);
  assert.equal(signedIn.user.name, "Changed during sign-in");
  assert.equal(signedIn.user.avatarSource, "custom");
  assert.equal(googlePhotoCalls, 0, "Google photo retrieval must not delay login");
  const clearedPhoto = await request("/v1/me", "PUT", { ...signInHeaders, "content-type": "application/json" }, JSON.stringify({ name: "Changed during sign-in", image: "" }));
  assert.equal(clearedPhoto.status, 200);
  assert.equal((await clearedPhoto.json()).user.hasAvatar, true, "Google photo fallback must remain available");
  const googlePhoto = await request("/v1/me/avatar", "GET", signInHeaders);
  assert.equal(googlePhoto.status, 200);
  assert.deepEqual(Buffer.from(await googlePhoto.arrayBuffer()), avatar);
  assert.equal(googlePhotoCalls, 1);
  const storedIdentity = JSON.parse(sqlite.prepare("SELECT data FROM users WHERE uid=?").get("sign-in-user").data).googleIdentityRefreshToken;
  assert.notEqual(storedIdentity, "identity-only-fixture");
  assert.equal(await decrypt(storedIdentity, encryptionKey(env.TOKEN_ENCRYPTION_KEY)), "identity-only-fixture");
  const browserCookie = `saku_access=${signInHeaders.authorization.slice(7)}`;
  const driveStart = await request("/auth/google/drive/start", "GET", { cookie: browserCookie });
  assert.equal(driveStart.status, 302);
  const driveState = new URL(driveStart.headers.get("location")).searchParams.get("state");
  driveGranted = true;
  const driveCallback = await request(`/auth/google/drive/callback?state=${driveState}&code=local-code`, "GET", { cookie: `${browserCookie}; saku_drive_state=${driveState}` });
  assert.equal(driveCallback.headers.get("location"), "https://saku.example/?drive=ok");
  const afterDrive = await (await request("/v1/me", "GET", signInHeaders)).json();
  assert.equal(afterDrive.user.name, "Changed during sign-in");
  assert.equal(afterDrive.sync.revision, 1);
  assert.equal((await request("/v1/me", "DELETE", signInHeaders)).status, 202);
  assert.equal((await request("/v1/auth/google", "POST", { "content-type": "application/json" }, JSON.stringify({ code: "local-test-code", agreementVersion: "2026-10-03" }))).status, 409);
  assert.equal((await deleteUntilDone(signInHeaders)).status, 200);
  assert.deepEqual(revoked, new Set(["drive-fixture", "identity-only-fixture"]), "Account deletion must revoke both Google grants");
  console.log("Profile races: metadata and custom photos survive concurrent sign-in/backup; recreated accounts reject late uploads; Drive callback and deletion of both grants pass");
} finally {
  globalThis.fetch = originalFetch;
  delete crypto.subtle.timingSafeEqual;
  sqlite.close();
}
