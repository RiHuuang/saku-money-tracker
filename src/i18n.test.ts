import assert from "node:assert/strict";
import { en } from "./locales/en";
import { id } from "./locales/id";
import { resolveLanguage, setActiveLanguage, t } from "./i18n";
import { dayLabel, groupDigits, monthLabel } from "./domain";

assert.deepEqual(Object.keys(id).sort(), Object.keys(en).sort(), "locale files must have identical keys");
assert.equal(resolveLanguage("system", "id-ID"), "id");
assert.equal(resolveLanguage("system", "en-US"), "en");
assert.equal(resolveLanguage("en", "id-ID"), "en");
setActiveLanguage("id");
assert.equal(t("recordedCash"), "Uang tercatat");
assert.equal(t("acrossAccounts", { count: 2 }), "Dari 2 akun");
assert.match(monthLabel("2026-10"), /Oktober/i);
assert.match(dayLabel("2026-10-25"), /Okt/i);
assert.equal(groupDigits(2450000), "2.450.000");
setActiveLanguage("en");
assert.equal(t("recordedCash"), "Recorded cash");
assert.match(monthLabel("2026-10"), /October/i);
