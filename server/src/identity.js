export const sessionToken = (id, secret) => `${id}.${secret}`;
export function splitSessionToken(token) {
  const [id, secret, extra] = String(token || "").split(".");
  return id && secret && !extra ? { id, secret } : null;
}
export function avatarAfterSignIn(existing, googleAvatarPath, nextVersion) {
  if (existing?.avatarSource === "custom" && existing.avatarPath) {
    return { avatarPath: existing.avatarPath, avatarSource: "custom", avatarVersion: existing.avatarVersion || "legacy" };
  }
  const avatarPath = googleAvatarPath || existing?.avatarPath || null;
  return {
    avatarPath,
    avatarSource: avatarPath ? "google" : null,
    avatarVersion: googleAvatarPath ? nextVersion : existing?.avatarVersion || "legacy",
  };
}
export function isGoogleAvatarUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com"));
  } catch { return false; }
}
