// Renders synthetic myBCA "Account Information" screenshots for the Catch up BCA benchmark.
// Every name, account and card number here is made up. Usage: node scripts/fixtures/bca/make-screens.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const { screens } = JSON.parse(readFileSync(join(here, "expected.json"), "utf8"));
const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function page(screen) {
  const rows = screen.rows.map((row) => {
    const date = row.printedDate === "PEND" ? `<div class="pend">PEND</div>`
      : `<div class="date"><b>${row.printedDate.split(" ")[0]}</b><span>${row.printedDate.split(" ")[1]}</span><span>${row.printedDate.split(" ")[2]}</span></div>`;
    return `<div class="row">${date}<div class="body"><p class="ref">${escape(row.printedRef)}</p><p class="type">${escape(row.printedType)}</p>` +
      `<p class="amt ${row.direction === "income" ? "cr" : "db"}">IDR ${row.amount.toLocaleString("en-US")}.00</p></div></div>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:650px;font-family:Arial,Helvetica,sans-serif;background:#2b5b9a}
.top{height:300px;color:#fff;padding:0 30px;box-sizing:border-box}.top h1{margin:0;padding-top:110px;font-size:32px;font-weight:500}
.acct{margin-top:30px;background:#6c86a8;border-radius:16px;padding:18px 28px;font-size:20px}
.sheet{background:#fff;border-radius:28px 28px 0 0;min-height:1100px}
.tabs{display:flex;justify-content:space-between;padding:40px 30px 20px;font-size:24px;color:#8a8f99;border-bottom:3px solid #eee}.tabs b{color:#1d4f91}
.month{background:#eef2f6;padding:22px 30px;font-weight:700;color:#1b2a3a;font-size:20px;margin-top:120px}
.row{display:flex;gap:28px;padding:22px 30px;border-bottom:1px solid #e5e8ec;align-items:center}
.date{width:110px;text-align:center;color:#8a8f99;font-size:26px;display:flex;flex-direction:column}.date b{font-size:38px;font-weight:600}
.pend{width:110px;text-align:center;color:#8a8f99;font-size:20px}
.body p{margin:4px 0;color:#1b2a3a;font-weight:700;font-size:20px;line-height:1.15}.body .type{margin-top:12px}
.amt.cr{color:#3a8fd0}.amt.db{color:#c0393b}
</style></head><body><div class="top"><h1>&lt;&nbsp; Account Information</h1><div class="acct">Account No.<br>${screen.account}</div></div>
<div class="sheet"><div class="tabs"><b>Account Transactions</b><span>Card</span><span>Pocket</span></div><div class="month">October</div>${rows}</div></body></html>`;
}

const out = join(here, "screens");
mkdirSync(out, { recursive: true });
for (const screen of screens) {
  const html = join(out, `${screen.id}.html`);
  writeFileSync(html, page(screen));
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=650,1400",
    `--screenshot=${join(out, `${screen.id}.png`)}`, `file:///${html.replace(/\\/g, "/")}`], { stdio: "ignore" });
  rmSync(html);
  console.log(`${screen.id}.png`);
}
