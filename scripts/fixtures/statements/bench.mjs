// Scores Monthly check reading for each bank's synthetic statement against the accuracy gate in
// docs/monthly-check-3.0.md: 100% of amounts and directions, at least 95% of names, no invented rows.
//
// Stage only: sends each fixture page to /v1/import/extract with source "auto", exactly as the app does for a text
// statement it can't prove locally. Needs a disposable stage session in SAKU_BENCH_TOKEN and SAKU_BENCH_UID
// (never printed). Exits non-zero when any bank misses the gate.
//
//   node scripts/fixtures/statements/bench.mjs [--origin=https://stage.sakumoney.my.id] [--bank=jago] [--out=result.json]
//   node scripts/fixtures/statements/bench.mjs --local     # offline: scores the expected rows themselves (checks the scorer)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BANKS = ["bca", "jago", "seabank", "blu", "gopay", "dana"];
const norm = (value) => String(value || "").toLocaleLowerCase("id-ID").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function loadFixture(bank) {
  const fixture = JSON.parse(readFileSync(join(here, `${bank}.json`), "utf8"));
  const rows = fixture.rows || fixture.expected;
  return { ...fixture, expectedRows: rows.map(([date, amount, direction], index) => ({ date, amount, direction, name: fixture.names[index] || "" })) };
}

// Each expected row claims the first unclaimed reading with its amount; whatever is left over was invented.
export function score(expected, actual) {
  const left = [...actual];
  const passed = { amount: 0, direction: 0, date: 0, name: 0 };
  const misses = [];
  for (const want of expected) {
    const index = left.findIndex((row) => row.amount === want.amount);
    if (index < 0) { misses.push({ missing: want }); continue; }
    const [got] = left.splice(index, 1);
    const checks = { amount: true, direction: got.direction === want.direction, date: got.date === want.date, name: norm(`${got.cleanName || ""} ${got.name || ""}`).includes(norm(want.name)) };
    for (const [field, ok] of Object.entries(checks)) if (ok) passed[field]++;
    const wrong = Object.keys(checks).filter((field) => !checks[field]);
    if (wrong.length) misses.push({ want, wrong, got: { date: got.date, amount: got.amount, direction: got.direction, name: got.cleanName || got.name } });
  }
  const total = expected.length;
  const gate = passed.amount === total && passed.direction === total && passed.name >= Math.ceil(total * 0.95) && left.length === 0;
  return { total, passed, invented: left.length, gate, misses };
}

async function extract(origin, token, uid, fixture) {
  const response = await fetch(`${origin}/v1/import/extract`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-saku-user-id": uid, "content-type": "application/json" },
    body: JSON.stringify({ kind: "text", month: fixture.month, source: "auto", text: fixture.text }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${fixture.bank}: ${response.status} ${body.error || ""}`);
  if (body.bank !== fixture.bank) throw new Error(`${fixture.bank}: the Worker read it as ${body.bank || "nothing"}`);
  return body.rows || [];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, fallback) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
  const local = process.argv.includes("--local");
  const origin = arg("origin", "https://stage.sakumoney.my.id");
  if (/app\.sakumoney/.test(origin)) throw new Error("The statement bench runs on stage only");
  const { SAKU_BENCH_TOKEN: token, SAKU_BENCH_UID: uid } = process.env;
  if (!local && (!token || !uid)) throw new Error("Set SAKU_BENCH_TOKEN and SAKU_BENCH_UID to a disposable stage session, or pass --local");
  const banks = arg("bank", "") ? [arg("bank", "")] : BANKS;
  const results = [];
  for (const bank of banks) {
    const fixture = loadFixture(bank);
    const rows = local ? fixture.expectedRows.map((row) => ({ ...row, cleanName: row.name })) : await extract(origin, token, uid, fixture);
    results.push({ bank, rows, ...score(fixture.expectedRows, rows) });
  }
  console.log(JSON.stringify(results.map(({ bank, total, passed, invented, gate, misses }) => ({ bank, gate: gate ? "PASS" : "FAIL", amount: `${passed.amount}/${total}`, direction: `${passed.direction}/${total}`, date: `${passed.date}/${total}`, name: `${passed.name}/${total}`, invented, misses })), null, 1));
  const out = arg("out", "");
  if (out) writeFileSync(out, JSON.stringify({ origin: local ? "local" : origin, at: new Date().toISOString(), results }, null, 1));
  if (results.some((result) => !result.gate)) process.exitCode = 1;
}
