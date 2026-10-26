import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { type Data, emptyData, validateData } from "./domain";
import { markCloudDirty } from "./cloud";
import { refreshHomeWidgets, scheduleCloudSync } from "./homeWidget";
import { deleteOwnerImportDrafts, importConsentKey } from "./importDraft";
import { clearNotificationInbox } from "./notificationCapture";
import { hasNativeLedger, loadNativeLedger, removeNativeLedger, saveNativeLedger } from "./nativeLedger";
const key = "saku-ledger-v1";
const userKey = (userId?: string) => userId ? `saku-ledger-v3-${userId}` : "saku-ledger-browser-v3";
let activeUserId = "";
let activeRevision = 0;
export async function loadData(userId?: string): Promise<Data> {
  activeUserId = userId || "";
  const { value } = await Preferences.get({ key: userKey(userId) });
  if (Capacitor.isNativePlatform() && userId) {
    const cloudValue = (await Preferences.get({ key: "saku-cloud-state-v1" })).value;
    const cloud = cloudValue ? (() => { try { return JSON.parse(cloudValue); } catch { return null; } })() : null;
    const legacySynced = cloud?.user?.id === userId ? !cloud.dirty : !value;
    const current = await loadNativeLedger(userId, value, legacySynced);
    activeRevision = current.revision;
    if (current.revision > current.syncedRevision && cloud?.user?.id === userId && !cloud.dirty) await markCloudDirty();
    return current.data;
  }
  return value ? validateData(JSON.parse(value)) : emptyData();
}
export async function saveData(data: Data) {
  if (Capacitor.isNativePlatform() && activeUserId) {
    await markCloudDirty();
    activeRevision = await saveNativeLedger(activeUserId, data, activeRevision);
  } else {
    await Preferences.set({ key: userKey(activeUserId), value: JSON.stringify(validateData(data)) });
    await markCloudDirty();
  }
  await refreshHomeWidgets();
  await scheduleCloudSync();
}
export async function replaceData(data: Data) {
  if (Capacitor.isNativePlatform() && activeUserId) activeRevision = await saveNativeLedger(activeUserId, data, activeRevision);
  else await Preferences.set({ key: userKey(activeUserId), value: JSON.stringify(validateData(data)) });
  await refreshHomeWidgets();
}
export async function loadLegacyData() {
  const { value } = await Preferences.get({ key });
  return value ? validateData(JSON.parse(value)) : null;
}
export async function hasUserData(userId: string) {
  if (Capacitor.isNativePlatform() && await hasNativeLedger(userId)) return true;
  return Boolean((await Preferences.get({ key: userKey(userId) })).value);
}
export async function removeUserData(userId: string) {
  await deleteOwnerImportDrafts(userId);
  await clearNotificationInbox();
  localStorage.removeItem(importConsentKey(userId));
  if (Capacitor.isNativePlatform()) await removeNativeLedger(userId);
  await Preferences.remove({ key: userKey(userId) });
  if (activeUserId === userId) { activeUserId = ""; activeRevision = 0; }
  await refreshHomeWidgets();
}
export async function download(name: string, content: string, type: string) {
  if (Capacitor.isNativePlatform()) {
    const file = await Filesystem.writeFile({
      path: name,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title: name, url: file.uri });
  } else {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
