import assert from "node:assert/strict";
import { test } from "node:test";
import { createConsentStore, type ConsentPurpose } from "./consent";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
};
// A fake server: records every request; requests can be made to fail or to wait for a release.
const fakeServer = () => {
  const server = { state: new Map<string, boolean>(), sent: [] as boolean[], offline: false, hold: null as null | Promise<void> };
  const send = async (userId: string, purpose: ConsentPurpose, _version: number, granted: boolean) => {
    if (server.hold) await server.hold;
    if (server.offline) throw new Error("offline");
    server.sent.push(granted);
    server.state.set(`${userId}|${purpose}`, granted);
  };
  return { server, send };
};
const R: ConsentPurpose = "notification_reader";

test("a receipt is sent once and a repeat ensure is free", async () => {
  const { server, send } = fakeServer(), storage = memory(), store = createConsentStore(() => storage, send);
  await store.ensure("u", R);
  await store.ensure("u", R);
  assert.deepEqual(server.sent, [true]);
  assert.equal(store.isOn("u", R), true);
});

test("offline revoke, re-grant and revoke again leaves the server withdrawn after the next start", async () => {
  const storage = memory(), { server, send } = fakeServer(), store = createConsentStore(() => storage, send);
  await store.ensure("u", R);
  server.offline = true;
  await store.withdraw("u", R).catch(() => undefined);
  await store.ensure("u", R).catch(() => undefined);
  await store.withdraw("u", R).catch(() => undefined);
  assert.equal(server.state.get("u|notification_reader"), true, "nothing reached the server while offline");
  server.offline = false;
  await createConsentStore(() => storage, send).retry("u");
  assert.equal(server.state.get("u|notification_reader"), false, "the latest choice, off, is what the server ends on");
});

test("quick off-then-on taps are sent in order and end on", async () => {
  const { server, send } = fakeServer(), storage = memory(), store = createConsentStore(() => storage, send);
  await store.ensure("u", R);
  let release!: () => void;
  server.hold = new Promise((resolve) => { release = resolve; });
  const off = store.withdraw("u", R), on = store.ensure("u", R);
  server.hold = null;
  release();
  await Promise.all([off, on]);
  assert.equal(server.state.get("u|notification_reader"), true);
  assert.equal(server.sent.at(-1), true, "one request at a time, and the latest choice is sent last");
  assert.ok(!server.sent.slice(1).includes(false), "a flip back before any request started needs no withdrawal");
});

test("a choice changed while its request was out is sent again", async () => {
  const { server, send } = fakeServer(), storage = memory(), store = createConsentStore(() => storage, send);
  let release!: () => void;
  server.hold = new Promise((resolve) => { release = resolve; });
  const on = store.ensure("u", R);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const off = store.withdraw("u", R);
  server.hold = null;
  release();
  await Promise.all([on, off]);
  assert.equal(server.state.get("u|notification_reader"), false);
});

test("clearing the account forgets every choice, and a stale mark from earlier builds is read as on", async () => {
  const storage = memory(), { server, send } = fakeServer(), store = createConsentStore(() => storage, send);
  storage.setItem("saku-consent-receipt-v1-u-merchant_tidy-1", "sent");
  assert.equal(store.isOn("u", "merchant_tidy"), true);
  await store.ensure("u", R);
  store.clear("u");
  assert.equal(store.isOn("u", R), false);
  await store.ensure("u", R);
  assert.deepEqual(server.sent, [true, true], "after deletion the receipt is sent again");
});

test("a 403 after the user turned a purpose off is not overridden by a resend", async () => {
  const { withConsentFor } = await import("./consent");
  const { server, send } = fakeServer(), storage = memory(), store = createConsentStore(() => storage, send);
  const refused = Object.assign(new Error("consent_required"), { status: 403 });
  let calls = 0;
  await assert.rejects(withConsentFor(store, "u", "merchant_tidy", async () => { calls++; await store.withdraw("u", "merchant_tidy"); throw refused; }), /consent_required/);
  assert.equal(calls, 1, "no second AI call");
  assert.equal(store.isOn("u", "merchant_tidy"), false);
  assert.equal(server.state.get("u|merchant_tidy"), false, "the server keeps the withdrawal");
  let retried = 0;
  assert.equal(await withConsentFor(store, "u", "ai_import", async () => { if (retried++ === 0) throw refused; return "ok"; }), "ok", "a lost receipt is re-sent once and the call retried");
});
