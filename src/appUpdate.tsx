import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Download, PackageCheck, RefreshCw, ShieldCheck, Wifi } from "lucide-react";
import { cachedRelease, shouldShowRelease, UPDATE_CHECK_INTERVAL_MS, validRelease, type AndroidRelease } from "./appUpdateLogic";

type NativeStatus = { versionCode: number; versionName: string; metered: boolean; canInstallPackages: boolean };
type UpdatePhase = "idle" | "downloading" | "permission" | "installer" | "error";
type UpdateContextValue = {
  native: boolean;
  installed?: NativeStatus;
  release?: AndroidRelease;
  available: boolean;
  critical: boolean;
  checking: boolean;
  phase: UpdatePhase;
  progress: number;
  error: string;
  visible: boolean;
  meteredConfirmation: boolean;
  checkNow: () => Promise<void>;
  install: (allowMetered?: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  dismiss: () => Promise<void>;
};

interface AppUpdatePlugin {
  getStatus(): Promise<NativeStatus>;
  downloadAndInstall(options: { url: string; bytes: number; sha256: string; versionCode: number; allowMetered: boolean }): Promise<{ status: "permissionRequired" | "installerOpened" }>;
  cancel(): Promise<void>;
  addListener(eventName: "downloadProgress", listener: (event: { bytes: number; total: number }) => void): Promise<PluginListenerHandle>;
}

const plugin = registerPlugin<AppUpdatePlugin>("AppUpdate");
const Context = createContext<UpdateContextValue | null>(null);
const apiUrl = (import.meta.env.VITE_SAKU_API_URL || "").replace(/\/$/, "");
const checkedKey = "saku-update-checked-at";
const releaseKey = "saku-update-release-v1";
const dismissedKey = "saku-update-dismissed-v1";

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const native = Capacitor.isNativePlatform();
  const [installed, setInstalled] = useState<NativeStatus>();
  const [release, setRelease] = useState<AndroidRelease>();
  const [checking, setChecking] = useState(false);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [meteredConfirmation, setMeteredConfirmation] = useState(false);
  const checkingRef = useRef(false);
  const sessionDismissedVersion = useRef<number | null>(null);
  const available = !!installed && !!release && release.versionCode > installed.versionCode;
  const critical = available && release!.minimumSupportedVersionCode > installed!.versionCode;

  const applyRelease = async (current: NativeStatus, next: AndroidRelease) => {
    setRelease(next);
    const dismissed = (await Preferences.get({ key: dismissedKey })).value;
    setVisible(shouldShowRelease(current.versionCode, next, dismissed, sessionDismissedVersion.current));
  };

  const check = async (force: boolean) => {
    if (!native || !apiUrl || checkingRef.current) return;
    checkingRef.current = true; setChecking(true);
    if (force) setError("");
    try {
      const current = await plugin.getStatus();
      setInstalled(current);
      if (!force) {
        const [last, cached] = await Promise.all([Preferences.get({ key: checkedKey }), Preferences.get({ key: releaseKey })]);
        const remembered = cachedRelease(last.value, cached.value);
        if (remembered) { await applyRelease(current, remembered); return; }
      }
      const response = await fetch(`${apiUrl}/v1/releases/android/latest`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Could not check for a Saku update");
      const next: unknown = await response.json();
      if (!validRelease(next)) throw new Error("Saku received invalid update information");
      await Promise.all([
        Preferences.set({ key: checkedKey, value: String(Date.now()) }),
        Preferences.set({ key: releaseKey, value: JSON.stringify(next) }),
      ]);
      await applyRelease(current, next);
    } catch (reason) {
      if (force) setError(reason instanceof Error ? reason.message : "Could not check for updates");
    } finally { checkingRef.current = false; setChecking(false); }
  };

  useEffect(() => {
    if (!native) return;
    let progressListener: Promise<PluginListenerHandle> | undefined;
    progressListener = plugin.addListener("downloadProgress", ({ bytes, total }) => setProgress(Math.min(1, bytes / Math.max(1, total))));
    void check(false);
    const stateListener = NativeApp.addListener("appStateChange", ({ isActive }) => { if (isActive) void check(false); });
    return () => { void progressListener?.then((listener) => listener.remove()); void stateListener.then((listener) => listener.remove()); };
  }, [native]);

  const install = async (allowMetered = false) => {
    if (!release || !installed) return;
    setError("");
    const status = await plugin.getStatus();
    setInstalled(status);
    if (status.metered && !allowMetered) { setMeteredConfirmation(true); return; }
    setMeteredConfirmation(false); setProgress(0); setPhase("downloading");
    try {
      const result = await plugin.downloadAndInstall({ url: `${apiUrl}${release.apkUrl}`, bytes: release.apkBytes, sha256: release.sha256, versionCode: release.versionCode, allowMetered });
      setPhase(result.status === "permissionRequired" ? "permission" : "installer");
    } catch (reason) {
      const code = (reason as { code?: string }).code;
      if (code === "CANCELLED") setPhase("idle");
      else { setPhase("error"); setError(reason instanceof Error ? reason.message : "Could not install the update"); }
    }
  };
  const cancel = async () => { await plugin.cancel(); setPhase("idle"); setProgress(0); };
  const dismiss = async () => {
    setVisible(false); setMeteredConfirmation(false); setError(""); setPhase("idle");
    if (release && critical) sessionDismissedVersion.current = release.versionCode;
    else if (release) await Preferences.set({ key: dismissedKey, value: JSON.stringify({ versionCode: release.versionCode, until: Date.now() + 3 * UPDATE_CHECK_INTERVAL_MS }) });
  };
  const value = useMemo<UpdateContextValue>(() => ({ native, installed, release, available, critical, checking, phase, progress, error, visible, meteredConfirmation, checkNow: () => check(true), install, cancel, dismiss }), [native, installed, release, available, critical, checking, phase, progress, error, visible, meteredConfirmation]);
  return <Context.Provider value={value}>{children}{visible && available && <UpdatePrompt />}</Context.Provider>;
}

export function useAppUpdate() {
  const value = useContext(Context);
  if (!value) throw new Error("AppUpdateProvider is missing");
  return value;
}

function UpdatePrompt() {
  const update = useAppUpdate(), release = update.release!;
  const size = `${(release.apkBytes / 1_000_000).toFixed(1)} MB`;
  return <div className="update-overlay" role="presentation">
    <section className="update-card" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div className="update-icon"><PackageCheck size={25} /></div>
      <p className="update-eyebrow">SAKU {release.versionName}</p>
      <h2 id="update-title">{update.critical ? "Update needed for cloud sync" : "A new Saku is ready"}</h2>
      <p>{update.critical ? "Your ledger stays available on this phone. Install this update to resume backup and sync." : "Install it from Saku, then Android will ask you to approve the update."}</p>
      {!!release.notes.length && <ul>{release.notes.map((note) => <li key={note}>{note}</li>)}</ul>}
      <div className="update-trust"><ShieldCheck size={17} /><span>Verified before Android opens the installer</span><strong>{size}</strong></div>
      {update.phase === "downloading" && <div className="update-progress" aria-live="polite"><span style={{ width: `${Math.round(update.progress * 100)}%` }} /><p>Downloading securely… {Math.round(update.progress * 100)}%</p></div>}
      {update.meteredConfirmation && <div className="update-notice"><Wifi size={17} /><p>This connection may use mobile data. The update is {size}.</p></div>}
      {update.phase === "permission" && <div className="update-notice"><p>Allow Saku to install updates in Android Settings, then return and tap Install again.</p></div>}
      {update.phase === "installer" && <div className="update-notice"><p>Android’s installer is open. Approve the update there; your Saku data stays in place.</p></div>}
      {update.error && <p className="form-error" role="alert">{update.error}</p>}
      <div className="update-actions">
        {update.phase === "downloading" ? <button className="button secondary" onClick={() => void update.cancel()}>Cancel download</button> : <>
          <button className="button secondary" onClick={() => void update.dismiss()}>{update.critical ? "Use Saku offline" : "Remind me in 3 days"}</button>
          <button className="button primary" onClick={() => void update.install(update.meteredConfirmation)}><Download size={17} />{update.meteredConfirmation ? "Use mobile data" : update.phase === "permission" ? "Install again" : "Install update"}</button>
        </>}
      </div>
    </section>
  </div>;
}

export function AppUpdateSettings() {
  const update = useAppUpdate();
  if (!update.native) return null;
  return <section className="app-update-settings">
    <div className="cloud-heading"><span className="connection-icon"><RefreshCw size={23} /></span><div><h2>App updates</h2><p>Saku checks once a day and asks before downloading or installing anything.</p></div></div>
    <div className="app-update-row"><span><strong>Installed</strong><small>{update.installed ? `Saku ${update.installed.versionName} · build ${update.installed.versionCode}` : "Checking this installation"}</small></span><span className={`sync-state ${update.available ? "pending" : ""}`}>{update.available ? `Version ${update.release?.versionName} ready` : "Up to date"}</span></div>
    {update.error && <p className="form-error" role="alert">{update.error}</p>}
    <div className="settings-actions"><button className="button secondary" disabled={update.checking} onClick={() => void update.checkNow()}><RefreshCw size={16} />{update.checking ? "Checking…" : "Check now"}</button>{update.available && <button className="button primary" onClick={() => void update.install()}><Download size={16} />Install update</button>}</div>
  </section>;
}
