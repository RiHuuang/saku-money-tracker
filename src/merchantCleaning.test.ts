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
