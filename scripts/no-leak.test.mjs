import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Owner rule O1: no SHA, checksum or build ID on any screen or page. A3: no model or runtime names.
const files = [
  ...readdirSync("src/locales").filter((name) => name.endsWith(".ts")).map((name) => `src/locales/${name}`),
  ...readdirSync("landing").filter((name) => /\.(html|js)$/.test(name)).map((name) => `landing/${name}`),
];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  assert.doesNotMatch(text, /SHA-?256|sha256|checksum|data-release|\{build\}/i, `${file} shows a hash or build ID (O1)`);
  assert.doesNotMatch(text, /Qwen|Gemma|INT4|\bMiB\b|LiteRT/, `${file} names a model or runtime (A3)`);
}
for (const file of readdirSync("src").filter((name) => name.endsWith(".tsx")).map((name) => `src/${name}`)) {
  assert.doesNotMatch(readFileSync(file, "utf8"), /Qwen|Gemma|INT4|LiteRT/, `${file} names a model or runtime (A3)`);
}
const landingCsp = readFileSync("landing/_headers", "utf8").match(/connect-src ([^;]+);/)[1];
assert.equal(landingCsp, "'self'", "the landing page calls no API");
console.log("No leaks: no hash, build ID or model name in copy or landing pages; landing connects to itself only");
