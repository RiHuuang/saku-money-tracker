import test from "node:test";
import assert from "node:assert/strict";
import { avatarAfterSignIn, decrypt, encrypt, encryptionKey, isGoogleAvatarUrl, sheetCell, splitSessionToken, validateSnapshot } from "./core.js";

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

test("preserves custom avatars across later Google sign-ins", () => {
  assert.deepEqual(
    avatarAfterSignIn({ avatarPath: "avatars/user.webp", avatarSource: "custom", avatarVersion: "custom-v1" }, "avatars/google.webp", "google-v2"),
    { avatarPath: "avatars/user.webp", avatarSource: "custom", avatarVersion: "custom-v1" },
  );
  assert.deepEqual(
    avatarAfterSignIn({ avatarPath: "avatars/old.webp", avatarSource: "google", avatarVersion: "old" }, "avatars/new.webp", "new"),
    { avatarPath: "avatars/new.webp", avatarSource: "google", avatarVersion: "new" },
  );
});

test("accepts only HTTPS Google-hosted profile images", () => {
  assert.equal(isGoogleAvatarUrl("https://lh3.googleusercontent.com/photo"), true);
  assert.equal(isGoogleAvatarUrl("http://lh3.googleusercontent.com/photo"), false);
  assert.equal(isGoogleAvatarUrl("https://evilgoogleusercontent.com/photo"), false);
  assert.equal(isGoogleAvatarUrl("not a URL"), false);
});
