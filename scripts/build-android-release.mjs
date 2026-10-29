import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

// The website APK (direct) carries the self-updater; the Play bundle never does.
const tasks = ["clean", "lintDirectRelease", "testDirectReleaseUnitTest", "testPlayReleaseUnitTest", "assembleDirectRelease", "bundlePlayRelease"];
const android = resolve("android");
// Windows only finds the wrapper by full path, quoted because the checkout path can contain spaces.
const gradle = process.platform === "win32" ? `"${resolve(android, "gradlew.bat")}"` : "./gradlew";
const result = spawnSync(gradle, tasks, { cwd: android, stdio: "inherit", shell: process.platform === "win32" });
if (result.status !== 0) throw new Error(`Gradle failed${result.error ? `: ${result.error.message}` : ""}`);
const outputs = {
  websiteApk: resolve(android, "app/build/outputs/apk/direct/release/app-direct-release.apk"),
  playBundle: resolve(android, "app/build/outputs/bundle/playRelease/app-play-release.aab"),
};
for (const [name, path] of Object.entries(outputs)) console.log(`${name}: ${path} (${(await stat(path)).size} bytes)`);
