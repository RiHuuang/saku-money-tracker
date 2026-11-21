import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTheme, resolveTheme } from "./appearance";
import { backDestination, popSheet, pushSheet } from "./navigation";

test("appearance preference defaults to system and resolves against device theme", () => {
  assert.equal(normalizeTheme(null), "system");
  assert.equal(normalizeTheme("unexpected"), "system");
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("back navigation follows the page that opened a destination", () => {
  assert.equal(backDestination("settings", ["overview"]), "overview", "the avatar returns to Home");
  assert.equal(backDestination("settings", ["pockets", "more"]), "more");
  assert.equal(backDestination("more", ["pockets"]), "pockets");
  assert.equal(backDestination("check", []), "overview", "a cold-start destination returns Home");
  assert.equal(backDestination("overview", []), null);
});

test("closing nested sheets returns through the account path one level at a time", () => {
  const overview = pushSheet([], "money by account");
  const account = pushSheet(overview, "account");
  const fixBalance = pushSheet(account, "fix balance");
  assert.deepEqual(popSheet(fixBalance), account);
  assert.deepEqual(popSheet(account), overview);
  assert.deepEqual(popSheet(overview), []);
  assert.deepEqual(overview, ["money by account"], "earlier stack values stay intact");
});
