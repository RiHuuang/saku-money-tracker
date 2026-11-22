import { Capacitor } from "@capacitor/core";

// Content Security Policy for the Android WebView (master plan 1D). It is added at runtime, as the first module,
// rather than as a static meta tag, so Capacitor's bridge is already in place before the policy applies.
export function nativeCsp(apiUrl: string) {
  const api = apiUrl ? new URL(apiUrl) : null;
  const http = api ? ` ${api.origin}` : "";
  const socket = api ? ` ${api.protocol === "https:" ? "wss:" : "ws:"}//${api.host}` : "";
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    `img-src 'self' data: blob:${http}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `connect-src 'self'${http}${socket}`,
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

if (Capacitor.isNativePlatform() && typeof document !== "undefined") {
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = nativeCsp((import.meta.env.VITE_SAKU_API_URL || "").replace(/\/$/, ""));
  document.head.prepend(meta);
}
