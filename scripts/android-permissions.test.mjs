import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

// Snapshot of the permissions Saku asks for. A change here is a Play policy change (master plan HC1).
function permissions(path) {
  const xml = readFileSync(path, "utf8");
  return [...xml.matchAll(/<uses-permission\b([^>]*)\/>/g)]
    .filter(([, attrs]) => !/tools:node="remove"/.test(attrs))
    .map(([, attrs]) => attrs.match(/android:name="([^"]+)"/)[1])
    .sort();
}
function removed(path) {
  const xml = readFileSync(path, "utf8");
  return [...xml.matchAll(/<uses-permission\b([^>]*)\/>/g)]
    .filter(([, attrs]) => /tools:node="remove"/.test(attrs))
    .map(([, attrs]) => attrs.match(/android:name="([^"]+)"/)[1])
    .sort();
}

const main = permissions("android/app/src/main/AndroidManifest.xml");
assert.deepEqual(main, [
  "android.permission.INTERNET",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.RECEIVE_BOOT_COMPLETED",
]);
assert.deepEqual(removed("android/app/src/main/AndroidManifest.xml"), ["android.permission.SCHEDULE_EXACT_ALARM"]);
assert.deepEqual(permissions("android/app/src/direct/AndroidManifest.xml"), ["android.permission.REQUEST_INSTALL_PACKAGES"], "only the website APK may install updates");
assert.ok(!existsSync("android/app/src/play/AndroidManifest.xml") || permissions("android/app/src/play/AndroidManifest.xml").length === 0, "the Play build adds no permissions");

const banned = /REQUEST_IGNORE_BATTERY_OPTIMIZATIONS|FOREGROUND_SERVICE|USE_EXACT_ALARM|QUERY_ALL_PACKAGES|READ_SMS|RECEIVE_SMS|BIND_ACCESSIBILITY_SERVICE|PACKAGE_USAGE_STATS/;
for (const path of ["android/app/src/main/AndroidManifest.xml", "android/app/src/direct/AndroidManifest.xml"]) {
  assert.doesNotMatch(readFileSync(path, "utf8"), banned, `${path} must not request a Play-sensitive permission`);
}

// The self-updater and the removed on-device model must not reach the Play build.
assert.ok(!existsSync("android/app/src/main/java/id/saku/money/AppUpdatePlugin.kt"), "the updater lives in the direct flavor only");
assert.ok(existsSync("android/app/src/direct/java/id/saku/money/AppUpdatePlugin.kt"));
assert.doesNotMatch(readFileSync("android/app/build.gradle", "utf8"), /litertlm/, "the unused on-device model runtime stays removed");
assert.doesNotMatch(readFileSync("android/app/src/main/java/id/saku/money/MainActivity.java", "utf8"), /AppUpdatePlugin/);
console.log("Android permissions: snapshot, Play-sensitive bans, updater only in the website build, no model runtime passed");
