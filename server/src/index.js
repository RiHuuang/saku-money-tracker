import http from "node:http";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { Firestore, FieldValue } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { OAuth2Client } from "google-auth-library";
import sharp from "sharp";
import { avatarAfterSignIn, decrypt, encrypt, encryptionKey, hashToken, sessionToken, sheetTables, splitSessionToken, timingSafeEqual, tokenPart, validateSnapshot } from "./core.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const projectId = process.env.GOOGLE_CLOUD_PROJECT || "saku-money-tracker";
const clientId = required("GOOGLE_OAUTH_CLIENT_ID");
const clientSecret = required("GOOGLE_OAUTH_CLIENT_SECRET");
const bucketName = required("SAKU_BUCKET");
const tokenKey = encryptionKey(required("TOKEN_ENCRYPTION_KEY"));
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || "https://localhost").split(",").map((x) => x.trim()).filter(Boolean));
const db = new Firestore({ projectId });
const bucket = new Storage({ projectId }).bucket(bucketName);
const verifier = new OAuth2Client(clientId);
const port = Number(process.env.PORT || 8080);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function send(res, status, body, origin) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (origin && allowedOrigins.has(origin)) Object.assign(headers, { "access-control-allow-origin": origin, vary: "Origin" });
  res.writeHead(status, headers).end(JSON.stringify(body));
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
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("googleusercontent.com")) return null;
  const response = await fetch(url);
  if (!response.ok || Number(response.headers.get("content-length") || 0) > 5_000_000) return null;
  const input = Buffer.from(await response.arrayBuffer());
  if (input.length > 5_000_000) return null;
  const image = await sharp(input).rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
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
  if (req.method === "POST" && req.url === "/v1/auth/google") {
    const input = await body(req);
    if (typeof input.code !== "string" || input.code.length < 10) throw Object.assign(new Error("Invalid authorization response"), { status: 400 });
    if (input.agreementVersion !== "2026-09-28") throw Object.assign(new Error("Accept the current Saku agreement before signing in"), { status: 400 });
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
        const image = await sharp(bytes).rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
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
    const json = validateSnapshot(input.data);
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
