import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTheme, resolveTheme } from "./appearance";
import { backDestination } from "./navigation";

test("appearance preference defaults to system and resolves against device theme", () => {
  assert.equal(normalizeTheme(null), "system");
  assert.equal(normalizeTheme("unexpected"), "system");
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("back navigation returns from More children to More, then the previous tab", () => {
  assert.equal(backDestination("settings", "pockets"), "more");
  assert.equal(backDestination("check", "transactions"), "overview", "Catch up is a main tab");
  assert.equal(backDestination("plans", "overview"), "more", "Plans lives in More");
  assert.equal(backDestination("more", "pockets"), "pockets");
  assert.equal(backDestination("more", "more"), "overview");
  assert.equal(backDestination("overview", "overview"), null);
});
