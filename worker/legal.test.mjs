import assert from "node:assert/strict";
import { legalLanguage, legalPage } from "./legal.js";

const env = { SUPPORT_EMAIL: "support@example.invalid" };
const page = async (path, lang) => (await legalPage(path, env, lang)).text();
const count = (html, pattern) => (html.match(pattern) || []).length;
assert.equal(legalLanguage(new URL("https://saku.example/privacy")), "id", "Bahasa Indonesia is the default");
assert.equal(legalLanguage(new URL("https://saku.example/privacy?lang=en")), "en");
assert.equal(legalLanguage(new URL("https://saku.example/privacy?lang=xx")), "id");
for (const path of ["/privacy", "/terms", "/account-deletion"]) {
  const id = await page(path, "id"), en = await page(path, "en");
  assert.match(id, /<html lang="id">/); assert.match(en, /<html lang="en">/);
  assert.ok(id.includes(`href="${path}?lang=en"`) && en.includes(`href="${path}?lang=id"`), `${path} links to the other language`);
  // Same sections, paragraphs, list items, labels and links in both languages.
  for (const [name, pattern] of [["h2", /<h2>/g], ["p", /<p>/g], ["li", /<li>/g], ["strong", /<strong>/g], ["mailto", /href="mailto:/g], ["page links", /href="\/[a-z-]+\?lang=/g]])
    assert.equal(count(id, pattern), count(en, pattern), `${path} has the same ${name} count in both languages`);
  assert.equal((await legalPage(path, env, "id")).headers.get("content-language"), "id");
}
const privacyId = await page("/privacy", "id"), privacyEn = await page("/privacy", "en");
for (const required of ["Nomor 27 Tahun 2022", "Cloudflare", "Google", "tujuh hari", "di luar Indonesia", "Hak kamu"]) assert.ok(privacyId.includes(required), `Indonesian privacy mentions ${required}`);
for (const required of ["Law No. 27 of 2022", "Cloudflare", "Google", "seven days", "outside Indonesia", "Your rights"]) assert.ok(privacyEn.includes(required), `English privacy mentions ${required}`);
assert.ok(privacyId.includes("support@example.invalid") && !privacyId.includes("${"), "contact is filled in");
console.log("Legal pages: Indonesian default, English alternate, cross-links and matching structure passed");
