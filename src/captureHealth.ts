import type { CaptureStatus } from "./notificationCapture";

export type CaptureHealth = { state: "off" | "on" | "check"; lastCapturedAt: number; quietDays: number };

const DAY = 86_400_000;

// Three states for the bank-notification reader (master plan 2.4). "check" means the phone stopped Saku or is
// holding it back; it never fires for quiet days, a missing battery exemption, or exits the user caused.
export function captureHealth(status: CaptureStatus, now = Date.now()): CaptureHealth {
  const reading = status.granted && !status.paused && status.apps.some((app) => app.account);
  const lastCapturedAt = status.lastCapturedAt || 0;
  const quietDays = lastCapturedAt ? Math.floor((now - lastCapturedAt) / DAY) : 0;
  if (!reading) return { state: "off", lastCapturedAt, quietDays };
  const connectedAt = status.connectedAt || 0, disconnectedAt = status.disconnectedAt || 0;
  // Not bound 5 seconds after the last drop (the rebind runs on every app start).
  const unbound = disconnectedAt > connectedAt && now - disconnectedAt > 5_000;
  // A kill the system already recovered from (a later connect) doesn't count.
  const killed = (status.systemKillAt || 0) > connectedAt;
  const held = !!status.backgroundRestricted || !!status.standbyRestricted;
  return { state: unbound || killed || held ? "check" : "on", lastCapturedAt, quietDays };
}

// The proactive "Keep running" row shows only where phones are known to stop listeners.
export const showKeepRunning = (status: CaptureStatus) => status.brand === "samsung" || status.brand === "xiaomi";
