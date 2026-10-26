import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}#auth-rate-limit`);
const counts = new Map();
let deletes = 0, inserts = 0;
const env = {
  PUBLIC_LOGIN_ENABLED: "true", GOOGLE_OAUTH_CLIENT_ID: "test-client",
  AUTH_RATE_LIMITER: { limit: async ({ key }) => {
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    return { success: count <= 20 };
  } },
  DB: { prepare: (sql) => ({ bind: () => ({ run: async () => { if (sql.startsWith("DELETE FROM oauth_states")) deletes++; else inserts++; } }) }) },
};
const start = (ip) => worker.fetch(new Request("https://saku.example/auth/google/start", { headers: { "cf-connecting-ip": ip } }), env);
for (let i = 0; i < 20; i++) assert.equal((await start("192.0.2.1")).status, 302);
const blocked = await start("192.0.2.1");
assert.equal(blocked.status, 429);
assert.deepEqual(await blocked.json(), { error: "Too many sign-in requests; try again in a minute" });
const androidBlocked = await worker.fetch(new Request("https://saku.example/v1/auth/google", { method: "POST", headers: { "cf-connecting-ip": "192.0.2.1" } }), env);
assert.equal(androidBlocked.status, 429, "Android sign-in shares the per-IP auth limit");
assert.equal((await start("192.0.2.2")).status, 302);
assert.equal(inserts, 21, "blocked requests must not insert OAuth states");
assert.equal(deletes, 21, "expired states should be pruned before each insert");
console.log("Auth rate limit: 21st request blocked, other IP unaffected, expired states pruned");
