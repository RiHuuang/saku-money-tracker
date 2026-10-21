import test from "node:test";
import assert from "node:assert/strict";
import { cachedRelease, shouldShowRelease, UPDATE_CHECK_INTERVAL_MS, validRelease, type AndroidRelease } from "./appUpdateLogic";

const release: AndroidRelease = {
  versionCode: 8,
  versionName: "2.2.0",
  minimumSupportedVersionCode: 7,
  releasedAt: "2026-10-21T00:00:00.000Z",
  apkUrl: "/download/android/8.apk",
  apkBytes: 40_350_643,
  sha256: "a".repeat(64),
  notes: ["A calmer update flow"],
};

test("reuses a valid release manifest during the daily cold-start window", () => {
  const now = Date.parse("2026-10-21T12:00:00.000Z");
  assert.deepEqual(cachedRelease(String(now - 1_000), JSON.stringify(release), now), release);
  assert.equal(cachedRelease(String(now - UPDATE_CHECK_INTERVAL_MS), JSON.stringify(release), now), undefined);
  assert.equal(cachedRelease(String(now + 1), JSON.stringify(release), now), undefined);
  assert.equal(cachedRelease(String(now - 1_000), "not json", now), undefined);
});

test("validates release data before trusting the cache", () => {
  assert.equal(validRelease(release), true);
  assert.equal(validRelease({ ...release, apkUrl: "https://example.com/update.apk" }), false);
  assert.equal(validRelease({ ...release, sha256: "short" }), false);
});

test("honors optional snoozes and critical session dismissals", () => {
  const now = Date.parse("2026-10-21T12:00:00.000Z");
  const snoozed = JSON.stringify({ versionCode: 8, until: now + 1_000 });
  assert.equal(shouldShowRelease(7, release, snoozed, null, now), false);
  assert.equal(shouldShowRelease(7, release, snoozed, null, now + 1_001), true);

  const critical = { ...release, minimumSupportedVersionCode: 8 };
  assert.equal(shouldShowRelease(7, critical, snoozed, null, now), true);
  assert.equal(shouldShowRelease(7, critical, snoozed, 8, now), false);
  assert.equal(shouldShowRelease(8, release, null, null, now), false);
});
