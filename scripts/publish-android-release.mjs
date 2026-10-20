import { createHash } from "node:crypto";
import { readFile, stat, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const values = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const at = argument.indexOf("=");
  if (!argument.startsWith("--") || at < 3) throw new Error(`Use --name=value arguments, received ${argument}`);
  return [argument.slice(2, at), argument.slice(at + 1)];
}));
const required = ["config", "apk", "version-code", "version-name", "minimum-build"];
for (const name of required) if (!values[name]) throw new Error(`Missing --${name}=...`);
const configPath = resolve(values.config), apkPath = resolve(values.apk);
const config = JSON.parse(await readFile(configPath, "utf8"));
const bucket = config.r2_buckets?.find((entry) => entry.binding === "BUCKET")?.bucket_name;
if (!bucket) throw new Error("The Wrangler config has no BUCKET R2 binding");
if (config.vars?.ANDROID_RELEASE_ENABLED !== "true") throw new Error("The Wrangler config does not enable Android releases");
const versionCode = Number(values["version-code"]), minimumSupportedVersionCode = Number(values["minimum-build"]);
if (!Number.isSafeInteger(versionCode) || versionCode < 1 || !Number.isSafeInteger(minimumSupportedVersionCode) || minimumSupportedVersionCode < 1 || minimumSupportedVersionCode > versionCode) throw new Error("Invalid Android build numbers");
if (!/^\d+\.\d+\.\d+$/.test(values["version-name"])) throw new Error("Version name must use x.y.z");
const notes = (values.notes || "").split("|").map((note) => note.trim()).filter(Boolean);
if (notes.length > 3 || notes.some((note) => note.length > 160)) throw new Error("Use at most three notes of 160 characters each");
const info = await stat(apkPath);
const sha256 = createHash("sha256").update(await readFile(apkPath)).digest("hex");
const manifest = {
  versionCode,
  versionName: values["version-name"],
  minimumSupportedVersionCode,
  releasedAt: new Date().toISOString(),
  apkUrl: `/download/android/${versionCode}.apk`,
  apkBytes: info.size,
  sha256,
  notes,
};
const manifestPath = resolve(tmpdir(), `saku-android-release-${process.pid}.json`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
const wrangler = resolve("node_modules/wrangler/bin/wrangler.js");
function put(key, file, contentType, cacheControl) {
  const result = spawnSync(process.execPath, [wrangler, "r2", "object", "put", `${bucket}/${key}`, "--file", file, "--remote", "--config", configPath, "--content-type", contentType, "--cache-control", cacheControl, "--force"], { cwd: process.cwd(), stdio: "inherit", shell: false });
  if (result.status !== 0) throw new Error(`Could not publish ${key}${result.error ? `: ${result.error.message}` : ""}`);
}
try {
  put(`releases/android/${versionCode}.apk`, apkPath, "application/vnd.android.package-archive", "public, max-age=31536000, immutable");
  // The pointer is deliberately last: clients never see a release before its APK exists.
  put("releases/android/latest.json", manifestPath, "application/json", "public, max-age=300");
  console.log(JSON.stringify({ published: basename(apkPath), bucket, ...manifest }, null, 2));
} finally { await unlink(manifestPath).catch(() => {}); }
