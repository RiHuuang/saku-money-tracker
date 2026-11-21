import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Master plan 2.8: ratchets that can only get better. Raise a baseline only with the owner's approval.
const BASELINE = {
  // Font sizes of 9-11 px in the app stylesheet: 219 at the audit, 216 after the reader and review screens moved to 12 px.
  smallFonts: 216,
  // English UI strings longer than 12 words.
  longStrings: 50,
};

const css = readFileSync("src/styles.css", "utf8");
const block = (selector) => {
  const start = css.lastIndexOf(`${selector} {\n`) >= 0 ? css.lastIndexOf(`${selector} {\n`) : css.lastIndexOf(`${selector} {\r\n`);
  assert.ok(start >= 0, `${selector} theme block`);
  const body = css.slice(start, css.indexOf("}", start));
  const full = (hex) => hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3}))\b/g)].map(([, name, value]) => [name, full(value)]));
};
const light = block(":root"), dark = { ...light, ...block(':root[data-theme="dark"]') };

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

for (const [theme, tokens] of [["light", light], ["dark", dark]]) {
  for (const background of ["canvas", "surface", "surface-muted"]) {
    for (const control of ["control-border", "focus-ring"]) {
      const ratio = contrast(tokens[control], tokens[background]);
      assert.ok(ratio >= 3, `${theme}: --${control} on --${background} is ${ratio.toFixed(3)}:1, needs 3:1`);
    }
    for (const text of ["ink", "muted", "warning", "teal"]) {
      const ratio = contrast(tokens[text], tokens[background]);
      assert.ok(ratio >= 4.5, `${theme}: --${text} on --${background} is ${ratio.toFixed(3)}:1, needs 4.5:1`);
    }
  }
}
assert.match(css, /input, select, textarea \{[^}]*border-color: var\(--control-border\)/, "inputs use the 3:1 control border, not --line");

const smallFonts = (css.match(/(?:font-size:\s*|font:[^;]*?\s)(?:9|10|11)(?:\.\d+)?px/g) || []).length;
assert.ok(smallFonts <= BASELINE.smallFonts, `9-11 px font sizes went up to ${smallFonts} (baseline ${BASELINE.smallFonts})`);

const en = readFileSync("src/locales/en.ts", "utf8");
const strings = [...en.matchAll(/(\w+): "((?:[^"\\]|\\.)*)"/g)].map(([, key, value]) => ({ key, value }));
const words = (value) => value.replace(/\{\w+\}/g, "x").split(/\s+/).filter(Boolean).length;
const longStrings = strings.filter((item) => words(item.value) > 12).length;
assert.ok(longStrings <= BASELINE.longStrings, `strings over 12 words went up to ${longStrings} (baseline ${BASELINE.longStrings})`);

// Copy lint (2.6). Vendor names belong in consent and legal text, never in labels.
const vendorAllowed = new Set(["agreementSummary", "consentText", "sendFiles", "googleBackup", "connectGoogleDrive", "reconnectGoogleDrive", "googleDriveConnected", "continueGoogle", "signInNotConfigured", "keepAPrivateBackupIn", "signingInAlsoCreatesYour", "googleAccountConnected", "googleSignInIsAvailable", "yourCloudSnapshotIsSaved", "sakuAccountDeletedRemoveIts", "permanentlyRemoveSakuCloudData"]);
for (const locale of readdirSync("src/locales").filter((name) => name.endsWith(".ts"))) {
  const text = readFileSync(`src/locales/${locale}`, "utf8");
  for (const [, key, value] of text.matchAll(/(\w+): "((?:[^"\\]|\\.)*)"/g)) {
    assert.doesNotMatch(value, /^Here is exactly|^Berikut persisnya/i, `${locale} ${key}: no "Here is exactly" openers`);
    if (!vendorAllowed.has(key)) assert.doesNotMatch(value, /Cloudflare|Workers AI|Gemma|Qwen|LiteRT|ML Kit/, `${locale} ${key}: no vendor or model names in labels`);
  }
}
console.log(`UI ratchets: contrast in both themes, ${smallFonts} small font sizes, ${longStrings} long strings, copy lint passed`);
