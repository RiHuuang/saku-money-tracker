import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["worker/index.js"], bundle: true, platform: "node", format: "esm", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(await fs.readFile("worker/schema.sql", "utf8"));
const uid = "synthetic-agreement-user", id = "synthetic-agreement-session", secret = "synthetic-agreement-secret", now = Date.now();
const hash = nodeCrypto.createHash("sha256").update(secret).digest("hex");
sqlite.prepare("INSERT INTO users VALUES(?,?,0,NULL,?)").run(uid, JSON.stringify({ name: "Synthetic", email: "synthetic@example.invalid", agreementVersion: "2026-10-03" }), now);
sqlite.prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run(id, uid, hash, hash, now + 600000, now + 600000, now);
const prepared = (sql, values = []) => ({
  bind: (...args) => prepared(sql, args),
  first: async () => sqlite.prepare(sql).get(...values) ?? null,
  run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }),
});
const env = { DB: { prepare: prepared }, SUPPORT_EMAIL: "support@example.invalid" };
const call = (path, method = "GET", body) => worker.fetch(new Request(`https://saku.example${path}`, { method, headers: { authorization: `Bearer ${id}.${secret}`, "content-type": "application/json", "x-saku-user-id": uid }, body }), env);
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
try {
  assert.equal((await (await call("/v1/me")).json()).user.agreementVersion, "2026-10-03", "the app can see which agreement the account accepted");
  assert.equal((await call("/v1/me/agreement", "POST", JSON.stringify({ agreementVersion: "2026-10-03" }))).status, 400, "only the current agreement can be accepted");
  const accepted = await call("/v1/me/agreement", "POST", JSON.stringify({ agreementVersion: "2026-10-26" }));
  assert.equal(accepted.status, 200, await accepted.clone().text());
  assert.equal((await accepted.json()).user.agreementVersion, "2026-10-26");
  const stored = JSON.parse(sqlite.prepare("SELECT data FROM users WHERE uid=?").get(uid).data);
  assert.equal(stored.agreementVersion, "2026-10-26");
  assert.equal(typeof stored.agreementAcceptedAt, "number");
  const privacy = await (await worker.fetch(new Request("https://saku.example/privacy?lang=en"), env)).text();
  assert.match(privacy, /notifications from the bank and e-wallet apps you choose/);
  assert.match(privacy, /Effective 26 October 2026/);
  assert.match(await (await worker.fetch(new Request("https://saku.example/terms?lang=en"), env)).text(), /reading bank and e-wallet notifications on Android are optional/);
  assert.match(await (await worker.fetch(new Request("https://saku.example/privacy"), env)).text(), /<html lang="id">/, "the notice defaults to Bahasa Indonesia");
  console.log("Agreement route: current version reported, only the current version accepted, notices describe notification access");
} finally { delete crypto.subtle.timingSafeEqual; sqlite.close(); }
