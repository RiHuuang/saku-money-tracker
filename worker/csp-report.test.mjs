import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { build } from "esbuild";
import { cspDirectives } from "./csp-report.js";
import { appCsp } from "./security-headers.js";

assert.deepEqual(cspDirectives(JSON.stringify({ "csp-report": { "document-uri": "https://app.sakumoney.my.id/", "violated-directive": "connect-src https://x", "blocked-uri": "https://evil.example/steal?token=1" } })), ["connect-src"]);
assert.deepEqual(cspDirectives(JSON.stringify([{ type: "csp-violation", body: { effectiveDirective: "script-src-elem", blockedURL: "https://cdn.example/x.js" } }, { type: "deprecation", body: {} }])), ["script-src-elem"]);
assert.deepEqual(cspDirectives("not json"), []);
assert.deepEqual(cspDirectives(JSON.stringify(Array.from({ length: 20 }, () => ({ type: "csp-violation", body: { effectiveDirective: "img-src" } })))), ["img-src"], "a flood of one directive is one write");
assert.deepEqual(cspDirectives(JSON.stringify({ "csp-report": { "violated-directive": "made-up" } })), [], "unknown directive names are not stored");
assert.doesNotMatch(appCsp, /connect-src[^;]*\swss:(\s|;)/, "no bare wss: in the web policy");
assert.match(appCsp, /report-uri \/v1\/csp-report/);

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(await fs.readFile("worker/schema.sql", "utf8"));
const prepared = (sql, values = []) => ({
  bind: (...args) => prepared(sql, args),
  first: async () => sqlite.prepare(sql).get(...values) ?? null,
  run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
  all: async () => ({ results: [], meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
});
const env = { DB: { prepare: prepared, batch: async (statements) => Promise.all(statements.map((statement) => statement.all())) } };
const report = (body) => worker.fetch(new Request("https://app.sakumoney.my.id/v1/csp-report", { method: "POST", headers: { "content-type": "application/csp-report", "content-length": String(Buffer.byteLength(body)) }, body }), env);
for (let i = 0; i < 2; i++) assert.equal((await report(JSON.stringify({ "csp-report": { "violated-directive": "img-src", "blocked-uri": "https://tracker.example/pixel" } }))).status, 204);
assert.equal((await report("garbage")).status, 204);
let limitedCalls = 0;
const limitedEnv = { ...env, AUTH_RATE_LIMITER: { limit: async () => { limitedCalls++; return { success: false }; } } };
assert.equal((await worker.fetch(new Request("https://app.sakumoney.my.id/v1/csp-report", { method: "POST", body: JSON.stringify({ "csp-report": { "violated-directive": "font-src" } }) }), limitedEnv)).status, 204);
assert.equal(limitedCalls, 1, "reports share the per-IP rate limiter");
const rows = sqlite.prepare("SELECT * FROM csp_reports").all();
assert.equal(rows.length, 1);
assert.equal(rows[0].directive, "img-src");
assert.equal(rows[0].count, 2);
assert.deepEqual(Object.keys(rows[0]).sort(), ["count", "day", "directive"], "only day, directive and a count are stored");
sqlite.close();
console.log("CSP reports: directive names only, counted per day, URLs dropped; web policy has no bare wss: passed");
