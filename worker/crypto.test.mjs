import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import * as native from "./crypto.js";
import * as legacy from "../server/src/core.js";

const secret = nodeCrypto.randomBytes(32).toString("base64"), key = native.encryptionKey(secret), oldKey = legacy.encryptionKey(secret);
for (const value of ["", "Google refresh token fixture", "日本語 / emoji 🧪 / newline\n" ]) {
  assert.equal(await native.decrypt(legacy.encrypt(value, oldKey), key), value, "Worker must decrypt GCP token format");
  assert.equal(legacy.decrypt(await native.encrypt(value, key), oldKey), value, "GCP recovery must decrypt Worker token format");
  assert.equal(await native.hashToken(value), legacy.hashToken(value), "Session hashes must remain compatible");
}
const corrupted = Buffer.from(await native.encrypt("token", key), "base64"); corrupted[12] ^= 1;
await assert.rejects(native.decrypt(corrupted.toString("base64"), key));
await assert.rejects(native.decrypt(await native.encrypt("token", key), native.encryptionKey(nodeCrypto.randomBytes(32).toString("base64"))));
await assert.rejects(native.encryptionKey(nodeCrypto.randomBytes(16).toString("base64")));
const verifier = native.tokenPart();
assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
assert.equal(await native.pkceChallenge(verifier), nodeCrypto.createHash("sha256").update(verifier).digest("base64url"));
// Node lacks the Workers timing-safe extension; verify its typed-array call contract.
crypto.subtle.timingSafeEqual = nodeCrypto.timingSafeEqual;
try {
  assert.equal(native.timingSafeEqual("same", "same"), true);
  assert.equal(native.timingSafeEqual("same", "diff"), false);
  assert.equal(native.timingSafeEqual("same", "shorter"), false);
} finally { delete crypto.subtle.timingSafeEqual; }
console.log("Worker native crypto: GCP encryption compatibility, authenticated tamper rejection, session hashes, PKCE and timing-safe comparison passed");
