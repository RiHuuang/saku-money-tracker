// Capture path-level CPU evidence without retaining cookies or OAuth query strings.
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
const outputPath = process.argv[2];
const record = (value) => outputPath
  ? fs.appendFileSync(outputPath, `${JSON.stringify(value)}\n`)
  : console.log(JSON.stringify(value));
const child = spawn(process.execPath, [path.resolve("node_modules/wrangler/bin/wrangler.js"), "tail", "--config", "wrangler.stage.jsonc", "--format", "json"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let buffer = "", depth = 0, quoted = false, escaped = false;
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  for (const character of chunk) {
    if (!depth && character !== "{") continue;
    buffer += character;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{") depth++;
    else if (character === "}") depth--;
    if (depth) continue;
    try {
      const event = JSON.parse(buffer);
      const measurement = event.logs?.find((log) => log.message?.[0] === "saku-runtime")?.message;
      if (event.eventTimestamp) record({
        at: new Date(event.eventTimestamp).toISOString(),
        path: event.event?.request?.url ? new URL(event.event.request.url).pathname : "cron",
        method: event.event?.request?.method,
        status: event.event?.response?.status,
        cpuMs: event.cpuTime,
        version: event.scriptVersion?.id,
        outcome: event.outcome,
        ...(measurement ? {
          coldInvocation: measurement[1] === "cold",
          coldGoogleKeys: measurement[2] === "keys-cold",
        } : {}),
      });
    } catch { console.error("Unparsed tail event"); }
    buffer = "";
  }
});
child.stderr.on("data", () => {});
child.on("exit", (code) => { process.exitCode = code || 0; });
process.on("SIGINT", () => child.kill());
