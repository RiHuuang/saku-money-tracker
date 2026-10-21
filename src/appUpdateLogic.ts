export type AndroidRelease = {
  versionCode: number;
  versionName: string;
  minimumSupportedVersionCode: number;
  releasedAt: string;
  apkUrl: string;
  apkBytes: number;
  sha256: string;
  notes: string[];
};

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function validRelease(value: unknown): value is AndroidRelease {
  const item = value as AndroidRelease;
  return Number.isSafeInteger(item?.versionCode) && item.versionCode > 0 && /^\d+\.\d+\.\d+$/.test(item.versionName) &&
    Number.isSafeInteger(item.minimumSupportedVersionCode) && item.minimumSupportedVersionCode > 0 &&
    !Number.isNaN(Date.parse(item.releasedAt)) && item.apkUrl === `/download/android/${item.versionCode}.apk` &&
    Number.isSafeInteger(item.apkBytes) && item.apkBytes > 0 && /^[a-f0-9]{64}$/.test(item.sha256) &&
    Array.isArray(item.notes) && item.notes.length <= 3 && item.notes.every((note) => typeof note === "string" && note.length > 0 && note.length <= 160);
}

export function cachedRelease(lastChecked: string | null | undefined, cached: string | null | undefined, now = Date.now()) {
  const checkedAt = Number(lastChecked || 0);
  if (!checkedAt || checkedAt > now || now - checkedAt >= UPDATE_CHECK_INTERVAL_MS || !cached) return undefined;
  try {
    const release: unknown = JSON.parse(cached);
    return validRelease(release) ? release : undefined;
  } catch {
    return undefined;
  }
}

export function shouldShowRelease(currentVersionCode: number, release: AndroidRelease, dismissed: string | null | undefined, sessionDismissedVersion: number | null, now = Date.now()) {
  if (release.versionCode <= currentVersionCode) return false;
  if (release.minimumSupportedVersionCode > currentVersionCode) return sessionDismissedVersion !== release.versionCode;
  try {
    const value = JSON.parse(dismissed || "{}") as { versionCode?: number; until?: number };
    return value.versionCode !== release.versionCode || Number(value.until || 0) <= now;
  } catch {
    return true;
  }
}
