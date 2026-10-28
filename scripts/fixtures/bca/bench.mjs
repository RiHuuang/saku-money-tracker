// Scores Catch up extraction on the synthetic BCA screens against expected.json.
// Stage only. Needs a disposable stage session in SAKU_BENCH_TOKEN and SAKU_BENCH_UID (never printed).
// Usage: node scripts/fixtures/bca/bench.mjs [--origin=https://stage.sakumoney.my.id] [--out=result.json]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => process.argv.find((item) => item.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const origin = arg("origin", "https://stage.sakumoney.my.id");
if (/app\.sakumoney/.test(origin)) throw new Error("The BCA bench runs on stage only");
const { SAKU_BENCH_TOKEN: token, SAKU_BENCH_UID: uid } = process.env;
if (!token || !uid) throw new Error("Set SAKU_BENCH_TOKEN and SAKU_BENCH_UID to a disposable stage session");
const { screens } = JSON.parse(readFileSync(join(here, "expected.json"), "utf8"));
const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); // Asia/Jakarta
const norm = (value) => String(value || "").toLocaleLowerCase("id-ID").replace(/[^a-z0-9]+/g, " ").trim();

// The kind a Saku row ends up as, from the extractor's activity and direction.
export function rowKind(row) {
  if (row.activity === "card_payment") return "card_payment";
  if (row.activity === "topup") return "wallet_topup";
  return row.direction === "income" ? "income" : "expense";
}

export function score(expectedRows, actualRows) {
  const left = [...actualRows];
  const fields = { amount: 0, direction: 0, date: 0, kind: 0, name: 0, note: 0 };
  const misses = [];
  for (const expected of expectedRows) {
    const index = left.findIndex((row) => row.amount === expected.amount);
    if (index < 0) { misses.push({ missing: expected.printedRef }); continue; }
    const [actual] = left.splice(index, 1);
    const want = expected.expect;
    const checks = {
      amount: true,
      direction: actual.direction === expected.direction,
      date: actual.date === want.date,
      kind: rowKind(actual) === want.kind,
      name: norm(actual.cleanName || actual.name).includes(norm(want.name).replace(/^(transfer dari|transfer ke|isi saldo|bayar kartu kredit) /, "")),
      note: norm(actual.note || "").replace(/ /g, "") === norm(want.note).replace(/ /g, ""),
    };
    for (const [field, ok] of Object.entries(checks)) if (ok) fields[field]++;
    const wrong = Object.keys(checks).filter((field) => !checks[field]);
    if (wrong.length) misses.push({ ref: expected.printedRef, wrong, got: { date: actual.date, direction: actual.direction, activity: actual.activity, name: actual.cleanName || actual.name, note: actual.note } });
  }
  return { fields, total: expectedRows.length, invented: left.length, misses };
}

async function extract(screen) {
  const image = `data:image/png;base64,${readFileSync(join(here, "screens", `${screen.id}.png`)).toString("base64")}`;
  const response = await fetch(`${origin}/v1/import/extract`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "x-saku-user-id": uid, "content-type": "application/json" },
    body: JSON.stringify({ kind: "image", month: "2026-10", image, source: "bca" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${screen.id}: ${response.status} ${body.error || ""}`);
  return body.rows || [];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = [];
  const totals = { fields: { amount: 0, direction: 0, date: 0, kind: 0, name: 0, note: 0 }, total: 0, invented: 0 };
  for (const screen of screens) {
    const rows = await extract(screen);
    const result = score(screen.rows, rows);
    results.push({ screen: screen.id, rows, ...result });
    totals.total += result.total; totals.invented += result.invented;
    for (const field of Object.keys(totals.fields)) totals.fields[field] += result.fields[field];
  }
  const summary = Object.fromEntries(Object.entries(totals.fields).map(([field, count]) => [field, `${count}/${totals.total}`]));
  console.log(JSON.stringify({ origin, today, summary, invented: totals.invented, misses: results.flatMap((item) => item.misses.map((miss) => ({ screen: item.screen, ...miss }))) }, null, 1));
  const out = arg("out", "");
  if (out) writeFileSync(out, JSON.stringify(results, null, 1));
}
