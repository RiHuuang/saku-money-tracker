import { t } from "./i18n";
import { useEffect, useState } from "react";
import { App as NativeApp } from "@capacitor/app";
import { BellRing, Pause, Play, Settings } from "lucide-react";
import type { Data } from "./domain";
import { notificationCapture, type CaptureStatus } from "./notificationCapture";
import { loadCleaningOptIn, saveCleaningOptIn } from "./merchantCleaning";
import { ChoiceField, Modal } from "./components";

export default function NotificationAccess({ data, notify }: { data: Data; notify: (message: string) => void }) {
  const [status, setStatus] = useState<CaptureStatus | null>(null), [disclosure, setDisclosure] = useState(false), [busy, setBusy] = useState(false), [cleaning, setCleaning] = useState(false);
  useEffect(() => { void loadCleaningOptIn().then(setCleaning).catch(() => {}); }, []);
  const refresh = () => notificationCapture.status().then(setStatus).catch(() => notify(t("notificationStatusUnavailable")));
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
  if (!status) return null;
  const enabled = status.apps.filter((app) => app.account);
  const reading = status.granted && enabled.length > 0;
  const accountFor = (suggested: string) => data.accounts.find((name) => name.toLocaleLowerCase("id-ID") === suggested.toLocaleLowerCase("id-ID")) || data.accounts[0];
  return <section className="notification-access-section">
    <div className="cloud-heading"><span className="connection-icon"><BellRing size={23} /></span><div><h2>{t("readBankNotifications")}</h2><p>{t("readBankNotificationsBody")}</p></div></div>
    <p className="notification-access-status">{!status.granted ? t("notificationAccessOff") : !enabled.length ? t("notificationNoApps") : status.paused ? t("notificationPausedFor", { apps: enabled.map((app) => app.name).join(", ") }) : t("notificationReadingFrom", { apps: enabled.map((app) => app.name).join(", ") })}
      {reading && <button className="text-button" disabled={busy} onClick={() => void run(() => notificationCapture.setPaused({ paused: !status.paused }))}>{status.paused ? <><Play size={14} /> {t("resume")}</> : <><Pause size={14} /> {t("pause")}</>}</button>}</p>
    <div className="notification-apps">{status.apps.map((app) => <div className="notification-app" key={app.packageName}>
      <label className="checkbox-label"><input type="checkbox" checked={!!app.account} disabled={busy || !app.installed || !data.accounts.length} onChange={(event) => void run(() => notificationCapture.setApp({ packageName: app.packageName, account: event.target.checked ? accountFor(app.suggestedAccount) : "" }))} /> {app.name}{!app.installed && <small> · {t("notInstalled")}</small>}</label>
      {app.account && <ChoiceField className="notification-app-account" label={t("sakuAccountFor", { app: app.name })} hideLabel value={data.accounts.includes(app.account) ? app.account : ""} disabled={busy} placeholder={t("chooseAnAccount")} onValueChange={(account) => void run(() => notificationCapture.setApp({ packageName: app.packageName, account }))} options={data.accounts.map((name) => ({ value: name, label: name }))} />}
    </div>)}</div>
    <label className="checkbox-label"><input type="checkbox" checked={cleaning} onChange={(event) => { const next = event.target.checked; setCleaning(next); void saveCleaningOptIn(next).catch(() => notify(t("changeNotSaved"))); }} /> {t("tidyMerchantNames")} <small>{t("tidyMerchantNamesBody")}</small></label>
    <div className="settings-actions">{status.granted ? <button className="button secondary" disabled={busy} onClick={() => void notificationCapture.openSettings()}><Settings size={16} />{t("manageNotificationAccess")}</button> : <button className="button primary" disabled={busy || !enabled.length} onClick={() => setDisclosure(true)}><BellRing size={16} />{t("allowNotificationAccess")}</button>}</div>
    {!status.granted && !enabled.length && <small className="cloud-note">{t("chooseAppFirst")}</small>}
    {disclosure && <Modal title={t("beforeNotificationAccess")} subtitle={t("beforeNotificationAccessBody")} onClose={() => setDisclosure(false)}>
      <div className="notification-disclosure">
        <p><strong>{t("whatSakuReads")}</strong> {t("whatSakuReadsBody", { apps: enabled.map((app) => app.name).join(", ") })}</p>
        <p><strong>{t("whatItKeeps")}</strong> {t("whatItKeepsBody")}</p>
        <p><strong>{t("whereItStays")}</strong> {t("whereItStaysBody")}</p>
        <p><strong>{t("howToStop")}</strong> {t("howToStopBody")}</p>
        <details><summary>{t("restrictedSettingQuestion")}</summary>
          <p>{t("restrictedSettingIntro")}</p>
          <ol><li>{t("restrictedStep1")}</li><li><strong>{t("restrictedPixel")}</strong> {t("restrictedPixelPath")}</li><li><strong>Samsung:</strong> {t("restrictedSamsungPath")}</li><li><strong>Xiaomi / HyperOS:</strong> {t("restrictedXiaomiPath")}</li><li>{t("restrictedStepLast")}</li></ol>
        </details>
      </div>
      <div className="form-footer"><button className="button secondary" onClick={() => setDisclosure(false)}>{t("notNow")}</button><button className="button primary" onClick={() => { setDisclosure(false); void notificationCapture.openSettings(); }}>{t("continueToAndroidSettings")}</button></div>
    </Modal>}
  </section>;
}
