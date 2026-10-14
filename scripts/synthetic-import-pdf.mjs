import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A deliberately fabricated text PDF for exercising the statement import UI.
const lines = [
  "CONTOH MUTASI REKENING - DATA SINTETIS",
  "10/10/2026 QRIS WARUNG CONTOH DB 28.000,00",
  "10/10/2026 TOP UP GOPAY DB 37.000,00",
  "SALDO AKHIR 500.000,00",
];
const escapePdf = (value) => value.replace(/[\\()]/g, "\\$&");
const stream = `BT /F1 12 Tf 50 740 Td ${lines.map((line, index) => `${index ? "0 -22 Td " : ""}(${escapePdf(line)}) Tj`).join(" ")} ET`;
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
mkdirSync("output", { recursive: true });
const path = join("output", "synthetic-import-check.pdf");
writeFileSync(path, pdf);
process.stdout.write(`${path}\n`);
