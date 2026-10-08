// Read account-wide usage; no user records, object names or credentials are printed.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const config = await fs.readFile(path.join(os.homedir(), "AppData/Roaming/xdg.config/.wrangler/config/default.toml"), "utf8");
const token = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error("Wrangler OAuth token unavailable");
const account = "0a69784f6f665813a15e6ab31e958692";
const end = new Date(), day = end.toISOString().slice(0, 10), month = `${day.slice(0, 7)}-01`;
const storageStart = new Date(end.valueOf() - 24 * 3600_000).toISOString();
const query = `query Usage {
  viewer { accounts(filter: {accountTag: "${account}"}) {
    workersInvocationsAdaptive(limit: 1000, filter: {datetime_geq: "${day}T00:00:00Z", datetime_leq: "${end.toISOString()}"}) {
      sum { requests errors } dimensions { scriptName }
    }
    d1AnalyticsAdaptiveGroups(limit: 1000, filter: {date_geq: "${day}", date_leq: "${day}"}) {
      sum { rowsRead rowsWritten } dimensions { databaseId }
    }
    d1StorageAdaptiveGroups(limit: 1000, filter: {date_geq: "${day}", date_leq: "${day}"}) {
      max { databaseSizeBytes } dimensions { databaseId }
    }
    r2OperationsAdaptiveGroups(limit: 10000, filter: {datetime_geq: "${month}T00:00:00Z", datetime_leq: "${end.toISOString()}"}) {
      sum { requests } dimensions { bucketName actionType }
    }
    r2StorageAdaptiveGroups(limit: 10000, filter: {datetime_geq: "${storageStart}", datetime_leq: "${end.toISOString()}"}, orderBy: [datetime_DESC]) {
      max { objectCount payloadSize metadataSize } dimensions { bucketName datetime }
    }
  } }
}`;
const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query }), signal: AbortSignal.timeout(60_000),
});
const result = await response.json();
if (!response.ok || result.errors) throw new Error(`Usage query failed: ${JSON.stringify(result.errors || response.status)}`);
const usage = result.data.viewer.accounts[0];
const latestBuckets = new Map();
for (const row of usage.r2StorageAdaptiveGroups) if (!latestBuckets.has(row.dimensions.bucketName)) latestBuckets.set(row.dimensions.bucketName, row);
usage.r2StorageAdaptiveGroups = [...latestBuckets.values()];
console.log(JSON.stringify({ measuredAt: end.toISOString(), workerAndD1DayUTC: day, r2OperationsMonthUTC: month, usage }, null, 2));
