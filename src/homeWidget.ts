import { Capacitor, registerPlugin } from "@capacitor/core";

interface HomeWidgetPlugin {
  refresh(): Promise<void>;
  getRevision(): Promise<{ revision: number }>;
  scheduleSync(): Promise<void>;
}

const plugin = registerPlugin<HomeWidgetPlugin>("HomeWidget");

export async function refreshHomeWidgets() {
  if (!Capacitor.isNativePlatform()) return;
  try { await plugin.refresh(); } catch { /* Widgets are optional launcher UI. */ }
}

export async function homeWidgetRevision() {
  if (!Capacitor.isNativePlatform()) return 0;
  try { return (await plugin.getRevision()).revision; } catch { return 0; }
}

export async function scheduleCloudSync() {
  if (!Capacitor.isNativePlatform()) return;
  try { await plugin.scheduleSync(); } catch { /* Foreground sync remains available. */ }
}
