export const CSP_REPORT_TABLE = "CREATE TABLE IF NOT EXISTS csp_reports (day TEXT NOT NULL, directive TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day, directive))";

const KNOWN = new Set(["default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem", "style-src-attr", "img-src", "font-src", "connect-src", "worker-src", "frame-src", "child-src", "object-src", "media-src", "manifest-src", "base-uri", "form-action", "frame-ancestors"]);

// Reads a report-uri body ({"csp-report": {...}}) or a Reporting API batch ([{type:"csp-violation", body:{...}}]) and
// returns only the violated directive names. Anything else in the report (URLs, samples) is dropped unread.
export function cspDirectives(text) {
  if (typeof text !== "string" || !text || text.length > 16_000) return [];
  let parsed;
  try { parsed = JSON.parse(text); } catch { return []; }
  const bodies = Array.isArray(parsed) ? parsed.filter((item) => item?.type === "csp-violation").map((item) => item.body) : [parsed?.["csp-report"]];
  // Each directive counts once per report, so one request writes at most one row per known directive.
  return [...new Set(bodies.slice(0, 20).flatMap((body) => {
    const name = String(body?.effectiveDirective || body?.["effective-directive"] || body?.["violated-directive"] || "").trim().split(/\s+/)[0];
    return KNOWN.has(name) ? [name] : [];
  }))];
}
