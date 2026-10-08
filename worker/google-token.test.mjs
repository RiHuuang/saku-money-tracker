import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

// Exercise the Worker's actual verifier and JOSE configuration with a local key.
// These signed fixtures are not Google credentials and never reach Google.
const bundled = await build({ stdin: { contents: `${await fs.readFile("worker/index.js", "utf8")}\nexport { profileFromToken };`, resolveDir: path.resolve("worker"), loader: "js" }, bundle: true, platform: "node", format: "esm", write: false });
const { profileFromToken } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`);
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(publicKey), kid: "saku-test", alg: "RS256", use: "sig" };
const client = "saku-test-client", now = Math.floor(Date.now() / 1000);
const claims = { iss: "https://accounts.google.com", aud: client, sub: "test-google-user", email: "test@example.invalid", email_verified: true, exp: now + 3600, iat: now };
const sign = (payload) => new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  assert.equal(String(url), "https://www.googleapis.com/oauth2/v3/certs");
  return Response.json({ keys: [jwk] });
};
try {
  assert.equal((await profileFromToken(await sign(claims), client)).sub, claims.sub);
  for (const invalid of [{ iss: "https://untrusted.example" }, { aud: "other-client" }, { exp: now - 10 }, { nbf: now + 3600 }, { email_verified: false }]) {
    await assert.rejects(profileFromToken(await sign({ ...claims, ...invalid }), client));
  }
  const withoutExpiry = { ...claims }; delete withoutExpiry.exp;
  await assert.rejects(profileFromToken(await sign(withoutExpiry), client));
  const token = await sign(claims), segments = token.split(".");
  segments[1] = Buffer.from(JSON.stringify({ ...claims, sub: "attacker" })).toString("base64url");
  await assert.rejects(profileFromToken(segments.join("."), client));
  console.log("Google verifier: signature, issuer, audience, required expiry, not-before and verified-email checks passed");
} finally { globalThis.fetch = originalFetch; }
