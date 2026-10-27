import assert from "node:assert/strict";
import { build } from "esbuild";

// The acknowledged sync base that a rejected upload is merged against.
const user = { id: "merge-user", name: "Test", email: "merge@example.invalid", hasAvatar: false };
const bundle = await build({
  entryPoints: ["src/cloud.ts"], bundle: true, platform: "node", format: "esm", write: false,
  define: { "import.meta.env.VITE_SAKU_API_URL": JSON.stringify("https://api.example.invalid") },
  plugins: [{ name: "sync-base-fixture", setup(builder) {
    builder.onResolve({ filter: /^@capacitor\/(core|preferences)$|^\.\/(homeWidget|nativeLedger)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "@capacitor/core"
      ? "export const Capacitor={isNativePlatform:()=>true}; export const registerPlugin=()=>globalThis.sakuMergeFixture.plugin;"
      : path === "@capacitor/preferences"
        ? "export const Preferences=globalThis.sakuMergeFixture.preferences;"
      : path === "./nativeLedger"
        ? "const f=()=>globalThis.sakuMergeFixture; export const acknowledgeNativeLedger=async()=>f().acknowledge; export const loadNativeSyncBase=async(id)=>f().bases.get(id)||null; export const saveNativeSyncBase=async(id,revision,data)=>{f().bases.set(id,{revision,data});};"
        : "export const refreshHomeWidgets=async()=>{};" }));
  } }],
});
const row = (id, amount = 1000) => ({ id, name: id, amount, type: "expense", date: "2026-10-26", pocketId: "", account: "Cash", note: "" });
const store = new Map();
const fixture = globalThis.sakuMergeFixture = {
  acknowledge: true,
  bases: new Map(),
  preferences: { get: async ({ key }) => ({ value: store.get(key) ?? null }), set: async ({ key, value }) => { store.set(key, value); }, remove: async ({ key }) => { store.delete(key); } },
  plugin: { getSession: async () => ({ signedIn: true, accessToken: "current", refreshToken: "refresh" }), clearSession: async () => {} },
};
let serverRevision = 4, uploads = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (url.includes("/v2/sync?baseRevision=")) {
    uploads++;
    return Response.json({ revision: ++serverRevision, spreadsheetUrl: "", sheetPending: false });
  }
  throw new Error(`Unexpected request ${url}`);
};
try {
  const cloud = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
  const { emptyData } = await import(`data:text/javascript;base64,${Buffer.from((await build({ entryPoints: ["src/domain.ts"], bundle: true, platform: "node", format: "esm", write: false })).outputFiles[0].contents).toString("base64")}`);
  const withRows = (...transactions) => ({ ...emptyData(), transactions });
  store.set("saku-cloud-state-v1", JSON.stringify({ user, revision: 4, dirty: true, changeVersion: 1 }));

  const synced = withRows(row("shared"), row("old"));
  await cloud.pushCloud(synced);
  assert.equal(uploads, 1);
  assert.equal(fixture.bases.get(user.id).revision, 5, "an acknowledged upload becomes the merge base");

  fixture.acknowledge = false;
  const edited = withRows(row("shared"), row("old"), row("pending"));
  await cloud.pushCloud(edited);
  assert.equal(fixture.bases.get(user.id).revision, 6, "the base follows the cloud even when the device changed meanwhile");
  assert.equal(JSON.parse(store.get("saku-cloud-state-v1")).dirty, true);
  fixture.acknowledge = true;

  // Phone deleted "old" and added "phone"; the web edited "shared" and added "web".
  const phone = withRows(row("shared"), row("pending"), row("phone"));
  const web = withRows(row("shared", 5000), row("old"), row("pending"), row("web"));
  const state = { user, revision: 7, dirty: true, signedIn: true, configured: true };
  const merged = await cloud.mergeWithSyncBase(phone, web, state);
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.data.transactions.map((item) => [item.id, item.amount]), [["shared", 5000], ["pending", 1000], ["phone", 1000], ["web", 1000]]);

  const clash = await cloud.mergeWithSyncBase(withRows(row("shared", 2000), row("old"), row("pending")), web, state);
  assert.deepEqual(clash.conflicts, ["shared"], "different edits of one transaction still need review");

  assert.deepEqual((await cloud.mergeWithSyncBase(phone, web, { ...state, revision: 5 })).conflicts, ["workspace"], "a base newer than the cloud is not trusted");
  assert.deepEqual((await cloud.mergeWithSyncBase(phone, web, { ...state, user: { ...user, id: "other-user" } })).conflicts, ["workspace"], "another account never merges with this base");

  await cloud.resolveCloudWithLocal(state, web);
  assert.equal(fixture.bases.get(user.id).revision, 7, "a reviewed cloud copy becomes the next merge base");
  assert.equal(JSON.parse(store.get("saku-cloud-state-v1")).revision, 7);
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.sakuMergeFixture;
}
console.log("cloud merge base tests passed");
