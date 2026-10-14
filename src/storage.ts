import { Preferences } from "@capacitor/preferences";
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { type Data, emptyData, validateData } from "./domain";
import { markCloudDirty } from "./cloud";
import { refreshHomeWidgets, scheduleCloudSync } from "./homeWidget";
import { deleteOwnerImportDrafts, importConsentKey } from "./importDraft";
const key = "saku-ledger-v1";
const userKey = (userId?: string) => userId ? `saku-ledger-v3-${userId}` : "saku-ledger-browser-v3";
let activeUserId = "";
export async function loadData(userId?: string): Promise<Data> {
  activeUserId = userId || "";
  const { value } = await Preferences.get({ key: userKey(userId) });
  return value ? validateData(JSON.parse(value)) : emptyData();
}
export async function saveData(data: Data) {
  await Preferences.set({ key: userKey(activeUserId), value: JSON.stringify(validateData(data)) });
  await markCloudDirty();
  await refreshHomeWidgets();
  await scheduleCloudSync();
}
export async function replaceData(data: Data) {
  await Preferences.set({ key: userKey(activeUserId), value: JSON.stringify(validateData(data)) });
  await refreshHomeWidgets();
}
export async function loadLegacyData() {
  const { value } = await Preferences.get({ key });
  return value ? validateData(JSON.parse(value)) : null;
}
export async function hasUserData(userId: string) {
  return Boolean((await Preferences.get({ key: userKey(userId) })).value);
}
export async function removeUserData(userId: string) {
  await deleteOwnerImportDrafts(userId);
  localStorage.removeItem(importConsentKey(userId));
  await Preferences.remove({ key: userKey(userId) });
  if (activeUserId === userId) activeUserId = "";
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
