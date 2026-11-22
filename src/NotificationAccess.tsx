import { t } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { App as NativeApp } from "@capacitor/app";
import { BellRing, Pause, Play, Settings } from "lucide-react";
import type { Data } from "./domain";
import { notificationCapture, type CaptureStatus } from "./notificationCapture";
import { loadCleaningOptIn, saveCleaningOptIn } from "./merchantCleaning";
import { ensureConsentReceipt, hasConsentReceipt, withdrawConsentReceipt } from "./consent";
import { ChoiceField, SettingsCard } from "./components";
import { captureHealth, showKeepRunning } from "./captureHealth";

const ago = (at: number, now = Date.now()) => {
  const minutes = Math.max(1, Math.round((now - at) / 60_000));
  return minutes < 60 ? t("minutesAgo", { count: minutes }) : minutes < 48 * 60 ? t("hoursAgo", { count: Math.round(minutes / 60) }) : t("daysAgoShort", { count: Math.round(minutes / 1440) });
};

export default function NotificationAccess({ data, userId, notify }: { data: Data; userId?: string; notify: (message: string) => void }) {
  const [status, setStatus] = useState<CaptureStatus | null>(null), [busy, setBusy] = useState(false), [cleaning, setCleaning] = useState(false);
  // Set once the user has been sent to Android's settings, so the restricted-settings line shows only after a failed try.
  const [askedAccess, setAskedAccess] = useState(false), [appInfoOpened, setAppInfoOpened] = useState(false);
  // Refs, because refresh also runs from the resume listener registered on mount: it must see the current user,
  // and know a "Turn on" is waiting for Android's toggle so it doesn't withdraw the receipt that tap just sent.
  const userRef = useRef(userId), awaitingAccess = useRef(false);
  userRef.current = userId;
  useEffect(() => { void loadCleaningOptIn().then(setCleaning).catch(() => {}); }, []);
  const refresh = () => notificationCapture.status().then((next) => {
    setStatus(next);
    // A cleared inbox is told once, never silently.
    if (next.inboxResetAt) { notify(t("inboxResetNotice")); void notificationCapture.acknowledgeReset().catch(() => {}); }
    // The receipt follows the reader, whenever Settings next looks: recorded while it reads, withdrawn once it
    // stops (access revoked in Android, even while Saku was closed, or the last app unticked), but not while a
    // first "Turn on" still waits for Android's toggle. Failed withdrawals retry on the next start.
    const owner = userRef.current, readingNow = next.granted && next.apps.some((app) => app.account);
    if (readingNow) awaitingAccess.current = false;
    const stopped = !readingNow && !awaitingAccess.current && (next.everGranted || !next.apps.some((app) => app.account));
    if (owner && readingNow && !hasConsentReceipt(owner, "notification_reader")) void ensureConsentReceipt(owner, "notification_reader").catch(() => { /* Next check. */ });
    if (owner && stopped && hasConsentReceipt(owner, "notification_reader")) void withdrawConsentReceipt(owner, "notification_reader").catch(() => { /* retryPendingWithdrawals */ });
  }).catch(() => notify(t("notificationStatusUnavailable")));
  useEffect(() => {
    void refresh();
    // Access is granted or revoked in system settings, so re-read whenever Saku comes back.
    const listener = NativeApp.addListener("appStateChange", ({ isActive }) => { if (isActive) void refresh(); });
    return () => { void listener.then((handle) => handle.remove()); };
  }, []);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try { await action(); await refresh(); }
    catch (error) { notify(error instanceof Error ? error.message : t("changeNotSaved")); }
    finally { setBusy(false); }
  }
  // Android Go phones can't grant notification access, so the card would be a dead end.
  if (!status || status.lowRam) return null;
  const enabled = status.apps.filter((app) => app.account);
  const reading = status.granted && enabled.length > 0;
  const health = captureHealth(status);
  const restrictedHelp = !status.granted && (appInfoOpened || askedAccess) && status.sdk !== undefined && status.sdk >= 33;
  // Installed bank apps the user hasn't chosen yet. Nothing is ticked until the user taps the one button that names them.
  const detected = enabled.length ? [] : status.apps.filter((app) => app.installed && app.packageName !== "com.android.shell");
  const names = (enabled.length ? enabled : detected).map((app) => app.name).join(", ");
  const turnOn = () => void run(async () => {
    for (const app of detected) await notificationCapture.setApp({ packageName: app.packageName, account: accountFor(app.suggestedAccount) });
    // The tap that names the apps, with the four facts on screen, is the consent (UU PDP); its receipt is kept.
    if (userId) void ensureConsentReceipt(userId, "notification_reader").catch(() => { /* Retried on the next tap. */ });
    awaitingAccess.current = true;
    const result = await notificationCapture.openSettings();
    setAskedAccess(true);
    if (result?.opened === "app_info") setAppInfoOpened(true);
  });
  const accountFor = (suggested: string) => data.accounts.find((name) => name.toLocaleLowerCase("id-ID") === suggested.toLocaleLowerCase("id-ID")) || data.accounts[0];
  const summary = health.state === "check" ? t("stateCheck") : health.state === "off" ? t("stateOff") : health.lastCapturedAt ? `${t("stateOn")} · ${ago(health.lastCapturedAt)}` : t("stateOn");
  // Open by default when it is off or needs a check, so the one Fix tap is visible without searching.
  return <SettingsCard title={t("readBankNotifications")} summary={summary} defaultOpen={health.state !== "on"}><section className="notification-access-section">
    <div className="cloud-heading"><span className="connection-icon"><BellRing size={23} /></span><div><h2>{t("readBankNotifications")}</h2><p>{t("readBankNotificationsBody")}</p></div></div>
    <p className={`notification-access-status health-${health.state}`} role="status">{!status.granted ? t("notificationAccessOff") : !enabled.length ? t("notificationNoApps") : status.paused ? t("notificationPausedFor", { apps: enabled.map((app) => app.name).join(", ") }) : health.state === "check" ? t("notificationHealthStopped") : health.lastCapturedAt ? t("notificationHealthOn", { ago: ago(health.lastCapturedAt) }) : t("notificationHealthOnNew")}
      {health.state === "check" && <button className="button primary" disabled={busy} onClick={() => void run(() => notificationCapture.fix())}>{t("fixReader")}</button>}
      {reading && <button className="text-button" disabled={busy} onClick={() => void run(() => notificationCapture.setPaused({ paused: !status.paused }))}>{status.paused ? <><Play size={14} /> {t("resume")}</> : <><Pause size={14} /> {t("pause")}</>}</button>}</p>
    {health.state === "on" && health.quietDays >= 5 && <p className="cloud-note">{t("notificationHealthQuiet", { days: health.quietDays })}</p>}
    {reading && showKeepRunning(status) && (status.brand === "xiaomi" || status.needsAutostart
      ? <p className="cloud-note">{t("xiaomiAutostart")} <button className="text-button" onClick={() => void notificationCapture.openAutostart().catch(() => notify(t("changeNotSaved")))}>{t("openAutostart")}</button></p>
      : <p className="cloud-note">{t("samsungKeepRunning")} <button className="text-button" onClick={() => void notificationCapture.fix().catch(() => notify(t("changeNotSaved")))}>{t("openBatterySettings")}</button></p>)}
    <div className="notification-apps">{status.apps.map((app) => <div className="notification-app" key={app.packageName}>
      <label className="checkbox-label"><input type="checkbox" checked={!!app.account} disabled={busy || !app.installed || !data.accounts.length} onChange={(event) => void run(() => notificationCapture.setApp({ packageName: app.packageName, account: event.target.checked ? accountFor(app.suggestedAccount) : "" }))} /> {app.name}{!app.installed && <small> · {t("notInstalled")}</small>}</label>
      {app.account && <ChoiceField className="notification-app-account" label={t("sakuAccountFor", { app: app.name })} hideLabel value={data.accounts.includes(app.account) ? app.account : ""} disabled={busy} placeholder={t("chooseAnAccount")} onValueChange={(account) => void run(() => notificationCapture.setApp({ packageName: app.packageName, account }))} options={data.accounts.map((name) => ({ value: name, label: name }))} />}
    </div>)}</div>
    <label className="switch-row"><span>{t("tidyMerchantNames")}<small id="tidy-names-body" className="switch-help">{t("tidyMerchantNamesBody")}</small></span><input type="checkbox" role="switch" aria-describedby="tidy-names-body" checked={cleaning} onChange={(event) => { const next = event.target.checked; setCleaning(next); void saveCleaningOptIn(next).catch(() => notify(t("changeNotSaved"))); if (userId) void (next ? ensureConsentReceipt(userId, "merchant_tidy") : withdrawConsentReceipt(userId, "merchant_tidy")).catch(() => { /* Retried before the next tidy call. */ }); }} /></label>
    {!status.granted && (enabled.length || detected.length) > 0 && <div className="notification-disclosure">
      <p><strong>{t("whatSakuReads")}</strong> {t("whatSakuReadsBody", { apps: names })}</p>
      <p><strong>{t("whatItKeeps")}</strong> {t("whatItKeepsBody")}</p>
      <p><strong>{t("whereItStays")}</strong> {t("whereItStaysBody")}</p>
      <p><strong>{t("howToStop")}</strong> {t("howToStopBody")}</p>
    </div>}
    <div className="settings-actions">{status.granted
      ? <button className="button secondary" disabled={busy} onClick={() => void notificationCapture.openSettings()}><Settings size={16} />{t("manageNotificationAccess")}</button>
      : <button className="button primary" disabled={busy || (!enabled.length && !detected.length)} onClick={turnOn}><BellRing size={16} />{t("turnOnReaderFor", { apps: names })}</button>}</div>
    {!status.granted && !enabled.length && !detected.length && <small className="cloud-note">{t("chooseAppFirst")}</small>}
    {restrictedHelp && <p className="cloud-note">{t("restrictedSettingsHelp")}</p>}
  </section></SettingsCard>;
}
