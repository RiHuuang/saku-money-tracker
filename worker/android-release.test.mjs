import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const request = (method = "GET", path = "/download/saku.apk") => new Request(`https://saku.example${path}`, { method });
const fixture = "signed fixture";
const manifest = {
  versionCode: 8,
  versionName: "2.2.0",
  minimumSupportedVersionCode: 7,
  releasedAt: "2026-10-21T00:00:00.000Z",
  apkUrl: "/download/android/8.apk",
  apkBytes: fixture.length,
  sha256: "a".repeat(64),
  notes: ["Updates can now be installed from Saku."],
};
let apkReads = 0;
const bucket = {
  get: async (key) => {
    if (key === "releases/android/latest.json") return { json: async () => manifest };
    assert.equal(key, "releases/android/8.apk");
    apkReads++;
    return { body: new Blob([fixture]).stream(), size: fixture.length, httpEtag: '"fixture"' };
  },
  head: async (key) => {
    assert.equal(key, "releases/android/8.apk");
    return { size: fixture.length, httpEtag: '"fixture"' };
  },
};

assert.equal((await worker.fetch(request(), { BUCKET: bucket })).status, 404);
assert.equal(apkReads, 0, "a closed release gate must not read an APK");
const env = { BUCKET: bucket, ANDROID_RELEASE_ENABLED: "true", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };
const latest = await worker.fetch(request("GET", "/v1/releases/android/latest"), env);
assert.equal(latest.status, 200);
assert.deepEqual(await latest.json(), manifest);
const response = await worker.fetch(request(), env);
assert.equal(response.status, 200);
assert.equal(response.headers.get("content-type"), "application/vnd.android.package-archive");
assert.equal(await response.text(), fixture);
const versioned = await worker.fetch(request("GET", "/download/android/8.apk"), env);
assert.equal(versioned.headers.get("cache-control"), "public, max-age=31536000, immutable");
assert.equal(await versioned.text(), fixture);
const head = await worker.fetch(request("HEAD", "/download/android/8.apk"), env);
assert.equal(head.headers.get("content-length"), String(fixture.length));
assert.equal(await head.text(), "");
assert.equal((await worker.fetch(request("GET", "/download/android/7.apk"), env)).status, 404);
assert.equal((await worker.fetch(request("GET", "/download/ledgers/private.json"), env)).status, 404);
assert.equal(apkReads, 2, "downloads must resolve only the current public release object");
console.log("Android release: manifest, legacy alias, immutable version, streaming GET and HEAD passed");
