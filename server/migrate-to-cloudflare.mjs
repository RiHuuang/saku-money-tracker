import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { spawnSync } from "node:child_process";
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { validateSnapshot } from "./src/core.js";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || "saku-money-tracker";
const bucketName = process.env.SAKU_BUCKET || `${projectId}-saku-data`;
const archive = path.resolve(process.env.SAKU_MIGRATION_DIR || "output/cloudflare-migration");
const mode = process.argv[2];
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const wrangler = path.resolve("node_modules/wrangler/bin/wrangler.js");

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], { stdio: "inherit", cwd: process.cwd() });
  if (result.status !== 0) throw new Error(`Wrangler failed: ${args.slice(0, 3).join(" ")}`);
}

function queryD1(command) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "saku", "--remote", "--command", command, "--json"], { stdio: "pipe", encoding: "utf8", cwd: process.cwd() });
  if (result.status !== 0) throw new Error("Could not verify the imported D1 records");
  return JSON.parse(result.stdout)[0].results;
}

function safeObjectPath(key) {
  if (key.includes("..") || !/^(?:ledgers\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+|avatars\/[a-zA-Z0-9_-]+(?:\.webp|\/[a-zA-Z0-9_.-]+))$/.test(key)) throw new Error(`Unexpected object key: ${key}`);
  return path.join(archive, "objects", ...key.split("/"));
}

async function readSnapshot(key) {
  let bytes = await fs.readFile(safeObjectPath(key));
  if (key.endsWith(".manifest.json")) {
    const manifest = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(manifest.parts) || !Number.isSafeInteger(manifest.size) || manifest.size > 10_000_000) throw new Error("Invalid snapshot manifest");
    const chunks = [];
    for (const part of manifest.parts) {
      const chunk = await fs.readFile(safeObjectPath(part.key));
      if (chunk.length !== part.size) throw new Error("Snapshot part size mismatch");
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
    if (bytes.length !== manifest.size) throw new Error("Snapshot manifest size mismatch");
    if (manifest.encoding === "gzip") bytes = gunzipSync(bytes);
    else if (manifest.encoding !== "identity") throw new Error("Invalid snapshot encoding");
  } else if (key.endsWith(".gz")) bytes = gunzipSync(bytes);
  return JSON.parse(bytes.toString("utf8"));
}

async function exportData() {
  await fs.mkdir(path.join(archive, "objects"), { recursive: true });
  const db = new Firestore({ projectId });
  const bucket = new Storage({ projectId }).bucket(bucketName);
  const users = (await db.collection("users").get()).docs.map((doc) => ({ uid: doc.id, data: doc.data() }));
  const [files] = await bucket.getFiles();
  const objects = [];
  for (const file of files) {
    const destination = safeObjectPath(file.name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await file.download({ destination });
    const bytes = await fs.readFile(destination);
    objects.push({ key: file.name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const manifest = { projectId, bucketName, exportedAt: new Date().toISOString(), users, objects };
  await fs.writeFile(path.join(archive, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await db.terminate();
  console.log(`Recovery export ready: ${users.length} users, ${objects.length} objects in ${archive}`);
}

function sqlString(value) { return `'${String(value).replaceAll("'", "''")}'`; }

async function verifyExport() {
  const manifest = JSON.parse(await fs.readFile(path.join(archive, "manifest.json"), "utf8"));
  const sourceKeys = new Set(manifest.objects.map((entry) => entry.key));
  for (const user of manifest.users) {
    if (user.data.snapshotPath && !sourceKeys.has(user.data.snapshotPath)) throw new Error(`Missing source snapshot for ${user.uid}`);
    if (user.data.avatarPath && !sourceKeys.has(user.data.avatarPath)) throw new Error(`Missing source avatar for ${user.uid}`);
  }
  for (const object of manifest.objects) {
    const source = safeObjectPath(object.key);
    const bytes = await fs.readFile(source);
    if (bytes.length !== object.bytes || sha256(bytes) !== object.sha256) throw new Error(`Export checksum mismatch: ${object.key}`);
  }
  for (const { uid, data } of manifest.users) {
    if (!data.snapshotPath) continue;
    try { validateSnapshot(await readSnapshot(data.snapshotPath)); }
    catch { throw new Error(`Invalid current snapshot for ${uid}`); }
  }
  return manifest;
}

async function compareSource() {
  const manifest = await verifyExport();
  const db = new Firestore({ projectId });
  const bucket = new Storage({ projectId }).bucket(bucketName);
  try {
    const current = (await db.collection("users").get()).docs;
    if (current.length !== manifest.users.length) throw new Error("GCP user count changed after export");
    const old = new Map(manifest.users.map((user) => [user.uid, user.data]));
    for (const doc of current) {
      const before = old.get(doc.id), after = JSON.parse(JSON.stringify(doc.data()));
      if (!before || !isDeepStrictEqual(before, after)) throw new Error("GCP account metadata or backup changed after export");
    }
    const [files] = await bucket.getFiles();
    const objects = new Map(manifest.objects.map((entry) => [entry.key, entry]));
    if (files.length !== objects.size || files.some((file) => !objects.has(file.name))) throw new Error("GCP object listing changed after export");
    for (const file of files) {
      const [bytes] = await file.download();
      const expected = objects.get(file.name);
      if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error("GCP object content changed after export");
    }
    console.log("GCP account metadata and every source object checksum still match the verified export");
  } finally {
    await db.terminate();
  }
}

async function importData() {
  const manifest = await verifyExport();
  const login = await fetch("https://app.sakumoney.my.id/auth/google/start", { redirect: "manual" });
  if (login.status !== 503) throw new Error("Cloudflare public login must be closed before import");
  if (queryD1("SELECT COUNT(*) AS count FROM sessions")[0].count !== 0) throw new Error("Cloudflare sessions must be empty before import");
  for (const object of manifest.objects) {
    const source = safeObjectPath(object.key);
    const contentType = object.contentType || (object.key.startsWith("avatars/") ? "image/webp" : object.key.endsWith(".manifest.json") ? "application/json" : object.key.endsWith(".gz") ? "application/gzip" : "application/octet-stream");
    runWrangler(["r2", "object", "put", `saku-data/${object.key}`, "--file", source, "--content-type", contentType, "--remote"]);
    const verified = path.join(archive, "verified", ...object.key.split("/"));
    await fs.mkdir(path.dirname(verified), { recursive: true });
    runWrangler(["r2", "object", "get", `saku-data/${object.key}`, "--file", verified, "--remote"]);
    const copied = await fs.readFile(verified);
    await fs.rm(verified);
    if (copied.length !== object.bytes || sha256(copied) !== object.sha256) throw new Error(`R2 checksum mismatch: ${object.key}`);
  }
  const statements = manifest.users.map(({ uid, data }) => {
    const { revision = 0, snapshotPath = null, ...details } = data;
    return `INSERT INTO users (uid,data,revision,snapshot_path,updated_at) VALUES (${sqlString(uid)},${sqlString(JSON.stringify(details))},${Number(revision)},${snapshotPath ? sqlString(snapshotPath) : "NULL"},${Date.now()}) ON CONFLICT(uid) DO UPDATE SET data=excluded.data,revision=excluded.revision,snapshot_path=excluded.snapshot_path,updated_at=excluded.updated_at;`;
  });
  for (const job of manifest.sheetJobs || []) {
    const value = (item) => item == null ? "NULL" : sqlString(item);
    statements.push(`INSERT INTO sheet_jobs (uid,baseline_path,baseline_revision,target_path,target_revision,cursor,total,updated_at) VALUES (${sqlString(job.uid)},${value(job.baseline_path)},${Number(job.baseline_revision)},${value(job.target_path)},${value(job.target_revision)},${Number(job.cursor)},${Number(job.total)},${Date.now()}) ON CONFLICT(uid) DO UPDATE SET baseline_path=excluded.baseline_path,baseline_revision=excluded.baseline_revision,target_path=excluded.target_path,target_revision=excluded.target_revision,cursor=excluded.cursor,total=excluded.total,updated_at=excluded.updated_at;`);
  }
  const script = path.join(archive, "import.sql");
  await fs.writeFile(script, statements.join("\n"), { mode: 0o600 });
  if (statements.length) runWrangler(["d1", "execute", "saku", "--remote", "--file", script]);
  const rows = new Map(queryD1("SELECT uid,data,revision,snapshot_path FROM users").map((row) => [row.uid, row]));
  if (rows.size !== manifest.users.length) throw new Error("D1 user count does not match the source export; resolve extra accounts before cutover");
  for (const { uid, data } of manifest.users) {
    const row = rows.get(uid);
    const { revision = 0, snapshotPath = null, ...details } = data;
    if (!row || row.revision !== revision || row.snapshot_path !== snapshotPath || JSON.stringify(JSON.parse(row.data)) !== JSON.stringify(details)) throw new Error(`D1 verification failed for ${uid}`);
  }
  if (manifest.sheetJobs) {
    const jobs = new Map(queryD1("SELECT uid,baseline_path,baseline_revision,target_path,target_revision,cursor,total FROM sheet_jobs").map((row) => [row.uid, row]));
    if (jobs.size !== manifest.sheetJobs.length) throw new Error("D1 Sheet job count does not match the recovery archive");
    for (const expected of manifest.sheetJobs) {
      const actual = jobs.get(expected.uid);
      if (!actual || actual.baseline_path !== expected.baseline_path || actual.baseline_revision !== expected.baseline_revision || actual.target_path !== expected.target_path || actual.target_revision !== expected.target_revision || actual.cursor !== expected.cursor || actual.total !== expected.total) throw new Error("D1 Sheet baseline verification failed");
    }
  }
  console.log(`Imported ${manifest.users.length} users and ${manifest.objects.length} checked objects. Verify remote rows and restore before cutover.`);
}

try {
  if (mode === "export") await exportData();
  else if (mode === "compare-source") await compareSource();
  else if (mode === "verify") {
    const manifest = await verifyExport();
    console.log(`Recovery export verified: ${manifest.users.length} users, ${manifest.objects.length} objects`);
  }
  else if (mode === "import") await importData();
  else throw new Error("Use: node server/migrate-to-cloudflare.mjs export|verify|compare-source|import");
} catch (error) {
  // Google SDK error objects can contain Authorization headers. Never print the object or its stack.
  console.error(`Migration ${mode || "command"} failed: ${error.message}`);
  process.exitCode = 1;
}
