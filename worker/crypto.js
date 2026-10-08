const encoder = new TextEncoder(), decoder = new TextDecoder();
const fromBase64 = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));
const base64url = (bytes) => base64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
let keyValue, keyPromise;

export const tokenPart = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
export async function hashToken(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function pkceChallenge(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}
export function timingSafeEqual(a, b) {
  const left = encoder.encode(String(a)), right = encoder.encode(String(b));
  return left.length === right.length && crypto.subtle.timingSafeEqual(left, right);
}
export async function encryptionKey(value) {
  if (keyValue !== value || !keyPromise) {
    const bytes = fromBase64(String(value || ""));
    if (bytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as base64");
    keyValue = value;
    keyPromise = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  return keyPromise;
}
export async function encrypt(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key, encoder.encode(value)));
  // Preserve GCP's IV | tag | ciphertext layout; Web Crypto returns ciphertext | tag.
  const result = new Uint8Array(12 + sealed.length);
  result.set(iv); result.set(sealed.subarray(-16), 12); result.set(sealed.subarray(0, -16), 28);
  return base64(result);
}
export async function decrypt(value, key) {
  const bytes = fromBase64(value);
  if (bytes.length < 28) throw new Error("Invalid encrypted Google token");
  const sealed = new Uint8Array(bytes.length - 12);
  sealed.set(bytes.subarray(28)); sealed.set(bytes.subarray(12, 28), sealed.length - 16);
  return decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, await key, sealed));
}
