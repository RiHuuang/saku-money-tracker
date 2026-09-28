import test from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt, encryptionKey, sheetCell, splitSessionToken, validateSnapshot } from "./core.js";

test("encrypts tokens with authenticated encryption", () => {
  const key = encryptionKey(Buffer.alloc(32, 7).toString("base64"));
  const encrypted = encrypt("refresh-secret", key);
  assert.notEqual(encrypted, "refresh-secret");
  assert.equal(decrypt(encrypted, key), "refresh-secret");
});

test("rejects malformed session tokens and oversized collections", () => {
  assert.deepEqual(splitSessionToken("id.secret"), { id: "id", secret: "secret" });
  assert.equal(splitSessionToken("bad"), null);
  assert.throws(() => validateSnapshot({ version: 3, accounts: [], pockets: [], transactions: [], creditCards: [], recurring: [], favorites: Array(31), pocketTransfers: [], existingInstallments: [] }));
});

test("neutralizes spreadsheet formulas", () => {
  assert.equal(sheetCell("=IMPORTXML(1)"), "'=IMPORTXML(1)");
  assert.equal(sheetCell("Coffee"), "Coffee");
});
