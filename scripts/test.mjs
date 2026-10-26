import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const directory = await mkdtemp(join(tmpdir(), "saku-tests-"));
try {
  const tests = ["src/domain.test.ts", "src/pdfStatement.test.ts", "src/importTransactions.test.ts", "src/importFlow.test.ts", "src/appearance.test.ts", "src/appUpdateLogic.test.ts", "src/backupCrypto.test.ts"];
  const outputs = tests.map((file) => join(directory, file.split("/").at(-1).replace(".ts", ".mjs")));
  await Promise.all(tests.map((entryPoints, index) => build({ entryPoints: [entryPoints], outfile: outputs[index], bundle: true, platform: "node", format: "esm" })));
  const child = spawn(process.execPath, ["--test", ...outputs], { stdio: "inherit" });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  process.exitCode = code ?? 1;
  if (process.exitCode === 0) {
    await import("../worker/import-ai.test.mjs");
    await import("../worker/import-ai-route.test.mjs");
    await import("./cloud-refresh.test.mjs");
    await import("../worker/avatar.test.mjs");
    await import("../worker/google-token.test.mjs");
    await import("../worker/crypto.test.mjs");
    await import("../worker/profile-race.test.mjs");
    await import("../worker/android-release.test.mjs");
    await import("../worker/sheet-refresh.test.mjs");
    await import("../worker/bounded-login.test.mjs");
    await import("../worker/live.test.mjs");
    await import("../worker/live-route.test.mjs");
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
