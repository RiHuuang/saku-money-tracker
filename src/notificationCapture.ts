import { Capacitor, registerPlugin } from "@capacitor/core";

export type CaptureApp = { packageName: string; name: string; suggestedAccount: string; installed: boolean; account: string };
export type CaptureStatus = { granted: boolean; paused: boolean; needsAutostart?: boolean; apps: CaptureApp[] };
export type InboxItem = { id: string; packageName: string; account: string; amount: number; direction: "expense" | "income"; rawMerchant: string; balance: number | null; occurredAt: number };
type NotificationCapturePlugin = {
  status(): Promise<CaptureStatus>;
  openSettings(): Promise<void>;
  openAutostart(): Promise<void>;
  setApp(options: { packageName: string; account: string }): Promise<void>;
  setPaused(options: { paused: boolean }): Promise<void>;
  inbox(): Promise<{ items: InboxItem[] }>;
  removeInbox(options: { ids: string[] }): Promise<void>;
  clearInbox(): Promise<void>;
};

export const notificationCapture = registerPlugin<NotificationCapturePlugin>("NotificationCapture");
export const notificationCaptureSupported = () => Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("NotificationCapture");
// Captured rows belong to whoever is signed in on this phone; leaving the account empties them.
export async function clearNotificationInbox() {
  if (notificationCaptureSupported()) await notificationCapture.clearInbox().catch(() => {});
}
