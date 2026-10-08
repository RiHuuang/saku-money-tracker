import { spawnSync } from "node:child_process";
import path from "node:path";

const project = process.env.GOOGLE_CLOUD_PROJECT || "saku-money-tracker";
if (!/^[a-z][a-z0-9-]{4,62}$/.test(project)) throw new Error("Invalid Google Cloud project ID");
const wrangler = path.resolve("node_modules/wrangler/bin/wrangler.js");
const config = process.env.SAKU_WRANGLER_CONFIG;
if (config && !["wrangler.jsonc", "wrangler.stage.jsonc"].includes(config)) throw new Error("Unsupported Wrangler configuration");
const names = [
  ["saku-google-oauth-client-secret", "GOOGLE_OAUTH_CLIENT_SECRET"],
  ["saku-token-encryption-key", "TOKEN_ENCRYPTION_KEY"],
];

for (const [source, destination] of names) {
  const read = spawnSync("gcloud.cmd", ["secrets", "versions", "access", "latest", `--secret=${source}`, `--project=${project}`], { encoding: "utf8", windowsHide: true, shell: true });
  if (read.status !== 0 || !read.stdout.trim()) throw new Error(`Could not read ${source} from GCP`);
  const put = spawnSync(process.execPath, [wrangler, "secret", "put", destination, ...(config ? ["--config", config] : [])], { input: read.stdout.trimEnd(), encoding: "utf8", windowsHide: true });
  if (put.status !== 0) throw new Error(`Could not put ${destination} in Cloudflare`);
  console.log(`Copied ${destination} without printing its value`);
}
