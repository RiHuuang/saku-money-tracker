import { Capacitor, registerPlugin } from "@capacitor/core";

export type CaptureApp = { packageName: string; name: string; suggestedAccount: string; installed: boolean; account: string };
export type CaptureStatus = { granted: boolean; paused: boolean; apps: CaptureApp[] };
type NotificationCapturePlugin = {
  status(): Promise<CaptureStatus>;
  openSettings(): Promise<void>;
  setApp(options: { packageName: string; account: string }): Promise<void>;
  setPaused(options: { paused: boolean }): Promise<void>;
};

export const notificationCapture = registerPlugin<NotificationCapturePlugin>("NotificationCapture");
export const notificationCaptureSupported = () => Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("NotificationCapture");
