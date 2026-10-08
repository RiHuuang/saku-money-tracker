import fs from "node:fs/promises";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["src/sheetMirror.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { sheetTables, sheetChanges, sheetGridRows } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
const before = {
  version: 3, accounts: ["Cash", "Savings"], pockets: [{ id: "p1", name: "食事", color: "teal", icon: "home", budget: 1000, budgets: { "2026-10": 2000 }, createdMonth: "2026-10" }],
  transactions: [{ id: "t1", date: "2026-10-04", name: "=IMPORTXML(1)", type: "expense", amount: 125, account: "Cash", pocketId: "p1", note: "https://example.invalid/a/" }],
  creditCards: [{ id: "c1", name: "Card", limit: 1000, openingDebt: 20, dueDay: 4 }],
  recurring: [{ id: "r1", name: "Rent", type: "expense", amount: 50, account: "Cash", installments: 1, skippedMonths: ["2026-10"], day: 1, startMonth: "2026-10", active: true }],
  favorites: [{ id: "f1", name: "Tea", type: "expense", amount: 25, account: "Cash" }],
  pocketTransfers: [{ id: "m1", month: "2026-10", fromPocketId: "p1", toPocketId: "p2", amount: 1 }],
  existingInstallments: [{ id: "i1", cardId: "c1", name: "Laptop", monthlyAmount: 10, nextDueMonth: "2026-10", paymentsLeft: 3 }],
};
const after = { ...before, accounts: ["Cash"], transactions: Array.from({ length: 600 }, (_, index) => ({ ...before.transactions[0], id: `t${index}`, name: "@Dinner", note: "/é食\\\"".repeat(120) })) };
const directory = "android/app/src/test/resources";
await fs.mkdir(directory, { recursive: true });
await fs.writeFile(`${directory}/sheet-parity.json`, JSON.stringify({ before, after, tables: sheetTables(before), changes: sheetChanges(before, after), grid: sheetGridRows(before, after) }));
console.log("Generated native Sheet parity fixture from the browser planner");
