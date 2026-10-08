import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { sheetTables } from "../server/src/core.js";
import { isDeepStrictEqual } from "node:util";

const origin = "https://saku.saku-money-manager.workers.dev";
const archive = path.resolve(process.env.SAKU_MIGRATION_DIR || "output/cloudflare-migration");
const manifest = JSON.parse(await fs.readFile(path.join(archive, "manifest.json"), "utf8"));
const user = manifest.users[0];
if (manifest.users.length !== 1 || !user.data.snapshotPath) throw new Error("Expected one imported account with a snapshot");
const id = crypto.randomUUID(), secret = crypto.randomBytes(32).toString("base64url"), hash = crypto.createHash("sha256").update(secret).digest("hex");
const wrangler = path.resolve("node_modules/wrangler/bin/wrangler.js");
function d1(command) {
  const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "saku", "--remote", "--command", command, "--json"], { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) throw new Error("Could not run the temporary live verification query");
}
const now = Date.now();
d1(`INSERT INTO sessions (id,uid,access_hash,refresh_hash,access_expires_at,refresh_expires_at,updated_at) VALUES ('${id}','${user.uid}','${hash}','${hash}',${now + 600000},${now + 600000},${now})`);
try {
  const headers = { authorization: `Bearer ${id}.${secret}` };
  let response = await fetch(`${origin}/v1/me`, { headers });
  assert.equal(response.status, 200, "profile request failed");
  const profile = await response.json();
  assert.equal(profile.user.id, user.uid);
  assert.equal(profile.sync.revision, user.data.revision);
  response = await fetch(`${origin}/v2/sync`, { headers });
  assert.equal(response.status, 200, "backup read failed");
  const encoding = response.headers.get("x-saku-encoding");
  const actual = encoding === "gzip" ? JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8")) : await response.json();
  const expected = JSON.parse(gunzipSync(await fs.readFile(path.join(archive, "objects", ...user.data.snapshotPath.split("/")))).toString("utf8"));
  assert.deepEqual(actual, expected);
  assert.equal(Number(response.headers.get("x-saku-revision")), user.data.revision);
  if (user.data.spreadsheetId) {
    response = await fetch(`${origin}/v2/sheets/current`, { headers });
    assert.equal(response.status, 200, "existing Sheet read failed");
    const current = await response.json();
    const tables = Object.values(sheetTables(expected));
    const normalize = (rows) => rows.map((row) => {
      const cells = row.map((cell) => String(cell ?? ""));
      while (cells.at(-1) === "") cells.pop();
      return cells;
    });
    assert.equal(current.valueRanges.length, tables.length);
    for (let index = 0; index < tables.length; index++) {
      if (!isDeepStrictEqual(normalize(current.valueRanges[index].values || []), normalize(tables[index]))) throw new Error("The live Google Sheet differs from the recovery export; check for newer GCP writes before the final import");
    }
  }
  if (user.data.avatarPath) {
    response = await fetch(`${origin}/v1/me/avatar`, { headers });
    assert.equal(response.status, 200, "avatar read failed");
    const source = await fs.readFile(path.join(archive, "objects", ...user.data.avatarPath.split("/")));
    assert.equal(crypto.createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex"), crypto.createHash("sha256").update(source).digest("hex"));
  }
  console.log("Live Worker profile, backup, revision, Sheet values, and avatar match the verified GCP export");
} finally {
  d1(`DELETE FROM sessions WHERE id='${id}'`);
}
