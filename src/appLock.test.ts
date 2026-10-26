import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultAppLock, parseAppLock, shouldLock } from "./appLock";

test("app lock settings parse defensively", () => {
  assert.deepEqual(parseAppLock(null), defaultAppLock);
  assert.deepEqual(parseAppLock("not json"), defaultAppLock);
  assert.deepEqual(parseAppLock(JSON.stringify({ enabled: true, after: 60, hideInRecents: true })), { enabled: true, after: 60, hideInRecents: true });
  assert.deepEqual(parseAppLock(JSON.stringify({ enabled: "yes", after: 30 })), defaultAppLock, "only exact values count");
});

test("the app locks only after leaving for at least the chosen time", () => {
  const on = { enabled: true, after: 60 as const, hideInRecents: false };
  assert.equal(shouldLock(on, null, 1_000_000), false, "never hidden");
  assert.equal(shouldLock(on, 1_000_000, 1_059_999), false);
  assert.equal(shouldLock(on, 1_000_000, 1_060_000), true);
  assert.equal(shouldLock({ ...on, after: 0 }, 1_000_000, 1_000_000), true, "immediately");
  assert.equal(shouldLock({ ...on, enabled: false }, 0, 10_000_000), false);
});
