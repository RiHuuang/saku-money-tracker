import { validAvatar } from "./avatar.js";
import { createRemoteJWKSet } from "jose/jwks/remote";
import { jwtVerify } from "jose/jwt/verify";
import { decrypt, encrypt, encryptionKey, hashToken, pkceChallenge, timingSafeEqual, tokenPart } from "./crypto.js";
import { avatarAfterSignIn, isGoogleAvatarUrl, sessionToken, splitSessionToken } from "../server/src/identity.js";
import { CLEAN_RESERVATION, cleanMessages, parseCleanAnswer, validateCleanInput } from "./merchant-clean.js";
import { aiImportAvailable, importMessages, importVerificationMessages, mergeImportPasses, MODEL, parseImportAnswer, reserveImport, settleImport, USER_BUDGET_TABLE, validateImportInput } from "./import-ai.js";
export { UserLiveUpdates } from "./live.js";

let jwks;
let hasServedRequest = false;
const googleAccess = new Map();
// Older versions still sign in so installed apps keep working; the app then asks for the current one.
const CURRENT_AGREEMENT = "2026-10-26";
const agreementVersions = new Set(["2026-09-28", "2026-09-29", "2026-10-03", CURRENT_AGREEMENT]);
const maxBody = 150_000;
const chunkBytes = 250_000;
const sheetNames = ["Transactions", "Pockets", "Accounts", "Cards", "Recurring", "Quick_entries", "Pocket_transfers", "Existing_installments"];
const sheetWidths = { Transactions: 18, Pockets: 7, Accounts: 1, Cards: 5, Recurring: 12, Quick_entries: 7, Pocket_transfers: 5, Existing_installments: 6 };
const sheetRowLimits = { Transactions: 100001, Pockets: 1001, Accounts: 101, Cards: 31, Recurring: 501, Quick_entries: 31, Pocket_transfers: 10001, Existing_installments: 101 };
const cookieOptions = "Secure; HttpOnly; SameSite=Lax; Path=/";
const legacyAndroidBuild = 7;
const liveRoom = async (env, uid) => env.LIVE_UPDATES.get(env.LIVE_UPDATES.idFromName(await hashToken(uid)));
async function liveNotify(env, uid, notice) {
  if (!env.LIVE_UPDATES) return;
  try { await (await liveRoom(env, uid)).fetch("https://live/notify", { method: "POST", body: JSON.stringify(notice) }); }
  catch (error) { console.error("Live notification failed", { message: error.message }); }
}
async function liveRevoke(env, uid, sessionId) {
  if (!env.LIVE_UPDATES) return;
  try { await (await liveRoom(env, uid)).fetch("https://live/revoke", { method: "POST", body: JSON.stringify({ sessionId }) }); }
  catch (error) { console.error("Live session revocation failed", { message: error.message }); }
}
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const corsHeaders = (origin, env) => origin && (env.ALLOWED_ORIGINS || "https://localhost").split(",").map((value) => value.trim()).includes(origin) ? {
  "access-control-allow-origin": origin,
  "access-control-expose-headers": "x-saku-revision,x-saku-spreadsheet-url,x-saku-sheet-pending,x-saku-encoding",
  vary: "Origin",
} : {};
const fault = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const reply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...headers } });
const cookies = (request) => Object.fromEntries((request.headers.get("cookie") || "").split("; ").filter(Boolean).map((part) => { const at = part.indexOf("="); return [part.slice(0, at), part.slice(at + 1)]; }));
const cookie = (name, value, maxAge) => `${name}=${value}; ${cookieOptions}; Max-Age=${maxAge}`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

async function readBody(request, limit = maxBody) {
  if (Number(request.headers.get("content-length") || 0) > limit) throw fault(413, "Request is too large");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > limit) throw fault(413, "Request is too large");
  try { return JSON.parse(new TextDecoder().decode(bytes) || "{}"); }
  catch { throw fault(400, "Invalid JSON"); }
}

async function googleJson(url, accessToken, options = {}) {
  const response = await fetch(url, { ...options, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...options.headers } });
  // Sheets echoes the entire written range for a successful PUT. Its cells
  // are already in the request, and parsing that echo wastes Worker CPU.
  if (response.ok && options.method === "PUT") return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw fault([401, 429].includes(response.status) ? response.status : 502, `Google API failed (${response.status}): ${result.error?.message || "request rejected"}`);
  return result;
}

async function exchangeCode(env, code, redirectUri, verifier) {
  const params = new URLSearchParams({ client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET, code, grant_type: "authorization_code", redirect_uri: redirectUri });
  if (verifier) params.set("code_verifier", verifier);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.id_token || !result.access_token) throw fault(401, "Google authorization code was rejected");
  return result;
}

async function refreshGoogle(env, encrypted) {
  if (!encrypted) throw fault(401, "Google Drive permission is unavailable; connect Google again");
  const cached = googleAccess.get(encrypted);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  googleAccess.delete(encrypted);
  const params = new URLSearchParams({ client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET, refresh_token: await decrypt(encrypted, encryptionKey(env.TOKEN_ENCRYPTION_KEY)), grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw fault(401, "Google access has expired; sign in again");
  // Reuse Google's access token across a maximum-size mirror in this isolate.
  // Keep the cache bounded and expire before Google does; no persistent token.
  const lifetime = Math.min(3_300_000, Number(result.expires_in || 0) * 1000 - 60_000);
  if (lifetime > 0) {
    if (googleAccess.size >= 128) googleAccess.delete(googleAccess.keys().next().value);
    googleAccess.set(encrypted, { token: result.access_token, expiresAt: Date.now() + lifetime });
  }
  return result.access_token;
}

// A cold Sheet batch must not also pay for a Google token exchange. Persist
// only encrypted, short-lived access; never send it to the device or browser.
async function sheetAccess(env, user) {
  if (!user.googleSheetsAccessToken || user.googleSheetsAccessGrant !== user.googleRefreshToken ||
      !Number.isFinite(user.googleSheetsAccessExpiresAt) || user.googleSheetsAccessExpiresAt <= Date.now()) {
    throw fault(428, "Refresh Google Drive access before continuing the Sheet mirror");
  }
  return decrypt(user.googleSheetsAccessToken, encryptionKey(env.TOKEN_ENCRYPTION_KEY));
}

async function profileFromToken(idToken, clientId) {
  jwks ||= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  const { payload } = await jwtVerify(idToken, jwks, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: clientId, requiredClaims: ["exp", "sub"] });
  if (!payload.sub || !payload.email || payload.email_verified !== true) throw fault(401, "A verified Google account is required");
  return payload;
}

// Separate Google's code exchange from verification/session creation so a cold
// invocation does not do the whole login. Only an opaque one-use handle leaves
// the server; temporary Google credentials are encrypted and expire in minutes.
async function beginLogin(env, tokens, agreementVersion, transport) {
  if (!agreementVersions.has(agreementVersion)) throw fault(400, "Accept the current Saku agreement before signing in");
  const pendingToken = tokenPart();
  const payload = await encrypt(JSON.stringify({ tokens, agreementVersion }), encryptionKey(env.TOKEN_ENCRYPTION_KEY));
  await env.DB.prepare("INSERT INTO oauth_logins(token_hash,payload,transport,expires_at) VALUES(?,?,?,?)")
    .bind(await hashToken(pendingToken), payload, transport, Date.now() + 300_000).run();
  return pendingToken;
}

async function finishLogin(env, pendingToken, transport) {
  if (typeof pendingToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(pendingToken)) throw fault(401, "Google sign-in expired; try again");
  const row = await env.DB.prepare("DELETE FROM oauth_logins WHERE token_hash=? AND transport=? AND expires_at>? RETURNING payload")
    .bind(await hashToken(pendingToken), transport, Date.now()).first();
  if (!row) throw fault(401, "Google sign-in expired; try again");
  const { tokens, agreementVersion } = JSON.parse(await decrypt(row.payload, encryptionKey(env.TOKEN_ENCRYPTION_KEY)));
  return signIn(env, tokens, agreementVersion);
}

async function getUser(env, uid) {
  const row = await env.DB.prepare("SELECT data, revision, snapshot_path FROM users WHERE uid = ?").bind(uid).first();
  return row ? { ...JSON.parse(row.data), revision: row.revision, snapshotPath: row.snapshot_path } : null;
}

async function putUser(env, uid, user, changes) {
  const { revision = 0, snapshotPath = null, ...details } = user;
  const patch = JSON.stringify(changes);
  const row = await env.DB.prepare("INSERT INTO users (uid,data,revision,snapshot_path,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET data=json_patch(users.data,CASE WHEN json_extract(users.data,'$.avatarSource')='custom' THEN json_remove(?,'$.avatarPath','$.avatarSource','$.avatarVersion') ELSE ? END), updated_at=excluded.updated_at WHERE coalesce(json_extract(users.data,'$.deleting'),0)=0 RETURNING data,revision,snapshot_path")
    .bind(uid, JSON.stringify(details), revision, snapshotPath, Date.now(), patch, patch).first();
  if (!row) throw fault(409, "Account deletion is in progress");
  return { ...JSON.parse(row.data), revision: row.revision, snapshotPath: row.snapshot_path };
}

async function patchUser(env, uid, changes, sessionId) {
  const row = await env.DB.prepare("UPDATE users SET data=json_patch(data,?),updated_at=? WHERE uid=? AND coalesce(json_extract(data,'$.deleting'),0)=0 AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND uid=users.uid) RETURNING data,revision,snapshot_path")
    .bind(JSON.stringify(changes), Date.now(), uid, sessionId).first();
  if (!row) throw fault(401, "Account or session changed; sign in again");
  return { ...JSON.parse(row.data), revision: row.revision, snapshotPath: row.snapshot_path };
}

async function saveCustomAvatar(env, auth, name, bytes) {
  const avatarPath = `avatars/${auth.uid}/${crypto.randomUUID()}.webp`;
  await env.BUCKET.put(avatarPath, bytes, { httpMetadata: { contentType: "image/webp" } });
  let next;
  try {
    next = await patchUser(env, auth.uid, { name, avatarPath, avatarSource: "custom", avatarVersion: Date.now().toString(36) }, auth.sessionId);
  } catch (error) {
    await env.BUCKET.delete(avatarPath);
    throw error;
  }
  if (auth.user.avatarPath) await env.BUCKET.delete(auth.user.avatarPath);
  await liveNotify(env, auth.uid, { type: "profile-changed" });
  return next;
}

async function getSheetJob(env, uid) {
  return env.DB.prepare("SELECT baseline_path, baseline_revision, target_path, target_revision, cursor, total FROM sheet_jobs WHERE uid = ?").bind(uid).first();
}

function snapshotManifest(key, object, headers) {
  if (key.endsWith(".manifest.json")) return new Response(object.body, { headers: { ...jsonHeaders, ...headers } });
  return reply({ encoding: key.endsWith(".gz") ? "gzip" : "identity", size: object.size, parts: [{ key, size: object.size }] }, 200, headers);
}

async function commitSnapshot(env, uid, user, baseRevision, key, sessionId) {
  await env.DB.prepare("INSERT OR IGNORE INTO sheet_jobs (uid,baseline_path,baseline_revision,target_path,target_revision,cursor,total,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions JOIN users ON users.uid=sessions.uid WHERE sessions.id=? AND sessions.uid=? AND coalesce(json_extract(users.data,'$.deleting'),0)=0)")
    .bind(uid, user.spreadsheetId && !user.sheetPending ? user.snapshotPath : null, user.spreadsheetId && !user.sheetPending ? user.revision : 0, null, null, 0, 0, Date.now(), sessionId, uid).run();
  const updated = await env.DB.prepare("UPDATE users SET revision=?,snapshot_path=?,updated_at=?,data=json_set(data,'$.sheetPending',json('true')) WHERE uid=? AND revision=? AND coalesce(json_extract(data,'$.deleting'),0)=0 AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND uid=users.uid)")
    .bind(baseRevision + 1, key, Date.now(), uid, baseRevision, sessionId).run();
  if (!updated.meta.changes) {
    const current = await getUser(env, uid);
    if (current?.snapshotPath === key && current.revision === baseRevision + 1) return { revision: current.revision, spreadsheetUrl: current.spreadsheetUrl || "", sheetPending: Boolean(current.sheetPending) };
    await env.BUCKET.delete(key);
    throw fault(409, "Cloud data changed on another device", { revision: current?.revision || 0 });
  }
  await liveNotify(env, uid, { type: "ledger-changed", revision: baseRevision + 1 });
  return { revision: baseRevision + 1, spreadsheetUrl: user.spreadsheetUrl || "", sheetPending: true };
}

function sheetMatches(values, expected) {
  for (let row = 0; row < expected.length; row++) {
    for (let column = 0; column < expected[row].length; column++) {
      if (String(values?.[row]?.[column] ?? "") !== expected[row][column]) return false;
    }
  }
  return true;
}

function sheetChange(input) {
  const match = /^'([A-Za-z_]+)'!A([1-9]\d*):([A-Z])([1-9]\d*)$/.exec(input.range || "");
  if (!match || !sheetNames.includes(match[1])) throw fault(400, "Invalid Sheet range");
  const width = sheetWidths[match[1]], count = Number(match[4]) - Number(match[2]) + 1;
  if (match[3] !== String.fromCharCode(64 + width) || count < 1 || count > 64) throw fault(400, "Invalid Sheet range");
  for (const values of [input.before, input.after]) {
    if (!Array.isArray(values) || values.length !== count || values.some((row) => !Array.isArray(row) || row.length !== width || row.some((cell) => typeof cell !== "string"))) throw fault(400, "Invalid Sheet cells");
  }
  return { range: input.range, before: input.before, after: input.after, count, width };
}

async function issueSession(env, uid, existingId, expectedRefreshHash) {
  const id = existingId || crypto.randomUUID();
  const accessSecret = tokenPart(), refreshSecret = tokenPart(), now = Date.now();
  const [accessHash, refreshHash] = await Promise.all([hashToken(accessSecret), hashToken(refreshSecret)]);
  if (existingId) {
    const updated = await env.DB.prepare("UPDATE sessions SET access_hash=?,refresh_hash=?,access_expires_at=?,refresh_expires_at=?,updated_at=? WHERE id=? AND uid=? AND refresh_hash=? AND refresh_expires_at>?")
      .bind(accessHash, refreshHash, now + 15 * 60_000, now + 30 * 86400_000, now, id, uid, expectedRefreshHash, now).run();
    if (!updated.meta.changes) throw fault(401, "Refresh session changed; retry with the current session");
  } else {
    await env.DB.prepare("INSERT INTO sessions (id,uid,access_hash,refresh_hash,access_expires_at,refresh_expires_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind(id, uid, accessHash, refreshHash, now + 15 * 60_000, now + 30 * 86400_000, now).run();
  }
  return { accessToken: sessionToken(id, accessSecret), refreshToken: sessionToken(id, refreshSecret) };
}

function setBrowserSession(response, session) {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie("saku_access", session.accessToken, 15 * 60));
  headers.append("set-cookie", cookie("saku_refresh", session.refreshToken, 30 * 86400));
  return new Response(response.body, { status: response.status, headers });
}

function clearBrowserSession(response) {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie("saku_access", "", 0));
  headers.append("set-cookie", cookie("saku_refresh", "", 0));
  headers.append("set-cookie", cookie("saku_csrf", "", 0));
  return new Response(response.body, { status: response.status, headers });
}

function checkBrowserMutation(request, env) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin || !origin.startsWith("https://")) throw fault(403, "Invalid request origin");
  const csrf = cookies(request).saku_csrf;
  if (!csrf || !timingSafeEqual(csrf, request.headers.get("x-saku-csrf") || "")) throw fault(403, "Invalid request token");
}

async function authenticate(request, env) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const browser = !bearer;
  if (!browser) {
    const rawBuild = request.headers.get("x-saku-app-build");
    const build = rawBuild === null ? legacyAndroidBuild : Number(rawBuild);
    const minimum = Number(env.MINIMUM_ANDROID_BUILD || 0);
    if (!Number.isSafeInteger(build) || build < 1) throw fault(400, "Invalid Saku app build");
    if (Number.isSafeInteger(minimum) && minimum > build) throw fault(426, "Update Saku to continue cloud sync", { code: "UPDATE_REQUIRED", minimumBuild: minimum });
  }
  if (browser && request.method !== "GET") checkBrowserMutation(request, env);
  const parsed = splitSessionToken(bearer || cookies(request).saku_access);
  if (!parsed) throw fault(401, "Sign in required");
  const row = await env.DB.prepare("SELECT s.uid,s.access_hash,s.access_expires_at,u.data,u.revision,u.snapshot_path FROM sessions s LEFT JOIN users u ON u.uid=s.uid WHERE s.id=?").bind(parsed.id).first();
  if (!row || row.access_expires_at < Date.now() || !timingSafeEqual(row.access_hash, await hashToken(parsed.secret))) throw fault(401, "Session expired");
  const user = row.data ? { ...JSON.parse(row.data), revision: row.revision, snapshotPath: row.snapshot_path } : null;
  return { uid: row.uid, sessionId: parsed.id, browser, user };
}

async function androidReleaseManifest(env) {
  if (env.ANDROID_RELEASE_ENABLED !== "true") throw fault(404, "Android release is not available yet");
  const object = await env.BUCKET.get("releases/android/latest.json");
  if (!object) throw fault(404, "Android release is not available yet");
  let manifest;
  try { manifest = await object.json(); }
  catch { throw fault(503, "Android release metadata is unavailable"); }
  const valid = Number.isSafeInteger(manifest?.versionCode) && manifest.versionCode > 0 &&
    typeof manifest.versionName === "string" && /^\d+\.\d+\.\d+$/.test(manifest.versionName) &&
    Number.isSafeInteger(manifest.minimumSupportedVersionCode) && manifest.minimumSupportedVersionCode > 0 &&
    typeof manifest.releasedAt === "string" && !Number.isNaN(Date.parse(manifest.releasedAt)) &&
    manifest.apkUrl === `/download/android/${manifest.versionCode}.apk` &&
    Number.isSafeInteger(manifest.apkBytes) && manifest.apkBytes > 0 &&
    typeof manifest.sha256 === "string" && /^[a-f0-9]{64}$/.test(manifest.sha256) &&
    Array.isArray(manifest.notes) && manifest.notes.length <= 3 && manifest.notes.every((note) => typeof note === "string" && note.length >= 1 && note.length <= 160);
  if (!valid) throw fault(503, "Android release metadata is unavailable");
  return manifest;
}

async function androidReleaseResponse(request, env, manifest, versioned) {
  const key = `releases/android/${manifest.versionCode}.apk`;
  const object = request.method === "HEAD" ? await env.BUCKET.head(key) : await env.BUCKET.get(key);
  if (!object || object.size !== manifest.apkBytes) throw fault(503, "Android release file is unavailable");
  return new Response(request.method === "HEAD" ? null : object.body, { headers: {
    "content-type": "application/vnd.android.package-archive",
    "content-disposition": `attachment; filename="saku-${manifest.versionName}.apk"`,
    "content-length": String(object.size),
    "cache-control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=300",
    "etag": object.httpEtag,
    "x-content-type-options": "nosniff",
  } });
}

async function provisionSheet(accessToken) {
  const folder = await googleJson("https://www.googleapis.com/drive/v3/files?fields=id,name", accessToken, { method: "POST", body: JSON.stringify({ name: "Saku", mimeType: "application/vnd.google-apps.folder" }) });
  const spreadsheet = await googleJson("https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId,spreadsheetUrl", accessToken, { method: "POST", body: JSON.stringify({ properties: { title: "Saku Money Tracker" }, sheets: sheetNames.map((title) => ({ properties: { title } })) }) });
  const file = await googleJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheet.spreadsheetId)}?fields=parents`, accessToken);
  await googleJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheet.spreadsheetId)}?addParents=${encodeURIComponent(folder.id)}&removeParents=${encodeURIComponent((file.parents || []).join(","))}&fields=id,parents`, accessToken, { method: "PATCH", body: "{}" });
  return { folderId: folder.id, spreadsheetId: spreadsheet.spreadsheetId, spreadsheetUrl: spreadsheet.spreadsheetUrl };
}

async function signIn(env, tokens, agreementVersion) {
  if (!agreementVersions.has(agreementVersion)) throw fault(400, "Accept the current Saku agreement before signing in");
  const profile = await profileFromToken(tokens.id_token, env.GOOGLE_OAUTH_CLIENT_ID);
  const existing = await getUser(env, profile.sub);
  if (existing?.deleting) throw fault(409, "Account deletion is in progress");
  const driveGranted = String(tokens.scope || "").split(" ").includes("https://www.googleapis.com/auth/drive.file");
  let drive = existing || {};
  let sheetPending = !existing?.spreadsheetId;
  if (!drive.spreadsheetId && driveGranted) {
    try { drive = await provisionSheet(tokens.access_token); sheetPending = false; }
    catch (error) { console.error("Sheet setup failed", { uid: profile.sub, message: error.message }); }
  }
  const googleAvatarUrl = typeof profile.picture === "string" && profile.picture.length <= 2048 && isGoogleAvatarUrl(profile.picture) ? profile.picture : existing?.googleAvatarUrl || null;
  const avatar = avatarAfterSignIn(existing, null, Date.now().toString(36));
  const encryptedRefreshToken = tokens.refresh_token ? await encrypt(tokens.refresh_token, encryptionKey(env.TOKEN_ENCRYPTION_KEY)) : null;
  const user = {
    ...existing, ...avatar, googleAvatarUrl, email: profile.email, name: existing?.name || profile.name || profile.email.split("@")[0],
    folderId: drive.folderId, spreadsheetId: drive.spreadsheetId, spreadsheetUrl: drive.spreadsheetUrl,
    googleRefreshToken: driveGranted && encryptedRefreshToken ? encryptedRefreshToken : existing?.googleRefreshToken,
    googleIdentityRefreshToken: !driveGranted && encryptedRefreshToken ? encryptedRefreshToken : existing?.googleIdentityRefreshToken,
    agreementVersion, agreementAcceptedAt: Date.now(), sheetPending: sheetPending || existing?.sheetPending || false,
    revision: existing?.revision || 0, snapshotPath: existing?.snapshotPath || null,
  };
  const changes = { email: user.email, agreementVersion, agreementAcceptedAt: user.agreementAcceptedAt, googleAvatarUrl };
  if (!existing?.name) changes.name = user.name;
  if (!existing?.spreadsheetId && drive.spreadsheetId) Object.assign(changes, { folderId: drive.folderId, spreadsheetId: drive.spreadsheetId, spreadsheetUrl: drive.spreadsheetUrl, sheetPending: true });
  if (encryptedRefreshToken) changes[driveGranted ? "googleRefreshToken" : "googleIdentityRefreshToken"] = encryptedRefreshToken;
  const saved = await putUser(env, profile.sub, user, changes);
  const session = await issueSession(env, profile.sub);
  return { session, user: publicUser(profile.sub, saved), sync: { revision: saved.revision, spreadsheetUrl: saved.spreadsheetUrl || "", sheetPending: saved.sheetPending } };
}

function publicUser(uid, value) {
  return { id: uid, name: value.name, email: value.email, hasAvatar: Boolean(value.avatarPath || value.googleAvatarUrl), avatarSource: value.avatarSource || (value.googleAvatarUrl ? "google" : undefined), avatarVersion: value.avatarVersion || "legacy", agreementVersion: value.agreementVersion || "" };
}

async function connectDrive(env, uid, tokens, sessionId) {
  const profile = await profileFromToken(tokens.id_token, env.GOOGLE_OAUTH_CLIENT_ID);
  if (profile.sub !== uid) throw fault(403, "Choose the same Google account used for Saku");
  if (!String(tokens.scope || "").split(" ").includes("https://www.googleapis.com/auth/drive.file") || !tokens.refresh_token) throw fault(400, "Google Drive permission was not granted");
  const user = await getUser(env, uid);
  if (!user) throw fault(404, "Account not found");
  if (user.deleting) throw fault(410, "Account deletion is in progress");
  let drive = user;
  if (!user.spreadsheetId) drive = await provisionSheet(tokens.access_token);
  await patchUser(env, uid, { folderId: drive.folderId, spreadsheetId: drive.spreadsheetId, spreadsheetUrl: drive.spreadsheetUrl, googleRefreshToken: await encrypt(tokens.refresh_token, encryptionKey(env.TOKEN_ENCRYPTION_KEY)), sheetPending: true }, sessionId);
  return { spreadsheetUrl: drive.spreadsheetUrl, sheetPending: true };
}

async function deletionStep(env, uid) {
  const lease = crypto.randomUUID();
  const row = await env.DB.prepare("UPDATE users SET data=json_set(data,'$.deletionLease',?,'$.deletionLeaseUntil',?) WHERE uid=? AND json_extract(data,'$.deleting')=1 AND coalesce(json_extract(data,'$.deletionLeaseUntil'),0)<? RETURNING data")
    .bind(lease, Date.now() + 60_000, uid, Date.now()).first();
  if (!row) return { done: !(await getUser(env, uid)) };
  const user = JSON.parse(row.data);
  const mark = async (field) => {
    const updated = await env.DB.prepare("UPDATE users SET data=json_set(data,?,json('true')) WHERE uid=? AND json_extract(data,'$.deletionLease')=?")
      .bind(`$.${field}`, uid, lease).run();
    if (!updated.meta.changes) throw fault(409, "Account deletion changed; retry");
  };
  try {
    for (const prefix of [`ledgers/${uid}/`, `avatars/${uid}/`]) {
      const page = await env.BUCKET.list({ prefix, limit: 5 });
      if (page.objects.length) {
        await env.BUCKET.delete(page.objects.map((object) => object.key));
        return { done: false };
      }
    }
    if (!user.deletionLegacyCleaned) {
      await env.BUCKET.delete([`avatars/${uid}.webp`, `avatars/${uid}.google`]);
      await mark("deletionLegacyCleaned");
      return { done: false };
    }
    if (!user.deletionDriveCleaned) {
      if (user.googleRefreshToken) {
        try {
          const token = await refreshGoogle(env, user.googleRefreshToken);
          const fileId = user.folderId || user.spreadsheetId;
          if (fileId) await googleJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`, token, { method: "PATCH", body: JSON.stringify({ trashed: true }) });
        } catch (error) {
          console.error("Could not trash Drive data", { uid, message: error.message });
          await mark("deletionDriveFailed");
        }
      }
      await mark("deletionDriveCleaned");
      return { done: false };
    }
    for (const [field, encrypted] of [["deletionDriveRevoked", user.googleRefreshToken], ["deletionIdentityRevoked", user.googleIdentityRefreshToken]]) {
      if (user[field]) continue;
      if (encrypted) {
        const response = await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: await decrypt(encrypted, encryptionKey(env.TOKEN_ENCRYPTION_KEY)) }), signal: AbortSignal.timeout(15_000) });
        if (!response.ok && response.status !== 400) throw fault(503, "Google access revocation is unavailable; retry deletion");
        googleAccess.delete(encrypted);
      }
      await mark(field);
      return { done: false };
    }
    const condition = "EXISTS(SELECT 1 FROM users WHERE users.uid=? AND json_extract(users.data,'$.deleting')=1 AND json_extract(users.data,'$.deletionLease')=?)";
    const results = await env.DB.batch([
      env.DB.prepare(`DELETE FROM sessions WHERE uid=? AND ${condition}`).bind(uid, uid, lease),
      env.DB.prepare(`DELETE FROM oauth_drive_states WHERE uid=? AND ${condition}`).bind(uid, uid, lease),
      env.DB.prepare("DELETE FROM users WHERE uid=? AND json_extract(data,'$.deleting')=1 AND json_extract(data,'$.deletionLease')=?").bind(uid, lease),
    ]);
    if (!results[2].meta.changes) throw fault(409, "Account deletion changed; retry");
    return { done: true, driveCleanupFailed: Boolean(user.deletionDriveFailed) };
  } finally {
    await env.DB.prepare("UPDATE users SET data=json_remove(data,'$.deletionLease','$.deletionLeaseUntil') WHERE uid=? AND json_extract(data,'$.deletionLease')=?").bind(uid, lease).run();
  }
}

async function deleteAccount(env, uid, user, sessionId) {
  if (!user.deleting) {
    const started = await env.DB.prepare("UPDATE users SET data=json_set(data,'$.deleting',json('true')) WHERE uid=? AND coalesce(json_extract(data,'$.deleting'),0)=0 AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND uid=users.uid)")
      .bind(uid, sessionId).run();
    if (started.meta.changes) {
      await env.DB.prepare(USER_BUDGET_TABLE).run();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM import_ai_user_budget WHERE uid=?").bind(uid),
        env.DB.prepare("DELETE FROM sessions WHERE uid=? AND id<>?").bind(uid, sessionId),
        env.DB.prepare("DELETE FROM snapshot_upload_parts WHERE id IN (SELECT id FROM snapshot_uploads WHERE uid=?)").bind(uid),
        env.DB.prepare("DELETE FROM snapshot_uploads WHERE uid=?").bind(uid),
        env.DB.prepare("DELETE FROM sheet_jobs WHERE uid=?").bind(uid),
      ]);
      return { done: false };
    }
  }
  return deletionStep(env, uid);
}

function legalPage(path, env) {
  const email = escapeHtml(env.SUPPORT_EMAIL);
  const pages = {
    "/privacy": ["Privacy Notice", `<p>Saku processes your Google account identifier, email, name, optional profile image, financial ledger, sync revision, and authentication tokens to provide sign-in and synchronization. Your ledger and image are stored privately using Cloudflare Workers, D1, and R2. A readable mirror is stored in a spreadsheet owned by your Google account. Google refresh tokens are encrypted; Saku session secrets are stored as hashes.</p><p>When you choose AI import, Saku sends selected statement text or page images to Cloudflare Workers AI for transaction extraction. The original files and review drafts remain on your device; Saku does not add them to ledger backups or Sheets. Accepted transactions sync as part of your ledger. You can export data, sign out, revoke Saku access in Google, or delete your account from Settings.</p><p>On Android you can choose to let Saku read notifications from the bank and e-wallet apps you select. Saku checks the app before reading anything else, keeps only the amount, direction, balance and merchant name with account and reference numbers removed, encrypts them on your phone and deletes them after seven days, on sign-out or on account deletion. Notification text is never uploaded or synced. Only transactions you add join your ledger. You can pause or turn this off in Settings or Android's notification access settings at any time. If you also turn on name tidying, merchant names Saku hasn't seen before, with long numbers removed, are sent to Cloudflare Workers AI once each; amounts, accounts and notification text are not.</p>`],
    "/terms": ["User Agreement", `<p>Saku helps you record and review information you provide. It is not a bank or financial adviser. You remain responsible for checking entries, statement matches, budgets, taxes, and payments.</p><p>You retain ownership of your ledger. You authorize Saku to process it for sign-in, backup, automatic synchronization, profile images, and Google Sheets mirroring. Reading bank and e-wallet notifications on Android is optional, uses only the apps you enable, and creates suggestions you review; it never records a transaction without your confirmation. Offline features can continue without cloud service. You can export or delete your account from Settings.</p>`],
    "/account-deletion": ["Delete your Saku account", `<p>In Saku Settings, choose Delete account and type DELETE. This removes your Saku cloud identity, sessions, ledger snapshots, and profile image, revokes Google access, and asks Google Drive to trash the Saku-created folder. If you cannot access the app, email <a href="mailto:${email}">${email}</a> from the Google address used for Saku.</p>`],
  };
  const [title, body] = pages[path] || ["Saku", `<p>Saku is an offline-first money tracker. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/account-deletion">Account deletion</a></p>`];
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title} - Saku</title><style>
    :root{color-scheme:light;--canvas:#f7f6f0;--surface:#fff;--ink:#203b33;--muted:#60746a;--line:#dbe6dc;--teal:#176b55;--soft:#e4efe8}
    @media(prefers-color-scheme:dark){:root{color-scheme:dark;--canvas:#101d18;--surface:#192c24;--ink:#edf3ed;--muted:#aec3b5;--line:#365144;--teal:#92d3b1;--soft:#284638}}
    *{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}a{color:var(--teal);font-weight:650;text-underline-offset:3px}header{border-bottom:1px solid var(--line);background:var(--surface)}header div{max-width:820px;margin:auto;padding:20px 24px}.brand{display:inline-flex;align-items:center;gap:10px;color:var(--ink);font-size:22px;font-weight:800;letter-spacing:-.04em;text-decoration:none}.mark{display:grid;width:34px;height:34px;place-items:center;border-radius:10px 10px 10px 4px;background:var(--teal);color:var(--surface);font-size:16px}.period{color:var(--teal)}main{max-width:820px;margin:auto;padding:54px 24px 88px}.eyebrow{margin:0 0 8px;color:var(--teal);font-size:12px;font-weight:700}h1{max-width:18ch;margin:0;color:var(--ink);font-size:clamp(34px,7vw,54px);line-height:1.04;letter-spacing:-.045em}time{display:block;margin:14px 0 30px;color:var(--muted);font-size:13px}.legal-copy{padding:26px 28px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}p{margin:0 0 18px}p:last-child{margin-bottom:0}.contact{margin-top:18px;padding:18px 20px;border-left:4px solid var(--teal);border-radius:4px 14px 14px 4px;background:var(--soft)}a:focus-visible{outline:3px solid var(--teal);outline-offset:4px;border-radius:3px}@media(max-width:560px){header div{padding:16px 18px}main{padding:38px 18px 64px}.legal-copy{padding:22px 20px}h1{font-size:36px}}
  </style></head><body><header><div><a class="brand" href="/"><span class="mark" aria-hidden="true">S</span><span>saku<span class="period">.</span></span></a></div></header><main><p class="eyebrow">Your money, in balance</p><h1>${title}</h1><time datetime="2026-10-26">Effective 26 October 2026</time><article class="legal-copy">${body}</article><p class="contact">Questions: <a href="mailto:${email}">${email}</a></p></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" } });
}

async function route(request, env) {
  const url = new URL(request.url), path = url.pathname, origin = request.headers.get("origin");
  if (url.hostname === "saku.saku-money-manager.workers.dev") {
    const successor = "https://app.sakumoney.my.id";
    if (["GET", "HEAD"].includes(request.method) && (path === "/" || ["/privacy", "/terms", "/account-deletion"].includes(path))) {
      return Response.redirect(`${successor}${path}`, 308);
    }
    if (["GET", "HEAD"].includes(request.method) && path.startsWith("/auth/")) {
      return Response.redirect(`${successor}/`, 302);
    }
    return reply({ error: "Update Saku to continue cloud sync.", code: "UPDATE_REQUIRED", updateUrl: successor }, 426);
  }
  if (["GET", "HEAD"].includes(request.method) && path === "/") return env.ASSETS.fetch(request);
  const allowedOrigins = new Set((env.ALLOWED_ORIGINS || "https://localhost").split(",").map((item) => item.trim()));
  const cors = corsHeaders(origin, env);
  if (origin && origin !== url.origin && !allowedOrigins.has(origin)) throw fault(403, "Origin is not allowed");
  if (request.method === "GET" && path === "/v1/live") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") throw fault(400, "WebSocket required");
    const room = url.searchParams.get("room"), ticket = url.searchParams.get("ticket");
    if (!room || !/^[a-f0-9]{64}$/.test(room) || !ticket || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw fault(401, "Invalid live ticket");
    return env.LIVE_UPDATES.get(env.LIVE_UPDATES.idFromName(room)).fetch(new Request(`https://live/connect?hash=${encodeURIComponent(await hashToken(ticket))}`, request));
  }
  if (request.method === "OPTIONS" && /^\/v[12]\//.test(path)) return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-headers": "authorization,content-type,x-saku-version,x-saku-user-id,x-saku-app-build", "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS" } });
  if (request.method === "GET" && ["/", "/privacy", "/terms", "/account-deletion"].includes(path) && path !== "/") return legalPage(path, env);
  if (request.method === "GET" && path === "/health") return reply({ ok: true });
  if (request.method === "GET" && path === "/v1/releases/android/latest") return reply(await androidReleaseManifest(env), 200, { ...cors, "cache-control": "public, max-age=300" });
  if (["GET", "HEAD"].includes(request.method) && path === "/download/saku.apk") return androidReleaseResponse(request, env, await androidReleaseManifest(env), false);
  const androidDownload = path.match(/^\/download\/android\/(\d+)\.apk$/);
  if (["GET", "HEAD"].includes(request.method) && androidDownload) {
    const manifest = await androidReleaseManifest(env);
    if (Number(androidDownload[1]) !== manifest.versionCode) throw fault(404, "Android release is not available");
    return androidReleaseResponse(request, env, manifest, true);
  }

  if (request.method === "GET" && path === "/auth/google/start") {
    if (env.PUBLIC_LOGIN_ENABLED !== "true") throw fault(503, "Public login is not enabled yet");
    const state = tokenPart(), verifier = tokenPart(), challenge = await pkceChallenge(verifier);
    await env.DB.prepare("INSERT INTO oauth_states (state_hash,verifier,expires_at) VALUES (?,?,?)").bind(await hashToken(state), verifier, Date.now() + 10 * 60_000).run();
    const redirect = `${url.origin}/auth/google/callback`;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.search = new URLSearchParams({ client_id: env.GOOGLE_OAUTH_CLIENT_ID, redirect_uri: redirect, response_type: "code", scope: "openid email profile", access_type: "offline", prompt: "consent", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
    const redirectResponse = Response.redirect(authUrl, 302);
    const headers = new Headers(redirectResponse.headers);
    headers.append("set-cookie", cookie("saku_oauth_state", state, 10 * 60));
    return new Response(null, { status: 302, headers });
  }
  if (request.method === "GET" && path === "/auth/google/callback") {
    if (env.PUBLIC_LOGIN_ENABLED !== "true") throw fault(503, "Public login is not enabled yet");
    const state = url.searchParams.get("state"), code = url.searchParams.get("code");
    if (!state || !code) return Response.redirect(`${url.origin}/?auth=cancelled`, 302);
    if (!timingSafeEqual(cookies(request).saku_oauth_state || "", state)) throw fault(403, "Invalid Google sign-in state");
    const key = await hashToken(state);
    const row = await env.DB.prepare("SELECT verifier,expires_at FROM oauth_states WHERE state_hash = ?").bind(key).first();
    if (!row || row.expires_at < Date.now()) throw fault(400, "Google sign-in expired; try again");
    await env.DB.prepare("DELETE FROM oauth_states WHERE state_hash = ?").bind(key).run();
    const tokens = await exchangeCode(env, code, `${url.origin}/auth/google/callback`, row.verifier);
    const pendingToken = await beginLogin(env, tokens, CURRENT_AGREEMENT, "browser");
    const headers = new Headers({ location: `${url.origin}/auth/google/finish`, "cache-control": "no-store" });
    headers.append("set-cookie", cookie("saku_login_pending", pendingToken, 300));
    headers.append("set-cookie", cookie("saku_oauth_state", "", 0));
    return new Response(null, { status: 302, headers });
  }
  if (request.method === "GET" && path === "/auth/google/finish") {
    if (env.PUBLIC_LOGIN_ENABLED !== "true") throw fault(503, "Public login is not enabled yet");
    const result = await finishLogin(env, cookies(request).saku_login_pending, "browser");
    const csrf = tokenPart();
    const headers = new Headers({ location: `${url.origin}/?auth=ok`, "cache-control": "no-store" });
    headers.append("set-cookie", cookie("saku_access", result.session.accessToken, 15 * 60));
    headers.append("set-cookie", cookie("saku_refresh", result.session.refreshToken, 30 * 86400));
    headers.append("set-cookie", `saku_csrf=${csrf}; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 86400}`);
    headers.append("set-cookie", cookie("saku_login_pending", "", 0));
    return new Response(null, { status: 302, headers });
  }
  if (request.method === "GET" && path === "/auth/google/drive/start") {
    if (env.PUBLIC_LOGIN_ENABLED !== "true") throw fault(503, "Public login is not enabled yet");
    if (env.WRITE_ENABLED !== "true") throw fault(503, "Cloud writes are paused for migration");
    const auth = await authenticate(request, env);
    const state = tokenPart(), verifier = tokenPart();
    const challenge = await pkceChallenge(verifier);
    await env.DB.prepare("INSERT INTO oauth_drive_states(state_hash,uid,verifier,expires_at) VALUES(?,?,?,?)")
      .bind(await hashToken(state), auth.uid, verifier, Date.now() + 10 * 60_000).run();
    const redirect = `${url.origin}/auth/google/drive/callback`;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.search = new URLSearchParams({ client_id: env.GOOGLE_OAUTH_CLIENT_ID, redirect_uri: redirect, response_type: "code", scope: "openid email profile https://www.googleapis.com/auth/drive.file", access_type: "offline", prompt: "consent", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
    const headers = new Headers({ location: authUrl.toString() });
    headers.append("set-cookie", cookie("saku_drive_state", state, 10 * 60));
    return new Response(null, { status: 302, headers });
  }
  if (request.method === "GET" && path === "/auth/google/drive/callback") {
    if (env.PUBLIC_LOGIN_ENABLED !== "true" || env.WRITE_ENABLED !== "true") throw fault(503, "Cloud writes are paused for migration");
    const state = url.searchParams.get("state"), code = url.searchParams.get("code");
    if (!state || !code) return Response.redirect(`${url.origin}/?drive=cancelled`, 302);
    if (!timingSafeEqual(cookies(request).saku_drive_state || "", state)) throw fault(403, "Invalid Google authorization state");
    const key = await hashToken(state);
    const row = await env.DB.prepare("SELECT uid,verifier,expires_at FROM oauth_drive_states WHERE state_hash=?").bind(key).first();
    if (!row || row.expires_at < Date.now()) throw fault(400, "Google authorization expired; try again");
    await env.DB.prepare("DELETE FROM oauth_drive_states WHERE state_hash=?").bind(key).run();
    try {
      const tokens = await exchangeCode(env, code, `${url.origin}/auth/google/drive/callback`, row.verifier);
      const auth = await authenticate(request, env);
      if (auth.uid !== row.uid) throw fault(403, "Google account changed during authorization");
      await connectDrive(env, row.uid, tokens, auth.sessionId);
      const headers = new Headers({ location: `${url.origin}/?drive=ok` });
      headers.append("set-cookie", cookie("saku_drive_state", "", 0));
      return new Response(null, { status: 302, headers });
    } catch (error) {
      console.error("Drive connection failed", { message: error.message });
      return Response.redirect(`${url.origin}/?drive=failed`, 302);
    }
  }

  if (request.method === "POST" && path === "/v1/auth/google") {
    if (env.PUBLIC_LOGIN_ENABLED !== "true") throw fault(503, "Public login is not enabled yet");
    const input = await readBody(request);
    if (input.bounded !== true) throw fault(409, "Update Saku to complete Google sign-in");
    if (typeof input.code !== "string" || input.code.length < 10) throw fault(400, "Invalid authorization response");
    if (!agreementVersions.has(input.agreementVersion)) throw fault(400, "Accept the current Saku agreement before signing in");
    const pendingToken = await beginLogin(env, await exchangeCode(env, input.code, ""), input.agreementVersion, "android");
    return reply({ pendingToken }, 202, cors);
  }
  if (request.method === "POST" && path === "/v1/auth/google/finish") {
    if (env.PUBLIC_LOGIN_ENABLED !== "true") throw fault(503, "Public login is not enabled yet");
    const input = await readBody(request);
    const result = await finishLogin(env, input.pendingToken, "android");
    return reply({ ...result.session, user: result.user, sync: result.sync }, 200, cors);
  }
  if (request.method === "POST" && path === "/v1/auth/refresh") {
    const browser = !request.headers.get("authorization") && Boolean(cookies(request).saku_refresh);
    if (browser) checkBrowserMutation(request, env);
    const value = browser ? cookies(request).saku_refresh : (await readBody(request)).refreshToken;
    const parsed = splitSessionToken(value);
    if (!parsed) throw fault(401, "Invalid refresh session");
    const row = await env.DB.prepare("SELECT uid,refresh_hash,refresh_expires_at FROM sessions WHERE id = ?").bind(parsed.id).first();
    if (!row || row.refresh_expires_at < Date.now() || !timingSafeEqual(row.refresh_hash, await hashToken(parsed.secret))) throw fault(401, "Refresh session expired");
    const next = await issueSession(env, row.uid, parsed.id, row.refresh_hash);
    return browser ? setBrowserSession(reply({ ok: true }), next) : reply(next, 200, cors);
  }

  if (!path.startsWith("/v1/") && !path.startsWith("/v2/")) return env.ASSETS.fetch(request);
  const auth = await authenticate(request, env);
  const expectedUid = request.headers.get("x-saku-user-id");
  if (expectedUid && expectedUid !== auth.uid) throw fault(409, "Google account changed during synchronization");
  if (auth.browser && request.method !== "GET" && (path.startsWith("/v2/") || path === "/v1/me" || path === "/v1/me/agreement" || path === "/v1/live-ticket") && expectedUid !== auth.uid) throw fault(403, "Account identity is required");
  const user = auth.user;
  if (!user) throw fault(404, "Account not found");
  if (user.deleting && !(request.method === "DELETE" && path === "/v1/me")) throw fault(410, "Account deletion is in progress");
  if (env.WRITE_ENABLED !== "true" && ((request.method === "PUT" && (path === "/v1/me" || path.startsWith("/v2/"))) || (request.method === "DELETE" && path === "/v1/me") || (request.method === "POST" && (path === "/v1/auth/google/drive" || path.startsWith("/v2/"))))) throw fault(503, "Cloud writes are paused for migration");
  if (request.method === "POST" && path === "/v1/merchants/clean") {
    if (expectedUid !== auth.uid) throw fault(403, "Account identity is required");
    if (!aiImportAvailable(env)) throw fault(503, "AI name cleaning is unavailable");
    let names;
    try { names = validateCleanInput(await readBody(request, 8_000)); }
    catch (error) { throw fault(400, error.message); }
    const day = new Date().toISOString().slice(0, 10);
    const reservation = await reserveImport(env.DB, day, auth.uid, CLEAN_RESERVATION);
    if (!reservation.reserved) throw fault(429, reservation.limit === "user" ? "You've used today's AI allowance for your account." : "Saku's shared AI allowance is used for today.");
    let answer;
    try { answer = await env.AI.run(MODEL, { messages: cleanMessages(names), max_completion_tokens: 512, temperature: 0, seed: 0, chat_template_kwargs: { enable_thinking: false }, response_format: { type: "json_object" }, store: false, n: 1 }); }
    catch { await settleImport(env.DB, day, auth.uid, { usage: { prompt_tokens: 0, completion_tokens: 0 } }, CLEAN_RESERVATION); throw fault(502, "Names could not be tidied right now."); }
    await settleImport(env.DB, day, auth.uid, answer, CLEAN_RESERVATION);
    return reply({ results: parseCleanAnswer(answer, names) }, 200, cors);
  }
  if (request.method === "POST" && path === "/v1/import/extract") {
    if (expectedUid !== auth.uid) throw fault(403, "Account identity is required");
    if (!aiImportAvailable(env)) throw fault(503, "AI import is unavailable");
    const body = await readBody(request, 3_100_000);
    let input;
    try { input = validateImportInput(body); }
    catch (error) { throw fault(400, error.message); }
    const day = new Date().toISOString().slice(0, 10);
    const runPass = async (messages) => {
      const reservation = await reserveImport(env.DB, day, auth.uid);
      if (!reservation.reserved) throw fault(429, reservation.limit === "user" ? "You've used today's AI import allowance for your account. Your draft is saved on this device; try again after 07:00 WIB." : "Saku's shared AI import allowance is used for today. Your draft is saved on this device; try again after 07:00 WIB.");
      const answer = await env.AI.run(MODEL, { messages, max_completion_tokens: 4096, temperature: 0, seed: 0, chat_template_kwargs: { enable_thinking: false }, response_format: { type: "json_object" }, store: false, n: 1 });
      await settleImport(env.DB, day, auth.uid, answer);
      return answer;
    };
    try {
      const firstRows = parseImportAnswer(await runPass(importMessages(input)), input.kind, input.month, input.kind === "text" ? input.text : "");
      const verifiedRows = parseImportAnswer(await runPass(importVerificationMessages(input, firstRows)), input.kind, input.month, input.kind === "text" ? input.text : "");
      return reply({ rows: mergeImportPasses(firstRows, verifiedRows) }, 200, cors);
    } catch (error) {
      if (error?.status === 429) throw error;
      throw fault(502, "Could not extract this page. It remains in your local draft for retry.");
    }
  }
  if (request.method === "POST" && path === "/v1/auth/logout") {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(auth.sessionId).run();
    await liveRevoke(env, auth.uid, auth.sessionId);
    return auth.browser ? clearBrowserSession(reply({ ok: true })) : reply({ ok: true }, 200, cors);
  }
  if (request.method === "POST" && path === "/v1/auth/google/drive") {
    const input = await readBody(request);
    if (typeof input.code !== "string" || input.code.length < 10) throw fault(400, "Invalid authorization response");
    return reply(await connectDrive(env, auth.uid, await exchangeCode(env, input.code, ""), auth.sessionId), 200, cors);
  }
  if (request.method === "DELETE" && path === "/v1/me") {
    const result = await deleteAccount(env, auth.uid, user, auth.sessionId);
    await liveRevoke(env, auth.uid, null);
    const response = reply(result.done ? { ok: true, driveCleanupFailed: Boolean(result.driveCleanupFailed) } : { pending: true }, result.done ? 200 : 202, cors);
    return auth.browser && result.done ? clearBrowserSession(response) : response;
  }
  const ownUser = (value) => publicUser(auth.uid, value);
  if (request.method === "POST" && path === "/v1/live-ticket") {
    const ticket = tokenPart(), room = await hashToken(auth.uid);
    await env.LIVE_UPDATES.get(env.LIVE_UPDATES.idFromName(room)).fetch("https://live/ticket", { method: "POST", body: JSON.stringify({ hash: await hashToken(ticket), sessionId: auth.sessionId, expiresAt: Date.now() + 30_000 }) });
    return reply({ room, ticket }, 200, cors);
  }
  if (request.method === "GET" && path === "/v1/me") return reply({ user: ownUser(user), sync: { revision: user.revision, spreadsheetUrl: user.spreadsheetUrl || "", sheetPending: Boolean(user.sheetPending) } }, 200, cors);
  if (request.method === "PUT" && path === "/v2/me/avatar") {
    const name = (url.searchParams.get("name") || "").trim(), size = Number(request.headers.get("content-length"));
    if (!name || name.length > 40) throw fault(400, "Enter a profile name up to 40 characters");
    if (request.headers.get("content-type") !== "image/webp" || !Number.isSafeInteger(size) || size < 1 || size > 3_000_000) throw fault(400, "Choose a valid profile image");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length !== size || !validAvatar(bytes)) throw fault(400, "Choose a static profile image up to 512 pixels");
    const next = await saveCustomAvatar(env, auth, name, bytes);
    return reply({ user: ownUser(next) }, 200, cors);
  }
  if (request.method === "POST" && path === "/v1/me/agreement") {
    const input = await readBody(request);
    if (input.agreementVersion !== CURRENT_AGREEMENT) throw fault(400, "Accept the current Saku agreement");
    const next = await patchUser(env, auth.uid, { agreementVersion: CURRENT_AGREEMENT, agreementAcceptedAt: Date.now() }, auth.sessionId);
    return reply({ user: ownUser(next) }, 200, cors);
  }
  if (request.method === "PUT" && path === "/v1/me") {
    if (Number(request.headers.get("content-length")) > maxBody) throw fault(413, "Use binary profile image uploads for larger photos");
    const input = await readBody(request), name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 40) throw fault(400, "Enter a profile name up to 40 characters");
    let avatarPath = user.avatarPath || null, avatarSource = user.avatarSource || (avatarPath ? "google" : null), avatarVersion = user.avatarVersion || "legacy";
    if (input.image !== undefined) {
      if (input.image === "") {
        avatarPath = null; avatarSource = null; avatarVersion = Date.now().toString(36);
      } else if (typeof input.image === "string" && /^data:image\/webp;base64,/.test(input.image) && input.image.length < 4_000_000) {
        const bytes = Uint8Array.from(atob(input.image.slice(input.image.indexOf(",") + 1)), (character) => character.charCodeAt(0));
        if (!validAvatar(bytes)) throw fault(400, "Choose a static profile image up to 512 pixels");
        const next = await saveCustomAvatar(env, auth, name, bytes);
        return reply({ user: ownUser(next) }, 200, cors);
      } else throw fault(400, "Choose a valid profile image");
    }
    const next = await patchUser(env, auth.uid, { name, ...(input.image !== undefined ? { avatarPath, avatarSource, avatarVersion } : {}) }, auth.sessionId);
    if (input.image === "" && user.avatarPath) await env.BUCKET.delete(user.avatarPath);
    await liveNotify(env, auth.uid, { type: "profile-changed" });
    return reply({ user: ownUser(next) }, 200, cors);
  }
  if (request.method === "GET" && path === "/v1/me/avatar") {
    if (user.googleAvatarUrl && user.avatarSource !== "custom" && isGoogleAvatarUrl(user.googleAvatarUrl)) {
      try {
        const image = await fetch(user.googleAvatarUrl, { signal: AbortSignal.timeout(10_000) });
        const type = image.headers.get("content-type")?.split(";")[0];
        if (image.ok && Number(image.headers.get("content-length") || 0) <= 5_000_000 && ["image/jpeg", "image/png", "image/webp"].includes(type))
          return new Response(image.body, { headers: { "content-type": type, "cache-control": "private,max-age=86400", "x-content-type-options": "nosniff", ...cors } });
      } catch { /* A stale Google photo must not hide a stored avatar. */ }
    }
    if (!user.avatarPath) throw fault(404, "No profile image");
    const object = await env.BUCKET.get(user.avatarPath);
    if (!object) throw fault(404, "No profile image");
    return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || "image/webp", "cache-control": "private,max-age=86400", "x-content-type-options": "nosniff", ...cors } });
  }
  if (request.method === "GET" && path === "/v2/sync") {
    const headers = {
      "x-saku-revision": String(user.revision),
      "x-saku-spreadsheet-url": user.spreadsheetUrl || "",
      "x-saku-sheet-pending": String(Boolean(user.sheetPending)),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...cors,
    };
    if (!user.snapshotPath) return new Response(null, { status: 204, headers });
    const object = await env.BUCKET.get(user.snapshotPath);
    if (!object) throw fault(503, "Cloud backup is unavailable");
    if (url.searchParams.get("format") === "manifest") return snapshotManifest(user.snapshotPath, object, { ...headers, "x-saku-encoding": "manifest" });
    if (object.size > chunkBytes || user.snapshotPath.endsWith(".manifest.json")) throw fault(413, "Use bounded backup downloads");
    const gzip = user.snapshotPath.endsWith(".gz");
    return new Response(object.body, { headers: { ...headers, "content-type": gzip ? "application/octet-stream" : "application/json; charset=utf-8", "x-saku-encoding": gzip ? "gzip" : "identity" } });
  }
  if (request.method === "GET" && path === "/v2/sync/chunk") {
    const key = url.searchParams.get("key"), offset = Number(url.searchParams.get("offset"));
    if (!key?.startsWith(`ledgers/${auth.uid}/`) || key.includes("..") || !Number.isSafeInteger(offset) || offset < 0 || offset % chunkBytes !== 0 || offset >= 10_000_000) throw fault(400, "Invalid backup chunk");
    const object = await env.BUCKET.get(key, { range: { offset, length: chunkBytes } });
    if (!object || offset >= object.size) throw fault(404, "Backup chunk is unavailable");
    return new Response(object.body, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store", ...cors } });
  }
  if (request.method === "POST" && path === "/v2/sync/start") {
    const input = await readBody(request);
    if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0 || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > 10_000_000) throw fault(400, "Invalid backup upload");
    if (input.baseRevision !== user.revision) throw fault(409, "Cloud data changed on another device", { revision: user.revision });
    const id = crypto.randomUUID();
    const inserted = await env.DB.prepare("INSERT INTO snapshot_uploads(id,uid,base_revision,size,expires_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions JOIN users ON users.uid=sessions.uid WHERE sessions.id=? AND sessions.uid=? AND coalesce(json_extract(users.data,'$.deleting'),0)=0)")
      .bind(id, auth.uid, input.baseRevision, input.size, Date.now() + 3600_000, auth.sessionId, auth.uid).run();
    if (!inserted.meta.changes) throw fault(401, "Account or session changed; sign in again");
    return reply({ id, chunkBytes }, 200, cors);
  }
  if ((request.method === "PUT" && path === "/v2/sync/chunk") || (request.method === "POST" && path === "/v2/sync/finish")) {
    const input = request.method === "POST" ? await readBody(request) : null;
    const id = input?.id || url.searchParams.get("id");
    if (request.method === "POST" && user.snapshotPath === `ledgers/${auth.uid}/${id}.manifest.json`) return reply({ revision: user.revision, spreadsheetUrl: user.spreadsheetUrl || "", sheetPending: Boolean(user.sheetPending) }, 200, cors);
    const upload = await env.DB.prepare("SELECT base_revision,size,expires_at FROM snapshot_uploads WHERE id=? AND uid=?").bind(id || "", auth.uid).first();
    if (!upload || upload.expires_at < Date.now()) throw fault(409, "Backup upload expired; try again");
    const prefix = `ledgers/${auth.uid}/${id}`;
    const count = Math.ceil(upload.size / chunkBytes);
    if (request.method === "PUT") {
      const index = Number(url.searchParams.get("index"));
      if (!Number.isInteger(index) || index < 0 || index >= count || url.searchParams.get("index") !== String(index)) throw fault(400, "Invalid backup chunk index");
      const size = Math.min(chunkBytes, upload.size - index * chunkBytes);
      if (Number(request.headers.get("content-length")) !== size || !request.body) throw fault(400, "Incomplete backup chunk");
      const key = `${prefix}/${index}`;
      // Conditional creation makes retries safe and prevents changing a committed backup.
      const part = await env.BUCKET.put(key, request.body, { onlyIf: { etagDoesNotMatch: "*" } });
      if (part && part.size !== size) { await env.BUCKET.delete(key); throw fault(400, "Incomplete backup chunk"); }
      if (!part && (await env.BUCKET.head(key))?.size !== size) throw fault(409, "Backup chunk changed");
      const recorded = await env.DB.prepare("INSERT INTO snapshot_upload_parts(id,part_index,size) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM snapshot_uploads JOIN sessions ON sessions.uid=snapshot_uploads.uid JOIN users ON users.uid=sessions.uid WHERE snapshot_uploads.id=? AND snapshot_uploads.uid=? AND sessions.id=? AND coalesce(json_extract(users.data,'$.deleting'),0)=0) ON CONFLICT(id,part_index) DO UPDATE SET size=excluded.size RETURNING size")
        .bind(id, index, size, id, auth.uid, auth.sessionId).first();
      if (!recorded) { await env.BUCKET.delete(key); throw fault(401, "Account or upload session changed; sign in again"); }
      return reply({ index }, 200, cors);
    }
    const received = await env.DB.prepare("SELECT COUNT(*) AS count,SUM(size) AS size FROM snapshot_upload_parts WHERE id=?").bind(id).first();
    if (received.count !== count || received.size !== upload.size) throw fault(409, "Backup upload is incomplete");
    const parts = [];
    for (let index = 0; index < count; index++) {
      const key = `${prefix}/${index}`, size = Math.min(chunkBytes, upload.size - index * chunkBytes);
      parts.push({ key, size });
    }
    const key = `${prefix}.manifest.json`;
    await env.BUCKET.put(key, JSON.stringify({ encoding: "identity", size: upload.size, parts }));
    const result = await commitSnapshot(env, auth.uid, user, upload.base_revision, key, auth.sessionId);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM snapshot_upload_parts WHERE id=?").bind(id),
      env.DB.prepare("DELETE FROM snapshot_uploads WHERE id=? AND uid=?").bind(id, auth.uid),
    ]);
    return reply(result, 200, cors);
  }
  if (request.method === "GET" && path === "/v2/sheets/current") {
    if (!user.spreadsheetId || !user.googleRefreshToken) throw fault(409, "Connect Google Drive to mirror your backup");
    const accessToken = await refreshGoogle(env, user.googleRefreshToken);
    const params = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE" });
    for (const name of sheetNames) params.append("ranges", `'${name}'!A:R`);
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(user.spreadsheetId)}/values:batchGet?${params}`, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw fault(502, `Google Sheet read failed (${response.status})`);
    return new Response(response.body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...cors } });
  }
  if (request.method === "POST" && path === "/v2/sheets/start") {
    if (!user.spreadsheetId || !user.googleRefreshToken) throw fault(409, "Connect Google Drive to mirror your backup");
    if (!user.snapshotPath) throw fault(409, "Back up your ledger before mirroring it");
    const results = await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO sheet_jobs (uid,baseline_path,baseline_revision,target_path,target_revision,cursor,total,updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(auth.uid, user.spreadsheetId && !user.sheetPending ? user.snapshotPath : null, user.spreadsheetId && !user.sheetPending ? user.revision : 0, null, null, 0, 0, Date.now()),
      env.DB.prepare("UPDATE sheet_jobs SET target_path=?,target_revision=?,cursor=0,total=-1,updated_at=? WHERE uid=? AND target_path IS NULL")
        .bind(user.snapshotPath, user.revision, Date.now(), auth.uid),
      env.DB.prepare("SELECT baseline_revision,target_revision,cursor,total FROM sheet_jobs WHERE uid=?").bind(auth.uid),
    ]);
    const job = results[2].results[0];
    return reply({ baselineRevision: job.baseline_revision, targetRevision: job.target_revision, cursor: job.cursor, total: job.total }, 200, cors);
  }
  if (request.method === "POST" && path === "/v2/sheets/plan") {
    const input = await readBody(request);
    if (!Number.isSafeInteger(input.targetRevision) || input.targetRevision < 1 || !Number.isSafeInteger(input.total) || input.total < 0 || input.total > 2000) throw fault(400, "Invalid Sheet mirror plan");
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE sheet_jobs SET total=?,updated_at=? WHERE uid=? AND target_revision=? AND target_path IS NOT NULL AND total=-1")
        .bind(input.total, Date.now(), auth.uid, input.targetRevision),
      env.DB.prepare("SELECT target_path,target_revision,total,cursor FROM sheet_jobs WHERE uid=?").bind(auth.uid),
    ]);
    const planned = results[1].results[0];
    if (!planned?.target_path || planned.target_revision !== input.targetRevision) throw fault(409, "Sheet mirror revision changed");
    if (planned.total !== input.total) throw fault(409, "Sheet mirror plan changed");
    return reply({ total: planned.total, cursor: planned.cursor }, 200, cors);
  }
  if (request.method === "POST" && path === "/v2/sheets/refresh") {
    if (!user.spreadsheetId || !user.googleRefreshToken) throw fault(409, "Connect Google Drive to mirror your backup");
    const accessToken = await refreshGoogle(env, user.googleRefreshToken);
    const expiresAt = googleAccess.get(user.googleRefreshToken)?.expiresAt;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw fault(502, "Google access lifetime is unavailable");
    const encrypted = await encrypt(accessToken, encryptionKey(env.TOKEN_ENCRYPTION_KEY));
    const updated = await env.DB.prepare("UPDATE users SET data=json_set(data,'$.googleSheetsAccessToken',?,'$.googleSheetsAccessGrant',?,'$.googleSheetsAccessExpiresAt',?) WHERE uid=? AND json_extract(data,'$.googleRefreshToken')=? AND coalesce(json_extract(data,'$.deleting'),0)=0 AND EXISTS(SELECT 1 FROM sessions WHERE id=? AND uid=users.uid)")
      .bind(encrypted, user.googleRefreshToken, expiresAt, auth.uid, user.googleRefreshToken, auth.sessionId).run();
    if (!updated.meta.changes) throw fault(409, "Google account or permission changed during refresh");
    return reply({ refreshed: true }, 200, cors);
  }
  if (request.method === "POST" && path === "/v2/sheets/grid") {
    const input = await readBody(request), job = await getSheetJob(env, auth.uid);
    if (!job?.target_path || input.targetRevision !== job.target_revision || job.total < 0 || !user.spreadsheetId || !user.googleRefreshToken) throw fault(409, "Sheet mirror is not ready");
    const rows = input.rows;
    if (!rows || typeof rows !== "object" || Object.keys(rows).length !== sheetNames.length || sheetNames.some((name) => !Number.isSafeInteger(rows[name]) || rows[name] < 1 || rows[name] > sheetRowLimits[name])) throw fault(400, "Invalid Sheet row counts");
    const accessToken = await refreshGoogle(env, user.googleRefreshToken);
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(user.spreadsheetId)}`;
    const metadata = await googleJson(`${base}?fields=sheets(properties(sheetId,title,gridProperties(rowCount)))`, accessToken);
    const existing = new Map((metadata.sheets || []).map(({ properties }) => [properties.title, properties]));
    if (sheetNames.some((name) => !existing.has(name))) throw fault(409, "The Saku Sheet tabs have changed");
    const requests = sheetNames.filter((name) => rows[name] > existing.get(name).gridProperties.rowCount).map((name) => ({ updateSheetProperties: {
      properties: { sheetId: existing.get(name).sheetId, gridProperties: { rowCount: rows[name] } }, fields: "gridProperties.rowCount",
    } }));
    if (requests.length) await googleJson(`${base}:batchUpdate`, accessToken, { method: "POST", body: JSON.stringify({ requests }) });
    return reply({ expanded: requests.length }, 200, cors);
  }
  if (request.method === "GET" && path === "/v2/sheets/snapshot") {
    const job = await getSheetJob(env, auth.uid);
    if (!job?.target_path) throw fault(409, "No Sheet mirror is in progress");
    const kind = url.searchParams.get("kind");
    if (kind !== "baseline" && kind !== "target") throw fault(400, "Invalid Sheet snapshot kind");
    const key = kind === "baseline" ? job.baseline_path : job.target_path;
    if (!key) return new Response(null, { status: 204, headers: { "cache-control": "no-store", ...cors } });
    const object = await env.BUCKET.get(key);
    if (!object) throw fault(503, "Sheet snapshot is unavailable");
    if (url.searchParams.get("format") === "manifest") return snapshotManifest(key, object, { ...cors, "x-saku-encoding": "manifest" });
    if (object.size > chunkBytes || key.endsWith(".manifest.json")) throw fault(413, "Use bounded Sheet downloads");
    return new Response(object.body, { headers: { "content-type": "application/octet-stream", "x-saku-encoding": key.endsWith(".gz") ? "gzip" : "identity", "cache-control": "no-store", ...cors } });
  }
  if (request.method === "POST" && path === "/v2/sheets/batch") {
    if (!user.spreadsheetId || !user.googleRefreshToken) throw fault(409, "Connect Google Drive to mirror your backup");
    const length = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(length) || length < 1 || length > 150_000) throw fault(413, "Sheet batch is too large");
    const input = await readBody(request);
    const change = sheetChange(input);
    const job = await getSheetJob(env, auth.uid);
    if (!job?.target_path || input.targetRevision !== job.target_revision || !Number.isSafeInteger(input.index) || input.index < 0 || input.index >= job.total) throw fault(409, "Sheet mirror revision changed");
    if (input.index < job.cursor) return reply({ cursor: job.cursor, applied: true }, 200, cors);
    if (input.index !== job.cursor) throw fault(409, "Sheet batch is out of order");
    const accessToken = await sheetAccess(env, user);
    const target = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(user.spreadsheetId)}/values/${encodeURIComponent(change.range)}`;
    const current = await googleJson(`${target}?valueRenderOption=UNFORMATTED_VALUE`, accessToken);
    if (!sheetMatches(current.values, change.after)) {
      if (!sheetMatches(current.values, change.before)) throw fault(409, "Google Sheet has edits in this range; review them before mirroring");
      await googleJson(`${target}?valueInputOption=RAW`, accessToken, { method: "PUT", body: JSON.stringify({ range: change.range, majorDimension: "ROWS", values: change.after }) });
    }
    await env.DB.prepare("UPDATE sheet_jobs SET cursor=cursor+1,updated_at=? WHERE uid=? AND target_revision=? AND cursor=?")
      .bind(Date.now(), auth.uid, job.target_revision, job.cursor).run();
    return reply({ cursor: job.cursor + 1, applied: true }, 200, cors);
  }
  if (request.method === "POST" && path === "/v2/sheets/finish") {
    const input = await readBody(request);
    if (!Number.isSafeInteger(input.targetRevision) || input.targetRevision < 1) throw fault(400, "Invalid Sheet mirror revision");
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE users SET data=json_set(data,'$.sheetPending',json('false')) WHERE uid=? AND revision=? AND EXISTS (SELECT 1 FROM sheet_jobs WHERE uid=? AND target_revision=? AND target_path IS NOT NULL AND total>=0 AND cursor=total)")
        .bind(auth.uid, input.targetRevision, auth.uid, input.targetRevision),
      env.DB.prepare("UPDATE sheet_jobs SET baseline_path=target_path,baseline_revision=target_revision,target_path=NULL,target_revision=NULL,cursor=0,total=0,updated_at=? WHERE uid=? AND target_revision=? AND target_path IS NOT NULL AND total>=0 AND cursor=total")
        .bind(Date.now(), auth.uid, input.targetRevision),
      env.DB.prepare("SELECT json_extract(data,'$.sheetPending') AS sheet_pending FROM users WHERE uid=?").bind(auth.uid),
    ]);
    if (!results[1].meta.changes) throw fault(409, "Sheet mirror is incomplete");
    if (!results[2].results.length) throw fault(404, "Account not found");
    return reply({ sheetPending: Boolean(results[2].results[0].sheet_pending) }, 200, cors);
  }
  if (request.method === "PUT" && path === "/v2/sync") {
    const baseRevision = Number(url.searchParams.get("baseRevision"));
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || url.searchParams.get("baseRevision") !== String(baseRevision)) throw fault(400, "Invalid sync revision");
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || request.headers.get("x-saku-version") !== "3") throw fault(400, "Unsupported Saku data version");
    const size = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(size) || size < 1 || size > chunkBytes || !request.body) throw fault(413, "Use bounded uploads for larger backups; the backup limit is 10 MB");
    const nextRevision = baseRevision + 1;
    const key = `ledgers/${auth.uid}/${nextRevision}-${crypto.randomUUID()}.json`;
    const object = await env.BUCKET.put(key, request.body, { httpMetadata: { contentType: "application/json" } });
    if (!object || object.size !== size) {
      await env.BUCKET.delete(key);
      throw fault(400, "Incomplete cloud backup");
    }
    return reply(await commitSnapshot(env, auth.uid, user, baseRevision, key, auth.sessionId), 200, cors);
  }
  return reply({ error: "Not found" }, 404, cors);
}

export default {
  async fetch(request, env) {
    const coldInvocation = !hasServedRequest;
    hasServedRequest = true;
    if (env.RUNTIME_DIAGNOSTICS === "true") console.info("saku-runtime", coldInvocation ? "cold" : "warm", jwks ? "keys-warm" : "keys-cold");
    try { return await route(request, env); }
    catch (error) {
      const status = error.status || 500;
      if (status >= 500) console.error("Request failed", { path: new URL(request.url).pathname, message: error.message });
      const origin = request.headers.get("origin");
      return reply({ error: status >= 500 ? "Server error" : error.message, revision: error.revision, code: error.code, minimumBuild: error.minimumBuild }, status, corsHeaders(origin, env));
    }
  },
  async scheduled(_controller, env) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM oauth_logins WHERE expires_at<=?").bind(now),
      env.DB.prepare("DELETE FROM oauth_states WHERE expires_at<=?").bind(now),
      env.DB.prepare("DELETE FROM oauth_drive_states WHERE expires_at<=?").bind(now),
    ]);
    const row = await env.DB.prepare("SELECT uid FROM users WHERE json_extract(data,'$.deleting')=1 LIMIT 1").first();
    if (row) await deletionStep(env, row.uid);
  },
};
