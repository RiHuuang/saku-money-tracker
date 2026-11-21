import assert from "node:assert/strict";
import { test } from "node:test";
import { captureHealth, showKeepRunning } from "./captureHealth";
import type { CaptureStatus } from "./notificationCapture";

const now = Date.parse("2026-11-22T12:00:00Z");
const base: CaptureStatus = { granted: true, paused: false, apps: [{ packageName: "com.bca", name: "BCA mobile", suggestedAccount: "BCA", installed: true, account: "BCA" }], connectedAt: now - 3_600_000, disconnectedAt: 0, lastCapturedAt: now - 7_200_000 };

test("the reader is on, off or needs a check", () => {
  assert.equal(captureHealth(base, now).state, "on");
  assert.equal(captureHealth({ ...base, granted: false }, now).state, "off");
  assert.equal(captureHealth({ ...base, paused: true }, now).state, "off");
  assert.equal(captureHealth({ ...base, apps: [{ ...base.apps[0], account: "" }] }, now).state, "off");
  assert.equal(captureHealth({ ...base, disconnectedAt: now - 10_000 }, now).state, "check", "not bound 5 s after a drop");
  assert.equal(captureHealth({ ...base, disconnectedAt: now - 2_000 }, now).state, "on", "a rebind is still within 5 s");
  assert.equal(captureHealth({ ...base, systemKillAt: now - 60_000 }, now).state, "check", "killed after the last connect");
  assert.equal(captureHealth({ ...base, systemKillAt: now - 7_200_000 }, now).state, "on", "the OS already reconnected after that kill");
  assert.equal(captureHealth({ ...base, backgroundRestricted: true }, now).state, "check");
  assert.equal(captureHealth({ ...base, standbyRestricted: true }, now).state, "check");
});

test("quiet days and a missing battery exemption never trigger a check", () => {
  const quiet = captureHealth({ ...base, lastCapturedAt: now - 6 * 86_400_000, batteryExempt: false }, now);
  assert.equal(quiet.state, "on");
  assert.equal(quiet.quietDays, 6);
  assert.equal(showKeepRunning({ ...base, brand: "samsung" }), true);
  assert.equal(showKeepRunning({ ...base, brand: "oppo" }), false);
});
