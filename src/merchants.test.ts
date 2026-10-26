import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyData, validateData } from "./domain";
import { MERCHANT_RULE_LIMIT, learnMerchant, merchantKey, normalizeMerchant, suggestMerchant } from "./merchants";

test("normalizeMerchant strips payment rails, codes and city suffixes", () => {
  const fixtures: [string, string][] = [
    ["QRIS ALFAMART 0123 JKT", "Alfamart"],
    ["QRIS ALFAMART 0456 BDG", "Alfamart"],
    ["QRIS INDOMARET T123 JAKSEL", "Indomaret"],
    ["GRAB* A-5XK2 RIDE", "Grab A-5xk2 Ride"],
    ["GOJEK*GOFOOD 123456", "Gojek Gofood"],
    ["TRSF E-BANKING DB 1310/FTSCY/WS95271 BUDI SANTOSO", "Budi Santoso"],
    ["TRSF E-BANKING CR 2510/FTFVA/WS95051 PT CONTOH JAYA", "Pt Contoh Jaya"],
    ["Tokopedia", "Tokopedia"],
    ["  kopi   kenangan  ", "Kopi Kenangan"],
    ["STARBUCKS 00987 SBY", "Starbucks"],
    ["QRIS WARUNG BU SRI 889102 YOGYAKARTA", "Warung Bu Sri Yogyakarta"],
    ["SHOPEE*PAY 1234567 ID", "Shopee Pay"],
    ["MCDONALD'S 0021 BEKASI", "Mcdonald's"],
    ["H&M 0012 JKT", "H&M"],
  ];
  for (const [raw, clean] of fixtures) assert.equal(normalizeMerchant(raw), clean, raw);
  assert.equal(merchantKey("QRIS ALFAMART 0123 JKT"), merchantKey("Alfamart"));
  assert.equal(normalizeMerchant("0123 4567"), "");
});

test("a saved correction is suggested for the same merchant from another branch", () => {
  const data = emptyData();
  data.pockets = [{ id: "groceries", name: "Groceries", color: "#15786e", icon: "gift", budget: 0, budgets: {}, createdMonth: "2026-10" }];
  assert.equal(suggestMerchant(data, "QRIS ALFAMART 0123 JKT"), null);
  data.merchantRules = learnMerchant(data, "QRIS ALFAMART 0123 JKT", { name: "Alfamart", pocketId: "groceries" }, "2026-10-25T10:00:00Z");
  assert.deepEqual(suggestMerchant(data, "QRIS ALFAMART 0456 BDG"), { name: "Alfamart", pocketId: "groceries" });
  assert.equal(learnMerchant(data, "Alfamart", { name: "Alfamart", pocketId: "groceries" }), data.merchantRules, "matching the suggestion learns nothing");
  const renamed = learnMerchant(data, "alfamart", { name: "Alfamart Sudirman", pocketId: "groceries" }, "2026-10-26T10:00:00Z");
  assert.deepEqual(renamed.map((rule) => [rule.key, rule.name]), [["alfamart", "Alfamart Sudirman"]], "one rule per merchant key");
});

test("rules referencing a deleted pocket fall back to Unassigned and survive a restore", () => {
  const data = emptyData();
  data.pockets = [{ id: "fun", name: "Fun", color: "#15786e", icon: "gift", budget: 0, budgets: {}, createdMonth: "2026-10" }];
  data.merchantRules = learnMerchant(data, "CGV 0042 JKT", { name: "CGV", pocketId: "fun" }, "2026-10-25T10:00:00Z");
  const restored = validateData(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(restored.merchantRules, data.merchantRules);
  const withoutPocket = validateData(JSON.parse(JSON.stringify({ ...data, pockets: [] })));
  assert.equal(withoutPocket.merchantRules[0].pocketId, "");
  assert.deepEqual(suggestMerchant({ ...data, pockets: [] }, "CGV"), { name: "CGV", pocketId: "" });
  const { merchantRules: _, ...old } = emptyData();
  assert.deepEqual(validateData(JSON.parse(JSON.stringify(old))).merchantRules, []);
  assert.throws(() => validateData({ ...emptyData(), merchantRules: [{ key: "", name: "x", pocketId: "", updatedAt: "" }] }));
});

test("the rule list stays bounded, dropping the oldest first", () => {
  const data = emptyData();
  for (let index = 0; index < MERCHANT_RULE_LIMIT + 3; index++)
    data.merchantRules = learnMerchant(data, `Store${String.fromCharCode(65 + (index % 26))}${String.fromCharCode(65 + Math.floor(index / 26))}`, { name: `Shop ${index}`, pocketId: "" }, new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString());
  assert.equal(data.merchantRules.length, MERCHANT_RULE_LIMIT);
  assert.equal(data.merchantRules.some((rule) => rule.name === "Shop 0"), false);
  assert.equal(data.merchantRules.some((rule) => rule.name === `Shop ${MERCHANT_RULE_LIMIT + 2}`), true);
});
