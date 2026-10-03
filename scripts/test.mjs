import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const directory = await mkdtemp(join(tmpdir(), "saku-tests-"));
try {
  const tests = ["src/domain.test.ts", "src/pdfStatement.test.ts", "src/appearance.test.ts"];
  const outputs = tests.map((file) => join(directory, file.split("/").at(-1).replace(".ts", ".mjs")));
  await Promise.all(tests.map((entryPoints, index) => build({ entryPoints: [entryPoints], outfile: outputs[index], bundle: true, platform: "node", format: "esm" })));
  const child = spawn(process.execPath, ["--test", ...outputs], { stdio: "inherit" });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  process.exitCode = code ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
