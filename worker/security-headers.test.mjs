import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { build } from "esbuild";
import landing from "./landing.js";
import { appCsp, landingCsp } from "./security-headers.js";

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: app } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const env = { ASSETS: { fetch: async () => new Response("synthetic asset", { headers: { "content-type": "text/html" } }) } };
for (const [worker, host, csp, header] of [
  [app, "app.sakumoney.my.id", appCsp, "content-security-policy-report-only"],
  [landing, "sakumoney.my.id", landingCsp, "content-security-policy"],
]) {
  const response = await worker.fetch(new Request(`https://${host}/`), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "synthetic asset");
  assert.equal(response.headers.get(header), csp);
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
}
for (const [file, csp, header] of [["public/_headers", appCsp, "Content-Security-Policy-Report-Only"], ["landing/_headers", landingCsp, "Content-Security-Policy"]]) {
  const source = await fs.readFile(file, "utf8");
  assert.ok(source.includes(`${header}: ${csp}`));
  assert.ok(source.includes("X-Frame-Options: DENY"));
}
assert.match(await fs.readFile("landing/.well-known/security.txt", "utf8"), /Contact: mailto:richardhuang\.email@gmail\.com/);
console.log("Security headers: app and landing assets, static fallback and contact passed");
