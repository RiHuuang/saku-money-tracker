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
  const refresh = () => notificationCapture.status().then(setStatus).catch(() => notify("Notification access status is unavailable."));
  useEffect(() => {
    void refresh();
    // Access is granted or revoked in system settings, so re-read whenever Saku comes back.
    const listener = NativeApp.addListener("appStateChange", ({ isActive }) => { if (isActive) void refresh(); });
    return () => { void listener.then((handle) => handle.remove()); };
  }, []);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try { await action(); await refresh(); }
    catch (error) { notify(error instanceof Error ? error.message : "That change could not be saved."); }
    finally { setBusy(false); }
  }
  if (!status) return null;
  const enabled = status.apps.filter((app) => app.account);
  const reading = status.granted && enabled.length > 0;
  const accountFor = (suggested: string) => data.accounts.find((name) => name.toLocaleLowerCase("id-ID") === suggested.toLocaleLowerCase("id-ID")) || data.accounts[0];
  return <section className="notification-access-section">
    <div className="cloud-heading"><span className="connection-icon"><BellRing size={23} /></span><div><h2>Read bank notifications</h2><p>Turn payments from your bank and e-wallet apps into rows to review in Catch up. Nothing joins your ledger until you add it.</p></div></div>
    <p className="notification-access-status">{!status.granted ? "Off: Saku doesn't have notification access." : !enabled.length ? "Access allowed, but no apps are chosen yet." : status.paused ? `Paused for ${enabled.map((app) => app.name).join(", ")}.` : `Reading notifications from: ${enabled.map((app) => app.name).join(", ")}.`}
      {reading && <button className="text-button" disabled={busy} onClick={() => void run(() => notificationCapture.setPaused({ paused: !status.paused }))}>{status.paused ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}</button>}</p>
    <div className="notification-apps">{status.apps.map((app) => <div className="notification-app" key={app.packageName}>
      <label className="checkbox-label"><input type="checkbox" checked={!!app.account} disabled={busy || !app.installed || !data.accounts.length} onChange={(event) => void run(() => notificationCapture.setApp({ packageName: app.packageName, account: event.target.checked ? accountFor(app.suggestedAccount) : "" }))} /> {app.name}{!app.installed && <small> · not installed</small>}</label>
      {app.account && <ChoiceField className="notification-app-account" label={`Saku account for ${app.name}`} hideLabel value={data.accounts.includes(app.account) ? app.account : ""} disabled={busy} placeholder="Choose an account" onValueChange={(account) => void run(() => notificationCapture.setApp({ packageName: app.packageName, account }))} options={data.accounts.map((name) => ({ value: name, label: name }))} />}
    </div>)}</div>
    <label className="checkbox-label"><input type="checkbox" checked={cleaning} onChange={(event) => { const next = event.target.checked; setCleaning(next); void saveCleaningOptIn(next).catch(() => notify("That change could not be saved.")); }} /> Tidy unknown merchant names with Cloudflare AI <small>Sends only names Saku hasn't seen, with long numbers removed: never amounts, accounts or notification text.</small></label>
    <div className="settings-actions">{status.granted ? <button className="button secondary" disabled={busy} onClick={() => void notificationCapture.openSettings()}><Settings size={16} />Manage notification access</button> : <button className="button primary" disabled={busy || !enabled.length} onClick={() => setDisclosure(true)}><BellRing size={16} />Allow notification access</button>}</div>
    {!status.granted && !enabled.length && <small className="cloud-note">Choose at least one app above first.</small>}
    {disclosure && <Modal title="Before you allow notification access" subtitle="Android will show a warning about reading notifications. Here is exactly what Saku does." onClose={() => setDisclosure(false)}>
      <div className="notification-disclosure">
        <p><strong>What Saku reads:</strong> notifications only from {enabled.map((app) => app.name).join(", ")}. Every other app's notifications are ignored before Saku reads anything in them.</p>
        <p><strong>What it keeps:</strong> the amount, money in or out, balance and merchant name, with account and reference numbers removed. Saku doesn't keep the notification text.</p>
        <p><strong>Where it stays:</strong> encrypted on this phone for up to 7 days, until you add or discard each row. Nothing is uploaded or synced unless you add it to your ledger.</p>
        <p><strong>How to stop:</strong> tap Pause here, untick an app, or turn off Saku in Android's notification access settings.</p>
        <details><summary>Android says “Restricted setting”?</summary>
          <p>Android 13 and later block this permission for apps installed from a website until you allow it once:</p>
          <ol><li>Try to turn on Saku in notification access, then close the warning.</li><li><strong>Pixel and most phones:</strong> Settings → Apps → Saku → ⋮ (top right) → Allow restricted settings.</li><li><strong>Samsung:</strong> Settings → Apps → Saku → ⋮ → Allow restricted settings.</li><li><strong>Xiaomi / HyperOS:</strong> Settings → Apps → Manage apps → Saku → ⋮ → Allow restricted settings.</li><li>Confirm with your screen lock, then come back and turn on Saku in notification access.</li></ol>
        </details>
      </div>
      <div className="form-footer"><button className="button secondary" onClick={() => setDisclosure(false)}>Not now</button><button className="button primary" onClick={() => { setDisclosure(false); void notificationCapture.openSettings(); }}>Continue to Android settings</button></div>
    </Modal>}
  </section>;
}
