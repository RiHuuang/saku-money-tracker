import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Camera,
  Check,
  CheckCheck,
  CircleUserRound,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  ExternalLink,
  FileCheck2,
  LayoutDashboard,
  Leaf,
  LockKeyhole,
  LogOut,
  Menu,
  PencilLine,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import {
  COLORS,
  ICONS,
  accountBalance,
  balanceAdjustment,
  budgetFor,
  cardBalance,
  emptyData,
  exportCSV,
  isIncome,
  isSpending,
  personalAmount,
  receiptSuggestion,
  money,
  monthLabel,
  shiftMonth,
  summary,
  today,
  uid,
  validAmount,
  validateData,
  type Data,
  type Favorite,
  type Pocket,
  type RecurringRule,
  type Transaction,
} from "./domain";
import { download, hasUserData, loadData, loadLegacyData, removeUserData, replaceData, saveData } from "./storage";
import {
  DirectionIcon,
  Empty,
  FlowChart,
  FitMoney,
  IconButton,
  MoneyInput,
  ChoiceField,
  Modal,
  PocketCard,
  PocketIcon,
  SpendingRing,
  SegmentedChoice,
  TransactionList,
} from "./components";
const Statements = lazy(() => import("./Statements"));
const CsvStatements = lazy(() => import("./CsvStatements"));
const CatchUp = lazy(() => import("./CatchUp"));
const Plans = lazy(() => import("./Plans"));
import { localStatementAI, nativeAIAvailable } from "./localStatementAI";
import { homeWidgetRevision } from "./homeWidget";
import { loadTheme, saveTheme, type ThemePreference } from "./appearance";
import { backDestination, moreViews, type View } from "./navigation";
import { AppUpdateSettings } from "./appUpdate";
import { version as appVersion } from "../package.json";
import {
  connectGoogleDrive,
  adoptCloudSnapshot,
  loadAvatarUrl,
  loadCloudState,
  refreshCloudMetadata,
  resolveCloudWithLocal,
  liveTicket,
  liveUrl,
  AGREEMENT_VERSION,
  deleteCloudAccount,
  legalUrl,
  markCloudDirty,
  mirrorCloud,
  pullCloud,
  pushCloud,
  signInGoogle,
  signOutGoogle,
  listDevices,
  signOutDevice,
  type SignedInDevice,
  updateProfile,
  type CloudState,
} from "./cloud";

type Edit =
  | { type: "transaction"; value?: Transaction; cardId?: string; favorite?: Favorite; pocketId?: string }
  | { type: "balance_adjustment"; account: string; value?: Transaction }
  | { type: "pocket"; value?: Pocket }
  | { type: "pocket_delete"; value: Pocket }
  | { type: "account_transfer"; value?: Transaction }
  | { type: "pocket_transfer" }
  | { type: "start" }
  | null;
const cloudImportEnabled = true;
const navigation = [
  { id: "overview", label: "Home", icon: LayoutDashboard },
  { id: "transactions", label: "Activity", icon: ArrowDownLeft },
  { id: "pockets", label: "Pockets", icon: Wallet },
  { id: "plans", label: "Plans", icon: CreditCard },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "check", label: cloudImportEnabled ? "Catch up" : "Check", icon: FileCheck2 },
] as const;
const mobileNavigation = [
  navigation[0], navigation[1], navigation[2], navigation[3],
  { id: "more", label: "More", icon: Menu },
] as const;
const pocketHasReferences = (data: Data, pocketId: string) =>
  data.transactions.some((t) => t.pocketId === pocketId) || data.recurring.some((r) => r.pocketId === pocketId) ||
  data.favorites.some((f) => f.pocketId === pocketId) || data.pocketTransfers.some((move) => move.fromPocketId === pocketId || move.toPocketId === pocketId);
export default function App() {
  const [data, setData] = useState<Data | null>(null),
    [loadError, setLoadError] = useState(""),
    [view, setView] = useState<View>("overview"),
    [month, setMonth] = useState(today().slice(0, 7)),
    [checkTab, setCheckTab] = useState<"catchup" | "statement" | "csv">(cloudImportEnabled ? "catchup" : "csv"),
    [edit, setEdit] = useState<Edit>(null),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [cloud, setCloud] = useState<CloudState | null>(null),
    [loginBusy, setLoginBusy] = useState(false),
    [resolution, setResolution] = useState<{ local: Data; remote: Data; remoteState?: CloudState } | null>(null),
    [avatarUrl, setAvatarUrl] = useState("");
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [previousView, setPreviousView] = useState<View>("overview");
  const [selectedPocketId, setSelectedPocketId] = useState<string | null>(null);
  const [pocketAllHistory, setPocketAllHistory] = useState(false);
  const saving = useRef(false);
  const widgetRevision = useRef(0);
  const pendingSync = useRef<Data | null>(null);
  const activeSync = useRef<Data | null>(null);
  const syncRunning = useRef(false);
  const mirrorRunning = useRef(false);
  const latest = useRef({ data, cloud, edit });
  latest.current = { data, cloud, edit };
  const reconcileRef = useRef<(() => Promise<void>) | null>(null);
  const selectedPocket = data?.pockets.find((p) => p.id === selectedPocketId);
  function openPocket(id: string) { go("pockets"); setSelectedPocketId(id); setPocketAllHistory(false); }
  function openTransaction(value: Transaction) {
    setEdit(value.kind === "account_transfer"
      ? { type: "account_transfer", value }
      : value.kind === "balance_adjustment"
        ? { type: "balance_adjustment", account: value.account, value }
        : { type: "transaction", value });
  }
  useEffect(() => {
    void (async () => {
      try {
        const state = await loadCloudState();
        setCloud(state);
        if (state.signedIn && state.user?.id) await openWorkspace(state);
      } catch { setLoadError("Saku could not open your protected workspace. Your saved data has been left untouched."); }
    })();
  }, []);
  async function openWorkspace(state: CloudState) {
    if (!state.user?.id) return;
    const scoped = await hasUserData(state.user.id);
    const local = scoped ? await loadData(state.user.id) : Capacitor.isNativePlatform() ? await loadLegacyData() : null;
    if (!scoped) await loadData(state.user.id);
    const useful = (value: Data | null) => Boolean(value && !value.demo && (value.transactions.length || value.pockets.length || value.creditCards.length || value.name !== "My"));
    let remote: Data | null = null, remoteState: CloudState | undefined;
    try { const result = await pullCloud(); remote = result.data; remoteState = result.state; }
    catch {
      if (!useful(local)) throw new Error("Could not reach Saku Cloud. Connect to the internet and retry before setting up a workspace. Your cloud data has not changed.");
      // A saved local ledger remains available offline.
    }
    const newerCleanCloud = scoped && !state.dirty && remoteState && remoteState.revision > state.revision && useful(remote);
    if (useful(local) && !newerCleanCloud && (!scoped || !remote || !useful(remote) || JSON.stringify(local) !== JSON.stringify(remote))) {
      setResolution({ local: local!, remote: remote || emptyData(), remoteState });
      return;
    }
    const chosen = newerCleanCloud ? remote! : useful(local) ? local! : useful(remote) ? remote! : emptyData();
    await replaceData(chosen);
    if (remoteState && !remoteState.dirty && remote && JSON.stringify(chosen) === JSON.stringify(remote)) setCloud(await adoptCloudSnapshot(remoteState));
    setData(chosen);
    if (!useful(chosen)) setEdit({ type: "start" });
  }
  useEffect(() => {
    if (!cloud?.signedIn || !cloud.user?.hasAvatar) { setAvatarUrl(""); return; }
    let url = "";
    let cancelled = false;
    void loadAvatarUrl(cloud.user.avatarVersion).then((value) => {
      if (cancelled) { if (value) URL.revokeObjectURL(value); return; }
      url = value;
      setAvatarUrl(value);
    });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [cloud?.signedIn, cloud?.user?.hasAvatar, cloud?.user?.avatarVersion]);
  useEffect(() => {
    if (!data || !cloud?.signedIn || !cloud.dirty) return;
    void queueSync(data);
  }, [data, cloud?.signedIn, cloud?.dirty]);
  useEffect(() => {
    if (!cloud?.signedIn || !cloud.user?.id || !data) return;
    let stopped = false, socket: WebSocket | null = null, timer: ReturnType<typeof setTimeout> | null = null;
    let running = false, retry = 0, needed = true, signal = 0;
    const userId = cloud.user.id;
    const visible = () => document.visibilityState === "visible" && navigator.onLine !== false;
    const reconcile = async () => {
      signal++;
      needed = true;
      if (running || !visible() || stopped) return;
      const current = latest.current;
      if (current.edit || saving.current || syncRunning.current || !current.data || current.cloud?.user?.id !== userId) return;
      const startedWith = signal;
      running = true;
      try {
        const { revision, state } = await refreshCloudMetadata();
        if (stopped || latest.current.cloud?.user?.id !== userId) return;
        setCloud(state);
        if (revision > state.revision) {
          const before = latest.current.data;
          const result = await pullCloud();
          if (stopped || latest.current.data !== before || latest.current.edit || saving.current) return;
          if (result.state.dirty) {
            if (result.data) setResolution({ local: before!, remote: result.data, remoteState: result.state });
          } else if (result.data) {
            await replaceData(result.data);
            const adopted = await adoptCloudSnapshot(result.state);
            setData(result.data);
            setCloud(adopted);
          }
        }
        needed = signal !== startedWith;
      } catch { /* Keep local data and retry after reconnection or next notice. */ }
      finally { running = false; if (needed && signal !== startedWith) queueMicrotask(() => { void reconcile(); }); }
    };
    reconcileRef.current = reconcile;
    const connect = async () => {
      if (stopped || !visible() || socket) return;
      try {
        const { room, ticket } = await liveTicket();
        if (stopped || !visible()) return;
        socket = new WebSocket(liveUrl(room, ticket));
        socket.onopen = () => { retry = 0; void reconcile(); };
        socket.onmessage = () => { void reconcile(); };
        socket.onclose = () => {
          socket = null;
          if (!stopped && visible()) timer = setTimeout(() => void connect(), Math.min(15000, 500 * 2 ** retry++));
        };
      } catch { if (!stopped && visible()) timer = setTimeout(() => void connect(), Math.min(15000, 500 * 2 ** retry++)); }
    };
    const activity = () => {
      if (!visible()) { if (timer) clearTimeout(timer); socket?.close(); socket = null; return; }
      if (needed) void reconcile();
      void connect();
    };
    document.addEventListener("visibilitychange", activity);
    window.addEventListener("online", activity);
    void connect();
    return () => { stopped = true; if (timer) clearTimeout(timer); socket?.close(); document.removeEventListener("visibilitychange", activity); window.removeEventListener("online", activity); if (reconcileRef.current === reconcile) reconcileRef.current = null; };
  }, [cloud?.signedIn, cloud?.user?.id, Boolean(data)]);
  useEffect(() => { if (!edit) void reconcileRef.current?.(); }, [edit]);
  useEffect(() => {
    if (!data || !cloud?.signedIn || !cloud.sheetPending || !cloud.spreadsheetUrl || cloud.dirty) return;
    if (cloud.revision === 0) { void queueSync(data); return; }
    void attemptMirror();
    const timer = setInterval(() => void attemptMirror(), 5 * 60_000);
    return () => clearInterval(timer);
  }, [data, cloud?.signedIn, cloud?.sheetPending, cloud?.spreadsheetUrl, cloud?.dirty, cloud?.user?.id]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !cloud?.user?.id || !data) return;
    let active = true;
    void homeWidgetRevision().then((revision) => { widgetRevision.current = revision; });
    const listener = NativeApp.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      void (async () => {
        const revision = await homeWidgetRevision();
        if (!active) return;
        const changedByWidget = revision !== widgetRevision.current;
        const nextData = changedByWidget ? await loadData(cloud.user!.id) : data;
        const nextCloud = await loadCloudState();
        widgetRevision.current = revision;
        if (active) { setData(nextData); setCloud(nextCloud); }
        if (active && nextCloud.signedIn && nextCloud.dirty) await queueSync(nextData);
        if (active) void reconcileRef.current?.();
      })();
    });
    return () => { active = false; void listener.then((handle) => handle.remove()); };
  }, [cloud?.user?.id, data]);
  useEffect(() => {
    void loadTheme().then(setThemePreference).catch(() => {});
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener("backButton", () => {
      const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
      const dialog = dialogs[dialogs.length - 1];
      if (dialog) {
        dialog.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')?.click();
        return;
      }
      if (edit) setEdit(null);
      else if (selectedPocketId) setSelectedPocketId(null);
      else {
        const destination = backDestination(view, previousView);
        if (destination) setView(destination);
        else NativeApp.minimizeApp();
      }
    });
    return () => {
      void listener.then((h) => h.remove());
    };
  }, [edit, view, previousView, selectedPocketId]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const openQuickAdd = (url?: string) => { if (url?.startsWith("saku://quick-add")) { setView("overview"); setEdit({ type: "transaction" }); } };
    void NativeApp.getLaunchUrl().then((result) => openQuickAdd(result?.url));
    const listener = NativeApp.addListener("appUrlOpen", (event) => openQuickAdd(event.url));
    return () => { void listener.then((h) => h.remove()); };
  }, []);
  async function commit(next: Data, message: string) {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    try {
      await saveData(next);
      setData(next);
      setCloud((value) => value?.signedIn ? { ...value, dirty: true } : value);
      void queueSync(next);
      if (message) setToast(message);
      return true;
    } catch (e) {
      setToast(
        e instanceof Error
          ? `Could not save: ${e.message}`
          : "Could not save. Please try again.",
      );
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function queueSync(next: Data, userInitiated = false) {
    if (activeSync.current === next || pendingSync.current === next) return;
    pendingSync.current = next;
    if (syncRunning.current || !cloud?.signedIn) return;
    syncRunning.current = true;
    try {
      while (pendingSync.current) {
        const snapshot = pendingSync.current;
        pendingSync.current = null;
        activeSync.current = snapshot;
        await markCloudDirty();
        setCloud(await pushCloud(snapshot));
        activeSync.current = null;
      }
      if (userInitiated) setToast("Cloud backup saved. Google Sheet is updating.");
    } catch (error: unknown) {
      pendingSync.current = null;
      activeSync.current = null;
      setCloud((value) => value?.signedIn ? { ...value, dirty: true } : value);
      const status = typeof error === "object" && error && "status" in error ? (error as { status?: number }).status : undefined;
      setToast(status === 409 ? "Google has newer data. Review before syncing again." : "Saved offline. Automatic sync will retry when Saku is active.");
    } finally {
      syncRunning.current = false;
      void reconcileRef.current?.();
    }
  }
  async function attemptMirror(userInitiated = false) {
    if (mirrorRunning.current || !cloud?.signedIn || !cloud.sheetPending || !cloud.spreadsheetUrl) return;
    mirrorRunning.current = true;
    try {
      const next = await mirrorCloud();
      setCloud((current) => current?.user?.id === next.user?.id ? next : current);
      if (userInitiated) setToast(next.sheetPending ? "Cloud backup saved. Google Sheet is still updating." : "Google Sheet updated");
    } catch (error) {
      if (userInitiated) setToast(error instanceof Error ? error.message : "Google Sheet update failed");
    } finally { mirrorRunning.current = false; }
  }
  async function recover(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 20000000) throw new Error("Backup is too large.");
      const next = validateData(JSON.parse(await file.text()));
      if (await commit(next, "Backup restored")) setLoadError("");
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Could not restore backup.",
      );
    }
  }
  if (cloud && !cloud.signedIn)
    return <LoginScreen configured={cloud.configured} busy={loginBusy} error={loadError} onLogin={async () => {
      setLoginBusy(true); setLoadError("");
      try { const next = await signInGoogle(); setCloud(next); await openWorkspace(next); }
      catch (error) { setLoadError(error instanceof Error ? error.message : "Google sign-in failed."); }
      finally { setLoginBusy(false); }
    }} />;
  if (resolution)
    return <WorkspaceChoice local={resolution.local} remote={resolution.remote} onChoose={async (chosen, localWins) => {
      if (localWins) { await saveData(chosen); if (resolution.remoteState) setCloud(await resolveCloudWithLocal(resolution.remoteState)); else setCloud((value) => value ? { ...value, dirty: true } : value); setData(chosen); void queueSync(chosen); } else { await replaceData(chosen); if (resolution.remoteState) setCloud(await adoptCloudSnapshot(resolution.remoteState, true)); } setData(chosen); setResolution(null); if (!chosen.transactions.length && !chosen.pockets.length && !chosen.accounts.length) setEdit({ type: "start" });
    }} onBackup={() => void download(`saku-local-backup-${today()}.json`, JSON.stringify(resolution.local, null, 2), "application/json")} />;
  if (!data)
    return (
      <div className="loading">
        <span className="brand-mark">
          <Wallet />
        </span>
        <h1>Saku</h1>
        {loadError ? (
          <>
            <p role="alert">{loadError}</p>
            <button
              className="button primary"
              onClick={() => location.reload()}
            >
              Retry
            </button>
            <label className="button secondary">
              Restore backup
              <input
                type="file"
                accept=".json"
                hidden
                onChange={(e) => void recover(e.target.files?.[0])}
              />
            </label>
          </>
        ) : (
          <p>Getting your pockets ready...</p>
        )}
      </div>
    );
  const stats = summary(data, month),
    sorted = [...stats.transactions].sort(
      (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
    );
  const topPocket = [...stats.pockets].sort((a, b) => b.spent - a.spent)[0];
  const overspent = stats.pockets.filter((p) => p.spent > p.limit);
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekTransactions = data.transactions.filter((t) => isSpending(t) && new Date(`${t.date}T12:00:00`) >= weekStart && t.date <= today());
  const weekSpend = weekTransactions.reduce((n, t) => n + personalAmount(t), 0);
  const weekTop = data.pockets.map((p) => ({ name: p.name, amount: weekTransactions.filter((t) => t.pocketId === p.id).reduce((n, t) => n + personalAmount(t), 0) })).sort((a, b) => b.amount - a.amount)[0];
  const currentAvailable = summary(data, today().slice(0, 7)).available;
  const titles: Record<View, [string, string]> = {
    overview: ["Your everyday money", "Home"],
    transactions: ["Find and review entries", "Activity"],
    pockets: ["Your monthly spending plan", "Pockets"],
    plans: ["Cards and recurring payments", "Plans"],
    more: ["Explore your workspace", "More"],
    insights: ["Understand your spending", "Insights"],
    check: cloudImportEnabled ? ["Catch up on your money", "Catch up"] : ["Review your records", "Check"],
    settings: ["Manage your workspace", "Settings"],
  };
  const go = (v: View) => {
    if (v === "more" && !moreViews.includes(view)) setPreviousView(view);
    setSelectedPocketId(null);
    setView(v);
    window.scrollTo({ top: 0 });
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("overview");
          }}
        >
          <span className="brand-mark">
            <Wallet size={25} />
          </span>
          <span>
            saku<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "active" : ""}
              onClick={() => go(n.id)}
            >
              <n.icon size={20} />
              {n.label}
              {n.id === "check" && <span className="nav-new">NEW</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={22} />
            <div>
              <strong>Just yours.</strong>
              <span>{cloud?.signedIn ? "Private Google backup." : "Stored on this device."}</span>
            </div>
            <span className="status-dot" />
          </div>
          <button
            className={`settings-link ${view === "settings" ? "active" : ""}`}
            onClick={() => go("settings")}
          >
            <Settings size={19} /> Settings
          </button>
          <button className="profile" onClick={() => go("settings")}>
            <span className="avatar">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : (cloud?.user?.name || data.name).slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>
                {data.name}'s workspace
              </strong>
              <small>
                {cloud?.signedIn ? cloud.user?.email : "Local profile"}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            My workspace <ChevronRight size={13} />
            <span>
              {navigation.find((n) => n.id === view)?.label || "Settings"}
            </span>
          </div>
          <a
            className="mobile-brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              go("overview");
            }}
          >
            saku<span>.</span>
          </a>
          <div className="topbar-actions">
            <span className="local-label">
              {cloud?.signedIn ? <CheckCheck size={13} /> : <LockKeyhole size={13} />}
              {cloud?.signedIn ? cloud.dirty ? "Not synced" : cloud.revision === 0 ? "Not backed up" : "Synced" : "On-device"}
            </span>
            <button
              className="top-avatar"
              onClick={() => go("settings")}
              title="Your profile"
            >
              {avatarUrl ? <img src={avatarUrl} alt="" /> : (cloud?.user?.name || data.name).slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <section className="page-heading">
            <div>
              {moreViews.includes(view) && view !== "more" && <button className="back-to-more" onClick={() => go("more")}><ChevronLeft size={17} /> More</button>}
              {selectedPocket && view === "pockets" && <button className="back-to-more" onClick={() => setSelectedPocketId(null)}><ChevronLeft size={17} /> All pockets</button>}
              <p>{selectedPocket && view === "pockets" ? "Pocket activity" : titles[view][0]}</p>
              <h1>{selectedPocket && view === "pockets" ? selectedPocket.name : titles[view][1]}</h1>
            </div>
            <div className="heading-actions">
              {view !== "settings" && view !== "more" && (
                <div className="month-picker">
                  <IconButton
                    label="Previous month"
                    onClick={() => setMonth(shiftMonth(month, -1))}
                  >
                    <ChevronLeft size={16} />
                  </IconButton>
                  <label>
                    <CalendarDays size={16} />
                    <span>{monthLabel(month, true)}</span>
                    <input
                      aria-label="Selected month"
                      type="month"
                      value={month}
                      onChange={(e) => {
                        if (/^\d{4}-\d{2}$/.test(e.target.value))
                          setMonth(e.target.value);
                      }}
                    />
                  </label>
                  <IconButton
                    label="Next month"
                    onClick={() => setMonth(shiftMonth(month, 1))}
                  >
                    <ChevronRight size={16} />
                  </IconButton>
                </div>
              )}
              {["overview", "transactions"].includes(view) && (
                <button
                  className="button primary add-transaction"
                  onClick={() => setEdit({ type: "transaction" })}
                >
                  <Plus size={18} />
                  <span>Add transaction</span>
                </button>
              )}
              {view === "pockets" && !selectedPocket && (
                <button
                  className="button primary"
                  onClick={() => setEdit({ type: "pocket" })}
                >
                  <Plus size={18} />
                  New pocket
                </button>
              )}
              {view === "pockets" && selectedPocket && <button className="button primary" onClick={() => setEdit({ type: "transaction", pocketId: selectedPocket.id })}><Plus size={18} /> Add transaction</button>}
            </div>
          </section>
          {view === "more" && <section className="more-list" aria-label="More destinations">
            <button onClick={() => go("insights")}><BarChart3 /><span><strong>Insights</strong><small>See trends and spending breakdowns</small></span><ChevronRight /></button>
            <button onClick={() => go("check")}><FileCheck2 /><span><strong>{cloudImportEnabled ? "Catch up" : "Check"}</strong><small>{cloudImportEnabled ? "Import screenshots and statements" : nativeAIAvailable ? "Review CSV and PDF statements" : "Compare CSV with your records"}</small></span><ChevronRight /></button>
            <button onClick={() => go("settings")}><Settings /><span><strong>Settings</strong><small>Accounts, appearance, backup and privacy</small></span><ChevronRight /></button>
          </section>}
          {view === "overview" && (
            <>
              <section className="summary-grid">
                <button className="balance-panel balance-action" onClick={() => go("insights")} aria-label={`View insights for ${monthLabel(month)}`}>
                  <div className="balance-top">
                    <span>
                      <Wallet size={17} />
                      Recorded cash
                    </span>
                    <span className="balance-badge">IDR</span>
                  </div>
                  <div className="balance-number"><FitMoney amount={stats.balance} /></div>
                  <p>
                    Across {data.accounts.length} accounts <span>·</span>{" "}
                    Through {monthLabel(month, true)}
                  </p>
                  <div className="balance-footer">
                    <span>
                      <span className="tiny-square" />
                      Budget availability
                    </span>
                    <strong>{money(stats.available)} available</strong>
                  </div>
                  <p className="availability-explainer">Capped by recorded cash and positive pocket balances. Not a live bank balance.</p>
                  <span className="balance-cta">View insights <ArrowRight size={16} /></span>
                </button>
                <div className="metric-panel">
                  <div className="metric-label">
                    <DirectionIcon income />
                    Money in
                    <span className="metric-arrow">
                      <ArrowDownLeft size={16} />
                    </span>
                  </div>
                  <strong><FitMoney amount={stats.income} /></strong>
                  <p>
                    {
                      stats.transactions.filter(isIncome)
                        .length
                    }{" "}
                    income transactions
                  </p>
                  <div className="mini-bars income-mini">
                    {Array.from({ length: 5 }, (_, week) => {
                      const amount = stats.transactions
                        .filter(t => isIncome(t) && Math.floor((Number(t.date.slice(-2)) - 1) / 7) === week)
                        .reduce((total, t) => total + t.amount, 0);
                      return <i key={week} title={`Week ${week + 1}: ${money(amount)}`} style={{ height: `${stats.income ? amount / stats.income * 100 : 0}%` }} />;
                    })}
                  </div>
                </div>
                <div className="metric-panel">
                  <div className="metric-label">
                    <DirectionIcon income={false} />
                    Money out
                    <span className="metric-arrow">
                      <ArrowUpRight size={16} />
                    </span>
                  </div>
                  <strong><FitMoney amount={stats.expenses} /></strong>
                  <p>
                    <span className="expense-dot" />
                    {stats.budget
                      ? `${Math.round((stats.expenses / stats.budget) * 100)}% of monthly budget`
                      : "No budget set yet"}
                  </p>
                  <div className="budget-meter">
                    <i
                      style={{
                        width: `${Math.min(100, stats.budget ? (stats.expenses / stats.budget) * 100 : 0)}%`,
                      }}
                    />
                  </div>
                  <small>{money(stats.budget)} planned</small>
                </div>
              </section>
              <section className="account-balance-strip" aria-label="Account balances">{stats.accounts.map((item) => <div className="account-balance-item" key={item.account}><span className="account-balance-icon"><Wallet size={16} /></span><span><small>{item.account}</small><strong>{money(item.balance)}</strong></span></div>)}</section>
              <section className="daily-strip" aria-label="Quick entries and weekly check-in">
                <div className="daily-check"><span>Current week · last 7 days</span><strong>{money(weekSpend)} spent</strong><small>{weekTop?.amount ? `${weekTop.name} was the largest pocket.` : "No spending recorded yet."}</small><small>{money(currentAvailable)} available in your current plan</small></div>
                <div className="quick-entries"><div className="section-heading"><h2>Quick add</h2><button className="text-button" onClick={() => setEdit({ type: "transaction" })}><Plus size={16} /> New</button></div><div className="quick-entry-list">{data.favorites.map((f) => <div className="quick-entry" key={f.id}><button onClick={() => setEdit({ type: "transaction", favorite: f })}><Plus size={16} /><span>{f.name}</span><strong>{money(f.amount)}</strong></button><button className="quick-remove" title={`Remove ${f.name} shortcut`} aria-label={`Remove ${f.name} shortcut`} onClick={() => void commit({ ...data, favorites: data.favorites.filter((x) => x.id !== f.id) }, "Quick entry removed")}><X size={14} /></button></div>)}{!data.favorites.length && <span className="quick-empty">Save a frequent expense when you add it.</span>}</div></div>
              </section>
              <section className="pockets-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      Little pockets, big plans{" "}
                      <span>{stats.pockets.length}</span>
                    </h2>
                    <p>Your month, thoughtfully divided.</p>
                  </div>
                  <button className="text-button" onClick={() => { setSelectedPocketId(null); go("pockets"); }}>
                    All pockets <ArrowRight size={16} />
                  </button>
                </div>
                {stats.pockets.length ? (
                  <div className="pocket-grid">
                    {stats.pockets.slice(0, 4).map((p) => (
                      <PocketCard
                        key={p.id}
                        p={p}
                        onClick={() => openPocket(p.id)}
                        onEdit={() => setEdit({ type: "pocket", value: p })}
                        onDelete={() => setEdit({ type: "pocket_delete", value: p })}
                      />
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="Give your money a purpose"
                    detail="Set a monthly amount for food, fun, and everything in between."
                    action="Create a pocket"
                    onClick={() => setEdit({ type: "pocket" })}
                  />
                )}
              </section>
              <button className="insights-link" onClick={() => go("insights")}><BarChart3 size={19} /><span><strong>Explore your spending</strong><small>Cash flow and category trends</small></span><ArrowRight size={18} /></button>
              <section className="charts-grid home-charts">
                <div className="chart-panel">
                  <div className="section-heading">
                    <h2>Money in, money out</h2>
                    <div className="chart-legend">
                      <span>
                        <i className="income-dot" />
                        Income
                      </span>
                      <span>
                        <i className="out-dot" />
                        Expenses
                      </span>
                    </div>
                  </div>
                  <FlowChart transactions={stats.transactions} month={month} />
                  <div className="chart-footnote">
                    Weekly cash flow <span>·</span> {monthLabel(month)}
                  </div>
                </div>
                <div className="chart-panel spending-panel">
                  <div className="section-heading">
                    <h2>Where it went</h2>
                    <button
                      className="icon-button"
                      title="See spending insights"
                      aria-label="See spending insights"
                      onClick={() => go("insights")}
                    >
                      <ArrowUpRight size={19} />
                    </button>
                  </div>
                  <SpendingRing
                    pockets={stats.pockets}
                    total={stats.expenses}
                  />
                </div>
              </section>
              <section className="recent-section">
                <div className="section-heading">
                  <div>
                    <h2>The latest little things</h2>
                    <p>Recent transactions this month.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => go("transactions")}
                  >
                    View all <ArrowRight size={16} />
                  </button>
                </div>
                <TransactionList
                  transactions={sorted.slice(0, 5)}
                  pockets={data.pockets}
                  onEdit={openTransaction}
                  compactView
                />
              </section>
              <div className="bottom-note">
                <Leaf size={15} />A little awareness goes a long way.
              </div>
            </>
          )}
          {view === "transactions" && (
            <Transactions
              data={data}
              month={month}
              onEdit={openTransaction}
              notify={setToast}
            />
          )}
          {view === "pockets" && selectedPocket && <section className="pocket-activity">
            <div className="pocket-activity-summary"><div><span>Funded this month</span><strong>{money(stats.pockets.find((p) => p.id === selectedPocket.id)?.limit || 0)}</strong></div><div><span>Spent this month</span><strong>{money(stats.pockets.find((p) => p.id === selectedPocket.id)?.spent || 0)}</strong></div><div><span>Remaining</span><strong>{money((stats.pockets.find((p) => p.id === selectedPocket.id)?.limit || 0) - (stats.pockets.find((p) => p.id === selectedPocket.id)?.spent || 0))}</strong></div></div>
            <p className="pocket-funding-note">Funding is your monthly budget and recorded moves between pockets. Cash income is recorded in accounts.</p>
            <div className="section-heading"><h2>History</h2><button className="text-button" onClick={() => setPocketAllHistory((value) => !value)}>{pocketAllHistory ? "Selected month" : "All history"}</button></div>
            {data.pocketTransfers.filter((move) => (move.fromPocketId === selectedPocket.id || move.toPocketId === selectedPocket.id) && (pocketAllHistory || move.month === month)).map((move) => <div className="pocket-move" key={move.id}><span>{move.toPocketId === selectedPocket.id ? "Budget moved in" : "Budget moved out"} · {monthLabel(move.month, true)}</span><strong>{move.toPocketId === selectedPocket.id ? "+" : "−"}{money(move.amount)}</strong></div>)}
            <TransactionList transactions={data.transactions.filter((t) => t.pocketId === selectedPocket.id && (pocketAllHistory || t.date.startsWith(month))).sort((a, b) => b.date.localeCompare(a.date))} pockets={data.pockets} onEdit={(value) => setEdit({ type: "transaction", value })} groupDates />
          </section>}
          {view === "pockets" && !selectedPocket && (
            <>
              <div className="budget-overview">
                <div>
                  <span>Monthly budget</span>
                  <strong>{money(stats.budget)}</strong>
                </div>
                <div>
                  <span>Spent so far</span>
                  <strong>{money(stats.expenses)}</strong>
                </div>
                <div>
                  <span>Within budget & cash</span>
                  <strong className="positive">{money(stats.available)}</strong>
                </div>
              </div>
              {stats.remaining > Math.max(0, stats.balance) && (
                <div className="inline-warning">
                  Your remaining pocket budgets exceed your recorded balance by{" "}
                  {money(stats.remaining - Math.max(0, stats.balance))}. Add any
                  missing income or adjust your plans.
                </div>
              )}
              {overspent.length > 0 && (
                <div className="inline-warning">
                  {overspent.length}{" "}
                  {overspent.length === 1 ? "pocket is" : "pockets are"} over
                  budget. Review the highlighted balances below.
                </div>
              )}
              <div className="section-heading"><div><h2>Budget allocation</h2><p>{stats.unassigned ? `${money(stats.unassigned)} is waiting for a pocket.` : "Move this month's plan without moving cash."}</p></div><button className="button secondary" disabled={data.pockets.length < 2} onClick={() => setEdit({ type: "pocket_transfer" })}><ArrowRight size={16} />Move budget</button></div>
              <div className="pocket-grid all-pockets">
                {stats.pockets.map((p) => (
                  <PocketCard
                    key={p.id}
                    p={p}
                    onClick={() => openPocket(p.id)}
                    onEdit={() => setEdit({ type: "pocket", value: p })}
                    onDelete={() => setEdit({ type: "pocket_delete", value: p })}
                  />
                ))}
                <button
                  className="new-pocket"
                  onClick={() => setEdit({ type: "pocket" })}
                >
                  <Plus size={25} />
                  <strong>A new little plan</strong>
                  <span>Create a pocket</span>
                </button>
              </div>
              <div className="inline-note">
                <CalendarDays size={18} />
                <span>
                  Budgets renew each month. Editing a budget changes{" "}
                  {monthLabel(month)} only.
                </span>
              </div>
            </>
          )}
          {view === "insights" && (
            <div className="insights-view">
              <div className="insights-summary">
                <div>
                  <span className="eyebrow">THIS MONTH'S BIGGEST CATEGORY</span>
                  <h2>
                    {topPocket?.spent
                      ? topPocket.name
                      : "Your story starts here"}
                  </h2>
                  <p>
                    {topPocket?.spent
                      ? `${money(topPocket.spent)} spent, ${Math.round((topPocket.spent / Math.max(1, stats.expenses)) * 100)}% of your total expenses.`
                      : "Log an expense to see where your money goes."}
                  </p>
                </div>
                <TrendingUp size={46} />
              </div>
              <div className="insight-stats">
                <div>
                  <Target />
                  <span>Available within your plan</span>
                  <strong>{money(stats.available)}</strong>
                  <small>Capped by your recorded cash balance</small>
                </div>
                <div>
                  <Wallet />
                  <span>Income minus expenses</span>
                  <strong
                    className={
                      stats.income - stats.expenses < 0
                        ? "negative"
                        : "positive"
                    }
                  >
                    {money(stats.income - stats.expenses)}
                  </strong>
                  <small>
                    {stats.income
                      ? `${Math.round(((stats.income - stats.expenses) / stats.income) * 100)}% of this month's income`
                      : "No income recorded this month"}
                  </small>
                </div>
                <div>
                  <CalendarDays />
                  <span>Average daily spending</span>
                  <strong>
                    {money(
                      Math.round(
                        stats.expenses /
                          (month === today().slice(0, 7)
                            ? Number(today().slice(-2))
                            : new Date(
                                Number(month.slice(0, 4)),
                                Number(month.slice(5, 7)),
                                0,
                              ).getDate()),
                      ),
                    )}
                  </strong>
                  <small>
                    {month === today().slice(0, 7)
                      ? "Across the days so far"
                      : "Across the whole month"}
                  </small>
                </div>
              </div>
              <section className="charts-grid">
                <div className="chart-panel">
                  <div className="section-heading">
                    <h2>Your cash flow</h2>
                    <div className="chart-legend">
                      <span>
                        <i className="income-dot" />
                        Income
                      </span>
                      <span>
                        <i className="out-dot" />
                        Expenses
                      </span>
                    </div>
                  </div>
                  <FlowChart transactions={stats.transactions} month={month} />
                </div>
                <div className="chart-panel">
                  <h2>Spending breakdown</h2>
                  <SpendingRing
                    pockets={stats.pockets}
                    total={stats.expenses}
                  />
                </div>
              </section>
              <section className="budget-breakdown">
                <h2>Every pocket, at a glance</h2>
                <div className="breakdown-header">
                  <span>Pocket</span>
                  <span>Budget</span>
                  <span>Spent</span>
                  <span>Remaining</span>
                </div>
                {[...stats.pockets]
                  .sort((a, b) => b.spent - a.spent)
                  .map((p) => (
                    <button
                      className="breakdown-row"
                      key={p.id}
                      onClick={() => openPocket(p.id)}
                    >
                      <span>
                        <PocketIcon name={p.icon} color={p.color} />
                        <strong>{p.name}</strong>
                      </span>
                      <span>{money(p.limit)}</span>
                      <span>{money(p.spent)}</span>
                      <span
                        className={p.spent > p.limit ? "negative" : "positive"}
                      >
                        {money(p.limit - p.spent)}
                      </span>
                    </button>
                  ))}
              </section>
            </div>
          )}
          {view === "check" && (
            <Suspense fallback={<p className="loading-view">Loading monthly check...</p>}>
              {cloudImportEnabled && <div className="check-tabs" role="tablist" aria-label="Import mode"><button role="tab" aria-selected={checkTab === "catchup"} className={checkTab === "catchup" ? "selected" : ""} onClick={() => setCheckTab("catchup")}>Catch up</button><button role="tab" aria-selected={checkTab === "statement"} className={checkTab === "statement" ? "selected" : ""} onClick={() => setCheckTab("statement")}>Statement check</button><button role="tab" aria-selected={checkTab === "csv"} className={checkTab === "csv" ? "selected" : ""} onClick={() => setCheckTab("csv")}>CSV on device</button></div>}
              {cloudImportEnabled && (checkTab === "catchup" ? <CatchUp key={`catchup-${cloud?.signedIn ? cloud.user?.id : "local"}`} data={data} month={month} userId={cloud?.signedIn ? cloud.user?.id : undefined} commit={commit} busy={busy} notify={setToast} /> : checkTab === "statement" ? <CatchUp key={`statement-${cloud?.signedIn ? cloud.user?.id : "local"}`} statementMode data={data} month={month} userId={cloud?.signedIn ? cloud.user?.id : undefined} commit={commit} busy={busy} notify={setToast} /> : null)}
              {cloudImportEnabled ? <div hidden={checkTab !== "csv"}><CsvStatements cloudImportEnabled data={data} month={month} commit={commit} busy={busy} notify={setToast} /></div> : <Statements data={data} month={month} commit={commit} busy={busy} notify={setToast} />}
            </Suspense>
          )}
          {view === "plans" && <Suspense fallback={<p className="loading-view">Loading plans...</p>}><Plans data={data} month={month} busy={busy} commit={commit} notify={setToast} onNewPurchase={(cardId) => setEdit({ type: "transaction", cardId })} /></Suspense>}
          {view === "settings" && (
            <SettingsView
              data={data}
              commit={commit}
              busy={busy}
              notify={setToast}
              cloud={cloud}
              avatarUrl={avatarUrl}
              setCloud={setCloud}
              setData={setData}
              onSignedIn={async (state) => { setData(null); setCloud(state); await openWorkspace(state); }}
              syncNow={() => cloud?.dirty || (cloud?.sheetPending && cloud.revision === 0) ? queueSync(data, true) : attemptMirror(true)}
              themePreference={themePreference}
              onThemeChange={(preference) => { setThemePreference(preference); void saveTheme(preference).catch(() => setToast("Appearance could not be saved.")); }}
              onAdjustBalance={(account) => setEdit({ type: "balance_adjustment", account })}
            />
          )}
        </main>
      </div>
      {(view === "overview" || view === "transactions" || (view === "pockets" && selectedPocket)) && <button className="mobile-add-action" onClick={() => setEdit({ type: "transaction", pocketId: selectedPocket?.id })}><Plus size={20} /> Add transaction</button>}
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {mobileNavigation.map((n) => (
          <button
            key={n.id}
            className={(n.id === "more" ? moreViews.includes(view) : view === n.id) ? "active" : ""}
            aria-current={(n.id === "more" ? moreViews.includes(view) : view === n.id) ? "page" : undefined}
            onClick={() => go(n.id)}
          >
            <n.icon size={21} />
            <span>
              {n.label}
            </span>
          </button>
        ))}
      </nav>
      {edit?.type === "account_transfer" && <TransactionEditor data={data} transaction={edit.value} initialTransfer month={month} busy={busy} onClose={() => setEdit(null)} onSave={async () => {}} onDelete={async () => {}} onRepay={async () => {}} onTransfer={async (rows, oldTransferId) => {
        const kept = data.transactions.filter((t) => !oldTransferId || t.transferId !== oldTransferId);
        if (await commit({ ...data, transactions: [...kept, ...rows] }, oldTransferId ? "Transfer updated" : "Transfer recorded")) setEdit(null);
      }} onDeleteTransfer={async (transferId) => { if (await commit({ ...data, transactions: data.transactions.filter((t) => t.transferId !== transferId) }, "Transfer deleted")) setEdit(null); }} />}
      {edit?.type === "balance_adjustment" && <BalanceAdjustmentEditor
        key={edit.value?.id || edit.account}
        data={data}
        account={edit.account}
        transaction={edit.value}
        busy={busy}
        onClose={() => { if (!busy) setEdit(null); }}
        onSave={async (transaction) => {
          const transactions = edit.value
            ? data.transactions.map((item) => item.id === transaction.id ? transaction : item)
            : [...data.transactions, transaction];
          if (await commit({ ...data, transactions }, edit.value ? "Balance adjustment updated" : "Account balance adjusted")) setEdit(null);
        }}
        onDelete={async (id) => {
          if (await commit({ ...data, transactions: data.transactions.filter((item) => item.id !== id) }, "Balance adjustment removed")) setEdit(null);
        }}
      />}
      {edit?.type === "pocket_transfer" && <PocketTransferEditor data={data} month={month} busy={busy} onClose={() => setEdit(null)} onSave={async (move) => { if (await commit({ ...data, pocketTransfers: [...data.pocketTransfers, move] }, "Pocket budget moved")) setEdit(null); }} />}
      {edit?.type === "transaction" && (
        <TransactionEditor
          key={edit.value?.id || edit.favorite?.id || edit.cardId || edit.pocketId || "new"}
          data={data}
          transaction={edit.value}
          initialCardId={edit.cardId}
          initialPocketId={edit.pocketId}
          favorite={edit.favorite}
          month={month}
          busy={busy}
          onClose={() => {
            if (!busy) setEdit(null);
          }}
          onSave={async (t, rule, favorite) => {
            const recurring = rule === null
              ? data.recurring.map((r) => r.id === edit.value?.recurringRuleId ? { ...r, active: false } : r)
              : rule
                ? [...data.recurring.filter((r) => r.id !== rule.id), rule]
                : data.recurring;
            if (
              await commit(
                {
                  ...data,
                  transactions: edit.value
                    ? data.transactions.map((x) => (x.id === t.id ? t : x))
                    : [...data.transactions, t],
                  recurring,
                  favorites: favorite ? [...data.favorites, favorite] : data.favorites,
                },
                edit.value ? "Transaction updated" : "Transaction added",
              )
            )
              setEdit(null);
          }}
          onDelete={async (id) => {
            if (
              await commit(
                {
                  ...data,
                  transactions: data.transactions.filter((t) => t.id !== id && t.forTransactionId !== id),
                },
                "Transaction deleted",
              )
            )
              setEdit(null);
          }}
          onRepay={async (sourceId, amount, account, date) => {
            const source = data.transactions.find((t) => t.id === sourceId);
            const paid = data.transactions.filter((t) => t.forTransactionId === sourceId).reduce((n, t) => n + t.amount, 0);
            if (!source?.split || !validAmount(amount) || paid + amount > source.amount - source.split.ownAmount || date < source.date || date > today()) {
              setToast("Check the repayment amount and date.");
              return;
            }
            await commit({ ...data, transactions: [...data.transactions, {
              id: uid(), name: `Repaid: ${source.name}`, amount, type: "income", date,
              pocketId: "", account, note: "", kind: "reimbursement", forTransactionId: sourceId,
            }] }, "Repayment recorded");
          }}
          onTransfer={async (rows, oldTransferId) => {
            const kept = data.transactions.filter((t) => !oldTransferId || t.transferId !== oldTransferId);
            if (await commit({ ...data, transactions: [...kept, ...rows] }, oldTransferId ? "Transfer updated" : "Transfer recorded")) setEdit(null);
          }}
          onDeleteTransfer={async (transferId) => {
            if (await commit({ ...data, transactions: data.transactions.filter((t) => t.transferId !== transferId) }, "Transfer deleted")) setEdit(null);
          }}
        />
      )}
      {edit?.type === "pocket" && (
        <PocketEditor
          data={data}
          pocket={edit.value}
          month={month}
          busy={busy}
          onClose={() => {
            if (!busy) setEdit(null);
          }}
          onSave={async (p) => {
            if (
              await commit(
                {
                  ...data,
                  pockets: edit.value
                    ? data.pockets.map((x) => (x.id === p.id ? p : x))
                    : [...data.pockets, p],
                },
                edit.value ? "Pocket updated" : "Pocket created",
              )
            )
              setEdit(null);
          }}
          onDelete={async (id) => {
            if (
              await commit(
                { ...data, pockets: data.pockets.filter((p) => p.id !== id) },
                "Pocket deleted",
              )
            )
              setEdit(null);
          }}
        />
      )}
      {edit?.type === "pocket_delete" && <Modal title={`Delete ${edit.value.name}?`} subtitle="This pocket will be removed from future plans." onClose={() => setEdit(null)}>
        {pocketHasReferences(data, edit.value.id) ? <p className="editor-help">This pocket has transactions, recurring items, shortcuts, or budget moves. Move or remove them before deleting it.</p> : <p>Delete this pocket and its monthly budgets?</p>}
        <div className="form-footer"><button className="button secondary" onClick={() => setEdit(null)}>Cancel</button>{!pocketHasReferences(data, edit.value.id) && <button className="button danger" disabled={busy} onClick={() => void commit({ ...data, pockets: data.pockets.filter((p) => p.id !== edit.value.id) }, "Pocket deleted").then((saved) => { if (saved) setEdit(null); })}>Delete pocket</button>}</div>
      </Modal>}
      {edit?.type === "start" && (
        <StartProfile
          busy={busy}
          suggestedName={cloud?.user?.name}
          onClose={() => setEdit(null)}
          onStart={async (next) => {
            if (await commit(next, "Your own little fresh start.")) {
              setEdit(null);
              setMonth(today().slice(0, 7));
              go("pockets");
            }
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button aria-label="Dismiss message" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Transactions({
  data,
  month,
  onEdit,
  notify,
}: {
  data: Data;
  month: string;
  onEdit: (t: Transaction) => void;
  notify: (s: string) => void;
}) {
  const exportMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      const menu = exportMenu.current;
      if (!menu?.open || menu.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      menu.open = false;
    };
    document.addEventListener("click", closeOutside, true);
    return () => document.removeEventListener("click", closeOutside, true);
  }, []);
  const [query, setQuery] = useState(""),
    [type, setType] = useState("all"),
    [pocket, setPocket] = useState("all"),
    [account, setAccount] = useState("all");
  const rows = data.transactions
    .filter(
      (t) =>
        t.date.startsWith(month) &&
        (type === "all" || t.type === type) &&
        (pocket === "all" || t.pocketId === pocket) &&
        (account === "all" || t.account === account) &&
        `${t.name} ${t.note} ${t.account}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return (
    <>
      <div className="transaction-tools">
        <label className="search-field">
          <Search size={18} />
          <input
            placeholder="Search transactions..."
            aria-label="Search transactions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="segmented">
          {["all", "expense", "income"].map((t) => (
            <button
              key={t}
              className={type === t ? "selected" : ""}
              onClick={() => setType(t)}
            >
              {t === "all" ? "All" : t === "expense" ? "Money out" : "Money in"}
            </button>
          ))}
        </div>
        <details ref={exportMenu} className="export-menu" onKeyDown={(event) => { if (event.key === "Escape") { exportMenu.current?.removeAttribute("open"); event.stopPropagation(); } }}><summary className="button secondary"><Download size={16} /> Export CSV</summary><div>
          <button onClick={() => { exportMenu.current?.removeAttribute("open"); void download(`saku-${month}.csv`, exportCSV(rows, data.pockets), "text/csv").catch(() => notify("Export could not be saved.")); }}>Current results ({rows.length})</button>
          <button onClick={() => { exportMenu.current?.removeAttribute("open"); void download("saku-all-transactions.csv", exportCSV(data.transactions, data.pockets), "text/csv").catch(() => notify("Export could not be saved.")); }}>All history</button>
        </div></details>
      </div>
      <div className="transaction-filters">
        <div className="transaction-filter-heading">
          <span className="transaction-filter-icon" aria-hidden="true"><SlidersHorizontal size={17} /></span>
          <span><strong>Filters</strong><small>Narrow this month</small></span>
        </div>
        <ChoiceField className="transaction-filter-field" label="Pocket" value={pocket} onValueChange={setPocket} options={[{ value: "all", label: "All pockets" }, ...data.pockets.map((p) => ({ value: p.id, label: p.name }))]} />
        <ChoiceField className="transaction-filter-field" label="Account" value={account} onValueChange={setAccount} options={[{ value: "all", label: "All accounts" }, ...data.accounts.map((name) => ({ value: name, label: name, description: money(accountBalance(data, name)) })), ...data.creditCards.map((card) => ({ value: card.name, label: card.name, description: "Credit card" }))]} />
        <span className="transaction-count">{rows.length} transactions</span>
      </div>
      <div className="ledger">
        <div className="ledger-header">
          <span>TRANSACTION</span>
          <span>DATE</span>
          <span>AMOUNT</span>
        </div>
        <TransactionList
          transactions={rows}
          pockets={data.pockets}
          onEdit={onEdit}
          groupDates
        />
      </div>
      <div className="ledger-total">
        <span>Net change in this view</span>
        <strong>
          {money(
            rows.reduce(
              (n, t) => n + (t.type === "income" ? t.amount : -t.amount),
              0,
            ),
          )}
        </strong>
      </div>
    </>
  );
}

function BalanceAdjustmentEditor({
  data,
  account,
  transaction,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  data: Data;
  account: string;
  transaction?: Transaction;
  busy: boolean;
  onClose: () => void;
  onSave: (transaction: Transaction) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const currentBalance = accountBalance(data, account);
  const baseBalance = transaction
    ? accountBalance({ ...data, transactions: data.transactions.filter((item) => item.id !== transaction.id) }, account)
    : currentBalance;
  const [target, setTarget] = useState(String(Math.max(0, currentBalance)));
  const [date, setDate] = useState(transaction?.date || today());
  const [reason, setReason] = useState(transaction?.note || "");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const targetBalance = target === "" ? Number.NaN : Number(target);
  const validTarget = Number.isSafeInteger(targetBalance) && targetBalance >= 0 && targetBalance <= 1e12;
  const difference = validTarget ? targetBalance - baseBalance : 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try { await onSave(balanceAdjustment(data, account, targetBalance, date, reason, transaction)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not adjust this balance."); }
  }
  return <Modal
    title={`Adjust ${account} balance`}
    subtitle="Match the amount shown by your bank, wallet, or cash count. Saku keeps the difference in Activity."
    onClose={onClose}
  >
    <form onSubmit={(event) => void submit(event)} className="balance-adjustment-form">
      <fieldset disabled={busy}>
        <div className="balance-adjustment-overview" aria-label={`Recorded balance ${money(currentBalance)}. New balance ${validTarget ? money(targetBalance) : "not entered"}.`}>
          <div><span>Recorded now</span><strong>{money(currentBalance)}</strong></div>
          <ArrowRight size={20} aria-hidden="true" />
          <div><span>After adjustment</span><strong>{validTarget ? money(targetBalance) : "Not set"}</strong></div>
        </div>
        <label className="field">New balance<div className="amount-input"><span>Rp</span><MoneyInput autoFocus min="0" max="1000000000000" value={target} onValueChange={setTarget} placeholder="0" required aria-label={`New balance for ${account} in rupiah`} /></div></label>
        <div className={`balance-adjustment-effect ${difference < 0 ? "negative" : difference > 0 ? "positive" : ""}`}>
          <span>{difference > 0 ? "Saku will add" : difference < 0 ? "Saku will subtract" : "No adjustment needed"}</span>
          {difference !== 0 && <strong>{difference > 0 ? "+" : "−"}{money(Math.abs(difference))}</strong>}
        </div>
        <label className="field">Reason<textarea rows={2} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Matched the balance in my bank app" required /></label>
        <label className="field">Adjustment date<input type="date" value={date} max={today()} onChange={(event) => setDate(event.target.value)} required /></label>
        <p className="editor-help">This changes the recorded account balance without counting as spending or income.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {deleting && transaction ? <div className="delete-confirm"><p>Remove this balance adjustment? The account returns to the balance calculated without it.</p><button type="button" className="button danger" onClick={() => void onDelete(transaction.id)}>Remove adjustment</button><button type="button" className="button secondary" onClick={() => setDeleting(false)}>Keep it</button></div> : <div className="form-footer">
          {transaction && <IconButton label="Remove balance adjustment" onClick={() => setDeleting(true)}><Trash2 size={18} /></IconButton>}
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={!validTarget || !validAmount(Math.abs(difference)) || !reason.trim() || date > today()}>{busy ? "Saving..." : transaction ? "Save adjustment" : "Adjust balance"}<Check size={16} /></button>
        </div>}
      </fieldset>
    </form>
  </Modal>;
}

function TransactionEditor({
  data,
  transaction,
  initialTransfer,
  initialCardId,
  initialPocketId,
  favorite,
  month,
  busy,
  onClose,
  onSave,
  onDelete,
  onRepay,
  onTransfer,
  onDeleteTransfer,
}: {
  data: Data;
  transaction?: Transaction;
  initialTransfer?: boolean;
  initialCardId?: string;
  initialPocketId?: string;
  favorite?: Favorite;
  month: string;
  busy: boolean;
  onClose: () => void;
  onSave: (t: Transaction, rule?: RecurringRule | null, favorite?: Favorite) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRepay: (sourceId: string, amount: number, account: string, date: string) => Promise<void>;
  onTransfer: (rows: Transaction[], oldTransferId?: string) => Promise<void>;
  onDeleteTransfer: (transferId: string) => Promise<void>;
}) {
  const special = transaction?.kind === "card_payment" || transaction?.kind === "reimbursement";
  const transferPair = transaction?.transferId ? data.transactions.find((item) => item.transferId === transaction.transferId && item.id !== transaction.id) : undefined;
  const transferOutgoing = transaction?.type === "expense" ? transaction : transferPair?.type === "expense" ? transferPair : undefined;
  const transferIncoming = transaction?.type === "income" ? transaction : transferPair?.type === "income" ? transferPair : undefined;
  const [mode, setMode] = useState<"expense" | "income" | "transfer">(initialTransfer || transaction?.kind === "account_transfer" ? "transfer" : transaction?.type || favorite?.type || "expense"),
    [amount, setAmount] = useState(
      transaction ? String(transaction.amount) : favorite ? String(favorite.amount) : "",
    ),
    [name, setName] = useState(transaction?.name || favorite?.name || ""),
    [date, setDate] = useState(
      transaction?.date || today(),
    ),
    [pocket, setPocket] = useState(
      transaction?.pocketId || favorite?.pocketId || initialPocketId || data.pockets[0]?.id || "",
    ),
    [account, setAccount] = useState(transaction && transaction.kind !== "card_purchase" ? transaction.account : favorite && !favorite.cardId ? favorite.account : data.accounts[0]),
    [transferFrom, setTransferFrom] = useState(transferOutgoing?.account || data.accounts[0]),
    [transferTo, setTransferTo] = useState(transferIncoming?.account || data.accounts.find((item) => item !== data.accounts[0]) || data.accounts[0]),
    [cardId, setCardId] = useState(transaction?.kind === "card_purchase" ? transaction.cardId || "" : initialCardId || favorite?.cardId || ""),
    [installments, setInstallments] = useState(String(transaction?.installments || 1)),
    [firstDueMonth, setFirstDueMonth] = useState(transaction?.firstDueMonth || shiftMonth(transaction?.date.slice(0, 7) || today().slice(0, 7), 1)),
    [recurring, setRecurring] = useState(!!transaction?.recurringRuleId),
    [shared, setShared] = useState(!!transaction?.split),
    [people, setPeople] = useState(String(transaction?.split?.people || 4)),
    [ownAmount, setOwnAmount] = useState(transaction?.split ? String(transaction.split.ownAmount) : ""),
    [saveFavorite, setSaveFavorite] = useState(false),
    [repayAmount, setRepayAmount] = useState(""),
    [repayAccount, setRepayAccount] = useState(data.accounts[0]),
    [repayDate, setRepayDate] = useState(today()),
    [scanning, setScanning] = useState(false),
    [scanInfo, setScanInfo] = useState(""),
    [note, setNote] = useState(transaction?.note || ""),
    [error, setError] = useState(""),
    [moreOpen, setMoreOpen] = useState(Boolean(transaction?.note || transaction?.split || transaction?.recurringRuleId)),
    [deleting, setDeleting] = useState(false);
  const type = mode === "income" ? "income" : "expense";
  const transferBalance = accountBalance(
    transaction?.transferId ? { ...data, transactions: data.transactions.filter((item) => item.transferId !== transaction.transferId) } : data,
    transferFrom,
  );
  async function scanReceipt(file?: File) {
    if (!file) return;
    if (!nativeAIAvailable) { setError("Receipt scanning needs the Android app."); return; }
    if (!file.type.startsWith("image/") || file.size > 12_000_000) { setError("Choose an image smaller than 12 MB."); return; }
    setScanning(true); setError(""); setScanInfo("");
    try {
      const image = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not read this photo.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
      canvas.width = 0; canvas.height = 0;
      const suggestion = receiptSuggestion((await localStatementAI.recognizeImage({ image: base64 })).text);
      if (suggestion.amount) setAmount(String(suggestion.amount));
      if (suggestion.merchant && !name) setName(suggestion.merchant);
      setScanInfo(suggestion.amount ? "Amount suggested from receipt. Check it before saving." : "No clear total found. Enter the amount manually.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not scan receipt."); }
    finally { setScanning(false); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validAmount(Number(amount))) {
      setError("Enter a whole rupiah amount greater than zero.");
      return;
    }
    if (mode === "transfer") {
      if (data.accounts.length < 2 || transferFrom === transferTo || Number(amount) > transferBalance) {
        setError("Choose two different accounts and an amount available in the source account.");
        return;
      }
      const transferId = transaction?.transferId || uid();
      await onTransfer([
        { id: transferOutgoing?.id || uid(), transferId, kind: "account_transfer", name: `Transfer to ${transferTo}`, amount: Number(amount), type: "expense", date, pocketId: "", account: transferFrom, note: note.trim(), verified: false },
        { id: transferIncoming?.id || uid(), transferId, kind: "account_transfer", name: `Transfer from ${transferFrom}`, amount: Number(amount), type: "income", date, pocketId: "", account: transferTo, note: note.trim(), verified: false },
      ], transaction?.transferId);
      return;
    }
    const p = data.pockets.find((p) => p.id === pocket);
    if (type === "expense" && p && date.slice(0, 7) < p.createdMonth) {
      setError(
        `This pocket starts in ${monthLabel(p.createdMonth)}. Choose a later date.`,
      );
      return;
    }
    if (shared && (!Number.isInteger(Number(people)) || Number(people) < 2 || Number(people) > 30 || !validAmount(Number(ownAmount || Math.ceil(Number(amount) / Number(people)))) || Number(ownAmount || Math.ceil(Number(amount) / Number(people))) > Number(amount))) {
      setError("Check the number of people and your share."); return;
    }
    const card = data.creditCards.find((c) => c.id === cardId);
    if (cardId && !card) { setError("Choose a valid credit card."); return; }
    if (cardId && (!Number.isInteger(Number(installments)) || Number(installments) < 1 || Number(installments) > 60 || !/^\d{4}-\d{2}$/.test(firstDueMonth) || firstDueMonth < date.slice(0, 7))) {
      setError("Choose 1 to 60 payments and the first due month."); return;
    }
    const ruleId = recurring ? transaction?.recurringRuleId || uid() : undefined;
    const saved: Transaction = {
      id: transaction?.id || uid(),
      name: name.trim(),
      amount: Number(amount),
      type,
      date,
      pocketId: type === "income" || transaction?.kind === "card_payment" ? "" : pocket,
      account: type === "expense" && card && !special ? card.name : account,
      note: note.trim(),
      verified: false,
      ...(special ? { kind: transaction!.kind, cardId: transaction!.cardId, forTransactionId: transaction!.forTransactionId } : card && type === "expense" ? { kind: "card_purchase" as const, cardId: card.id, installments: Number(installments), firstDueMonth } : {}),
      ...(shared && !special && type === "expense" ? { split: { people: Number(people), ownAmount: Number(ownAmount || Math.ceil(Number(amount) / Number(people))) } } : {}),
      ...(ruleId ? { recurringRuleId: ruleId, occurrenceMonth: transaction?.occurrenceMonth } : {}),
    };
    const rule = recurring && !special ? {
      id: ruleId!, name: saved.name, amount: saved.amount, type: saved.type,
      pocketId: saved.pocketId, account: saved.account, cardId: saved.kind === "card_purchase" ? saved.cardId : undefined,
      installments: saved.kind === "card_purchase" ? saved.installments : undefined,
      day: Number(date.slice(-2)), startMonth: shiftMonth(date.slice(0, 7), 1), active: true,
    } satisfies RecurringRule : transaction?.recurringRuleId && !recurring ? null : undefined;
    const quick = saveFavorite && !special ? {
      id: uid(), name: saved.name, amount: saved.amount, type: saved.type, pocketId: saved.pocketId,
      account: saved.account, cardId: saved.kind === "card_purchase" ? saved.cardId : undefined,
    } satisfies Favorite : undefined;
    await onSave(saved, rule, quick);
  }
  const accountChoices = data.accounts.map((name) => ({ value: name, label: name, description: `Recorded balance ${money(accountBalance(data, name))}` }));
  const paymentChoices = [
    ...data.accounts.map((name) => ({ value: `bank:${name}`, label: name, description: `Account · ${money(accountBalance(data, name))}` })),
    ...data.creditCards.map((item) => ({ value: `card:${item.id}`, label: item.name, description: `Credit available ${money(Math.max(0, item.limit - cardBalance(data, item.id)))}` })),
  ];
  const pocketStats = summary(data, date.slice(0, 7)).pockets;
  const pocketChoices = [{ value: "", label: "Unassigned", description: "Categorize this later" }, ...pocketStats.map((item) => ({ value: item.id, label: item.name, description: `${money(Math.max(0, item.limit - item.spent))} remaining` }))];
  const modeControl = <div className="segmented form-segment transaction-modes">
    <button type="button" disabled={special || !!transaction?.split || transaction?.kind === "account_transfer"} className={mode === "expense" ? "selected" : ""} onClick={() => setMode("expense")}><ArrowUpRight size={16} />Expense</button>
    <button type="button" disabled={special || !!transaction?.split || transaction?.kind === "account_transfer"} className={mode === "income" ? "selected" : ""} onClick={() => setMode("income")}><ArrowDownLeft size={16} />Income</button>
    <button type="button" disabled={special || !!transaction?.split || (!!transaction && transaction.kind !== "account_transfer")} className={mode === "transfer" ? "selected" : ""} onClick={() => setMode("transfer")}><ArrowRight size={16} />Transfer</button>
  </div>;
  if (mode === "transfer") return <Modal title={transaction ? "Edit transfer" : "Add transaction"} subtitle="Move money between your accounts without changing income or spending." onClose={onClose}>
    <form onSubmit={(e) => void submit(e)}><fieldset disabled={busy}>{modeControl}
      {data.accounts.length < 2 && <p className="form-error" role="alert">Add another bank, cash account, or e-wallet before making a transfer.</p>}
      <label className="field">Amount<div className="amount-input"><span>Rp</span><MoneyInput autoFocus min="1" max="1000000000000" value={amount} onValueChange={setAmount} required /></div></label>
      <div className="form-columns"><label className="field">From<ChoiceField hideLabel label="Transfer from" value={transferFrom} onValueChange={setTransferFrom} options={accountChoices} /></label><label className="field">To<ChoiceField hideLabel label="Transfer to" value={transferTo} onValueChange={setTransferTo} options={accountChoices} /></label></div>
      <label className="field">Date<input type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} required /></label>
      <label className="field">Note <span className="optional">optional</span><textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer">{transaction?.transferId && <button type="button" className="button danger" onClick={() => void onDeleteTransfer(transaction.transferId!)}>Delete</button>}<button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={data.accounts.length < 2}>{busy ? "Saving..." : "Save transfer"}<Check size={16} /></button></div>
    </fieldset></form>
  </Modal>;
  return (
    <Modal
      title={transaction ? "Edit transaction" : "Add transaction"}
      subtitle={
        transaction
          ? "Keep the details just right."
          : "Every transaction tells part of your story."
      }
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)}>
        <fieldset disabled={busy}>
          {modeControl}
          <label className="field">
            Amount
            <div className="amount-input">
              <span>Rp</span>
              <MoneyInput
                autoFocus
                min="1"
                max="1000000000000"
                step="1"
                value={amount}
                onValueChange={setAmount}
                placeholder="0"
                required
                aria-label="Amount in rupiah"
              />
            </div>
          </label>
          {!transaction && nativeAIAvailable && <label className="button secondary receipt-capture"><Camera size={16} /> {scanning ? "Reading receipt..." : "Scan receipt"}<input type="file" accept="image/*" capture="environment" disabled={scanning || busy} hidden onChange={(e) => { void scanReceipt(e.target.files?.[0]); e.target.value = ""; }} /></label>}
          {scanInfo && <p className="editor-help" role="status">{scanInfo}</p>}
          <label className="field">
            {type === "income" ? "Where did it come from?" : "What was it for?"}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                type === "income"
                  ? "e.g. Monthly salary"
                  : "e.g. Coffee with a friend"
              }
              maxLength={100}
              pattern=".*\S.*"
              required
            />
          </label>
          {type === "expense" && !special && <label className="field">Paid with
            <ChoiceField hideLabel label="Paid with" value={cardId ? `card:${cardId}` : `bank:${account}`} options={paymentChoices} onValueChange={(value) => {
              if (value.startsWith("card:")) setCardId(value.slice(5));
              else { setCardId(""); setAccount(value.slice(5)); }
            }} />
          </label>}
          {type === "expense" && (
            transaction?.kind !== "card_payment" &&
            <label className="field">
              Pocket
              <ChoiceField hideLabel label="Pocket" value={pocket} onValueChange={setPocket} options={pocketChoices} />
              <small>{pocket ? "Counts against this pocket." : "You can categorize this later."}</small>
            </label>
          )}
          <div className="form-columns">
            <label className="field">
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                max={today()}
                required
              />
            </label>
            {(special || type === "income") && <label className="field">
              Account
              <ChoiceField hideLabel label="Account" value={account} onValueChange={setAccount} options={accountChoices} />
            </label>}
          </div>
          {cardId && type === "expense" && !special && <div className="form-columns">
            <label className="field">Payment plan
              <SegmentedChoice label="Payment plan" value={installments === "1" ? "one" : "installments"} onValueChange={(value) => setInstallments(value === "one" ? "1" : "3")} options={[{ value: "one", label: "One payment" }, { value: "installments", label: "Installments" }]} />
            </label>
            {installments !== "1" && <label className="field">Number of payments<input type="number" min={2} max={60} value={installments} onChange={(e) => setInstallments(e.target.value)} /></label>}
            <label className="field">First due month<input type="month" value={firstDueMonth} onChange={(e) => setFirstDueMonth(e.target.value)} /></label>
          </div>}
          <details className="editor-more" open={moreOpen || Boolean(error)} onToggle={(event) => setMoreOpen(event.currentTarget.open)}><summary>More details <span>Sharing, repeat, quick entry and note</span></summary>
          {type === "expense" && !special && <label className="checkbox-label editor-option"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Shared with others</label>}
          {shared && type === "expense" && !special && <div className="form-columns"><label className="field">People including you<input type="number" min={2} max={30} value={people} onChange={(e) => setPeople(e.target.value)} /></label><label className="field">Your share (Rp)<MoneyInput min={1} max={Number(amount) || undefined} placeholder={amount ? String(Math.ceil(Number(amount) / Number(people))) : ""} value={ownAmount} onValueChange={setOwnAmount} /></label><p className="editor-help">The full payment stays on your bank or card statement. Only your share uses your pocket budget.</p></div>}
          {!special && <label className="checkbox-label editor-option"><input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> Repeat monthly after I confirm it</label>}
          {!transaction && !special && <label className="checkbox-label editor-option"><input type="checkbox" checked={saveFavorite} onChange={(e) => setSaveFavorite(e.target.checked)} /> Save as a quick entry</label>}
          {transaction?.split && <div className="repayment-review"><strong>Shared payment</strong><p>Others owe {money(transaction.amount - transaction.split.ownAmount)}. Repaid {money(data.transactions.filter((t) => t.forTransactionId === transaction.id).reduce((n, t) => n + t.amount, 0))}.</p><div className="plans-fields"><label className="field">Repayment (Rp)<MoneyInput min={1} value={repayAmount} onValueChange={setRepayAmount} /></label><label className="field">Received in<ChoiceField hideLabel label="Repayment account" value={repayAccount} onValueChange={setRepayAccount} options={accountChoices} /></label><label className="field">Received on<input type="date" min={transaction.date} max={today()} value={repayDate} onChange={(e) => setRepayDate(e.target.value)} /></label></div><button type="button" className="button secondary" disabled={busy || !validAmount(Number(repayAmount))} onClick={() => void onRepay(transaction.id, Number(repayAmount), repayAccount, repayDate).then(() => setRepayAmount(""))}>Record repayment</button></div>}
          <label className="field">
            Note <span className="optional">optional</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="Anything to remember?"
            />
          </label>
          </details>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {deleting ? (
            <div className="delete-confirm">
              <p>
                Delete this transaction? Its amount will be removed from your
                totals.
              </p>
              <button
                type="button"
                className="button danger"
                onClick={() => void onDelete(transaction!.id)}
              >
                Delete transaction
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setDeleting(false)}
              >
                Keep it
              </button>
            </div>
          ) : (
            <div className="form-footer">
              {transaction && (
                <IconButton
                  label="Delete transaction"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={18} />
                </IconButton>
              )}
              <button
                type="button"
                className="button secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button className="button primary" type="submit">
                {busy
                  ? "Saving..."
                  : transaction
                    ? "Save changes"
                    : "Add transaction"}
                <Check size={16} />
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

function PocketEditor({
  data,
  pocket,
  month,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  data: Data;
  pocket?: Pocket;
  month: string;
  busy: boolean;
  onClose: () => void;
  onSave: (p: Pocket) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState(pocket?.name || ""),
    [budget, setBudget] = useState(
      pocket ? String(budgetFor(pocket, month)) : "",
    ),
    [color, setColor] = useState(pocket?.color || COLORS[0]),
    [icon, setIcon] = useState(pocket?.icon || ICONS[0]),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false);
  const used =
    !!pocket && pocketHasReferences(data, pocket.id);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      !Number.isSafeInteger(Number(budget)) ||
      Number(budget) < 0 ||
      Number(budget) > 1e12
    ) {
      setError("Enter a whole rupiah budget, zero or greater.");
      return;
    }
    if (
      data.pockets.some(
        (p) =>
          p.id !== pocket?.id &&
          p.name.toLowerCase() === name.trim().toLowerCase(),
      )
    ) {
      setError("A pocket with this name already exists.");
      return;
    }
    await onSave({
      id: pocket?.id || uid(),
      name: name.trim(),
      color,
      icon,
      budget: pocket?.budget ?? Number(budget),
      budgets: { ...pocket?.budgets, [month]: Number(budget) },
      createdMonth: pocket?.createdMonth || month,
    });
  }
  return (
    <Modal
      title={pocket ? "Make it your own" : "A pocket for your plans"}
      subtitle={`Monthly budget for ${monthLabel(month)}.`}
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)}>
        <fieldset disabled={busy}>
          <div className="pocket-preview">
            <PocketIcon name={icon} color={color} size={30} />
          </div>
          <label className="field">
            Pocket name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekend adventures"
              maxLength={40}
              required
              pattern=".*\S.*"
            />
          </label>
          <label className="field">
            {pocket ? "Budget for this month" : "Monthly budget"}
            <div className="amount-input">
              <span>Rp</span>
              <MoneyInput
                min="0"
                max="1000000000000"
                step="1"
                value={budget}
                onValueChange={setBudget}
                placeholder="100,000"
                required
                aria-label="Pocket budget in rupiah"
              />
            </div>
            {!pocket && (
              <small>
                This amount repeats as the default for future months.
              </small>
            )}
          </label>
          <span className="field-label">Color</span>
          <div className="color-swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                style={{ background: c }}
                aria-label={`Color ${c}`}
                aria-pressed={c === color}
                className={c === color ? "chosen" : ""}
                onClick={() => setColor(c)}
              >
                {c === color && <Check size={18} />}
              </button>
            ))}
          </div>
          <span className="field-label">Icon</span>
          <div className="icon-choices">
            {ICONS.map((i) => (
              <button
                key={i}
                type="button"
                title={i}
                aria-label={`${i} icon`}
                aria-pressed={icon === i}
                className={icon === i ? "chosen" : ""}
                onClick={() => setIcon(i)}
              >
                <PocketIcon name={i} color={color} />
              </button>
            ))}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {deleting ? (
            <div className="delete-confirm">
              <p>
                {used
                  ? "This pocket has transactions. Move or delete them before deleting the pocket."
                  : "Delete this empty pocket?"}
              </p>
              {!used && (
                <button
                  type="button"
                  className="button danger"
                  onClick={() => void onDelete(pocket!.id)}
                >
                  Delete pocket
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                onClick={() => setDeleting(false)}
              >
                Keep it
              </button>
            </div>
          ) : (
            <div className="form-footer">
              {pocket && (
                <IconButton
                  label="Delete pocket"
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={18} />
                </IconButton>
              )}
              <button
                className="button secondary"
                type="button"
                onClick={onClose}
              >
                Cancel
              </button>
              <button className="button primary" type="submit">
                {busy ? "Saving..." : pocket ? "Save changes" : "Create pocket"}
                <Check size={16} />
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

function PocketTransferEditor({ data, month, busy, onClose, onSave }: { data: Data; month: string; busy: boolean; onClose: () => void; onSave: (move: Data["pocketTransfers"][number]) => Promise<void> }) {
  const stats = summary(data, month), [from, setFrom] = useState(data.pockets[0]?.id || ""), [to, setTo] = useState(data.pockets[1]?.id || ""), [amount, setAmount] = useState(""), [error, setError] = useState("");
  const choices = stats.pockets.map((p) => ({ value: p.id, label: p.name, description: `${money(Math.max(0, p.limit - p.spent))} remaining` }));
  return <Modal title="Move pocket budget" subtitle={`Adjust ${monthLabel(month)} only. No cash moves.`} onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); const source = stats.pockets.find((p) => p.id === from), value = Number(amount); if (from === to || !source || !validAmount(value) || value > Math.max(0, source.limit - source.spent)) { setError("Choose two different pockets and an amount still available in the source pocket."); return; } void onSave({ id: uid(), fromPocketId: from, toPocketId: to, amount: value, month }); }}><fieldset disabled={busy}><label className="field">From<ChoiceField hideLabel label="Pocket to move from" value={from} onValueChange={setFrom} options={choices} /></label><label className="field">To<ChoiceField hideLabel label="Pocket to move to" value={to} onValueChange={setTo} options={choices} /></label><label className="field">Amount<div className="amount-input"><span>Rp</span><MoneyInput required value={amount} onValueChange={setAmount} /></div></label>{error && <p className="form-error">{error}</p>}<div className="form-footer"><button className="button primary">Move budget</button></div></fieldset></form></Modal>;
}

function LoginScreen({ configured, busy, error, onLogin }: { configured: boolean; busy: boolean; error: string; onLogin: () => Promise<void> }) {
  const [accepted, setAccepted] = useState(false);
  return <main className="login-screen">
    <section className="login-panel">
      <span className="brand-mark"><Wallet /></span><h1>Saku</h1>
      <p>Know where your money lives, what it is for, and what is safe to spend.</p>
      <details className="agreement"><summary>User agreement and privacy</summary><p>Saku stores your synchronized ledger in a private database and in a spreadsheet owned by your Google account. A protected device copy supports offline use. If you choose AI import, selected statement text and images are processed by Cloudflare AI. Original files and review drafts stay on this device. Read the <a href={legalUrl("terms")} target="_blank" rel="noreferrer">User Agreement</a> and <a href={legalUrl("privacy")} target="_blank" rel="noreferrer">Privacy Notice</a>.</p></details>
      <label className="checkbox-label"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />I accept the Saku User Agreement and Privacy Notice, version {AGREEMENT_VERSION}.</label>
      <button className="button primary login-button" disabled={!accepted || busy || !configured} onClick={() => void onLogin()}><CircleUserRound size={18} />{busy ? "Connecting..." : "Continue with Google"}</button>
      {!configured && <p className="form-error">Google sign-in is not configured in this build.</p>}{error && <p className="form-error" role="alert">{error}</p>}
    </section>
  </main>;
}
function WorkspaceChoice({ local, remote, onChoose, onBackup }: { local: Data; remote: Data; onChoose: (data: Data, localWins: boolean) => Promise<void>; onBackup: () => void }) {
  return <main className="login-screen"><section className="login-panel workspace-choice"><ShieldCheck size={30} /><h1>Choose this device's workspace</h1><p>This device has local Saku data. Choose whether to bring it into this Google account or use the cloud backup. Nothing is uploaded until you choose.</p>
    <button className="workspace-option" onClick={() => void onChoose(local, true)}><strong>Keep this phone</strong><span>{local.transactions.length} transactions · {local.pockets.length} pockets</span></button>
    <button className="workspace-option" onClick={() => void onChoose(remote, false)}><strong>{remote.transactions.length || remote.pockets.length ? "Restore cloud copy" : "Start without local data"}</strong><span>{remote.transactions.length} transactions · {remote.pockets.length} pockets</span></button>
    <button className="button secondary" onClick={onBackup}><Download size={17} />Export phone backup first</button>
  </section></main>;
}

function StartProfile({
  busy,
  suggestedName,
  onClose,
  onStart,
}: {
  busy: boolean;
  suggestedName?: string;
  onClose: () => void;
  onStart: (data: Data) => Promise<void>;
}) {
  const [name, setName] = useState(suggestedName?.trim().slice(0, 40) || "");
  const [accounts, setAccounts] = useState([{ name: "BCA", balance: "" }, { name: "Jago", balance: "" }]);
  const [pockets, setPockets] = useState([{ name: "Food & coffee", budget: "", icon: "utensils" }, { name: "Bills", budget: "", icon: "home" }, { name: "Fun", budget: "", icon: "game" }]);
  const [hasCard, setHasCard] = useState(false), [cardName, setCardName] = useState(""), [cardLimit, setCardLimit] = useState(""), [cardDebt, setCardDebt] = useState("0"), [dueDay, setDueDay] = useState("15");
  const [hasInstallment, setHasInstallment] = useState(false), [installmentName, setInstallmentName] = useState(""), [monthlyAmount, setMonthlyAmount] = useState(""), [nextDueMonth, setNextDueMonth] = useState(shiftMonth(today().slice(0, 7), 1)), [paymentsLeft, setPaymentsLeft] = useState("1");
  const [step, setStep] = useState(0), [stepError, setStepError] = useState("");
  function advance() {
    if (step === 0) {
      const chosen = accounts.map((item) => item.name.trim()).filter(Boolean);
      if (!name.trim() || !chosen.length || new Set(chosen.map((item) => item.toLowerCase())).size !== chosen.length) {
        setStepError("Enter your name and at least one account. Account names must be unique."); return;
      }
    }
    setStepError(""); setStep((value) => value + 1);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const chosenAccounts = accounts.map((item) => ({ ...item, name: item.name.trim() })).filter((item) => item.name);
    if (!chosenAccounts.length || new Set(chosenAccounts.map((item) => item.name.toLowerCase())).size !== chosenAccounts.length) return;
    const next = emptyData(); next.name = name.trim(); next.accounts = chosenAccounts.map((item) => item.name); next.pockets = pockets.filter((item) => item.name.trim()).map((item, index) => ({ id: uid(), name: item.name.trim(), budget: Number(item.budget || 0), budgets: {}, createdMonth: today().slice(0, 7), icon: item.icon, color: COLORS[index % COLORS.length] }));
    next.transactions = chosenAccounts.filter((item) => Number(item.balance) > 0).map((item) => ({ id: uid(), name: "Opening balance", amount: Number(item.balance), type: "income" as const, kind: "opening_balance" as const, date: today(), pocketId: "", account: item.name, note: "Opening balance when starting Saku" }));
    if (hasCard && cardName.trim() && validAmount(Number(cardLimit))) {
      const cardId = uid(); next.creditCards = [{ id: cardId, name: cardName.trim(), limit: Number(cardLimit), openingDebt: Number(cardDebt || 0), dueDay: Number(dueDay) }];
      if (hasInstallment && installmentName.trim() && validAmount(Number(monthlyAmount)) && Number(paymentsLeft) >= 1) next.existingInstallments = [{ id: uid(), cardId, name: installmentName.trim(), monthlyAmount: Number(monthlyAmount), nextDueMonth, paymentsLeft: Number(paymentsLeft) }];
    }
    void onStart(next);
  }
  return (
    <Modal title="Set up your Saku" subtitle="Keep only the accounts and pockets you actually use." onClose={onClose}>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="setup-progress" aria-label={`Setup step ${step + 1} of 3`}><span className={step === 0 ? "active" : ""}>1 Accounts</span><span className={step === 1 ? "active" : ""}>2 Pockets</span><span className={step === 2 ? "active" : ""}>3 Cards</span></div>
          {step === 0 && <><label className="field">Your name<input autoFocus required value={name} maxLength={40} pattern=".*\S.*" onChange={(e) => setName(e.target.value)} placeholder={suggestedName?.trim() || "What should we call you?"} /></label>
          <div className="setup-account-heading">
            <div><h3>Where your money lives</h3><p>Enter the balance shown in each bank or e-wallet today. Leave it at Rp0 if the account is empty.</p></div>
          </div>
          <div className="setup-account-list">{accounts.map((item, index) => {
            const balanceHelpId = `opening-balance-help-${index}`;
            return <section className="setup-account-card" key={index} aria-label={item.name ? `${item.name} account` : `Account ${index + 1}`}>
              <span className="setup-account-icon" aria-hidden="true"><Wallet size={18} /></span>
              <label className="field setup-account-name">Account name<input aria-label={`Account ${index + 1} name`} value={item.name} maxLength={50} onChange={(e) => setAccounts(accounts.map((x, i) => i === index ? { ...x, name: e.target.value } : x))} /></label>
              <label className="field setup-opening-balance">Opening balance<div className="amount-input"><span>Rp</span><MoneyInput aria-label={`${item.name || "Account"} opening balance`} aria-describedby={balanceHelpId} placeholder={index === 0 ? "2,450,000" : index === 1 ? "875,000" : "0"} value={item.balance} onValueChange={(balance) => setAccounts(accounts.map((x, i) => i === index ? { ...x, balance } : x))} /></div><small id={balanceHelpId}>{item.balance ? "This becomes your starting recorded balance." : "Example only. It is saved only after you enter an amount."}</small></label>
            </section>;
          })}</div>
          <button type="button" className="button secondary" onClick={() => setAccounts([...accounts, { name: "", balance: "" }])}><Plus size={16} />Add bank, cash, or e-wallet</button></>}
          {step === 1 && <>
          <h3>Your monthly pockets</h3>{pockets.map((item, index) => <div className="setup-row" key={index}><input aria-label={`Pocket ${index + 1} name`} value={item.name} maxLength={40} onChange={(e) => setPockets(pockets.map((x, i) => i === index ? { ...x, name: e.target.value } : x))} /><div className="amount-input"><span>Rp</span><MoneyInput aria-label={`${item.name || "Pocket"} monthly budget`} placeholder="Monthly budget" value={item.budget} onValueChange={(budget) => setPockets(pockets.map((x, i) => i === index ? { ...x, budget } : x))} /></div></div>)}
          <button type="button" className="button secondary" onClick={() => setPockets([...pockets, { name: "", budget: "", icon: "home" }])}><Plus size={16} />Add pocket</button></>}
          {step === 2 && <>
          <label className="checkbox-label editor-option"><input type="checkbox" checked={hasCard} onChange={(e) => setHasCard(e.target.checked)} />I use a credit card</label>
          {hasCard && <div className="setup-section"><label className="field">Card name<input required value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="e.g. BCA Visa" /></label><label className="field">Credit limit<div className="amount-input"><span>Rp</span><MoneyInput required value={cardLimit} onValueChange={setCardLimit} /></div></label><label className="field">Currently owed<div className="amount-input"><span>Rp</span><MoneyInput value={cardDebt} onValueChange={setCardDebt} /></div></label><label className="field">Payment day<input type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></label><label className="checkbox-label"><input type="checkbox" checked={hasInstallment} onChange={(e) => setHasInstallment(e.target.checked)} />I have an ongoing installment</label>{hasInstallment && <><label className="field">What is it?<input required value={installmentName} onChange={(e) => setInstallmentName(e.target.value)} /></label><label className="field">Payment each month<div className="amount-input"><span>Rp</span><MoneyInput required value={monthlyAmount} onValueChange={setMonthlyAmount} /></div></label><div className="form-columns"><label className="field">Next due month<input type="month" value={nextDueMonth} onChange={(e) => setNextDueMonth(e.target.value)} /></label><label className="field">Payments left<input type="number" min={1} max={60} value={paymentsLeft} onChange={(e) => setPaymentsLeft(e.target.value)} /></label></div></>}</div>}</>}
          {stepError && <p className="form-error" role="alert">{stepError}</p>}
          <p className="privacy-copy"><LockKeyhole size={17} />Nothing here is sample data. You can change every item later.</p>
          <div className="form-footer">{step > 0 && <button type="button" className="button secondary" onClick={() => { setStep(step - 1); setStepError(""); }}>Back</button>}{step < 2 ? <button type="button" className="button primary" onClick={advance}>Continue <ArrowRight size={17} /></button> : <button className="button primary" type="submit">{busy ? "Creating..." : "Start my tracker"}<ArrowRight size={17} /></button>}</div>
        </fieldset>
      </form>
    </Modal>
  );
}

function SettingsView({
  data,
  commit,
  busy,
  notify,
  cloud,
  avatarUrl,
  setCloud,
  setData,
  onSignedIn,
  syncNow,
  themePreference,
  onThemeChange,
  onAdjustBalance,
}: {
  data: Data;
  commit: (d: Data, m: string) => Promise<boolean>;
  busy: boolean;
  notify: (s: string) => void;
  cloud: CloudState | null;
  avatarUrl: string;
  setCloud: (state: CloudState | null) => void;
  setData: (data: Data) => void;
  onSignedIn: (state: CloudState) => Promise<void>;
  syncNow: () => Promise<void>;
  themePreference: ThemePreference;
  onThemeChange: (preference: ThemePreference) => void;
  onAdjustBalance: (account: string) => void;
}) {
  const [name, setName] = useState(data.name),
    [account, setAccount] = useState(""),
    [profileImage, setProfileImage] = useState<string | undefined>(),
    [restore, setRestore] = useState<Data | null>(null),
    [cloudBusy, setCloudBusy] = useState(false),
    [pullConfirm, setPullConfirm] = useState(false),
    [deleteConfirm, setDeleteConfirm] = useState(false),
    [deleteText, setDeleteText] = useState("");
  const profileFile = useRef<HTMLInputElement>(null);
  async function cloudAction(action: () => Promise<void>) {
    setCloudBusy(true);
    try { await action(); }
    catch (error) { notify(error instanceof Error ? error.message : "Cloud action failed."); }
    finally { setCloudBusy(false); }
  }
  async function backup() {
    try {
      await download(
        `saku-backup-${today()}.json`,
        JSON.stringify(data, null, 2),
        "application/json",
      );
    } catch {
      notify("Backup could not be saved.");
    }
  }
  async function readBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 20000000) throw new Error("Backup is too large.");
      setRestore(validateData(JSON.parse(await file.text())));
    } catch (e) {
      notify(e instanceof Error ? e.message : "Invalid backup.");
    }
  }
  async function readProfileImage(file?: File) {
    if (!file || !file.type.startsWith("image/") || file.size > 8_000_000) { notify("Choose an image smaller than 8 MB."); return; }
    const image = await createImageBitmap(file), canvas = document.createElement("canvas"), size = 512;
    canvas.width = size; canvas.height = size;
    const scale = Math.max(size / image.width, size / image.height), width = image.width * scale, height = image.height * scale;
    canvas.getContext("2d")?.drawImage(image, (size - width) / 2, (size - height) / 2, width, height); image.close();
    setProfileImage(canvas.toDataURL("image/webp", 0.82)); canvas.width = 0; canvas.height = 0;
  }
  return (
    <div className="settings-content">
      <section className="appearance-section">
        <h2>Appearance</h2>
        <p>Choose how Saku looks on this device and its widgets.</p>
        <div className="appearance-options" role="group" aria-label="Appearance">
          {(["system", "light", "dark"] as const).map((option) => <button key={option} type="button" aria-pressed={themePreference === option} className={themePreference === option ? "selected" : ""} onClick={() => onThemeChange(option)}>{option === "system" ? "System" : option === "light" ? "Light" : "Dark"}</button>)}
        </div>
      </section>
      <AppUpdateSettings />
      <section>
        <h2>Local profile</h2>
        <p>Your workspace on this device.</p>
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            void cloudAction(async () => {
              if (!(await commit({ ...data, name: name.trim() }, "Profile updated"))) return;
              if (cloud?.signedIn) setCloud(await updateProfile(name.trim(), profileImage));
              setProfileImage(undefined);
            });
          }}
        >
          <label className="field">
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={40}
              pattern=".*\S.*"
            />
          </label>
          <div className="profile-photo-field"><span>Profile photo <span className="optional">optional</span></span><button type="button" className="profile-photo-button" aria-label="Choose profile photo" onClick={() => profileFile.current?.click()}>{profileImage || avatarUrl ? <img src={profileImage || avatarUrl} alt="" /> : <span>{name.trim().slice(0, 1).toUpperCase() || "?"}</span>}<span className="profile-photo-edit"><Camera size={15} /></span></button><small>Tap the photo to choose one. Stored as a private compressed WebP image.</small><input ref={profileFile} type="file" accept="image/*" hidden onChange={(e) => { void readProfileImage(e.target.files?.[0]); e.target.value = ""; }} /></div>
          <button className="button primary" disabled={busy}>
            Save profile
          </button>
        </form>
      </section>
      <section>
        <h2>Your accounts</h2>
        <p>Keep cash, banks, and e-wallets in one place.</p>
        <div className="account-list">
          {data.accounts.map((a) => (
            <div className="account-row" key={a}>
              <button type="button" className="account-adjust-button" disabled={busy} onClick={() => onAdjustBalance(a)} aria-label={`Adjust ${a} balance, currently ${money(accountBalance(data, a))}`}>
                <span className="account-list-icon"><Wallet size={19} /></span>
                <span className="account-list-name"><strong>{a}</strong><small>Tap to adjust balance</small></span>
                <strong className="account-list-balance">{money(accountBalance(data, a))}</strong>
                <PencilLine size={16} aria-hidden="true" />
              </button>
              {!data.transactions.some((t) => t.account === a) &&
                data.accounts.length > 1 && (
                  <IconButton
                    label={`Delete account ${a}`}
                    disabled={busy}
                    onClick={() =>
                      void commit(
                        {
                          ...data,
                          accounts: data.accounts.filter((x) => x !== a),
                        },
                        "Account removed",
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </IconButton>
                )}
            </div>
          ))}
        </div>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            const a = account.trim();
            if (!a) return;
            if (
              data.accounts.some((x) => x.toLowerCase() === a.toLowerCase())
            ) {
              notify("This account already exists.");
              return;
            }
            void commit(
              { ...data, accounts: [...data.accounts, a] },
              "Account added",
            ).then((ok) => {
              if (ok) setAccount("");
            });
          }}
        >
          <input
            aria-label="New account name"
            placeholder="New account name"
            maxLength={50}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            required
          />
          <button className="button secondary" disabled={busy}>
            <Plus size={16} />
            Add account
          </button>
        </form>
      </section>
      <section className="cloud-section">
        <div className="cloud-heading">
          <span className="connection-icon"><ShieldCheck size={24} /></span>
          <div>
            <h2>Google backup</h2>
            <p>Keep a private backup in Saku Cloud and, with your permission, a readable copy in your own Google Drive.</p>
          </div>
        </div>
        {!cloud?.signedIn ? (
          <div className="cloud-signed-out">
            <p>Signing in also creates your Saku account. Saku never receives or stores your Google password.</p>
            <button className="button primary" disabled={cloudBusy || !cloud?.configured} onClick={() => void cloudAction(async () => {
              const next = await signInGoogle();
              await onSignedIn(next);
              setName(next.user?.name || name);
              notify("Google account connected");
            })}>
              <CircleUserRound size={18} />
              {cloudBusy ? "Connecting..." : "Continue with Google"}
            </button>
            {!cloud?.configured && <small className="cloud-note">Google sign-in is available in a production-configured Android build.</small>}
          </div>
        ) : (
          <div className="cloud-account">
            <div className="cloud-user">
              <CircleUserRound size={21} />
              <span><strong>{cloud.user?.name}</strong><small>{cloud.user?.email}</small></span>
              <span className={`sync-state ${cloud.dirty || cloud.sheetPending ? "pending" : ""}`}>{cloud.dirty ? "Changes waiting" : cloud.sheetPending ? "Sheet pending" : "Up to date"}</span>
            </div>
            <div className="settings-actions">
              {(cloud.dirty || cloud.sheetPending) && <button className="button primary" disabled={cloudBusy} onClick={() => void cloudAction(syncNow)}><Upload size={17} />Retry sync</button>}
              {cloud.sheetPending && <button className="button secondary" disabled={cloudBusy} onClick={() => void cloudAction(async () => { setCloud(await connectGoogleDrive()); notify("Google Drive connected"); })}><ExternalLink size={17} />{cloud.spreadsheetUrl ? "Reconnect Google Drive" : "Connect Google Drive"}</button>}
              <button className="button secondary" disabled={cloudBusy} onClick={() => setPullConfirm(true)}><Download size={17} />Restore cloud copy</button>
              {cloud.spreadsheetUrl && <a className="button secondary" href={cloud.spreadsheetUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} />Open Sheet</a>}
              <button className="button text-button" disabled={cloudBusy} onClick={() => void cloudAction(async () => {
                await signOutGoogle();
                setCloud(await loadCloudState());
                notify("Signed out on this device");
              })}><LogOut size={16} />Sign out</button>
            </div>
            <small className="cloud-note">Changes sync automatically, including widget entries while Saku is closed. {cloud.lastSyncedAt ? `Last synced ${new Date(cloud.lastSyncedAt).toLocaleString()}` : "Not backed up yet."}</small>
            {cloud.sheetPending && <p className="inline-warning">Your cloud snapshot is saved, but Google Sheets mirroring is still pending.</p>}
            <SignedInDevices notify={notify} onSignedOutHere={async (id) => {
              // Revoking this session first would strand any changes still waiting to sync.
              if (cloud.dirty) await syncNow();
              const latest = await loadCloudState();
              if (!latest.signedIn || latest.user?.id !== cloud.user?.id || latest.dirty) throw new Error("Sync your changes before signing out this device.");
              await signOutDevice(id);
              await signOutGoogle();
              setCloud(await loadCloudState());
            }} />
          </div>
        )}
      </section>
      <section>
        <h2>Your data stays with you</h2>
        <p>
          Keep a backup before switching devices or uninstalling Saku. Backups
          contain your transaction details.
        </p>
        <div className="settings-actions">
          <button className="button secondary" onClick={() => void backup()}>
            <Download size={17} />
            Back up data
          </button>
          <label className="button secondary">
            <Upload size={17} />
            Restore backup
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                void readBackup(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="legal-links"><a href={legalUrl("privacy")} target="_blank" rel="noreferrer">Privacy Notice</a><span>·</span><a href={legalUrl("terms")} target="_blank" rel="noreferrer">User Agreement</a><span>·</span><a href={legalUrl("account-deletion")} target="_blank" rel="noreferrer">Account deletion</a></p>
        {cloud?.signedIn && <div className="danger-zone"><div><strong>Delete Saku account</strong><p>Permanently remove Saku Cloud data and this phone's local workspace, revoke access, and ask Drive to trash the Saku-created folder.</p></div><button className="button danger-button" disabled={cloudBusy} onClick={() => setDeleteConfirm(true)}><Trash2 size={16} />Delete account</button></div>}
      </section>
      <section className="connection-section">
        <span className="connection-icon"><CheckCheck size={25} /></span>
        <div><h2>Offline first</h2><p>{cloudImportEnabled ? "Your ledger works without internet. AI import sends selected statement text or images to Cloudflare for processing. Original files and review drafts stay on this device; accepted transactions follow your existing cloud and Sheet sync." : nativeAIAvailable ? "Your ledger works without internet. CSV and PDF statement checking stay on this device while cloud catch-up is being tested." : "Your ledger works without internet. CSV checking stays on this device; PDF checking is available in the Android app while cloud catch-up is being tested."}</p></div>
      </section>
      <footer className="settings-footer">
        Saku {appVersion} <span>·</span> Made for a more mindful month.
      </footer>
      {restore && (
        <Modal
          title="Restore this backup?"
          subtitle="Your current workspace will be replaced. Export a backup first if you want to keep it."
          onClose={() => setRestore(null)}
        >
          <div className="restore-summary">
            <strong>{restore.name}'s workspace</strong>
            <p>
              {restore.transactions.length} transactions ·{" "}
              {restore.pockets.length} pockets
            </p>
          </div>
          <div className="form-footer">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRestore(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void commit(restore, "Backup restored").then((ok) => {
                  if (ok) {
                    setName(restore.name);
                    setRestore(null);
                  }
                })
              }
            >
              Restore backup
            </button>
          </div>
        </Modal>
      )}
      {pullConfirm && (
        <Modal title="Restore the cloud copy?" subtitle="This replaces the workspace on this device. Back it up first if you need to keep local-only changes." onClose={() => setPullConfirm(false)}>
          <div className="form-footer">
            <button className="button secondary" disabled={cloudBusy} onClick={() => setPullConfirm(false)}>Cancel</button>
            <button className="button primary" disabled={cloudBusy} onClick={() => void cloudAction(async () => {
              const result = await pullCloud();
              if (!result.data) { notify("There is no cloud backup yet."); setPullConfirm(false); return; }
              await replaceData(result.data);
              setCloud(await adoptCloudSnapshot(result.state, true));
              setData(result.data);
              setName(result.data.name);
              setPullConfirm(false);
              notify("Cloud backup restored");
            })}>Restore cloud copy</button>
          </div>
        </Modal>
      )}
      {deleteConfirm && (
        <Modal title="Delete your Saku account?" subtitle="This permanently deletes your Saku Cloud data and local workspace. Export a backup first if you need one." onClose={() => { setDeleteConfirm(false); setDeleteText(""); }}>
          <label className="field">Type DELETE to confirm<input autoCapitalize="characters" autoComplete="off" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} /></label>
          <div className="form-footer">
            <button className="button secondary" disabled={cloudBusy} onClick={() => { setDeleteConfirm(false); setDeleteText(""); }}>Cancel</button>
            <button className="button danger-button" disabled={cloudBusy || deleteText !== "DELETE"} onClick={() => void cloudAction(async () => {
              const userId = cloud?.user?.id;
              if (!userId) return;
              const deletion = await deleteCloudAccount();
              await removeUserData(userId);
              setData(emptyData());
              setCloud(await loadCloudState());
              setDeleteConfirm(false);
              setDeleteText("");
              notify(deletion.driveCleanupFailed ? "Saku account deleted. Remove its Sheet from Google Drive manually." : "Saku account deleted");
            })}><Trash2 size={16} />Delete permanently</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function SignedInDevices({ notify, onSignedOutHere }: { notify: (message: string) => void; onSignedOutHere: (id: string) => Promise<void> }) {
  const [devices, setDevices] = useState<SignedInDevice[] | null>(null), [busy, setBusy] = useState("");
  const load = () => listDevices().then(setDevices).catch(() => setDevices([]));
  useEffect(() => { void load(); }, []);
  async function signOut(device: SignedInDevice) {
    setBusy(device.id);
    try {
      if (device.current) { await onSignedOutHere(device.id); return; }
      await signOutDevice(device.id);
      notify(`${device.label} signed out`);
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "That device could not be signed out. Try again."); }
    finally { setBusy(""); }
  }
  if (!devices?.length) return null;
  return <div className="signed-in-devices">
    <strong>Signed-in devices</strong>
    <ul>{devices.map((device) => <li key={device.id}><span><b>{device.label}{device.current ? " · this device" : ""}</b><small>Last active {new Date(device.lastActiveAt).toLocaleString()}</small></span><button className="button text-button" disabled={!!busy} onClick={() => void signOut(device)}><LogOut size={15} />{busy === device.id ? "Signing out..." : "Sign out"}</button></li>)}</ul>
  </div>;
}
