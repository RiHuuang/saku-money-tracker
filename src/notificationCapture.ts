import { Capacitor, registerPlugin } from "@capacitor/core";

export type CaptureApp = { packageName: string; name: string; suggestedAccount: string; installed: boolean; account: string };
// Health fields are timestamps and counts read on the phone (master plan 1A); older builds leave them out.
export type CaptureStatus = {
  granted: boolean; paused: boolean; needsAutostart?: boolean; apps: CaptureApp[];
  brand?: "xiaomi" | "samsung" | "oppo" | "vivo" | "transsion" | "other"; lowRam?: boolean; directBuild?: boolean; sdk?: number; everGranted?: boolean;
  connectedAt?: number; disconnectedAt?: number; lastCapturedAt?: number; redactedCount?: number; expiredCount?: number; inboxResetAt?: number;
  systemKillAt?: number; systemKillReason?: string; batteryExempt?: boolean; backgroundRestricted?: boolean; standbyRestricted?: boolean; autoRevokeExempt?: boolean;
  sleepListAvailable?: boolean;
};
export type InboxItem = { id: string; packageName: string; account: string; amount: number; direction: "expense" | "income"; rawMerchant: string; balance: number | null; occurredAt: number; cancels?: boolean };
type NotificationCapturePlugin = {
  status(): Promise<CaptureStatus>;
  openSettings(): Promise<{ opened?: "listener" | "app_info" }>;
  fix(): Promise<{ opened: "app_info" | "battery" | "brand" }>;
  acknowledgeReset(): Promise<void>;
  openKeepRunning(options: { step: "battery" | "sleep" }): Promise<{ opened: string }>;
  openAutostart(): Promise<void>;
  setApp(options: { packageName: string; account: string }): Promise<void>;
  setPaused(options: { paused: boolean }): Promise<void>;
  inbox(): Promise<{ items: InboxItem[] }>;
  removeInbox(options: { ids: string[] }): Promise<void>;
  restoreInbox(options: { items: InboxItem[] }): Promise<void>;
  clearInbox(): Promise<void>;
};

export const notificationCapture = registerPlugin<NotificationCapturePlugin>("NotificationCapture");
export const notificationCaptureSupported = () => Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("NotificationCapture");
// Captured rows belong to whoever is signed in on this phone; leaving the account empties them.
export async function clearNotificationInbox() {
  if (notificationCaptureSupported()) await notificationCapture.clearInbox().catch(() => {});
}
