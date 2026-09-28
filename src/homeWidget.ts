import { Capacitor, registerPlugin } from "@capacitor/core";

interface HomeWidgetPlugin {
  refresh(): Promise<void>;
  getRevision(): Promise<{ revision: number }>;
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
