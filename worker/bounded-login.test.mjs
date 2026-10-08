import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { decrypt, encryptionKey, hashToken, pkceChallenge } from "./crypto.js";

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}#bounded-login-fixture`);
const db = new DatabaseSync(":memory:");
db.exec(await fs.readFile("worker/schema.sql", "utf8"));
function prepare(sql, args = []) {
  const statement = db.prepare(sql);
  return { bind: (...values) => prepare(sql, values), first: async () => statement.get(...args) || null,
    run: async () => ({ meta: { changes: Number(statement.run(...args).changes) } }) };
}
const env = { PUBLIC_LOGIN_ENABLED: "true", GOOGLE_OAUTH_CLIENT_ID: "bounded-client", TOKEN_ENCRYPTION_KEY: nodeCrypto.randomBytes(32).toString("base64"),
  DB: { prepare, batch: async (statements) => Promise.all(statements.map((statement) => statement.run())) } };
const originalFetch = globalThis.fetch, originalCompare = crypto.subtle.timingSafeEqual;
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(publicKey), kid: "bounded-key", alg: "RS256", use: "sig" };
const idToken = await new SignJWT({ iss: "https://accounts.google.com", aud: env.GOOGLE_OAUTH_CLIENT_ID, sub: "bounded-user", email: "bounded@example.invalid", email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600 })
  .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
let exchanges = 0, verifications = 0, expectedChallenge;
globalThis.fetch = async (url, options) => {
  if (String(url) === "https://www.googleapis.com/oauth2/v3/certs") { verifications++; return Response.json({ keys: [jwk] }); }
  assert.equal(String(url), "https://oauth2.googleapis.com/token");
  exchanges++;
  if (expectedChallenge) assert.equal(await pkceChallenge(options.body.get("code_verifier")), expectedChallenge);
  return Response.json({ id_token: idToken, access_token: "private-google-access", refresh_token: "private-google-refresh", scope: "openid email profile" });
};
const call = (path, method = "GET", body, headers = {}, overrides = {}) => worker.fetch(new Request(`https://saku.example${path}`, {
  method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), { ...env, ...overrides });
const count = (table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
const begin = () => call("/v1/auth/google", "POST", { code: "synthetic-code", agreementVersion: "2026-10-03", bounded: true });
try {
  assert.equal((await call("/v1/auth/google", "POST", { code: "synthetic-code", agreementVersion: "2026-10-03" })).status, 409);
  assert.equal(exchanges, 0, "old clients must fail before expensive login");
  const started = await begin();
  assert.equal(started.status, 202);
  const { pendingToken } = await started.json();
  assert.match(pendingToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(count("users"), 0); assert.equal(count("sessions"), 0);
  assert.equal(verifications, 0, "code exchange and JWT verification must be separate requests");
  const pending = db.prepare("SELECT * FROM oauth_logins").get();
  assert.equal(pending.token_hash, await hashToken(pendingToken));
  assert.ok(!JSON.stringify(pending).includes(pendingToken));
  assert.ok(!pending.payload.includes("private-google"));
  assert.equal(JSON.parse(await decrypt(pending.payload, encryptionKey(env.TOKEN_ENCRYPTION_KEY))).tokens.id_token, idToken);
  assert.equal((await call("/auth/google/finish", "GET", undefined, { cookie: `saku_login_pending=${pendingToken}` })).status, 401);
  assert.equal(count("oauth_logins"), 1, "a different transport must not consume the handle");
  assert.equal((await call("/v1/auth/google/finish", "POST", { pendingToken }, {}, { PUBLIC_LOGIN_ENABLED: undefined })).status, 503);
  const finished = await Promise.all([0, 1].map(() => call("/v1/auth/google/finish", "POST", { pendingToken })));
  assert.deepEqual(finished.map((response) => response.status).sort(), [200, 401]);
  assert.equal(count("sessions"), 1); assert.equal(count("oauth_logins"), 0);
  const authorized = await finished.find((response) => response.status === 200).json();
  assert.equal(authorized.user.id, "bounded-user");
  assert.ok(authorized.accessToken && authorized.refreshToken);
  assert.ok(!JSON.stringify(authorized).includes("private-google"));
  assert.equal((await call("/v1/auth/google/finish", "POST", { pendingToken })).status, 401);

  const expired = await (await begin()).json();
  db.prepare("UPDATE oauth_logins SET expires_at=0").run();
  assert.equal((await call("/v1/auth/google/finish", "POST", expired)).status, 401);
  await worker.scheduled({}, env);
  assert.equal(count("oauth_logins"), 0);

  const start = await call("/auth/google/start");
  const googleUrl = new URL(start.headers.get("location"));
  const state = googleUrl.searchParams.get("state");
  expectedChallenge = googleUrl.searchParams.get("code_challenge");
  assert.equal(googleUrl.searchParams.get("code_challenge_method"), "S256");
  const before = exchanges;
  assert.equal((await call(`/auth/google/callback?state=${state}&code=synthetic-code`, "GET", undefined, { cookie: "saku_oauth_state=wrong" })).status, 403);
  assert.equal(exchanges, before);
  const callback = await call(`/auth/google/callback?state=${state}&code=synthetic-code`, "GET", undefined, { cookie: `saku_oauth_state=${state}` });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "https://saku.example/auth/google/finish");
  const pendingCookie = callback.headers.getSetCookie().find((value) => value.startsWith("saku_login_pending="));
  assert.match(pendingCookie, /Secure; HttpOnly; SameSite=Lax/);
  assert.equal(count("sessions"), 1, "browser callback must not yet create a session");
  const browserFinish = await call("/auth/google/finish", "GET", undefined, { cookie: pendingCookie.split(";")[0] });
  assert.equal(browserFinish.status, 302);
  assert.equal(browserFinish.headers.get("location"), "https://saku.example/?auth=ok");
  const sessionCookies = browserFinish.headers.getSetCookie();
  assert.ok(sessionCookies.some((value) => value.startsWith("saku_access=") && value.includes("HttpOnly")));
  assert.ok(sessionCookies.some((value) => value.startsWith("saku_csrf=")));
  assert.equal((await call("/auth/google/finish", "GET", undefined, { cookie: pendingCookie.split(";")[0] })).status, 401);
  assert.equal(count("sessions"), 2);
  console.log("Bounded login: encrypted handoff, one-use replay, expiry, transport binding, PKCE/state and secure browser cookies passed");
} finally {
  globalThis.fetch = originalFetch; crypto.subtle.timingSafeEqual = originalCompare; db.close();
}
