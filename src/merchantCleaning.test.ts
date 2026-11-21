import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData } from "./domain";
import { namesToClean } from "./merchantCleaning";
import { learnMerchant } from "./merchants";

test("only unknown, eligible purchase names are sent for cleaning, once each", () => {
  const data = emptyData();
  data.merchantRules = learnMerchant(data, "Alfamart", { name: "Alfamart", pocketId: "" });
  const rows = [
    { name: "QRIS ALFAMART 0456 BDG", activity: "purchase" }, { name: "GRAB* A-5XK2 RIDE", activity: "purchase" }, { name: "grab*  a-5xk2 ride", activity: "purchase" },
    { name: "GoPay", activity: "topup" }, { name: "TRSF 1234567 BUDI", activity: "purchase" }, { name: "x".repeat(101), activity: "purchase" }, { name: "", activity: "purchase" },
  ];
  assert.deepEqual(namesToClean(rows, data), ["GRAB* A-5XK2 RIDE"]);
  assert.equal(namesToClean(Array.from({ length: 30 }, (_, index) => ({ name: `Shop${String.fromCharCode(65 + index)}`, activity: "purchase" })), data).length, 20);
});

test("tidy names apply only to rows already added, and teach a rule", async () => {
  const { applyTidiedNames } = await import("./merchantCleaning");
  const data = emptyData();
  const base = { amount: 10_000, type: "expense" as const, date: "2026-11-20", pocketId: "", account: "BCA", note: "" };
  data.transactions = [{ ...base, id: "added", name: "QRIS ALFAMART 0123 JKT" }, { ...base, id: "older", name: "QRIS ALFAMART 0123 JKT" }, { ...base, id: "renamed", name: "My snack" }];
  const next = applyTidiedNames(data, new Set(["added", "renamed"]), [{ name: "QRIS ALFAMART 0123 JKT", cleanName: "Alfamart" }]);
  assert.deepEqual(next.transactions.map((transaction) => transaction.name), ["Alfamart", "QRIS ALFAMART 0123 JKT", "My snack"]);
  assert.equal(next.merchantRules.at(-1)?.name, "Alfamart");
  assert.equal(next.merchantRules.at(-1)?.automaticName, true);
  assert.equal(applyTidiedNames(next, new Set(["added"]), [{ name: "QRIS ALFAMART 0123 JKT", cleanName: "Alfamart" }]), next, "nothing new returns the same data");
});

test("statement drafts and their original files expire after 30 days", async () => {
  const { draftExpired } = await import("./importDraft");
  const now = Date.parse("2026-11-22T00:00:00Z");
  assert.equal(draftExpired({ createdAt: now - 29 * 86_400_000 }, now), false);
  assert.equal(draftExpired({ createdAt: now - 31 * 86_400_000 }, now), true);
});
