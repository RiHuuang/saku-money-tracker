import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const config = await fs.readFile(path.join(os.homedir(), "AppData/Roaming/xdg.config/.wrangler/config/default.toml"), "utf8");
const token = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error("Wrangler OAuth token unavailable");
const hours = Number(process.env.SAKU_METRICS_HOURS || 1);
if (!Number.isInteger(hours) || hours < 1 || hours > 24) throw new Error("SAKU_METRICS_HOURS must be 1–24");
const script = process.env.SAKU_METRICS_SCRIPT || "saku";
if (!/^[a-z][a-z0-9-]{0,62}$/.test(script)) throw new Error("Invalid Worker script name");
const end = process.env.SAKU_METRICS_END ? new Date(process.env.SAKU_METRICS_END) : new Date();
const start = process.env.SAKU_METRICS_START ? new Date(process.env.SAKU_METRICS_START) : new Date(end.valueOf() - hours * 60 * 60_000);
if (!Number.isFinite(start.valueOf()) || !Number.isFinite(end.valueOf()) || end <= start || end.valueOf() - start.valueOf() > 24 * 3600_000) throw new Error("Invalid metrics interval");
const query = `query Metrics($account: string, $start: string, $end: string) { viewer { accounts(filter: {accountTag: $account}) { workersInvocationsAdaptive(limit: 1000, filter: {scriptName: "${script}", datetime_geq: $start, datetime_leq: $end}) { sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { datetime status } } } } }`;
const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query, variables: { account: "0a69784f6f665813a15e6ab31e958692", start: start.toISOString(), end: end.toISOString() } }),
});
const body = await response.json();
if (!response.ok || body.errors) throw new Error(`Metrics query failed: ${JSON.stringify(body.errors || response.status)}`);
console.log(JSON.stringify(body.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [], null, 2));
