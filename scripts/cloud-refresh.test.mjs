import assert from "node:assert/strict";
import { build } from "esbuild";

const user = { id: "test-user", name: "Test", email: "test@example.invalid", hasAvatar: false };
const bundle = await build({
  entryPoints: ["src/cloud.ts"], bundle: true, platform: "node", format: "esm", write: false,
  define: { "import.meta.env.VITE_SAKU_API_URL": JSON.stringify("https://api.example.invalid") },
  plugins: [{ name: "native-session-fixture", setup(builder) {
    builder.onResolve({ filter: /^@capacitor\/(core|preferences)$|^\.\/(homeWidget|nativeLedger)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "@capacitor/core"
      ? "export const Capacitor={isNativePlatform:()=>true}; export const registerPlugin=()=>globalThis.sakuSessionFixture.plugin;"
      : path === "@capacitor/preferences"
        ? "export const Preferences=globalThis.sakuSessionFixture.preferences;"
      : path === "./nativeLedger"
        ? "export const acknowledgeNativeLedger=async()=>true;"
        : "export const refreshHomeWidgets=async()=>{};" }));
  } }],
});
let state, tokens, refreshCount = 0, saveCount = 0, switchAccount = false, deleteRequests = 0, rejectIdentity = false, offlineIdentity = false;
const reset = () => {
  state = { user, revision: 0, dirty: false };
  tokens = { signedIn: true, accessToken: "expired", refreshToken: "original" };
};
reset();
globalThis.sakuSessionFixture = {
  preferences: { get: async () => ({ value: JSON.stringify(state) }), set: async ({ value }) => { state = JSON.parse(value); }, remove: async () => { state = null; } },
  plugin: { isConfigured: async () => ({ configured: true, deviceSecure: true }), getSession: async () => ({ ...tokens }), saveSession: async (value) => { saveCount++; tokens = { signedIn: true, ...value }; }, clearSession: async () => { tokens = { signedIn: false }; } },
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (url.endsWith("/v1/auth/refresh")) {
    refreshCount++;
    await new Promise(setImmediate);
    if (switchAccount) {
      tokens = { signedIn: true, accessToken: "other-access", refreshToken: "other-refresh" };
      state = { ...state, user: { ...user, id: "other-user" } };
    }
    return Response.json({ accessToken: "renewed", refreshToken: "rotated" });
  }
  if (url.endsWith("/v1/me") && offlineIdentity) throw new Error("Network unavailable");
  if (url.endsWith("/v1/me") && rejectIdentity) return Response.json({ error: "Session expired" }, { status: 401 });
  if (new Headers(options.headers).get("authorization") !== "Bearer renewed") return Response.json({ error: "Session expired" }, { status: 401 });
  if (url.includes("/v2/sync")) return new Response(null, { status: 204, headers: { "x-saku-revision": "0" } });
  if (url.endsWith("/v1/me") && options.method === "DELETE") return Response.json(++deleteRequests < 3 ? { pending: true } : { ok: true, driveCleanupFailed: false }, { status: deleteRequests < 3 ? 202 : 200 });
  if (url.endsWith("/v1/me")) return Response.json({ user, sync: { revision: 0, spreadsheetUrl: "", sheetPending: false } });
  if (url.includes("/v2/me/avatar?")) {
    assert.equal(new Headers(options.headers).get("content-type"), "image/webp");
    assert.deepEqual(options.body, Uint8Array.from([82, 73, 70, 70]));
    state = { ...state, revision: 7, dirty: true };
    return Response.json({ user: { ...user, hasAvatar: true, avatarSource: "custom" } });
  }
  throw new Error(`Unexpected request ${url}`);
};
try {
  const cloud = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
  await Promise.all([cloud.pullCloud(), cloud.updateProfile("Test")]);
  state = { ...state, lastSyncedAt: "2026-09-01T00:00:00.000Z" };
  const downloaded = await cloud.pullCloud();
  assert.equal(downloaded.state.lastSyncedAt, undefined, "an empty cloud must not be reported as backed up");
  assert.equal(state.lastSyncedAt, "2026-09-01T00:00:00.000Z", "a download must not acknowledge a snapshot before local replacement");
  await cloud.updateProfile("Test", "data:image/webp;base64,UklGRg==");
  assert.equal(state.revision, 7, "profile updates must retain newer sync state");
  assert.equal(state.dirty, true);
  await cloud.resolveCloudWithLocal({ user, revision: 8 });
  assert.equal(state.revision, 8, "explicit local conflict resolution must use the reviewed remote revision");
  assert.equal(state.dirty, true);
  assert.equal(refreshCount, 1, "concurrent expired requests should share one refresh");
  assert.equal(saveCount, 1);
  assert.equal(tokens.refreshToken, "rotated");
  reset(); switchAccount = false; tokens.accessToken = "renewed";
  await cloud.deleteCloudAccount();
  assert.equal(deleteRequests, 3, "The client must wait for every bounded deletion phase");
  assert.equal(state, null);
  assert.equal(tokens.signedIn, false);
  reset(); switchAccount = true;
  await assert.rejects(cloud.updateProfile("Test"), /session changed/);
  assert.equal(tokens.refreshToken, "other-refresh", "a late refresh must not replace another account's session");
  assert.equal(saveCount, 1);
  reset(); switchAccount = false; rejectIdentity = true;
  const expired = await cloud.loadCloudState();
  assert.equal(expired.signedIn, false, "an old-backend session must require Google sign-in again");
  assert.equal(tokens.signedIn, false);
  assert.equal(state.user.id, user.id, "invalidating a session must retain local account metadata");
  reset(); rejectIdentity = false; offlineIdentity = true;
  const offline = await cloud.loadCloudState();
  assert.equal(offline.signedIn, true, "a network outage must preserve offline access");
  assert.equal(tokens.signedIn, true);
  reset(); tokens.accessToken = "renewed";
  state = { ...state, spreadsheetUrl: "https://sheets.example.invalid", sheetPending: true };
  let driveRefreshes = 0, firstBatchCalls = 0;
  const mirrored = { version: 3, demo: false, name: "Synthetic", accounts: ["Cash"], pockets: [], transactions: [], creditCards: [], recurring: [], favorites: [], pocketTransfers: [], existingInstallments: [] };
  globalThis.fetch = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    assert.equal(new Headers(options.headers).get("x-saku-user-id"), user.id);
    if (pathname === "/v2/sheets/start") return Response.json({ targetRevision: 1, cursor: 0, total: -1 });
    if (pathname === "/v2/sheets/snapshot") return url.includes("kind=baseline")
      ? new Response(null, { status: 204 })
      : Response.json(mirrored, { headers: { "x-saku-encoding": "identity" } });
    if (pathname === "/v2/sheets/plan") return Response.json({ cursor: 0, total: JSON.parse(options.body).total });
    if (pathname === "/v2/sheets/grid") return Response.json({ expanded: 0 });
    if (pathname === "/v2/sheets/refresh") { driveRefreshes++; return Response.json({ refreshed: true }); }
    if (pathname === "/v2/sheets/batch") {
      const input = JSON.parse(options.body);
      if (input.index === 0 && ++firstBatchCalls === 1) return Response.json({ error: "Refresh Google Drive access" }, { status: 428 });
      return Response.json({ cursor: input.index + 1, applied: true });
    }
    if (pathname === "/v2/sheets/finish") return Response.json({ sheetPending: false });
    throw new Error(`Unexpected Sheet recovery request ${pathname}`);
  };
  await cloud.mirrorCloud();
  assert.equal(driveRefreshes, 1);
  assert.equal(firstBatchCalls, 2, "refresh must retry the same batch without skipping its cursor");
  assert.equal(state.sheetPending, false);
  state = { ...state, revision: 8, dirty: false, sheetPending: true };
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).pathname, "/v2/sheets/start");
    return Response.json({ error: "Google Sheets unavailable" }, { status: 503 });
  };
  await assert.rejects(cloud.mirrorCloud(), /Google Sheets unavailable/);
  assert.equal(state.revision, 8, "a Sheet outage must not roll back a saved backup");
  assert.equal(state.dirty, false, "a Sheet outage must not mark the backup unsaved");
  assert.equal(state.sheetPending, true, "a Sheet outage must remain eligible for retry");
  const savedBeforeLogin = saveCount;
  const pendingToken = "a".repeat(43);
  const loginCalls = [];
  globalThis.sakuSessionFixture.plugin.authorize = async () => ({ serverAuthCode: "synthetic-code" });
  globalThis.fetch = async (url, options) => {
    const pathname = new URL(url).pathname;
    loginCalls.push(pathname);
    assert.equal(saveCount, savedBeforeLogin, "an unfinished login must not persist a session");
    if (pathname === "/v1/auth/google") {
      assert.equal(JSON.parse(options.body).bounded, true);
      return Response.json({ pendingToken }, { status: 202 });
    }
    assert.equal(pathname, "/v1/auth/google/finish");
    assert.deepEqual(JSON.parse(options.body), { pendingToken });
    return Response.json({ accessToken: "new-access", refreshToken: "new-refresh", user, sync: { revision: 3, spreadsheetUrl: "", sheetPending: false } });
  };
  const loggedIn = await cloud.signInGoogle();
  assert.deepEqual(loginCalls, ["/v1/auth/google", "/v1/auth/google/finish"]);
  assert.equal(loggedIn.revision, 3);
  assert.equal(tokens.refreshToken, "new-refresh");
  assert.equal(saveCount, savedBeforeLogin + 1);
  globalThis.fetch = async () => Response.json({ pendingToken: "malformed" }, { status: 202 });
  await assert.rejects(cloud.signInGoogle(), /Invalid Google sign-in response/);
  assert.equal(saveCount, savedBeforeLogin + 1);
  console.log("Cloud client: concurrent refresh, account-switch protection, separate Sheet refresh, and Sheet outage recovery passed");
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.sakuSessionFixture;
}
