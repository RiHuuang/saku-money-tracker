import http from "node:http";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { Firestore, FieldValue } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { OAuth2Client } from "google-auth-library";
import sharp from "sharp";
import { avatarAfterSignIn, decrypt, encrypt, encryptionKey, hashToken, isGoogleAvatarUrl, sessionToken, sheetTables, splitSessionToken, timingSafeEqual, tokenPart, validateSnapshot } from "./core.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const projectId = process.env.GOOGLE_CLOUD_PROJECT || "saku-money-tracker";
const clientId = required("GOOGLE_OAUTH_CLIENT_ID");
const clientSecret = required("GOOGLE_OAUTH_CLIENT_SECRET");
const bucketName = required("SAKU_BUCKET");
const tokenKey = encryptionKey(required("TOKEN_ENCRYPTION_KEY"));
const supportEmail = required("SUPPORT_EMAIL");
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || "https://localhost").split(",").map((x) => x.trim()).filter(Boolean));
const db = new Firestore({ projectId });
const bucket = new Storage({ projectId }).bucket(bucketName);
const verifier = new OAuth2Client(clientId);
const port = Number(process.env.PORT || 8080);
const agreementVersion = "2026-10-03";
const acceptedAgreementVersions = new Set(["2026-09-28", "2026-09-29", agreementVersion]);
const writesFrozen = process.env.SAKU_WRITE_FROZEN === "true";
const successorUrl = process.env.SAKU_SUCCESSOR_URL || "";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function send(res, status, body, origin) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "strict-transport-security": "max-age=31536000; includeSubDomains" };
  if (origin && allowedOrigins.has(origin)) Object.assign(headers, { "access-control-allow-origin": origin, vary: "Origin" });
  res.writeHead(status, headers).end(JSON.stringify(body));
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
function sendLegal(res, title, body) {
  const email = escapeHtml(supportEmail);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - Saku</title><style>body{margin:0;background:#f5f7f8;color:#173e40;font:16px/1.65 system-ui,sans-serif}main{max-width:760px;margin:auto;padding:48px 22px 80px}h1,h2{line-height:1.2}h1{font-size:2rem}h2{margin-top:2rem;font-size:1.2rem}a{color:#176e67}small{color:#687875}</style></head><body><main><a href="/">Saku</a><h1>${title}</h1><small>Effective ${agreementVersion}</small>${body(email)}<h2>Contact</h2><p>Questions or privacy requests: <a href="mailto:${email}">${email}</a>.</p></main></body></html>`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public,max-age=3600", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "strict-transport-security": "max-age=31536000; includeSubDomains" }).end(html);
}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12_000_000) throw Object.assign(new Error("Request is too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
}
async function googleJson(url, accessToken, options = {}) {
  const response = await fetch(url, { ...options, headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...options.headers } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google API failed (${response.status}): ${result.error?.message || "request rejected"}`);
  return result;
}
async function exchangeCode(code) {
  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: "" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params });
  const result = await response.json();
  if (!response.ok || !result.id_token || !result.access_token) throw Object.assign(new Error("Google authorization code was rejected"), { status: 401 });
  return result;
}
async function refreshGoogle(refreshToken) {
  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params });
  const result = await response.json();
  if (!response.ok || !result.access_token) throw Object.assign(new Error("Google access has expired; sign in again"), { status: 401 });
  return result.access_token;
}
async function provisionSheet(accessToken) {
  const folder = await googleJson("https://www.googleapis.com/drive/v3/files?fields=id,name", accessToken, {
    method: "POST", body: JSON.stringify({ name: "Saku", mimeType: "application/vnd.google-apps.folder" }),
  });
  const sheetNames = ["Transactions", "Pockets", "Accounts", "Cards", "Recurring", "Quick_entries", "Pocket_transfers", "Existing_installments"];
  const spreadsheet = await googleJson("https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId,spreadsheetUrl", accessToken, {
    method: "POST", body: JSON.stringify({ properties: { title: "Saku Money Tracker" }, sheets: sheetNames.map((title) => ({ properties: { title } })) }),
  });
  const file = await googleJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheet.spreadsheetId)}?fields=parents`, accessToken);
  await googleJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheet.spreadsheetId)}?addParents=${encodeURIComponent(folder.id)}&removeParents=${encodeURIComponent((file.parents || []).join(","))}&fields=id,parents`, accessToken, { method: "PATCH", body: "{}" });
  return { folderId: folder.id, spreadsheetId: spreadsheet.spreadsheetId, spreadsheetUrl: spreadsheet.spreadsheetUrl };
}
async function mirrorSheet(user, data) {
  const accessToken = await refreshGoogle(decrypt(user.googleRefreshToken, tokenKey));
  const tables = sheetTables(data);
  const metadata = await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${user.spreadsheetId}?fields=sheets.properties.title`, accessToken);
  const existing = new Set((metadata.sheets || []).map((sheet) => sheet.properties.title));
  const missing = Object.keys(tables).filter((name) => !existing.has(name));
  if (missing.length) await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${user.spreadsheetId}:batchUpdate`, accessToken, { method: "POST", body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }) });
  const ranges = Object.keys(tables).map((name) => `'${name}'!A:Z`).join(",");
  await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${user.spreadsheetId}/values:batchClear`, accessToken, { method: "POST", body: JSON.stringify({ ranges: Object.keys(tables).map((name) => `'${name}'!A:Z`) }) });
  await googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${user.spreadsheetId}/values:batchUpdate`, accessToken, {
    method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: Object.entries(tables).map(([name, values]) => ({ range: `'${name}'!A1`, majorDimension: "ROWS", values })) }),
  });
}
async function storeAvatar(sub, url) {
  if (!url) return null;
  if (!isGoogleAvatarUrl(url)) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 5_000_000) return null;
  const input = Buffer.from(await response.arrayBuffer());
  if (input.length > 5_000_000) return null;
  const image = await sharp(input, { limitInputPixels: 16_777_216 }).rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
  const path = `avatars/${sub}.webp`;
  await bucket.file(path).save(image, { resumable: false, contentType: "image/webp", metadata: { cacheControl: "private,max-age=86400" } });
  return path;
}
async function issueSession(uid, existingId) {
  const id = existingId || crypto.randomUUID();
  const accessSecret = tokenPart();
  const refreshSecret = tokenPart();
  await db.collection("sessions").doc(id).set({ uid, accessHash: hashToken(accessSecret), refreshHash: hashToken(refreshSecret), accessExpiresAt: Date.now() + 15 * 60_000, refreshExpiresAt: Date.now() + 30 * 86400_000, updatedAt: FieldValue.serverTimestamp() });
  return { accessToken: sessionToken(id, accessSecret), refreshToken: sessionToken(id, refreshSecret) };
}
async function deleteAccount(uid, user) {
  let refreshToken = null;
  try { refreshToken = user.googleRefreshToken ? decrypt(user.googleRefreshToken, tokenKey) : null; }
  catch (error) { console.error("Could not decrypt token during account deletion", { uid, message: error.message }); }
  if (refreshToken) {
    try {
      const accessToken = await refreshGoogle(refreshToken);
      const fileId = user.folderId || user.spreadsheetId;
      if (fileId) await googleJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,trashed`, accessToken, { method: "PATCH", body: JSON.stringify({ trashed: true }) });
    } catch (error) { console.error("Could not trash Drive data during account deletion", { uid, message: error.message }); }
    await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refreshToken }) }).catch(() => {});
  }
  const removals = [
    bucket.deleteFiles({ prefix: `ledgers/${uid}/` }),
    bucket.file(`avatars/${uid}.webp`).delete({ ignoreNotFound: true }),
  ];
  const results = await Promise.allSettled(removals);
  const failedRemoval = results.find((result) => result.status === "rejected");
  if (failedRemoval) {
    console.error("Cloud file deletion failed", { uid, message: failedRemoval.reason?.message });
    throw Object.assign(new Error("Account deletion could not finish; try again"), { status: 503 });
  }
  const sessions = await db.collection("sessions").where("uid", "==", uid).get();
  const documents = [...sessions.docs];
  while (documents.length > 499) {
    const batch = db.batch();
    documents.splice(0, 499).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  const finalBatch = db.batch();
  documents.forEach((doc) => finalBatch.delete(doc.ref));
  finalBatch.delete(db.collection("users").doc(uid));
  await finalBatch.commit();
}
async function authenticate(req) {
  const parsed = splitSessionToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  if (!parsed) throw Object.assign(new Error("Sign in required"), { status: 401 });
  const snap = await db.collection("sessions").doc(parsed.id).get();
  const session = snap.data();
  if (!session || session.accessExpiresAt < Date.now() || !timingSafeEqual(session.accessHash, hashToken(parsed.secret))) throw Object.assign(new Error("Session expired"), { status: 401 });
  return { uid: session.uid, sessionId: parsed.id };
}
async function handle(req, res) {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) return send(res, 403, { error: "Origin is not allowed" });
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": origin, "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS", "access-control-allow-headers": "authorization,content-type", "access-control-max-age": "3600", vary: "Origin" }).end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true }, origin);
  if (writesFrozen && !["GET", "HEAD"].includes(req.method)) {
    return send(res, 426, { error: "This version of Saku needs an update before cloud sync can continue.", code: "UPDATE_REQUIRED", updateUrl: successorUrl || undefined }, origin);
  }
  if (successorUrl && req.method === "GET" && req.url === "/") {
    res.writeHead(308, { location: successorUrl, "cache-control": "no-store" }).end();
    return;
  }
  if (req.method === "GET" && req.url === "/") return sendLegal(res, "Saku", () => `<p>Saku is an offline-first Android money tracker for accounts, pockets, cards, transfers, recurring payments, and on-device statement checks.</p><p><a href="/privacy">Privacy Notice</a> · <a href="/terms">User Agreement</a> · <a href="/account-deletion">Account deletion</a></p><h2>Google integration</h2><p>Signing in creates a private cloud backup and a readable Saku spreadsheet in the user's own Google Drive. Saku uses the narrow <code>drive.file</code> permission and cannot browse unrelated Drive files.</p>`);
  if (req.method === "GET" && req.url === "/privacy") return sendLegal(res, "Privacy Notice", (email) => `<p>Saku is an offline-first money tracker. This notice explains what Saku processes when you sign in and use automatic cloud sync.</p><h2>Data we process</h2><p>We process your Google account identifier, email address, display name, optional profile image, acceptance record, Saku ledger and settings, sync revision, and authentication tokens. Transaction descriptions and financial amounts are included in automatic synchronization, including transactions created from a home-screen widget while Saku is closed.</p><h2>Google data</h2><p>Saku requests basic identity and <code>drive.file</code> access. It uses that access only to create and update the Saku folder and spreadsheet in your Drive. Saku cannot browse unrelated Drive files. Google passwords are never received.</p><h2>On-device processing</h2><p>Imported statements, extracted statement text, OCR images, and on-device AI prompts stay on your device and are discarded after the review session. They are not uploaded by Saku.</p><h2>Storage and sharing</h2><p>Your synchronized ledger is stored in a private database in Google Cloud. A readable mirror is stored in the Saku spreadsheet owned by your Google account, and your compressed profile image is stored privately in Google Cloud. We use Google Cloud solely to operate Saku and do not sell data, run advertising, or share financial data for marketing.</p><h2>Security and retention</h2><p>Google refresh tokens are encrypted at rest, Saku sessions are stored as hashes, and cloud storage is private. The Android app keeps its Saku session encrypted with Android Keystore and may use it for background synchronization. Data is kept while your account is active. You can delete your account in Saku Settings; deletion removes active Saku Cloud records, revokes Google access, and asks Google Drive to place the Saku-created folder in trash. Deleted storage objects can remain recoverable for up to seven days under the configured disaster-recovery policy before permanent removal.</p><h2>Your choices</h2><p>You can export your ledger, sign out, revoke Saku in your Google Account, or request deletion at <a href="mailto:${email}">${email}</a>.</p>`);
  if (req.method === "GET" && req.url === "/terms") return sendLegal(res, "User Agreement", () => `<p>By using Saku, you agree to this agreement and the Privacy Notice.</p><h2>Personal finance tool</h2><p>Saku helps you record and review information you provide. It is not a bank, accounting service, or financial adviser. You remain responsible for checking entries, statement matches, budgets, taxes, and payment decisions.</p><h2>Your account</h2><p>You must use an account you are authorized to control and keep your device secure. Do not use Saku where doing so would violate law or another person's rights.</p><h2>Your data</h2><p>You retain ownership of your ledger. Saku stores your synchronized ledger in a private database and mirrors it to a Google Sheet owned by your Google account. You authorize Saku to process it only to provide the app, automatic synchronization including background widget sync, profile image, and Google Sheets mirror. You can export or delete it from Settings.</p><h2>Availability</h2><p>Offline features can continue without the cloud, but sync, Google sign-in, and Drive mirroring depend on third-party services. Keep your own exports of important records. Features may change to maintain security, compatibility, or legal compliance.</p><h2>Acceptable use</h2><p>Do not attempt unauthorized access, disrupt the service, automate abusive traffic, or use Saku to harm others.</p><h2>Warranty and liability</h2><p>Saku is provided as available. To the extent permitted by law, no guarantee is made that inferred statement data or financial calculations are error-free. Nothing in this agreement limits rights that cannot legally be limited.</p>`);
  if (req.method === "GET" && req.url === "/account-deletion") return sendLegal(res, "Delete your Saku account", (email) => `<p>In the Android app, open <strong>Settings</strong>, find <strong>Your data stays with you</strong>, choose <strong>Delete account</strong>, and type DELETE. This removes your Saku Cloud identity, sessions, ledger snapshots, and profile image, revokes Saku's Google access, asks Google Drive to place the Saku-created folder in trash, and clears the workspace from that phone.</p><p>If you cannot access the app, email <a href="mailto:${email}">${email}</a> from the Google address used for Saku. We will verify the request before deleting data.</p><p>You can separately empty Google Drive trash or remove Saku under your Google Account's third-party connections.</p>`);
  if (req.method === "POST" && req.url === "/v1/auth/google") {
    const input = await body(req);
    if (typeof input.code !== "string" || input.code.length < 10) throw Object.assign(new Error("Invalid authorization response"), { status: 400 });
    if (!acceptedAgreementVersions.has(input.agreementVersion)) throw Object.assign(new Error("Accept the current Saku agreement before signing in"), { status: 400 });
    const tokens = await exchangeCode(input.code);
    const ticket = await verifier.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || profile.email_verified !== true) throw Object.assign(new Error("A verified Google account is required"), { status: 401 });
    const ref = db.collection("users").doc(profile.sub);
    const existing = (await ref.get()).data();
    let drive = existing?.spreadsheetId ? existing : await provisionSheet(tokens.access_token);
    const keepCustomAvatar = existing?.avatarSource === "custom" && existing?.avatarPath;
    const googleAvatarPath = keepCustomAvatar ? null : await storeAvatar(profile.sub, profile.picture).catch(() => null);
    const { avatarPath, avatarSource, avatarVersion } = avatarAfterSignIn(existing, googleAvatarPath, Date.now().toString(36));
    const user = {
      email: profile.email, name: profile.name || profile.email.split("@")[0], avatarPath, avatarSource, avatarVersion,
      folderId: drive.folderId, spreadsheetId: drive.spreadsheetId, spreadsheetUrl: drive.spreadsheetUrl,
      googleRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token, tokenKey) : existing?.googleRefreshToken,
      revision: existing?.revision || 0, snapshotPath: existing?.snapshotPath || null,
      createdAt: existing?.createdAt || FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      agreementVersion: input.agreementVersion, agreementAcceptedAt: FieldValue.serverTimestamp(),
    };
    if (!user.googleRefreshToken) throw Object.assign(new Error("Google did not return offline access; remove Saku access from your Google Account and try again"), { status: 409 });
    await ref.set(user, { merge: true });
    const session = await issueSession(profile.sub);
    return send(res, 200, { ...session, user: { id: profile.sub, name: user.name, email: user.email, hasAvatar: Boolean(avatarPath), avatarSource, avatarVersion }, sync: { revision: user.revision, spreadsheetUrl: user.spreadsheetUrl } }, origin);
  }
  if (req.method === "POST" && req.url === "/v1/auth/refresh") {
    const input = await body(req);
    const parsed = splitSessionToken(input.refreshToken);
    if (!parsed) throw Object.assign(new Error("Invalid refresh session"), { status: 401 });
    const ref = db.collection("sessions").doc(parsed.id);
    const snap = await ref.get();
    const session = snap.data();
    if (!session || session.refreshExpiresAt < Date.now() || !timingSafeEqual(session.refreshHash, hashToken(parsed.secret))) throw Object.assign(new Error("Refresh session expired"), { status: 401 });
    return send(res, 200, await issueSession(session.uid, parsed.id), origin);
  }
  const auth = await authenticate(req);
  const userRef = db.collection("users").doc(auth.uid);
  const userSnap = await userRef.get();
  const user = userSnap.data();
  if (!user) throw Object.assign(new Error("Account not found"), { status: 404 });
  if (req.method === "POST" && req.url === "/v1/auth/logout") {
    await db.collection("sessions").doc(auth.sessionId).delete();
    return send(res, 200, { ok: true }, origin);
  }
  if (req.method === "DELETE" && req.url === "/v1/me") {
    await deleteAccount(auth.uid, user);
    return send(res, 200, { ok: true }, origin);
  }
  if (req.method === "GET" && req.url === "/v1/me") return send(res, 200, { user: { id: auth.uid, name: user.name, email: user.email, hasAvatar: Boolean(user.avatarPath), avatarSource: user.avatarSource || "google", avatarVersion: user.avatarVersion || "legacy" }, sync: { revision: user.revision || 0, spreadsheetUrl: user.spreadsheetUrl } }, origin);
  if (req.method === "PUT" && req.url === "/v1/me") {
    const input = await body(req);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 40) throw Object.assign(new Error("Enter a profile name up to 40 characters"), { status: 400 });
    let avatarPath = user.avatarPath || null;
    let avatarSource = user.avatarSource || (avatarPath ? "google" : null);
    let avatarVersion = user.avatarVersion || "legacy";
    if (input.image !== undefined) {
      if (input.image === "") { if (avatarPath) await bucket.file(avatarPath).delete({ ignoreNotFound: true }); avatarPath = null; avatarSource = null; avatarVersion = Date.now().toString(36); }
      else if (typeof input.image === "string" && /^data:image\/(?:jpeg|png|webp);base64,/.test(input.image) && input.image.length < 4_000_000) {
        const bytes = Buffer.from(input.image.slice(input.image.indexOf(",") + 1), "base64");
        const image = await sharp(bytes, { limitInputPixels: 16_777_216 }).rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
        avatarPath = `avatars/${auth.uid}.webp`;
        await bucket.file(avatarPath).save(image, { resumable: false, contentType: "image/webp", metadata: { cacheControl: "private,max-age=86400" } });
        avatarSource = "custom";
        avatarVersion = Date.now().toString(36);
      } else throw Object.assign(new Error("Choose a valid profile image"), { status: 400 });
    }
    await userRef.update({ name, avatarPath, avatarSource, avatarVersion, updatedAt: FieldValue.serverTimestamp() });
    return send(res, 200, { user: { id: auth.uid, name, email: user.email, hasAvatar: Boolean(avatarPath), avatarSource, avatarVersion } }, origin);
  }
  if (req.method === "GET" && (req.url === "/v1/me/avatar" || req.url.startsWith("/v1/me/avatar?"))) {
    if (!user.avatarPath) return send(res, 404, { error: "No profile image" }, origin);
    const [image] = await bucket.file(user.avatarPath).download();
    const headers = { "content-type": "image/webp", "cache-control": "private,max-age=86400", "x-content-type-options": "nosniff" };
    if (origin) Object.assign(headers, { "access-control-allow-origin": origin, vary: "Origin" });
    res.writeHead(200, headers).end(image);
    return;
  }
  if (req.method === "GET" && req.url === "/v1/sync") {
    if (!user.snapshotPath) return send(res, 200, { revision: 0, data: null, spreadsheetUrl: user.spreadsheetUrl }, origin);
    const [compressed] = await bucket.file(user.snapshotPath).download();
    return send(res, 200, { revision: user.revision, data: JSON.parse((await gunzip(compressed)).toString("utf8")), spreadsheetUrl: user.spreadsheetUrl }, origin);
  }
  if (req.method === "PUT" && req.url === "/v1/sync") {
    const input = await body(req);
    if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) throw Object.assign(new Error("Invalid sync revision"), { status: 400 });
    let json;
    try { json = validateSnapshot(input.data); }
    catch (error) { throw Object.assign(error, { status: 400 }); }
    const nextRevision = input.baseRevision + 1;
    const path = `ledgers/${auth.uid}/${nextRevision}-${crypto.randomUUID()}.json.gz`;
    await bucket.file(path).save(await gzip(json), { resumable: false, contentType: "application/gzip", metadata: { cacheControl: "private,no-store" } });
    try {
      await db.runTransaction(async (tx) => {
        const current = (await tx.get(userRef)).data();
        if ((current?.revision || 0) !== input.baseRevision) throw Object.assign(new Error("Cloud data changed on another device"), { status: 409, revision: current?.revision || 0 });
        tx.update(userRef, { revision: nextRevision, snapshotPath: path, updatedAt: FieldValue.serverTimestamp(), sheetPending: true });
      });
    } catch (error) {
      await bucket.file(path).delete({ ignoreNotFound: true }).catch(() => {});
      throw error;
    }
    let sheetPending = false;
    try {
      await mirrorSheet(user, input.data);
      await userRef.update({ sheetPending: false, sheetSyncedAt: FieldValue.serverTimestamp() });
    } catch (error) {
      sheetPending = true;
      console.error("Sheet mirror failed", { uid: auth.uid, message: error.message });
    }
    return send(res, 200, { revision: nextRevision, spreadsheetUrl: user.spreadsheetUrl, sheetPending }, origin);
  }
  return send(res, 404, { error: "Not found" }, origin);
}

http.createServer((req, res) => handle(req, res).catch((error) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error("Request failed", { path: req.url, message: error.message });
  send(res, status, { error: status >= 500 ? "Server error" : error.message, revision: error.revision }, req.headers.origin);
})).listen(port, "0.0.0.0", () => console.log(`Saku API listening on ${port}`));
