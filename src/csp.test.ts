import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeCsp } from "./csp";

test("the Android WebView policy allows only Saku's API and live socket", () => {
  const policy = nativeCsp("https://app.sakumoney.my.id");
  assert.match(policy, /connect-src 'self' https:\/\/app\.sakumoney\.my\.id wss:\/\/app\.sakumoney\.my\.id;/);
  assert.match(policy, /worker-src 'self' blob:/);
  assert.doesNotMatch(policy, /'unsafe-eval'|connect-src[^;]*\swss:[\s;]|\*/, "no eval, no bare wss:, no wildcard");
  assert.doesNotMatch(policy, /frame-ancestors|report-uri/, "a meta policy cannot use header-only directives");
  assert.equal(nativeCsp(""), nativeCsp("").replace(/ https?:\/\/\S+/g, ""), "without an API URL only the app itself is allowed");
});
