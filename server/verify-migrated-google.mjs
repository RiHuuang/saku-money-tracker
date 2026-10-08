import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { decrypt, encryptionKey, sheetTables } from "./src/core.js";

const project = process.env.GOOGLE_CLOUD_PROJECT || "saku-money-tracker";
if (!/^[a-z][a-z0-9-]{4,62}$/.test(project)) throw new Error("Invalid Google Cloud project ID");
const archive = path.resolve(process.env.SAKU_MIGRATION_DIR || "output/cloudflare-migration");
const manifest = JSON.parse(await fs.readFile(path.join(archive, "manifest.json"), "utf8"));
async function snapshot(key) {
  const read = (partKey) => {
    if (partKey.includes("..") || !/^ledgers\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+$/.test(partKey)) throw new Error("Invalid backup object key");
    return fs.readFile(path.join(archive, "objects", ...partKey.split("/")));
  };
  let bytes = await read(key);
  if (key.endsWith(".manifest.json")) {
    const parts = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(parts.parts) || !Number.isSafeInteger(parts.size) || parts.size < 1 || parts.size > 10_000_000) throw new Error("Invalid backup manifest");
    bytes = Buffer.concat(await Promise.all(parts.parts.map(async (part) => {
      const chunk = await read(part.key);
      if (chunk.length !== part.size) throw new Error("Backup part size mismatch");
      return chunk;
    })));
    if (bytes.length !== parts.size) throw new Error("Backup size mismatch");
    if (parts.encoding === "gzip") bytes = gunzipSync(bytes);
    else if (parts.encoding !== "identity") throw new Error("Invalid backup encoding");
  } else if (key.endsWith(".gz")) bytes = gunzipSync(bytes);
  return JSON.parse(bytes.toString("utf8"));
}
function secret(name) {
  const result = spawnSync("gcloud.cmd", ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${project}`], { encoding: "utf8", windowsHide: true, shell: true });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`Could not read ${name}`);
  return result.stdout.trimEnd();
}
const key = encryptionKey(secret("saku-token-encryption-key"));
const clientSecret = secret("saku-google-oauth-client-secret");
const clientId = "213129330817-578l0t3n12ctd9uja57ad2bcf22t5o7l.apps.googleusercontent.com";
for (const [index, { data }] of manifest.users.entries()) {
  if (!data.googleRefreshToken || !data.spreadsheetId) continue;
  const refreshToken = decrypt(data.googleRefreshToken, key);
  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const credentials = await token.json().catch(() => ({}));
  if (!token.ok || !credentials.access_token) throw new Error(`Migrated Google refresh failed for account ${index + 1}`);
  const metadata = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(data.spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,sheets.properties.title`, { headers: { authorization: `Bearer ${credentials.access_token}` } });
  const spreadsheet = await metadata.json().catch(() => ({}));
  if (!metadata.ok || spreadsheet.spreadsheetId !== data.spreadsheetId) throw new Error(`Migrated Sheet read failed for account ${index + 1}`);
  const tables = sheetTables(await snapshot(data.snapshotPath));
  const params = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE" });
  for (const name of Object.keys(tables)) params.append("ranges", `'${name}'!A:R`);
  const valuesResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(data.spreadsheetId)}/values:batchGet?${params}`, { headers: { authorization: `Bearer ${credentials.access_token}` } });
  const values = await valuesResponse.json().catch(() => ({}));
  if (!valuesResponse.ok || values.valueRanges?.length !== Object.keys(tables).length) throw new Error(`Migrated Sheet values read failed for account ${index + 1}`);
  const normalize = (rows) => rows.map((row) => {
    const cells = row.map((cell) => String(cell ?? ""));
    while (cells.at(-1) === "") cells.pop();
    return cells;
  });
  const mismatches = Object.entries(tables).filter(([name, rows], index) => JSON.stringify(normalize(rows)) !== JSON.stringify(normalize(values.valueRanges[index].values || []))).map(([name]) => name);
  console.log(`Migrated Google token and Sheet link verified read-only for account ${index + 1} (${spreadsheet.sheets?.length || 0} tabs; ${mismatches.length ? `different tabs: ${mismatches.join(", ")}` : "all mirrored values match"})`);
}
