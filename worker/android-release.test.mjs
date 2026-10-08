import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const request = (method = "GET", path = "/download/saku.apk") => new Request(`https://saku.example${path}`, { method });
let reads = 0;
const bucket = { get: async (key) => {
  assert.equal(key, "releases/saku.apk");
  reads++;
  return { body: new Blob(["signed fixture"]).stream(), size: 14, httpEtag: '"fixture"' };
}, head: async (key) => {
  assert.equal(key, "releases/saku.apk");
  return { size: 14, httpEtag: '"fixture"' };
} };
assert.equal((await worker.fetch(request(), { BUCKET: bucket })).status, 404);
assert.equal(reads, 0, "a closed release gate must not read any objects");
const env = { BUCKET: bucket, ANDROID_RELEASE_ENABLED: "true", ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };
const response = await worker.fetch(request(), env);
assert.equal(response.status, 200);
assert.equal(response.headers.get("content-type"), "application/vnd.android.package-archive");
assert.equal(await response.text(), "signed fixture");
const head = await worker.fetch(request("HEAD"), env);
assert.equal(head.headers.get("content-length"), "14");
assert.equal(await head.text(), "");
assert.equal((await worker.fetch(request("GET", "/download/ledgers/private.json"), env)).status, 404);
assert.equal(reads, 1, "downloads must never map arbitrary URLs to private bucket keys");
console.log("Android release: gate, exact public object, streaming GET and HEAD passed");
