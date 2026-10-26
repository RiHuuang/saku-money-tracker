import assert from "node:assert/strict";
import { build } from "esbuild";

// The browser build has no API origin, so the live URL must resolve against the page.
const bundle = await build({
  entryPoints: ["src/cloud.ts"], bundle: true, platform: "node", format: "esm", write: false,
  define: { "import.meta.env.VITE_SAKU_API_URL": JSON.stringify("") },
  plugins: [{ name: "browser-fixture", setup(builder) {
    builder.onResolve({ filter: /^@capacitor\/(core|preferences)$|^\.\/(homeWidget|nativeLedger)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "@capacitor/core"
      ? "export const Capacitor={isNativePlatform:()=>false}; export const registerPlugin=()=>({});"
      : path === "@capacitor/preferences" ? "export const Preferences={};"
      : path === "./nativeLedger" ? "export const acknowledgeNativeLedger=async()=>true;"
      : "export const refreshHomeWidgets=async()=>{};" }));
  } }],
});
globalThis.location = new URL("https://app.example.invalid/home");
try {
  const cloud = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
  assert.equal(cloud.liveUrl("room-1", "ticket-1"), "wss://app.example.invalid/v1/live?room=room-1&ticket=ticket-1");
  globalThis.location = new URL("http://localhost:5173/");
  assert.equal(cloud.liveUrl("r", "t"), "ws://localhost:5173/v1/live?room=r&ticket=t");
} finally { delete globalThis.location; }
console.log("Live URL: browser builds resolve the live socket against the page origin");
