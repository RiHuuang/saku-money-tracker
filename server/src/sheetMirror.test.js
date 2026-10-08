import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { sheetTables as serverTables } from "./core.js";

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../../src/sheetMirror.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", write: false });
const { sheetTables, sheetChanges, sheetGridRows } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`);

test("client Sheet cells match the existing mirror and neutralize formulas", () => {
  const data = {
    version: 3, accounts: ["Cash"], pockets: [{ id: "p1", name: "Food", color: "teal", icon: "home", budget: 1000, budgets: {}, createdMonth: "2026-10" }],
    transactions: [{ id: "t1", date: "2026-10-04", name: "=IMPORTXML(1)", type: "expense", amount: 125, account: "Cash", pocketId: "p1", note: "Lunch", split: { people: 2, ownAmount: 62 } }],
    creditCards: [], recurring: [], favorites: [], pocketTransfers: [], existingInstallments: [],
  };
  assert.deepEqual(sheetTables(data), serverTables(data));
  const changes = sheetChanges(null, data);
  assert.equal(changes.length, 8);
  assert.equal(changes[0].range, "'Transactions'!A1:R2");
  assert.equal(changes[0].after[1][2], "'=IMPORTXML(1)");
});

test("bounded Sheet changes clear only stale app cells and leave other columns outside the range", () => {
  const oldData = { version: 3, accounts: ["Cash", "Savings"], pockets: [], transactions: [
    { id: "t1", date: "2026-10-04", name: "Lunch", type: "expense", amount: 125, account: "Cash" },
    { id: "t2", date: "2026-10-04", name: "Tea", type: "expense", amount: 25, account: "Cash" },
  ], creditCards: [], recurring: [], favorites: [], pocketTransfers: [], existingInstallments: [] };
  const newData = { ...oldData, accounts: ["Cash"], transactions: [{ ...oldData.transactions[0], name: "Dinner" }] };
  const changes = sheetChanges(oldData, newData);
  assert.deepEqual(changes.map(({ range }) => range), ["'Transactions'!A2:R3", "'Accounts'!A3:A3"]);
  assert.equal(changes[0].before[1][0], "t2");
  assert.ok(changes[0].after[1].every((cell) => cell === ""));
  assert.ok(changes.every((change) => change.after.length <= 250 && Buffer.byteLength(JSON.stringify(change)) < 370_000));
  assert.equal(sheetGridRows(oldData, newData).Transactions, 3);
});

test("large Sheet edits split below the measured Worker CPU batch size", () => {
  const data = {
    version: 3, accounts: ["Cash"], pockets: [],
    transactions: Array.from({ length: 250 }, (_, index) => ({ id: `t${index}`, date: "2026-10-04", name: "Entry", type: "expense", amount: 1, account: "Cash", note: "n".repeat(500) })),
    creditCards: [], recurring: [], favorites: [], pocketTransfers: [], existingInstallments: [],
  };
  const changes = sheetChanges(null, data);
  assert.ok(changes.length >= 2);
  assert.ok(changes.every((change) => change.after.length <= 250 && Buffer.byteLength(JSON.stringify(change)) < 150_000));
});
