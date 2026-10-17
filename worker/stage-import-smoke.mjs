import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

if (process.env.SAKU_APPROVED_SINGLE_AI_TEST !== "yes") throw new Error("Set SAKU_APPROVED_SINGLE_AI_TEST=yes only for an approved single staging call");
const mode = process.argv[2] || "text";
if (!["text", "screenshot", "scan", "benchmark-1", "benchmark-2", "benchmark-3", "private-image"].includes(mode)) throw new Error("Choose text, screenshot, scan, benchmark-1 through benchmark-3, or private-image");
const root = process.cwd();
const wrangler = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const uid = `synthetic-import-${randomUUID()}`;
const id = randomBytes(16).toString("hex");
const secret = randomBytes(32).toString("base64url");
const refresh = randomBytes(32).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const now = Date.now();
const sqlPath = join(root, "output", `synthetic-import-${id}.sql`);
const execute = (sql) => {
  writeFileSync(sqlPath, sql);
  try { execFileSync(process.execPath, [wrangler, "d1", "execute", "saku-stage", "--remote", "--config", "wrangler.stage.jsonc", "--file", sqlPath], { cwd: root, stdio: "pipe", timeout: 45000 }); }
  finally { unlinkSync(sqlPath); }
};

async function inputForMode() {
  if (mode === "text") return { kind: "text", month: "2026-10", text: "CONTOH MUTASI REKENING - DATA SINTETIS\n10/10/2026 QRIS WARUNG CONTOH DB 28.000,00\n10/10/2026 TOP UP GOPAY DB 37.000,00\nSALDO AKHIR 500.000,00" };
  if (mode === "screenshot") return { kind: "image", month: "2026-10", image: `data:image/png;base64,${readFileSync(join(root, "output", "synthetic-wallet-history.png")).toString("base64")}` };
  if (mode === "private-image") {
    if (!process.env.SAKU_PRIVATE_IMAGE_PATH) throw new Error("Set SAKU_PRIVATE_IMAGE_PATH to the approved local image");
    return { kind: "image", month: "2026-10", image: `data:image/jpeg;base64,${readFileSync(process.env.SAKU_PRIVATE_IMAGE_PATH).toString("base64")}` };
  }
  if (mode.startsWith("benchmark-")) return { kind: "image", month: "2026-10", image: `data:image/jpeg;base64,${readFileSync(join(root, "output", "import-benchmark-30", `screen-${mode.slice(-1)}.jpg`)).toString("base64")}` };
  const [{ getDocument }, { createCanvas }] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("@napi-rs/canvas")]);
  const task = getDocument({ data: new Uint8Array(readFileSync(join(root, "output", "synthetic-scanned-statement.pdf"))), useSystemFonts: true, disableFontFace: true });
  try {
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: Math.min(2, 1900 / page.getViewport({ scale: 1 }).width) });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return { kind: "image", month: "2026-10", image: canvas.toDataURL("image/jpeg", 0.75) };
  } finally { await task.destroy(); }
}

try {
  execute(`INSERT INTO users(uid,data,revision,snapshot_path,updated_at) VALUES('${uid}','{"name":"Synthetic import test"}',0,NULL,${now});
INSERT INTO sessions(id,uid,access_hash,refresh_hash,access_expires_at,refresh_expires_at,updated_at) VALUES('${id}','${uid}','${hash(secret)}','${hash(refresh)}',${now + 300000},${now + 300000},${now});`);
  const response = await fetch("https://saku-stage.saku-money-manager.workers.dev/v1/import/extract", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${id}.${secret}`, "x-saku-user-id": uid },
    body: JSON.stringify(await inputForMode()),
  });
  const result = await response.json();
  if (response.ok && mode.startsWith("benchmark-")) writeFileSync(join(root, "output", "import-benchmark-30", `screen-${mode.slice(-1)}.json`), JSON.stringify(result, null, 2));
  if (mode === "private-image") {
    writeFileSync(join(root, "output", "private-image-stage-result.json"), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify({ mode, status: response.status, rowCount: result.rows?.length ?? 0 })}\n`);
  } else process.stdout.write(`${JSON.stringify({ mode, status: response.status, result })}\n`);
} finally {
  execute(`DELETE FROM sessions WHERE id='${id}';
DELETE FROM users WHERE uid='${uid}';`);
}
