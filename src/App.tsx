import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
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
  Info,
  LockKeyhole,
  LogOut,
  Menu,
  PencilLine,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
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
  accountIsReferenced,
  averageDailySpending,
  balanceAdjustment,
  budgetFor,
  cardBalance,
  catchUpGap,
  dayLabel,
  dueRules,
  emptyData,
  extendPocketsToTransactions,
  groupDigits,
  isIncome,
  isSpending,
  personalAmount,
  receiptSuggestion,
  reassignAndDeletePocket,
  money,
  monthLabel,
  shiftDate,
  lastPocketFor,
  shiftMonth,
  setPocketBudgetFromMonth,
  summary,
  today,
  daysAgo,
  uid,
  validAmount,
  validDate,
  validateData,
  type Data,
  type Favorite,
  type Pocket,
  type RecurringRule,
  type Transaction,
  pocketHasReferences,
  applyPocketPlan,
  rollbackPocketPlan,
  newestFirst,
  timeOfDay,
} from "./domain";
import { learnMerchant, suggestMerchant } from "./merchants";
import { listImportDrafts } from "./importDraft";
import { notificationCapture, notificationCaptureSupported } from "./notificationCapture";
import NotificationAccess from "./NotificationAccess";
import { importRowsWaiting } from "./importTransactions";
import { AccountEditor, AccountsOverview, accountColor } from "./AccountsOverview";
import { applyRecentsPrivacy, appLockStatus, appLockSupported, authenticate, defaultAppLock, loadAppLock, saveAppLock, shouldLock, type AppLockSettings, type LockAfter } from "./appLock";
import { LocalNotifications } from "@capacitor/local-notifications";
import { defaultReminder, loadReminder, remindersSupported, requestReminderPermission, saveReminder, syncReminders, type ReminderSettings } from "./reminders";
import { MIN_PASSWORD_LENGTH, decryptBackup, encryptBackup, isEncryptedBackup, type EncryptedBackup } from "./backupCrypto";
import { download, hasUserData, loadData, loadLegacyData, removeUserData, replaceData, saveData } from "./storage";
import {
  DirectionIcon,
  Empty,
  FlowChart,
  FitMoney,
  IconButton,
  MoneyInput,
  LongDateInput,
  ChoiceField,
  Modal,
  PocketCard,
  PocketIcon,
  SpendingRing,
  SakuMark,
  SegmentedChoice,
  TransactionList,
  SettingsCard,
} from "./components";
const Onboarding = lazy(() => import("./Onboarding"));
const PocketPlanner = lazy(() => import("./PocketPlanner"));
const CsvStatements = lazy(() => import("./CsvStatements"));
const CatchUp = lazy(() => import("./CatchUp"));
const Plans = lazy(() => import("./Plans"));
const CatchUpDays = lazy(() => import("./CatchUpDays"));
const NotificationReview = lazy(() => import("./NotificationReview"));
const learnsMerchant = (t: Transaction) => t.type === "expense" && (!t.kind || t.kind === "card_purchase");
function SheetMessage({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  useLayoutEffect(() => {
    const open = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
    setDialog(open[open.length - 1] || null);
  });
  return dialog ? createPortal(children, dialog) : children;
}
import { localStatementAI, nativeAIAvailable } from "./localStatementAI";
import { homeWidgetRevision } from "./homeWidget";
import { loadTheme, saveTheme, type ThemePreference } from "./appearance";
import { loadLanguage, localeTag, prepareLanguage, saveLanguage, setActiveLanguage, t, t as translate, type LanguagePreference } from "./i18n";
import { backDestination, moreViews, popSheet, pushSheet, type View } from "./navigation";
import { AppUpdateSettings, useAppUpdate } from "./appUpdate";
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
  mergeWithSyncBase,
  mirrorCloud,
  pullCloud,
  pushCloud,
  signInGoogle,
  signOutGoogle,
  listDevices,
  signOutDevice,
  type SignedInDevice,
  updateProfile,
  acceptAgreement,
  type CloudState,
} from "./cloud";

type Edit =
  | { type: "transaction"; value?: Transaction; cardId?: string; favorite?: Favorite; pocketId?: string; account?: string; date?: string; initialMode?: "expense" | "income" }
  | { type: "balance_adjustment"; account: string; value?: Transaction }
  | { type: "pocket"; value?: Pocket; focusBudget?: boolean }
  | { type: "pocket_delete"; value: Pocket }
  | { type: "account_transfer"; value?: Transaction; account?: string }
  | { type: "pocket_transfer"; toPocketId?: string; amount?: number }
  | { type: "cash_shortfall" }
  | { type: "start" }
  | { type: "plan" }
  | null;
const catchUpDismissedKey = "saku-catch-up-dismissed-v1";
const navigation = [
  { id: "overview", label: "Home", icon: LayoutDashboard },
  { id: "transactions", label: "Activity", icon: ArrowDownLeft },
  { id: "pockets", label: "Pockets", icon: Wallet },
  { id: "plans", label: "Plans", icon: CreditCard },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "check", label: "Catch up", icon: FileCheck2 },
] as const;
const navigationKeys = { overview: "home", transactions: "activity", pockets: "pockets", plans: "plans", insights: "insights", check: "catchUp", more: "more" } as const;
const mobileNavigation = [
  navigation[0], navigation[1], navigation[5], navigation[2],
  { id: "more", label: "More", icon: Menu },
] as const;
export default function App() {
  const [data, setData] = useState<Data | null>(null),
    [loadError, setLoadError] = useState(""),
    [view, setView] = useState<View>("overview"),
    [month, setMonth] = useState(today().slice(0, 7)),
    [checkTab, setCheckTab] = useState<"catchup" | "notifications" | "statement" | "csv">("catchup"),
    [editStack, setEditStack] = useState<Exclude<Edit, null>[]>([]),
    [toast, setToast] = useState<string | { message: string; action: { label: string; run: () => void }; secondaryAction?: { label: string; run: () => void } }>(""),
    [busy, setBusy] = useState(false),
    [cloud, setCloud] = useState<CloudState | null>(null),
    [loginBusy, setLoginBusy] = useState(false),
    [resolution, setResolution] = useState<{ local: Data; remote: Data; remoteState?: CloudState } | null>(null),
    [avatarUrl, setAvatarUrl] = useState(""),
    [catchUpSheet, setCatchUpSheet] = useState<{ days: string[]; index: number } | null>(null),
    [reminder, setReminder] = useState<ReminderSettings>(defaultReminder),
    [reminderTap, setReminderTap] = useState<{ kind: "catchup" | "card" } | null>(null),
    [catchUpDismissed, setCatchUpDismissed] = useState(() => { try { return localStorage.getItem(catchUpDismissedKey) || ""; } catch { return ""; } }),
    [importWaiting, setImportWaiting] = useState(0), [draftsWaiting, setDraftsWaiting] = useState(0),
    [waitingRecount, setWaitingRecount] = useState(0),
    // Native builds start covered until the lock setting is read, so no amount can flash before authentication.
    [lockState, setLockState] = useState<"checking" | "covered" | "locked" | "open">(appLockSupported() ? "checking" : "open"),
    [appLock, setAppLock] = useState<AppLockSettings>(defaultAppLock);
  const appLockRef = useRef(defaultAppLock);
  const hiddenAt = useRef<number | null>(null);
  const authenticating = useRef(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>("system");
  const [showAvailabilityInfo, setShowAvailabilityInfo] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [plansTab, setPlansTab] = useState<"cards" | "bills">("cards");
  setActiveLanguage(languagePreference);
  const [viewHistory, setViewHistory] = useState<View[]>([]);
  const [selectedPocketId, setSelectedPocketId] = useState<string | null>(null);
  const [pocketReturnView, setPocketReturnView] = useState<View>("pockets");
  const [pocketAllHistory, setPocketAllHistory] = useState(false);
  const saving = useRef(false);
  const edit = editStack.at(-1) ?? null;
  const setEdit = (next: Edit) => setEditStack((stack) => next ? pushSheet(stack, next) : popSheet(stack));
  const widgetRevision = useRef(0);
  const pendingSync = useRef<Data | null>(null);
  const activeSync = useRef<Data | null>(null);
  const syncRunning = useRef(false);
  const mirrorRunning = useRef(false);
  const latest = useRef({ data, cloud, edit, resolution });
  latest.current = { data, cloud, edit, resolution };
  const reconcileRef = useRef<((afterFailedSync?: boolean) => Promise<void>) | null>(null);
  const selectedPocket = data?.pockets.find((p) => p.id === selectedPocketId);
  useEffect(() => {
    if (!remindersSupported()) return;
    void loadReminder().then(setReminder).catch(() => {});
    // A tap that cold-starts Saku is delivered once the listener attaches; it waits for the ledger below.
    const listener = LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => setReminderTap({ kind: notification.extra?.kind === "card" ? "card" : "catchup" }));
    return () => { void listener.then((handle) => handle.remove()); };
  }, []);
  useEffect(() => {
    if (!remindersSupported() || !data) return;
    void syncReminders(data, reminder).catch(() => {});
  }, [data, reminder]);
  useEffect(() => {
    if (!reminderTap || !data) return;
    setReminderTap(null);
    setSelectedPocketId(null);
    setViewHistory([]);
    if (reminderTap.kind === "card") { setView("plans"); return; }
    setView("overview");
    const days = catchUpGap(data, today());
    if (days.length) setCatchUpSheet({ days, index: 0 }); else setEdit({ type: "transaction" });
  }, [reminderTap, data]);
  function openPocket(id: string) { setPocketReturnView(view); go("pockets"); setSelectedPocketId(id); setPocketAllHistory(false); }
  function closePocket() { if (pocketReturnView === "pockets") setSelectedPocketId(null); else backView(); }
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
      } catch (error) {
        // The message stays generic for the user; the cause is kept for diagnosis.
        console.error("Saku could not open the workspace", error);
        setLoadError(t("sakuCouldNotOpenYour"));
      }
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
      if (!useful(local)) throw new Error(t("couldNotReachSakuCloud"));
      // A saved local ledger remains available offline.
    }
    const localNeedsReview = scoped && (remoteState?.dirty ?? state.dirty);
    if (localNeedsReview && local && remote && remoteState && await mergeCloudChanges(local, remote, remoteState, false)) return;
    const newerCleanCloud = scoped && remoteState && !remoteState.dirty && remoteState.revision > state.revision && useful(remote);
    if ((useful(local) || localNeedsReview) && !newerCleanCloud && (!scoped || !remote || !useful(remote) || JSON.stringify(local) !== JSON.stringify(remote))) {
      setResolution({ local: local!, remote: remote || emptyData(), remoteState });
      return;
    }
    const chosen = newerCleanCloud ? remote! : useful(local) || localNeedsReview ? local! : useful(remote) ? remote! : emptyData();
    await replaceData(chosen);
    if (remoteState && !remoteState.dirty && remote && JSON.stringify(chosen) === JSON.stringify(remote)) setCloud(await adoptCloudSnapshot(remoteState, false, chosen));
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
    // After a failed sync, only an outside signal (a notice, reconnecting) retries it.
    const reconcile = async (afterFailedSync = false) => {
      signal++;
      needed = true;
      if (running || !visible() || stopped) return;
      const current = latest.current;
      if (current.edit || current.resolution || saving.current || syncRunning.current || !current.data || current.cloud?.user?.id !== userId) return;
      const startedWith = signal;
      running = true;
      try {
        const { revision, state } = await refreshCloudMetadata();
        if (stopped || latest.current.cloud?.user?.id !== userId) return;
        setCloud(state);
        // Unsynced edits go through the sync queue, which merges on a 409 and retries.
        if (state.dirty) { if (latest.current.data && !afterFailedSync) void queueSync(latest.current.data); }
        else if (revision > state.revision) {
          const before = latest.current.data;
          const result = await pullCloud();
          if (stopped || latest.current.data !== before || latest.current.edit || saving.current) return;
          if (result.state.dirty) {
            if (result.data) void queueSync(before!);
          } else if (result.data) {
            await replaceData(result.data);
            const adopted = await adoptCloudSnapshot(result.state, false, result.data);
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
    void loadLanguage().then(async (preference) => { await prepareLanguage(preference); setLanguagePreference(preference); }).catch(() => {});
  }, []);
  async function unlock() {
    if (authenticating.current) return;
    authenticating.current = true;
    const unlocked = await authenticate(t("unlockSaku"));
    authenticating.current = false;
    hiddenAt.current = null;
    setLockState(unlocked ? "open" : "locked");
  }
  async function changeAppLock(next: AppLockSettings, confirm: boolean) {
    if (confirm) {
      authenticating.current = true;
      const confirmed = await authenticate(next.enabled ? t("turnOnAppLock") : t("turnOffAppLock"));
      authenticating.current = false;
      if (!confirmed) return false;
    }
    await saveAppLock(next);
    appLockRef.current = next;
    setAppLock(next);
    return true;
  }
  useEffect(() => {
    if (!appLockSupported()) return;
    void loadAppLock().then(async (settings) => {
      appLockRef.current = settings;
      setAppLock(settings);
      await applyRecentsPrivacy(settings).catch(() => {});
      if (settings.enabled) { setLockState("locked"); void unlock(); } else setLockState("open");
    }).catch(() => setLockState("open"));
    const listener = NativeApp.addListener("appStateChange", ({ isActive }) => {
      // The device-credential screen pauses Saku too; that pause is part of unlocking, not leaving.
      if (authenticating.current || !appLockRef.current.enabled) return;
      if (!isActive) { hiddenAt.current = Date.now(); setLockState((state) => state === "open" ? "covered" : state); return; }
      if (shouldLock(appLockRef.current, hiddenAt.current, Date.now())) { setLockState("locked"); void unlock(); }
      else { hiddenAt.current = null; setLockState((state) => state === "covered" ? "open" : state); }
    });
    return () => { void listener.then((handle) => handle.remove()); };
  }, []);
  useEffect(() => {
    // Recount after leaving Catch up or saving, so the badge reflects rows still waiting in local drafts.
    if (!data) { setImportWaiting(0); return; }
    let live = true;
    void Promise.all([
      cloud?.signedIn && cloud.user?.id ? listImportDrafts(cloud.user.id).then((drafts) => importRowsWaiting(drafts, data)).catch(() => 0) : 0,
      notificationCaptureSupported() ? notificationCapture.inbox().then((inbox) => inbox.items.length).catch(() => 0) : 0,
    ]).then(([drafts, inbox]) => { if (live) { setImportWaiting(drafts + inbox); setDraftsWaiting(drafts); } });
    return () => { live = false; };
  }, [data, view, cloud?.signedIn, cloud?.user?.id, waitingRecount]);
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
        // The same path as Escape: every Modal closes itself on "cancel".
        dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
        return;
      }
      // Full-page flows (setup) step back themselves instead of closing.
      const stepper = document.querySelector("[data-back-step]");
      if (stepper) { stepper.dispatchEvent(new Event("saku-back")); return; }
      if (edit) setEdit(null);
      else if (editingAccount) setEditingAccount("");
      else if (catchUpSheet) setCatchUpSheet(null);
      else if (selectedAccount) setSelectedAccount("");
      else if (accountsOpen) setAccountsOpen(false);
      else if (selectedPocketId) closePocket();
      else {
        if (backDestination(view, viewHistory)) backView();
        else NativeApp.minimizeApp();
      }
    });
    return () => {
      void listener.then((h) => h.remove());
    };
  }, [edit, view, viewHistory, editingAccount, catchUpSheet, selectedAccount, accountsOpen, selectedPocketId, pocketReturnView]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const openQuickAdd = (url?: string) => {
      if (url?.startsWith("saku://quick-add")) { setViewHistory([]); setView("overview"); setEdit({ type: "transaction" }); }
      if (url?.startsWith("saku://review")) { setViewHistory([]); setView("check"); setCheckTab("notifications"); }
    };
    void NativeApp.getLaunchUrl().then((result) => openQuickAdd(result?.url));
    const listener = NativeApp.addListener("appUrlOpen", (event) => openQuickAdd(event.url));
    return () => { void listener.then((h) => h.remove()); };
  }, []);
  async function commit(next: Data, message: string) {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    try {
      next = extendPocketsToTransactions(next);
      await saveData(next);
      setData(next);
      setCloud((value) => value?.signedIn ? { ...value, dirty: true } : value);
      void queueSync(next);
      if (message) setToast(message);
      return true;
    } catch (e) {
      setToast(
        e instanceof Error
          ? t("couldNotSaveDetail", { detail: e.message })
          : t("saveFailedTryAgain"),
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
    let merges = 0, failed = false;
    try {
      while (pendingSync.current) {
        const snapshot: Data = pendingSync.current;
        pendingSync.current = null;
        activeSync.current = snapshot;
        await markCloudDirty();
        try { setCloud(await pushCloud(snapshot)); }
        catch (error) {
          // Another device uploaded first: merge row by row, then upload the result.
          if ((error as { status?: number }).status !== 409 || merges++ >= 3) throw error;
          let remote: Awaited<ReturnType<typeof pullCloud>>;
          try { remote = await pullCloud(); }
          catch (download) {
            // The ledger changed while downloading; retry with the newest copy.
            if (!latest.current.data || latest.current.data === snapshot) throw download;
            pendingSync.current ||= latest.current.data;
            activeSync.current = null;
            continue;
          }
          const merged: Data | null = remote.data && await mergeCloudChanges(snapshot, remote.data, remote.state);
          if (merged) pendingSync.current ||= merged;
          else if (latest.current.data !== snapshot && latest.current.data) pendingSync.current ||= latest.current.data;
          else {
            if (remote.data) setResolution({ local: snapshot, remote: remote.data, remoteState: remote.state });
            throw error;
          }
        }
        activeSync.current = null;
      }
      if (userInitiated) setToast(t("cloudSavedUpdating"));
    } catch (error: unknown) {
      failed = true;
      pendingSync.current = null;
      activeSync.current = null;
      setCloud((value) => value?.signedIn ? { ...value, dirty: true } : value);
      const status = typeof error === "object" && error && "status" in error ? (error as { status?: number }).status : undefined;
      const message = status === 409 ? t("syncConflict") : t("savedOffline");
      // Keep an Undo toast actionable; repeated failures must not repeat the same notice.
      setToast((current) => typeof current === "string" ? message : current.message.includes(message) ? current : { ...current, message: `${current.message} · ${message}` });
    } finally {
      syncRunning.current = false;
      void reconcileRef.current?.(failed);
    }
  }
  /** Saves the three-way merge of local and cloud edits; null when the user must choose. */
  async function mergeCloudChanges(local: Data, remote: Data, remoteState: CloudState, requireCurrent = true) {
    if (saving.current || (requireCurrent && latest.current.data !== local)) return null;
    const merged = await mergeWithSyncBase(local, remote, remoteState);
    if (!merged.data || saving.current || (requireCurrent && latest.current.data !== local)) return null;
    saving.current = true;
    try {
      await saveData(merged.data);
      setCloud(await resolveCloudWithLocal(remoteState, remote));
      setData(merged.data);
      latest.current = { ...latest.current, data: merged.data };
      return merged.data;
    } finally { saving.current = false; }
  }
  async function attemptMirror(userInitiated = false) {
    if (mirrorRunning.current || !cloud?.signedIn || !cloud.sheetPending || !cloud.spreadsheetUrl) return;
    mirrorRunning.current = true;
    try {
      const next = await mirrorCloud();
      setCloud((current) => current?.user?.id === next.user?.id ? next : current);
      if (userInitiated) setToast(next.sheetPending ? t("sheetSavedPending") : t("sheetUpdated"));
    } catch (error) {
      if (userInitiated) setToast(error instanceof Error ? error.message : t("sheetFailed"));
    } finally { mirrorRunning.current = false; }
  }
  async function recover(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 20000000) throw new Error(t("backupTooLarge"));
      let parsed = JSON.parse(await file.text());
      if (isEncryptedBackup(parsed)) {
        const password = window.prompt(t("backupPasswordPrompt")) || "";
        if (!password) return;
        parsed = JSON.parse(await decryptBackup(parsed, password));
      }
      const next = validateData(parsed);
      if (await commit(next, t("backupRestored"))) setLoadError("");
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : t("restoreFailed"),
      );
    }
  }
  if (lockState !== "open")
    return (
      <div className="loading app-lock">
        <span className="brand-mark"><LockKeyhole /></span>
        <h1>Saku</h1>
        {lockState === "locked" && <><p>{t("sakuLocked")}</p><button className="button primary" onClick={() => void unlock()}>{t("unlock")}</button></>}
      </div>
    );
  if (cloud && !cloud.signedIn)
    return <LoginScreen configured={cloud.configured} busy={loginBusy} error={loadError} onLogin={async () => {
      setLoginBusy(true); setLoadError("");
      try { const next = await signInGoogle(); setCloud(next); await openWorkspace(next); }
      catch (error) { setLoadError(error instanceof Error ? error.message : t("signInFailed")); }
      finally { setLoginBusy(false); }
    }} />;
  if (cloud?.signedIn && typeof cloud.user?.agreementVersion === "string" && cloud.user.agreementVersion !== AGREEMENT_VERSION)
    return <AgreementUpdate busy={loginBusy} error={loadError} onAccept={async () => {
      setLoginBusy(true); setLoadError("");
      try { setCloud(await acceptAgreement()); }
      catch (error) { setLoadError(error instanceof Error ? error.message : t("agreementSaveFailed")); }
      finally { setLoginBusy(false); }
    }} onSignOut={async () => { await signOutGoogle(); setCloud(await loadCloudState()); }} />;
  if (resolution)
    return <WorkspaceChoice local={resolution.local} remote={resolution.remote} onChoose={async (chosen, localWins) => {
      if (localWins) { await saveData(chosen); if (resolution.remoteState) setCloud(await resolveCloudWithLocal(resolution.remoteState)); else setCloud((value) => value ? { ...value, dirty: true } : value); setData(chosen); void queueSync(chosen); } else { await replaceData(chosen); if (resolution.remoteState) setCloud(await adoptCloudSnapshot(resolution.remoteState, true, chosen)); } setData(chosen); setResolution(null); if (!chosen.transactions.length && !chosen.pockets.length && !chosen.accounts.length) setEdit({ type: "start" });
    }} onBackup={() => void download(`saku-local-backup-${today()}.json`, JSON.stringify(resolution.local, null, 2), "application/json")} />;
  if (!data)
    return (
      <div className="loading">
        <span className="brand-mark">
          <SakuMark />
        </span>
        <h1>Saku</h1>
        {loadError ? (
          <>
            <p role="alert">{loadError}</p>
            <button
              className="button primary"
              onClick={() => location.reload()}
            >
              {t("retry")}
            </button>
            <label className="button secondary">
              {t("restoreBackup")}
              <input
                type="file"
                accept=".json"
                hidden
                onChange={(e) => void recover(e.target.files?.[0])}
              />
            </label>
          </>
        ) : (
          <p>{t("gettingReady")}</p>
        )}
      </div>
    );
  const stats = summary(data, month),
    sorted = newestFirst(stats.transactions);
  const topPocket = [...stats.pockets].sort((a, b) => b.spent - a.spent)[0];
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekTransactions = data.transactions.filter((t) => isSpending(t) && new Date(`${t.date}T12:00:00`) >= weekStart && t.date <= today());
  const weekSpend = weekTransactions.reduce((n, t) => n + personalAmount(t), 0);
  const weekTop = data.pockets.map((p) => ({ name: p.name, amount: weekTransactions.filter((t) => t.pocketId === p.id).reduce((n, t) => n + personalAmount(t), 0) })).sort((a, b) => b.amount - a.amount)[0];
  const dueBills = dueRules(data).filter(({ rule }) => rule.type === "expense");
  const catchUpDays = catchUpDismissed === today() ? [] : catchUpGap(data, today());
  const catchUpAnchorChecked = catchUpDays.length > 0 && data.checkedDays.includes(shiftDate(catchUpDays[0], -1)) && !data.transactions.some((t) => t.date === shiftDate(catchUpDays[0], -1) && t.kind !== "opening_balance");
  const showCatchUp = catchUpDays.length > 0 && data.transactions.some((t) => t.date <= shiftDate(today(), -2));
  function dismissCatchUp() { setCatchUpDismissed(today()); try { localStorage.setItem(catchUpDismissedKey, today()); } catch { /* Dismissal is a convenience only. */ } }
  const titles: Record<View, [string, string]> = {
    overview: [t("homeIntro"), t("home")],
    transactions: [t("activityIntro"), t("activity")],
    pockets: [t("pocketsIntro"), t("pockets")],
    plans: [t("plansIntro"), t("plans")],
    more: [t("moreIntro"), t("more")],
    insights: [t("insightsIntro"), t("insights")],
    check: [t("catchUpIntro"), t("catchUp")],
    settings: [t("settingsIntro"), t("settings")],
  };
  const go = (v: View) => {
    if (v !== view) setViewHistory((history) => [...history.slice(-11), view]);
    // Opening Catch up lands on what is actually waiting: captured notifications, unless a screenshot draft is open.
    if (v === "check" && view !== "check" && importWaiting > draftsWaiting && !draftsWaiting) setCheckTab("notifications");
    setSelectedPocketId(null);
    setSelectedAccount("");
    setAccountsOpen(false);
    setView(v);
    window.scrollTo({ top: 0 });
  };
  function backView() {
    const destination = backDestination(view, viewHistory);
    if (!destination) return;
    setViewHistory((history) => popSheet(history));
    setSelectedPocketId(null);
    setSelectedAccount("");
    setAccountsOpen(false);
    setView(destination);
    window.scrollTo({ top: 0 });
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{t("skipToContent")}</a>
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
            <SakuMark size={25} />
          </span>
          <span>
            saku<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace-label">{t("personalWorkspace")}</div>
        <nav className="side-nav" aria-label={t("mainNavigation")}>
          {navigation.map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "active" : ""}
              onClick={() => go(n.id)}
            >
              <n.icon size={20} />
              {t(navigationKeys[n.id])}
              {n.id === "check" && importWaiting > 0 && <span className="nav-badge" aria-label={`${importWaiting} waiting`}>{importWaiting > 99 ? "99+" : importWaiting}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={22} />
            <div>
              <strong>{t("justYours")}</strong>
              <span>{cloud?.signedIn ? t("privateBackup") : t("storedOnDevice")}</span>
            </div>
            <span className="status-dot" />
          </div>
          <button
            className={`settings-link ${view === "settings" ? "active" : ""}`}
            onClick={() => go("settings")}
          >
            <Settings size={19} /> {t("settings")}
          </button>
          <button className="profile" onClick={() => go("settings")}>
            <span className="avatar">
              {avatarUrl ? <img src={avatarUrl} alt="" /> : (cloud?.user?.name || data.name).slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>
                {t("workspaceOf", { name: data.name })}
              </strong>
              <small>
                {cloud?.signedIn ? cloud.user?.email : t("localProfile")}
              </small>
            </span>
            <ChevronRight size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            {t("myWorkspace")} <ChevronRight size={13} />
            <span>
              {navigation.find((n) => n.id === view) ? t(navigationKeys[view as keyof typeof navigationKeys]) : t("settings")}
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
              {cloud?.signedIn ? cloud.dirty ? t("notSynced") : cloud.revision === 0 ? t("notBackedUp") : t("synced") : t("onDevice")}
            </span>
            <button
              className="top-avatar"
              onClick={() => go("settings")}
              title={t("yourProfile")}
            >
              {avatarUrl ? <img src={avatarUrl} alt="" /> : (cloud?.user?.name || data.name).slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {selectedAccount ? <AccountActivity data={data} account={selectedAccount} month={month} onMonthChange={setMonth} onBack={() => setSelectedAccount("")} onRename={() => setEditingAccount(selectedAccount)} onAdd={() => setEdit({ type: "transaction", account: selectedAccount })} onTransfer={() => setEdit({ type: "account_transfer", account: selectedAccount })} onAdjust={() => setEdit({ type: "balance_adjustment", account: selectedAccount })} onEdit={openTransaction} /> : <>
          <section className="page-heading">
            <div>
              {moreViews.includes(view) && view !== "more" && <button className="back-to-more" onClick={backView}><ChevronLeft size={17} /> {t(viewHistory.at(-1) === "more" ? "more" : viewHistory.at(-1) === "overview" ? "home" : viewHistory.at(-1) === "pockets" ? "pockets" : "more")}</button>}
              {selectedPocket && view === "pockets" && <button className="back-to-more" onClick={closePocket}><ChevronLeft size={17} /> {t(pocketReturnView === "pockets" ? "allPockets" : pocketReturnView === "insights" ? "insights" : "home")}</button>}
              <p>{selectedPocket && view === "pockets" ? t("pocketActivity") : titles[view][0]}</p>
              <h1>{selectedPocket && view === "pockets" ? selectedPocket.name : titles[view][1]}{selectedPocket && view === "pockets" && <button type="button" className="pocket-heading-edit" aria-label={t("editPocket")} onClick={() => setEdit({ type: "pocket", value: selectedPocket })}><PencilLine size={17} /></button>}</h1>
            </div>
            <div className="heading-actions">
              {!["settings", "more", "check", "plans"].includes(view) && (
                <div className="month-picker">
                  <IconButton
                    label={t("previousMonth")}
                    onClick={() => setMonth(shiftMonth(month, -1))}
                  >
                    <ChevronLeft size={16} />
                  </IconButton>
                  <label>
                    <CalendarDays size={16} />
                    <span>{monthLabel(month, true)}</span>
                    <input
                      aria-label={t("selectedMonth")}
                      type="month"
                      value={month}
                      onChange={(e) => {
                        if (/^\d{4}-\d{2}$/.test(e.target.value))
                          setMonth(e.target.value);
                      }}
                    />
                  </label>
                  <IconButton
                    label={t("nextMonth")}
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
                  <span>{t("addTransaction")}</span>
                </button>
              )}
              {view === "pockets" && !selectedPocket && (
                <button
                  className="button primary"
                  onClick={() => setEdit({ type: "pocket" })}
                >
                  <Plus size={18} />
                  {t("addPocket")}
                </button>
              )}
              {view === "pockets" && selectedPocket && <button className="button primary pocket-desktop-add" onClick={() => setEdit({ type: "transaction", pocketId: selectedPocket.id })}><Plus size={18} /> {t("addTransaction")}</button>}
            </div>
          </section>
          {view === "more" && <section className="more-list" aria-label={t("moreDestinations")}>
            <button onClick={() => go("insights")}><BarChart3 /><span><strong>{t("insights")}</strong><small>{t("cashFlowTrends")}</small></span><ChevronRight /></button>
            <button onClick={() => go("plans")}><CreditCard /><span><strong>{t("plans")}</strong><small>{t("plansIntro")}</small></span><ChevronRight /></button>
            <button onClick={() => go("settings")}><Settings /><span><strong>{t("settings")}</strong><small>{t("settingsIntro")}</small></span><ChevronRight /></button>
          </section>}
          {view === "overview" && (
            <>
              {showCatchUp && <section className="catch-up-card" aria-label={t("catchUpDays")}><CalendarDays size={20} /><div><strong>{catchUpDays.length === 14 ? t("lastEntryOld") : `${catchUpAnchorChecked ? t("checkedUpTo") : t("lastEntry")} ${dayLabel(shiftDate(catchUpDays[0], -1))}`} · {t(catchUpDays.length === 1 ? "oneDayToCatchUp" : "daysToCatchUp", { count: catchUpDays.length })}</strong><div className="catch-up-actions"><button className="button primary" onClick={() => setCatchUpSheet({ days: catchUpDays, index: 0 })}>{t("fillByDay")}</button><button className="button secondary" onClick={() => { go("check"); setCheckTab("catchup"); }}>{t("importScreenshot")}</button></div></div><button className="icon-button catch-up-dismiss" aria-label={t("hideTomorrow")} title={t("hideTomorrow")} onClick={dismissCatchUp}><X size={18} /></button></section>}
              <section className="summary-grid">
                <div className="balance-panel balance-action" role="button" tabIndex={0} aria-label={t("openMoneyByAccount")} onClick={() => setAccountsOpen(true)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setAccountsOpen(true); } }}>
                  <div className="balance-top">
                    <span>
                      <Wallet size={17} />
                      {t("cash")}
                    </span>
                    <span className="balance-badge">IDR</span>
                  </div>
                  <div className="balance-number"><FitMoney amount={stats.balance} /></div>
                  <p>
                    {t("acrossAccounts", { count: data.accounts.length })}
                  </p>
                  <div className="balance-footer">
                    <span>
                      <span className="tiny-square" />
                      {t("freeToSpend")}
                      <button type="button" className="availability-info-button" aria-label={t("availabilityInfo")} aria-expanded={showAvailabilityInfo} onClick={(event) => { event.stopPropagation(); setShowAvailabilityInfo((value) => !value); }}><Info size={15} /></button>
                    </span>
                    <strong>{money(stats.available)}</strong>
                  </div>
                  {showAvailabilityInfo && <p className="availability-explainer">{t("availabilityExplainer")}</p>}
                  <button type="button" className="balance-cta" onClick={(event) => { event.stopPropagation(); go("insights"); }}>{t("viewInsights")} <ArrowRight size={16} /></button>
                </div>
                <div className="metric-panel">
                  <div className="metric-label">
                    <DirectionIcon income />
                    {t("moneyIn")}
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
                    {t("incomeTransactions")}
                  </p>
                  <div className="mini-bars income-mini">
                    {Array.from({ length: 5 }, (_, week) => {
                      const amount = stats.transactions
                        .filter(t => isIncome(t) && Math.floor((Number(t.date.slice(-2)) - 1) / 7) === week)
                        .reduce((total, t) => total + t.amount, 0);
                      return <i key={week} title={t("weekAmount", { week: week + 1, amount: money(amount) })} style={{ height: `${stats.income ? amount / stats.income * 100 : 0}%` }} />;
                    })}
                  </div>
                </div>
                <div className="metric-panel">
                  <div className="metric-label">
                    <DirectionIcon income={false} />
                    {t("moneyOut")}
                    <span className="metric-arrow">
                      <ArrowUpRight size={16} />
                    </span>
                  </div>
                  <strong><FitMoney amount={stats.expenses} /></strong>
                  <p>
                    <span className="expense-dot" />
                    {stats.budget
                      ? `${Math.round((stats.expenses / stats.budget) * 100)}% ${t("ofBudget")}`
                      : t("noBudget")}
                  </p>
                  <div className="budget-meter">
                    <i
                      style={{
                        width: `${Math.min(100, stats.budget ? (stats.expenses / stats.budget) * 100 : 0)}%`,
                      }}
                    />
                  </div>
                  <small>{money(stats.budget)} {t("planned")}</small>
                </div>
              </section>
              <section className="account-balance-strip" aria-label={t("accountBalances")}>{stats.accounts.map((item) => <button type="button" className="account-balance-item" key={item.account} aria-label={t("accountCardLabel", { account: item.account, amount: money(item.balance) })} onClick={() => setSelectedAccount(item.account)}><span className="account-balance-icon" style={{ color: accountColor(data, item.account) }}><Wallet size={16} /></span><span><small>{item.account}</small><strong>{money(item.balance)}</strong></span></button>)}</section>
              {accountsOpen && !selectedAccount && <AccountsOverview data={data} monthTransactions={stats.transactions} onClose={() => setAccountsOpen(false)} onEdit={(account) => setSelectedAccount(account)} />}
              {!!dueBills.length && <section className="due-list home-due-bills"><div className="section-heading"><h2>{t("billsToRecord")}</h2><button className="text-button" type="button" onClick={() => { setPlansTab("bills"); go("plans"); }}>{t("viewBills")} <ArrowRight size={16} /></button></div>{dueBills.slice(0, 3).map(({ rule, date }) => <button type="button" className="due-row" key={`${rule.id}:${date}`} onClick={() => { setPlansTab("bills"); go("plans"); }}><CalendarDays size={17} /><span><strong>{rule.name}</strong><small>{t("dueOn", { date })}</small></span><strong>{money(rule.amount)}</strong><ArrowRight size={16} /></button>)}</section>}
              <section className="daily-strip" aria-label={t("quickEntriesLabel")}>
                <div className="daily-check"><span>{t("currentWeek")}</span><strong>{money(weekSpend)} {t("spent")}</strong><small>{weekTop?.amount ? t("largestPocket", { name: weekTop.name }) : t("noSpending")}</small></div>
<div className="quick-entries"><div className="section-heading"><h2>{t("quickAdd")}</h2><button className="text-button" onClick={() => setEdit({ type: "transaction" })}><Plus size={16} /> {t("new")}</button></div><div className="quick-entry-list">{data.favorites.map((f) => <div className="quick-entry" key={f.id}><button onClick={() => setEdit({ type: "transaction", favorite: f })}><Plus size={16} /><span>{f.name}</span><strong>{money(f.amount)}</strong></button><button className="quick-remove" title={t("removeShortcut", { name: f.name })} aria-label={t("removeShortcut", { name: f.name })} onClick={() => void commit({ ...data, favorites: data.favorites.filter((x) => x.id !== f.id) }, "").then((ok) => { if (ok) setToast({ message: t("quickEntryRemoved"), action: { label: t("undo"), run: () => { const current = latest.current.data; if (current && !current.favorites.some((item) => item.id === f.id)) { const index = data.favorites.indexOf(f); void commit({ ...current, favorites: [...current.favorites.slice(0, index), f, ...current.favorites.slice(index)] }, t("quickEntryRestored")); } } } }); })}><X size={14} /></button></div>)}{!data.favorites.length && <span className="quick-empty">{t("quickEmpty")}</span>}</div></div>
              </section>
              <section className="pockets-section">
                <div className="section-heading">
                  <div>
                    <h2>
                      {t("pocketsHeading")}{" "}
                      <span>{stats.pockets.length}</span>
                    </h2>
                  </div>
                  <button className="text-button" onClick={() => { setSelectedPocketId(null); go("pockets"); }}>
                    {t("allPockets")} <ArrowRight size={16} />
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
                        onCover={() => setEdit(data.pockets.length > 1 ? { type: "pocket_transfer", toPocketId: p.id, amount: p.spent - p.limit } : { type: "pocket", value: p, focusBudget: true })}
                      />
                    ))}
                  </div>
                ) : (
                  <Empty
                    title={t("purposeTitle")}
                    detail={t("purposeDetail")}
                    action={t("createPocket")}
                    onClick={() => setEdit({ type: "pocket" })}
                  />
                )}
              </section>
              <section className="charts-grid home-charts">
                <div className="chart-panel">
                  <div className="section-heading">
                    <h2>{t("inOut")}</h2>
                    <div className="chart-legend">
                      <span>
                        <i className="income-dot" />
                        {t("income")}
                      </span>
                      <span>
                        <i className="out-dot" />
                        {t("expenses")}
                      </span>
                    </div>
                  </div>
                  <FlowChart transactions={stats.transactions} month={month} />
                  <div className="chart-footnote">
                    {t("weeklyCashFlow")} <span>·</span> {monthLabel(month)}
                  </div>
                </div>
                <div className="chart-panel spending-panel">
                  <div className="section-heading">
                    <h2>{t("whereWent")}</h2>
                    <button
                      className="icon-button"
                      title={t("seeInsights")}
                      aria-label={t("seeInsights")}
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
                    <h2>{t("latestThings")}</h2>
                    <p>{t("recentThisMonth")}</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => go("transactions")}
                  >
                    {t("viewAll")} <ArrowRight size={16} />
                  </button>
                </div>
                <TransactionList
                  transactions={sorted.slice(0, 5)}
                  pockets={data.pockets}
                  onEdit={openTransaction}
                  compactView
                />
              </section>
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
            <div className="pocket-activity-summary"><button type="button" onClick={() => setEdit({ type: "pocket", value: selectedPocket, focusBudget: true })}><span>{t("budget")}</span><strong>{money(stats.pockets.find((p) => p.id === selectedPocket.id)?.limit || 0)}</strong></button><div><span>{t("spent2")}</span><strong>{money(stats.pockets.find((p) => p.id === selectedPocket.id)?.spent || 0)}</strong></div><div><span>{(stats.pockets.find((p) => p.id === selectedPocket.id)?.limit || 0) < (stats.pockets.find((p) => p.id === selectedPocket.id)?.spent || 0) ? t("overBudget") : t("left")}</span><strong>{money(Math.abs((stats.pockets.find((p) => p.id === selectedPocket.id)?.limit || 0) - (stats.pockets.find((p) => p.id === selectedPocket.id)?.spent || 0)))}</strong></div></div>
            <div className="section-heading"><h2>{t("history")}</h2><button className="text-button" onClick={() => setPocketAllHistory((value) => !value)}>{pocketAllHistory ? t("selectedMonth") : t("allHistory")}</button></div>
            {data.pocketTransfers.filter((move) => (move.fromPocketId === selectedPocket.id || move.toPocketId === selectedPocket.id) && (pocketAllHistory || move.month === month)).map((move) => <div className="pocket-move" key={move.id}><span>{move.toPocketId === selectedPocket.id ? t("budgetMovedIn") : t("budgetMovedOut")} · {monthLabel(move.month, true)}</span><strong>{move.toPocketId === selectedPocket.id ? "+" : "−"}{money(move.amount)}</strong></div>)}
            <TransactionList transactions={newestFirst(data.transactions.filter((t) => t.pocketId === selectedPocket.id && (pocketAllHistory || t.date.startsWith(month))))} pockets={data.pockets} onEdit={(value) => setEdit({ type: "transaction", value })} groupDates />
          </section>}
          {view === "pockets" && !selectedPocket && (
            <>
              <div className="budget-overview">
                <div>
                  <span>{t("monthlyBudget")}</span>
                  <strong>{money(stats.budget)}</strong>
                </div>
                <div>
                  <span>{t("spentSoFar")}</span>
                  <strong>{money(stats.expenses)}</strong>
                </div>
                <button type="button" className={stats.shortfall > 0 ? "shortfall-tile" : ""} onClick={() => setEdit({ type: "cash_shortfall" })}>
                  <span>{stats.shortfall > 0 ? t("shortBy") : t("freeToSpend")}</span>
                  <strong>{money(stats.shortfall > 0 ? stats.shortfall : stats.available)}</strong>
                </button>
              </div>
              <div className="section-heading"><div><h2>{t("budgetAllocation")}</h2><p>{stats.unassigned ? t("unassignedWaiting", { amount: money(stats.unassigned) }) : t("moveWithoutCash")}</p></div><div className="section-actions"><button className="button secondary" onClick={() => setEdit({ type: "plan" })}><Sparkles size={16} />{t("planWithSaku")}</button><button className="button secondary" onClick={() => data.pockets.length < 2 ? setToast(t("addAnotherPocketFirst")) : setEdit({ type: "pocket_transfer" })}><ArrowRight size={16} />{t("moveBudget")}</button></div></div>
              <div className="pocket-grid all-pockets">
                {stats.pockets.map((p) => (
                  <PocketCard
                    key={p.id}
                    p={p}
                    onClick={() => openPocket(p.id)}
                    onEdit={() => setEdit({ type: "pocket", value: p })}
                    onDelete={() => setEdit({ type: "pocket_delete", value: p })}
                    onCover={() => setEdit(data.pockets.length > 1 ? { type: "pocket_transfer", toPocketId: p.id, amount: p.spent - p.limit } : { type: "pocket", value: p, focusBudget: true })}
                  />
                ))}
                <button
                  className="new-pocket"
                  onClick={() => setEdit({ type: "pocket" })}
                >
                  <Plus size={25} />
                  <strong>{t("aNewLittlePlan")}</strong>
                  <span>{t("createPocket")}</span>
                </button>
              </div>
            </>
          )}
          {view === "insights" && (
            <div className="insights-view">
              <div className="insights-summary">
                <div>
                  <span className="eyebrow">{t("biggestCategory")}</span>
                  <h2>
                    {topPocket?.spent
                      ? topPocket.name
                      : t("storyStarts")}
                  </h2>
                  <p>
                    {topPocket?.spent
                      ? t("topPocketShare", { amount: money(topPocket.spent), percent: Math.round((topPocket.spent / Math.max(1, stats.expenses)) * 100) })
                      : t("logExpenseHint")}
                  </p>
                </div>
                <TrendingUp size={46} />
              </div>
              <div className="insight-stats">
                <div>
                  <Target />
                  <span>{t("availableWithinYourPlan")}</span>
                  <strong>{money(stats.available)}</strong>
                  <small>{t("cappedByYourRecordedCash")}</small>
                </div>
                <div>
                  <Wallet />
                  <span>{t("incomeMinusExpenses")}</span>
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
                      ? t("percentOfIncome", { percent: Math.round(((stats.income - stats.expenses) / stats.income) * 100) })
                      : t("noIncomeRecordedThisMonth")}
                  </small>
                </div>
                <div>
                  <CalendarDays />
                  <span>{t("averageDailySpending")}</span>
                  <strong>{money(averageDailySpending(data, month))}</strong>
                  <small>{t("perDaySinceYourFirst")}</small>
                </div>
              </div>
              <section className="charts-grid">
                <div className="chart-panel">
                  <div className="section-heading">
                    <h2>{t("yourCashFlow")}</h2>
                    <div className="chart-legend">
                      <span>
                        <i className="income-dot" />
                        {t("income")}
                      </span>
                      <span>
                        <i className="out-dot" />
                        {t("expenses")}
                      </span>
                    </div>
                  </div>
                  <FlowChart transactions={stats.transactions} month={month} />
                </div>
                <div className="chart-panel">
                  <h2>{t("spendingBreakdown")}</h2>
                  <SpendingRing
                    pockets={stats.pockets}
                    total={stats.expenses}
                  />
                </div>
              </section>
              <section className="budget-breakdown">
                <h2>{t("everyPocketAtAGlance")}</h2>
                <div className="breakdown-header">
                  <span>{t("pocket")}</span>
                  <span>{t("budget")}</span>
                  <span>{t("spent2")}</span>
                  <span>{t("remaining")}</span>
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
            <Suspense fallback={<p className="loading-view">{t("loadingMonthlyCheck")}</p>}>
              <div className="check-tabs" role="tablist" aria-label={t("importMode")}><button role="tab" aria-selected={checkTab === "catchup"} className={checkTab === "catchup" ? "selected" : ""} onClick={() => setCheckTab("catchup")}>{t("catchUp")}</button>{notificationCaptureSupported() && <button role="tab" aria-selected={checkTab === "notifications"} className={checkTab === "notifications" ? "selected" : ""} onClick={() => setCheckTab("notifications")}>{t("notificationsTab")}</button>}<button role="tab" aria-selected={checkTab === "statement"} className={checkTab === "statement" ? "selected" : ""} onClick={() => setCheckTab("statement")}>{t("catchUpMonthly")}</button><button role="tab" aria-selected={checkTab === "csv"} className={checkTab === "csv" ? "selected" : ""} onClick={() => setCheckTab("csv")}>{t("csvOnDevice")}</button></div>
              {checkTab === "catchup" ? <CatchUp key={`catchup-${cloud?.signedIn ? cloud.user?.id : "local"}`} data={data} month={month} userId={cloud?.signedIn ? cloud.user?.id : undefined} commit={commit} busy={busy} notify={setToast} /> : checkTab === "notifications" ? <Suspense fallback={<p className="loading-view">{t("loadingNotifications")}</p>}><NotificationReview data={data} userId={cloud?.signedIn ? cloud.user?.id : undefined} commit={commit} busy={busy} notify={setToast} onCount={() => setWaitingRecount((value) => value + 1)} onSettings={() => go("settings")} getCurrentData={() => latest.current.cloud?.user?.id === cloud?.user?.id ? latest.current.data : null} /></Suspense> : checkTab === "statement" ? <CatchUp key={`statement-${cloud?.signedIn ? cloud.user?.id : "local"}`} statementMode data={data} month={month} userId={cloud?.signedIn ? cloud.user?.id : undefined} commit={commit} busy={busy} notify={setToast} /> : null}
              <div hidden={checkTab !== "csv"}><CsvStatements cloudImportEnabled data={data} month={month} commit={commit} busy={busy} notify={setToast} /></div>
            </Suspense>
          )}
          {view === "plans" && <Suspense fallback={<p className="loading-view">{t("loadingPlans")}</p>}><Plans data={data} month={month} busy={busy} commit={commit} notify={setToast} onNewPurchase={(cardId) => setEdit({ type: "transaction", cardId })} initialTab={plansTab} /></Suspense>}
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
              onThemeChange={(preference) => { setThemePreference(preference); void saveTheme(preference).catch(() => setToast(t("appearanceCouldNotBeSaved"))); }}
              languagePreference={languagePreference}
              onLanguageChange={(preference) => { void prepareLanguage(preference).then(() => { setLanguagePreference(preference); return saveLanguage(preference); }).catch(() => setToast(t("languageSaveError"))); }}
              onOpenAccount={(account) => setSelectedAccount(account)}
              onRemoveAccount={(account) => { const index = data.accounts.indexOf(account); void commit({ ...data, accounts: data.accounts.filter((item) => item !== account) }, "").then((ok) => { if (ok) setToast({ message: t("accountRemoved"), action: { label: t("undo"), run: () => { const current = latest.current.data; if (current && !current.accounts.includes(account)) void commit({ ...current, accounts: [...current.accounts.slice(0, index), account, ...current.accounts.slice(index)] }, t("accountRestored")); } } }); }); }}
              appLock={appLock}
              onAppLockChange={changeAppLock}
              reminder={reminder}
              onReminderChange={async (next) => { await saveReminder(next); setReminder(next); }}
            />
          )}
          </>}
        </main>
      </div>
      {editingAccount && <AccountEditor data={data} account={editingAccount} busy={busy} onClose={() => setEditingAccount("")} onAdjust={(account) => setEdit({ type: "balance_adjustment", account })} onSave={async (next, message, renamed) => {
        const ok = await commit(next, message);
        if (ok && !renamed && !next.accounts.includes(editingAccount)) {
          const removed = editingAccount;
          const index = data.accounts.indexOf(removed);
          setToast({ message: t("accountRemoved"), action: { label: t("undo"), run: () => { const current = latest.current.data; if (current && !current.accounts.includes(removed)) void commit({ ...current, accounts: [...current.accounts.slice(0, index), removed, ...current.accounts.slice(index)] }, t("accountRestored")); } } });
        }
        if (ok && !next.accounts.includes(editingAccount)) setSelectedAccount("");
        if (ok && renamed) {
          setSelectedAccount(renamed.to);
          if (notificationCaptureSupported()) void notificationCapture.status().then((status) => Promise.all(status.apps.filter((app) => app.account === renamed.from).map((app) => notificationCapture.setApp({ packageName: app.packageName, account: renamed.to })))).catch(() => {});
        }
        return ok;
      }} />}
      {!selectedAccount && (view === "overview" || view === "transactions" || (view === "pockets" && selectedPocket)) && <button className="mobile-add-action" onClick={() => setEdit({ type: "transaction", pocketId: selectedPocket?.id })}><Plus size={20} /> {t("addTransaction")}</button>}
      <nav className="bottom-nav" aria-label={t("mobileNavigation")}>
        {mobileNavigation.map((n) => (
          <button
            key={n.id}
            className={(n.id === "more" ? moreViews.includes(view) : view === n.id) ? "active" : ""}
            aria-current={(n.id === "more" ? moreViews.includes(view) : view === n.id) ? "page" : undefined}
            onClick={() => go(n.id)}
          >
            <n.icon size={21} />
            {n.id === "check" && importWaiting > 0 && <span className="nav-badge" aria-label={`${importWaiting} waiting`}>{importWaiting > 99 ? "99+" : importWaiting}</span>}
            <span>
              {t(navigationKeys[n.id])}
            </span>
          </button>
        ))}
      </nav>
      {edit?.type === "account_transfer" && <TransactionEditor data={data} transaction={edit.value} initialTransfer initialAccount={edit.account} month={month} busy={busy} onClose={() => setEdit(null)} onSave={async () => false} onDelete={async () => {}} onRepay={async () => {}} onTransfer={async (rows, oldTransferId) => {
        const kept = data.transactions.filter((t) => !oldTransferId || t.transferId !== oldTransferId);
        if (await commit({ ...data, transactions: [...kept, ...rows] }, oldTransferId ? t("transferUpdated") : t("transferRecorded"))) setEdit(null);
      }} onDeleteTransfer={async (transferId) => { if (await commit({ ...data, transactions: data.transactions.filter((t) => t.transferId !== transferId) }, t("transferDeleted"))) setEdit(null); }} />}
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
          if (await commit({ ...data, transactions }, edit.value ? t("balanceAdjustmentUpdated") : t("accountBalanceAdjusted"))) { setEdit(null); setEditingAccount(""); }
        }}
        onDelete={async (id) => {
          if (await commit({ ...data, transactions: data.transactions.filter((item) => item.id !== id) }, t("balanceAdjustmentRemoved"))) setEdit(null);
        }}
      />}
      {edit?.type === "pocket_transfer" && <PocketTransferEditor data={data} month={month} busy={busy} toPocketId={edit.toPocketId} initialAmount={edit.amount} onClose={() => setEdit(null)} onSave={async (move) => { if (await commit({ ...data, pocketTransfers: [...data.pocketTransfers, move] }, t("pocketBudgetMoved"))) setEdit(null); }} />}
      {edit?.type === "cash_shortfall" && <Modal className="modal-compact" title={stats.shortfall > 0 ? t("shortBy") : t("freeToSpend")} subtitle={money(stats.shortfall > 0 ? stats.shortfall : stats.available)} onClose={() => setEdit(null)}><div className="form-footer"><button className="button primary" onClick={() => setEdit({ type: "transaction", initialMode: "income" })}>{t("addIncome")}</button><button className="button secondary" onClick={() => setEdit({ type: "plan" })}>{t("adjustPlan")}</button></div></Modal>}
      {catchUpSheet && !edit && <Suspense fallback={null}><CatchUpDays data={data} days={catchUpSheet.days} index={catchUpSheet.index} busy={busy} onIndex={(index) => setCatchUpSheet({ ...catchUpSheet, index })} onAdd={(date, favorite) => setEdit({ type: "transaction", date, favorite })} onEdit={(value) => openTransaction(value)} onNothingSpent={(day) => commit({ ...data, checkedDays: [...new Set([...data.checkedDays, day])].sort() }, t("markedAsNothingSpent"))} onClose={() => setCatchUpSheet(null)} /></Suspense>}
      {edit?.type === "transaction" && (
        <TransactionEditor
          key={edit.value?.id || edit.favorite?.id || edit.cardId || edit.pocketId || edit.date || "new"}
          data={data}
          transaction={edit.value}
          initialCardId={edit.cardId}
          initialPocketId={edit.pocketId}
          initialAccount={edit.account}
          initialDate={edit.date}
          initialMode={edit.initialMode}
          favorite={edit.favorite}
          month={month}
          busy={busy}
          onClose={() => {
            if (!busy) setEdit(null);
          }}
          onSave={async (t, rule, favorite, keepOpen) => {
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
                  merchantRules: learnsMerchant(t) ? learnMerchant(data, t.name, t) : data.merchantRules,
                },
                edit.value ? translate("transactionUpdated") : translate("transactionAdded"),
              )
            ) {
              if (!edit.value) setToast({ message: t.date.slice(0, 7) === month ? translate("transactionAdded") : translate("transactionAddedInMonth", { month: monthLabel(t.date.slice(0, 7)) }), action: { label: translate("undo"), run: () => {
                const current = latest.current.data;
                if (current?.transactions.some((item) => item.id === t.id)) void commit({ ...current, transactions: current.transactions.filter((item) => item.id !== t.id) }, translate("transactionRemoved"));
              } }, ...(t.date.slice(0, 7) === month ? {} : { secondaryAction: { label: translate("view"), run: () => { setMonth(t.date.slice(0, 7)); go("transactions"); setToast(""); } } }) });
              if (!keepOpen) setEdit(null);
              return true;
            }
            return false;
          }}
          onDelete={async (id) => {
            if (
              await commit(
                {
                  ...data,
                  transactions: data.transactions.filter((t) => t.id !== id && t.forTransactionId !== id),
                },
                t("transactionDeleted"),
              )
            )
              setEdit(null);
          }}
          onRepay={async (sourceId, amount, account, date) => {
            const source = data.transactions.find((t) => t.id === sourceId);
            const paid = data.transactions.filter((t) => t.forTransactionId === sourceId).reduce((n, t) => n + t.amount, 0);
            if (!source?.split || !validAmount(amount) || paid + amount > source.amount - source.split.ownAmount || date < source.date || date > today()) {
              setToast(t("checkTheRepaymentAmountAnd"));
              return;
            }
            await commit({ ...data, transactions: [...data.transactions, {
              id: uid(), name: `Repaid: ${source.name}`, amount, type: "income", date,
              pocketId: "", account, note: "", kind: "reimbursement", forTransactionId: sourceId,
            }] }, t("repaymentRecorded"));
          }}
          onTransfer={async (rows, oldTransferId) => {
            const kept = data.transactions.filter((t) => !oldTransferId || t.transferId !== oldTransferId);
            if (await commit({ ...data, transactions: [...kept, ...rows] }, oldTransferId ? t("transferUpdated") : t("transferRecorded"))) setEdit(null);
          }}
          onDeleteTransfer={async (transferId) => {
            if (await commit({ ...data, transactions: data.transactions.filter((t) => t.transferId !== transferId) }, t("transferDeleted"))) setEdit(null);
          }}
        />
      )}
      {edit?.type === "pocket" && (
        <PocketEditor
          data={data}
          pocket={edit.value}
          focusBudget={edit.focusBudget}
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
                edit.value ? t("pocketUpdated") : t("pocketCreated"),
              )
            )
              setEdit(null);
          }}
          onDelete={() => edit.value && setEdit({ type: "pocket_delete", value: edit.value })}
        />
      )}
      {edit?.type === "pocket_delete" && <PocketDeleteEditor data={data} pocket={edit.value} busy={busy} onClose={() => setEdit(null)} onAddPocket={() => setEdit({ type: "pocket" })} onSave={async (targetId) => {
        const next = targetId ? reassignAndDeletePocket(data, edit.value.id, targetId) : { ...data, pockets: data.pockets.filter((p) => p.id !== edit.value.id) };
        if (await commit(next, t("pocketDeleted"))) { setEdit(null); if (selectedPocketId === edit.value.id) closePocket(); }
      }} />}
      {edit?.type === "plan" && <Suspense fallback={null}><PocketPlanner
        data={data}
        month={today().slice(0, 7)}
        userId={cloud?.signedIn ? cloud.user?.id : undefined}
        busy={busy}
        onClose={() => setEdit(null)}
        onApply={async (plan) => {
          let next: Data;
          try { next = applyPocketPlan(data, plan, today().slice(0, 7)); }
          catch (error) { setToast(error instanceof Error ? error.message : t("planNotApplied")); return false; }
          const planId = next.pocketPlans?.[0]?.id;
          if (!(await commit(next, t("planSaved")))) return false;
          if (planId) setToast({ message: t("planSaved"), action: { label: t("undo"), run: () => {
            const current = latest.current.data;
            if (!current?.pocketPlans?.some((item) => item.id === planId)) return;
            const { data: back, kept } = rollbackPocketPlan(current, planId);
            void commit(back, kept.length ? t("rolledBackKept", { names: kept.join(", ") }) : t("rolledBack"));
          } } });
          return true;
        }}
        onRollback={async (planId) => {
          const { data: back, kept } = rollbackPocketPlan(data, planId);
          await commit(back, kept.length ? t("rolledBackKept", { names: kept.join(", ") }) : t("rolledBack"));
        }}
      /></Suspense>}
      {edit?.type === "start" && (
        <Suspense fallback={null}><Onboarding
          busy={busy}
          suggestedName={cloud?.user?.name}
          userId={cloud?.signedIn ? cloud.user?.id : undefined}
          onClose={() => setEdit(null)}
          onStart={async (next) => {
            if (await commit(next, t("yourOwnLittleFreshStart"))) {
              setEdit(null);
              setMonth(today().slice(0, 7));
              go("overview");
              setEdit({ type: "transaction" });
            }
          }}
        /></Suspense>
      )}
      {toast && (
        <SheetMessage><div className={`toast${edit || accountsOpen || editingAccount ? " in-sheet" : view === "overview" || view === "transactions" || (view === "pockets" && selectedPocket) ? " above-mobile-add" : ""}`} role="status">
          <Check size={17} />
          {typeof toast === "string" ? toast : toast.message}
          {typeof toast !== "string" && <button type="button" className="toast-action" onClick={toast.action.run}>{toast.action.label}</button>}
          {typeof toast !== "string" && toast.secondaryAction && <button type="button" className="toast-action" onClick={toast.secondaryAction.run}>{toast.secondaryAction.label}</button>}
          <button aria-label={t("dismissMessage")} onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div></SheetMessage>
      )}
    </div>
  );
}

function AccountActivity({ data, account, month, onMonthChange, onBack, onRename, onAdd, onTransfer, onAdjust, onEdit }: {
  data: Data; account: string; month: string; onMonthChange: (month: string) => void; onBack: () => void;
  onRename: () => void; onAdd: () => void; onTransfer: () => void; onAdjust: () => void; onEdit: (transaction: Transaction) => void;
}) {
  const [allHistory, setAllHistory] = useState(false);
  const transactions = data.transactions.filter((transaction) => transaction.account === account && transaction.kind !== "card_purchase");
  const monthRows = transactions.filter((transaction) => transaction.date.startsWith(month));
  const amount = (type: Transaction["type"]) => monthRows.filter((transaction) => transaction.type === type).reduce((total, transaction) => total + transaction.amount, 0);
  const shown = newestFirst(allHistory ? transactions : monthRows);
  return <section className="account-activity">
    <div className="page-heading"><div><button className="back-to-more" onClick={onBack}><ChevronLeft size={17} />{t("back")}</button><p>{t("accountActivity")}</p><h1>{account}<button type="button" className="pocket-heading-edit" aria-label={t("editAccountNamed", { account })} onClick={onRename}><PencilLine size={17} /></button></h1></div>
      <div className="heading-actions"><div className="month-picker"><IconButton label={t("previousMonth")} onClick={() => onMonthChange(shiftMonth(month, -1))}><ChevronLeft size={16} /></IconButton><label><CalendarDays size={16} /><span>{monthLabel(month, true)}</span><input aria-label={t("selectedMonth")} type="month" value={month} onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.target.value)) onMonthChange(event.target.value); }} /></label><IconButton label={t("nextMonth")} onClick={() => onMonthChange(shiftMonth(month, 1))}><ChevronRight size={16} /></IconButton></div></div>
    </div>
    <div className="pocket-activity-summary"><div><span>{t("balance")}</span><strong>{money(accountBalance(data, account))}</strong></div><div><span>{t("moneyIn")}</span><strong>{money(amount("income"))}</strong></div><div><span>{t("moneyOut")}</span><strong>{money(amount("expense"))}</strong></div></div>
    <div className="account-activity-actions"><button className="button primary" onClick={onAdd}><Plus size={16} />{t("addTransaction")}</button><button className="button secondary" onClick={onTransfer}><ArrowRight size={16} />{t("transfer")}</button><button className="button secondary" onClick={onAdjust}><Wallet size={16} />{t("fixBalance")}</button></div>
    <div className="section-heading"><h2>{t("history")}</h2><button className="text-button" onClick={() => setAllHistory((value) => !value)}>{allHistory ? t("selectedMonth") : t("allHistory")}</button></div>
    <TransactionList transactions={shown} pockets={data.pockets} onEdit={onEdit} groupDates />
  </section>;
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
  const rows = newestFirst(data.transactions
    .filter(
      (t) =>
        t.date.startsWith(month) &&
        (type === "all" || t.type === type) &&
        (pocket === "all" || t.pocketId === pocket) &&
        (account === "all" || t.account === account) &&
        `${t.name} ${t.note} ${t.account}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ));
  return (
    <>
      <div className="transaction-tools">
        <label className="search-field">
          <Search size={18} />
          <input
            placeholder={t("searchTransactions")}
            aria-label={t("searchTransactions2")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="segmented">
          {["all", "expense", "income"].map((option) => (
            <button
              key={option}
              className={type === option ? "selected" : ""}
              onClick={() => setType(option)}
            >
              {option === "all" ? t("all") : option === "expense" ? t("moneyOut") : t("moneyIn")}
            </button>
          ))}
        </div>
        <details ref={exportMenu} className="export-menu" onKeyDown={(event) => { if (event.key === "Escape") { exportMenu.current?.removeAttribute("open"); event.stopPropagation(); } }}><summary className="button secondary"><Download size={16} /> {t("exportCsv")}</summary><div>
          <button onClick={() => { exportMenu.current?.removeAttribute("open"); void import("./csv").then(({ exportCSV }) => download(`saku-${month}.csv`, exportCSV(rows, data.pockets), "text/csv")).catch(() => notify(t("exportCouldNotBeSaved"))); }}>{t("currentResults", { count: rows.length })}</button>
          <button onClick={() => { exportMenu.current?.removeAttribute("open"); void import("./csv").then(({ exportCSV }) => download("saku-all-transactions.csv", exportCSV(data.transactions, data.pockets), "text/csv")).catch(() => notify(t("exportCouldNotBeSaved"))); }}>{t("allHistory")}</button>
        </div></details>
      </div>
      <div className="transaction-filters">
        <ChoiceField hideLabel className="transaction-filter-field" label={t("pocket")} value={pocket} onValueChange={setPocket} options={[{ value: "all", label: t("allPockets") }, ...data.pockets.map((p) => ({ value: p.id, label: p.name }))]} />
        <ChoiceField hideLabel className="transaction-filter-field" label={t("account")} value={account} onValueChange={setAccount} options={[{ value: "all", label: t("allAccounts") }, ...data.accounts.map((name) => ({ value: name, label: name, description: money(accountBalance(data, name)) })), ...data.creditCards.map((card) => ({ value: card.name, label: card.name, description: t("creditCard") }))]} />
      </div>
      <div className="ledger">
        <div className="ledger-header">
          <span>{t("tableTransaction")}</span>
          <span>{t("tableDate")}</span>
          <span>{t("tableAmount")}</span>
        </div>
        <TransactionList
          transactions={rows}
          pockets={data.pockets}
          onEdit={onEdit}
          groupDates
        />
      </div>
      <div className="ledger-total">
        <span>{t("netChangeInThisView")}</span>
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
  const [balanceError, setBalanceError] = useState("");
  const [dateError, setDateError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const balanceField = useRef<HTMLLabelElement>(null);
  const dateDetails = useRef<HTMLDetailsElement>(null);
  const targetBalance = target === "" ? Number.NaN : Number(target);
  const validTarget = Number.isSafeInteger(targetBalance) && targetBalance >= 0 && targetBalance <= 1e12;
  const difference = validTarget ? targetBalance - baseBalance : 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBalanceError("");
    setDateError("");
    if (!validTarget) {
      setBalanceError(t("enterNewBalance"));
      balanceField.current?.querySelector("input")?.focus();
      return;
    }
    if (!validAmount(Math.abs(difference)) || (!transaction && targetBalance === currentBalance)) {
      setBalanceError(t("balanceMustChange"));
      balanceField.current?.querySelector("input")?.focus();
      return;
    }
    if (!validDate(date) || date > today()) {
      setDateError(t("choosePastOrToday"));
      if (dateDetails.current) dateDetails.current.open = true;
      dateDetails.current?.querySelector("input")?.focus();
      return;
    }
    try { await onSave(balanceAdjustment(data, account, targetBalance, date, reason.trim() || t("balanceAdjustmentLabel"), transaction)); }
    catch { setBalanceError(t("couldNotAdjustBalance")); }
  }
  return <Modal
    title={t("fixBalanceFor", { account })}
    onClose={onClose}
  >
    <form onSubmit={(event) => void submit(event)} className="balance-adjustment-form">
      <fieldset disabled={busy}>
        <div className="balance-adjustment-overview" aria-label={t("balanceOverviewLabel", { recorded: money(currentBalance), target: validTarget ? money(targetBalance) : t("notEntered") })}>
          <div><span>{t("recordedNow")}</span><strong>{money(currentBalance)}</strong></div>
          <ArrowRight size={20} aria-hidden="true" />
          <div><span>{t("afterAdjustment")}</span><strong>{validTarget ? money(targetBalance) : t("notEntered")}</strong></div>
        </div>
        <label className="field" ref={balanceField}>{t("newBalance")}<div className="amount-input"><span>Rp</span><MoneyInput autoFocus min="0" max="1000000000000" value={target} onValueChange={(value) => { setTarget(value); setBalanceError(""); }} placeholder="0" aria-invalid={!!balanceError} aria-describedby={balanceError ? "balance-adjustment-target-error" : undefined} aria-label={t("newBalanceFor", { account })} /></div>{balanceError && <span className="field-error" id="balance-adjustment-target-error" role="alert">{balanceError}</span>}</label>
        <div className={`balance-adjustment-effect ${difference < 0 ? "negative" : difference > 0 ? "positive" : ""}`}>
          <span>{difference > 0 ? t("sakuWillAdd") : difference < 0 ? t("sakuWillSubtract") : t("noAdjustmentNeeded")}</span>
          {difference !== 0 && <strong>{difference > 0 ? "+" : "−"}{money(Math.abs(difference))}</strong>}
        </div>
        <label className="field">{t("reason")} <small>{t("optional")}</small><textarea rows={2} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder={t("eGMatchedTheBalance")} /></label>
        <details className="balance-adjustment-more" ref={dateDetails}><summary>{t("moreDetails")}</summary><label className="field">{t("adjustmentDate")}<LongDateInput value={date} onValueChange={(value) => { setDate(value); setDateError(""); }} aria-invalid={!!dateError} aria-describedby={dateError ? "balance-adjustment-date-error" : undefined} />{dateError && <span className="field-error" id="balance-adjustment-date-error" role="alert">{dateError}</span>}</label></details>
        {deleting && transaction ? <div className="delete-confirm"><p>{t("removeThisBalanceAdjustmentThe")}</p><button type="button" className="button danger" onClick={() => void onDelete(transaction.id)}>{t("removeAdjustment")}</button><button type="button" className="button secondary" onClick={() => setDeleting(false)}>{t("keepIt")}</button></div> : <div className="form-footer">
          {transaction && <IconButton label={t("removeBalanceAdjustment")} onClick={() => setDeleting(true)}><Trash2 size={18} /></IconButton>}
          <button type="button" className="button secondary" onClick={onClose}>{t("cancel")}</button>
          <button className="button primary" disabled={busy}>{busy ? t("saving") : transaction ? t("saveChanges") : t("fixBalance")}<Check size={16} /></button>
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
  initialAccount,
  initialDate,
  initialMode,
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
  initialAccount?: string;
  initialDate?: string;
  initialMode?: "expense" | "income";
  favorite?: Favorite;
  month: string;
  busy: boolean;
  onClose: () => void;
  onSave: (t: Transaction, rule?: RecurringRule | null, favorite?: Favorite, keepOpen?: boolean) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onRepay: (sourceId: string, amount: number, account: string, date: string) => Promise<void>;
  onTransfer: (rows: Transaction[], oldTransferId?: string) => Promise<void>;
  onDeleteTransfer: (transferId: string) => Promise<void>;
}) {
  const special = transaction?.kind === "card_payment" || transaction?.kind === "reimbursement";
  const transferPair = transaction?.transferId ? data.transactions.find((item) => item.transferId === transaction.transferId && item.id !== transaction.id) : undefined;
  const transferOutgoing = transaction?.type === "expense" ? transaction : transferPair?.type === "expense" ? transferPair : undefined;
  const transferIncoming = transaction?.type === "income" ? transaction : transferPair?.type === "income" ? transferPair : undefined;
  const [mode, setMode] = useState<"expense" | "income" | "transfer">(initialTransfer || transaction?.kind === "account_transfer" ? "transfer" : transaction?.type || favorite?.type || initialMode || "expense"),
    [amount, setAmount] = useState(
      transaction ? String(transaction.amount) : favorite ? String(favorite.amount) : "",
    ),
    [name, setName] = useState(transaction?.name || favorite?.name || ""),
    [date, setDate] = useState(
      transaction?.date || initialDate || today(),
    ),
    [pocket, setPocket] = useState(
      transaction ? transaction.pocketId : favorite?.pocketId || initialPocketId || "",
    ),
    // An existing row, a quick entry or a pocket page already chose the pocket; only a blank new entry learns it from the name.
    [pocketChosen, setPocketChosen] = useState(Boolean(transaction || favorite || initialPocketId)),
    [pickingDate, setPickingDate] = useState(() => ![daysAgo(0), daysAgo(1), daysAgo(2)].includes(transaction?.date || initialDate || today())),
    [account, setAccount] = useState(transaction && transaction.kind !== "card_purchase" ? transaction.account : favorite && !favorite.cardId ? favorite.account : initialAccount || [...data.transactions].reverse().find((item) => data.accounts.includes(item.account) && item.kind !== "account_transfer")?.account || data.accounts[0]),
    [transferFrom, setTransferFrom] = useState(transferOutgoing?.account || initialAccount || data.accounts[0]),
    [transferTo, setTransferTo] = useState(transferIncoming?.account || data.accounts.find((item) => item !== (initialAccount || data.accounts[0])) || data.accounts[0]),
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
    [fieldError, setFieldError] = useState<{ field: "amount" | "name" | "date" | "transfer" | "pocket" | "share" | "card" | "installments"; message: string } | null>(null),
    [moreOpen, setMoreOpen] = useState(Boolean(transaction?.note || transaction?.split || transaction?.recurringRuleId)),
    [deleting, setDeleting] = useState(false);
  const type = mode === "income" ? "income" : "expense";
  async function scanReceipt(file?: File) {
    if (!file) return;
    if (!nativeAIAvailable) { setError(t("receiptAndroidOnly")); return; }
    if (!file.type.startsWith("image/") || file.size > 12_000_000) { setError(t("receiptImageLimit")); return; }
    setScanning(true); setError(""); setScanInfo("");
    try {
      const image = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("receiptReadError"));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
      canvas.width = 0; canvas.height = 0;
      const suggestion = receiptSuggestion((await localStatementAI.recognizeImage({ image: base64 })).text);
      const filled = !!suggestion.amount && !amount;
      if (filled) setAmount(String(suggestion.amount));
      if (suggestion.merchant && !name) setName(suggestion.merchant);
      setScanInfo(filled ? t("receiptAmountSuggested") : suggestion.amount ? "" : t("receiptNoTotal"));
    } catch (e) { setError(e instanceof Error ? e.message : t("receiptScanError")); }
    finally { setScanning(false); }
  }
  const amountField = useRef<HTMLDivElement>(null);
  const receiptInput = useRef<HTMLInputElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const keepOpen = useRef(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const addAnother = keepOpen.current;
    keepOpen.current = false;
    setFieldError(null);
    if (!validAmount(Number(amount))) {
      setFieldError({ field: "amount", message: t("wholeRupiahError") });
      amountField.current?.querySelector("input")?.focus();
      return;
    }
    if (!validDate(date) || date > today()) {
      setFieldError({ field: "date", message: t("choosePastOrToday") });
      return;
    }
    if (mode === "transfer") {
      if (data.accounts.length < 2 || transferFrom === transferTo) {
        setFieldError({ field: "transfer", message: t(data.accounts.length < 2 ? "anotherAccountTransfer" : "sameAccountTransfer") });
        return;
      }
      const transferId = transaction?.transferId || uid();
      await onTransfer([
        { id: transferOutgoing?.id || uid(), transferId, kind: "account_transfer", name: t("transferToName", { account: transferTo }), amount: Number(amount), type: "expense", date, pocketId: "", account: transferFrom, note: note.trim(), verified: false },
        { id: transferIncoming?.id || uid(), transferId, kind: "account_transfer", name: t("transferFromName", { account: transferFrom }), amount: Number(amount), type: "income", date, pocketId: "", account: transferTo, note: note.trim(), verified: false },
      ], transaction?.transferId);
      return;
    }
    if (!name.trim()) {
      setFieldError({ field: "name", message: t("transactionNameNeeded") });
      nameField.current?.focus();
      return;
    }
    if (shared && (!Number.isInteger(Number(people)) || Number(people) < 2 || Number(people) > 30 || !validAmount(Number(ownAmount || Math.ceil(Number(amount) / Number(people)))) || Number(ownAmount || Math.ceil(Number(amount) / Number(people))) > Number(amount))) {
      setFieldError({ field: "share", message: t("shareError") }); setMoreOpen(true); return;
    }
    const card = data.creditCards.find((c) => c.id === cardId);
    if (cardId && !card) { setFieldError({ field: "card", message: t("cardError") }); return; }
    if (cardId && (!Number.isInteger(Number(installments)) || Number(installments) < 1 || Number(installments) > 60 || !/^\d{4}-\d{2}$/.test(firstDueMonth) || firstDueMonth < date.slice(0, 7))) {
      setFieldError({ field: "installments", message: t("installmentsError") }); return;
    }
    const ruleId = recurring ? transaction?.recurringRuleId || uid() : undefined;
    const saved: Transaction = {
      id: transaction?.id || uid(),
      name: name.trim(),
      amount: Number(amount),
      type,
      date,
      // Keeps a recorded time while the date is unchanged; a new entry for today is stamped now.
      ...(transaction?.time && transaction.date === date ? { time: transaction.time } : !transaction && date === today() ? { time: timeOfDay(Date.now()) } : {}),
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
    if (await onSave(saved, rule, quick, addAnother) && addAnother) {
      setAmount(""); setName(""); setNote(""); setScanInfo(""); setError(""); setFieldError(null); setShared(false); setOwnAmount(""); setRecurring(false); setSaveFavorite(false);
      if (!initialPocketId && !favorite) { setPocket(""); setPocketChosen(false); }
      amountField.current?.querySelector("input")?.focus();
    }
  }
  function learnPocket() {
    if (pocketChosen || type !== "expense" || special) return;
    const learned = suggestMerchant(data, name)?.pocketId ?? lastPocketFor(data, name);
    setPocket(learned !== undefined && (!learned || data.pockets.some((p) => p.id === learned)) ? learned : "");
  }
  const dateChoice = pickingDate ? "pick" : date === daysAgo(0) ? "0" : date === daysAgo(1) ? "1" : date === daysAgo(2) ? "2" : "pick";
  const accountChoices = data.accounts.map((name) => ({ value: name, label: name, description: t("recordedBalanceAmount", { amount: money(accountBalance(data, name)) }) }));
  const paymentChoices = [
    ...data.accounts.map((name) => ({ value: `bank:${name}`, label: name, description: t("accountBalanceAmount", { amount: money(accountBalance(data, name)) }) })),
    ...data.creditCards.map((item) => ({ value: `card:${item.id}`, label: item.name, description: t("creditAvailableAmount", { amount: money(Math.max(0, item.limit - cardBalance(data, item.id))) }) })),
  ];
  const pocketStats = summary(data, date.slice(0, 7)).pockets;
  const pocketChoices = [{ value: "", label: t("unassigned") }, ...pocketStats.map((item) => ({ value: item.id, label: item.name, description: t("remainingAmount", { amount: money(Math.max(0, item.limit - item.spent)) }) }))];
  const modeControl = <div className="segmented form-segment transaction-modes">
    <button type="button" disabled={special || !!transaction?.split || transaction?.kind === "account_transfer"} className={mode === "expense" ? "selected" : ""} onClick={() => setMode("expense")}><ArrowUpRight size={16} />{t("expense")}</button>
    <button type="button" disabled={special || !!transaction?.split || transaction?.kind === "account_transfer"} className={mode === "income" ? "selected" : ""} onClick={() => setMode("income")}><ArrowDownLeft size={16} />{t("income")}</button>
    <button type="button" disabled={special || !!transaction?.split || (!!transaction && transaction.kind !== "account_transfer")} className={mode === "transfer" ? "selected" : ""} onClick={() => setMode("transfer")}><ArrowRight size={16} />{t("transfer")}</button>
  </div>;
  if (mode === "transfer") return <Modal title={transaction ? t("editTransfer") : t("addTransaction")} onClose={onClose}>
    <form onSubmit={(e) => void submit(e)}><fieldset disabled={busy}>{modeControl}
      {data.accounts.length < 2 && <p className="form-error" role="alert">{t("anotherAccountTransfer")}</p>}
      <label className="field">{t("amount")}<div className="amount-input" ref={amountField}><span>Rp</span><MoneyInput autoFocus min="1" max="1000000000000" value={amount} onValueChange={(value) => { setAmount(value); setFieldError(null); }} aria-invalid={fieldError?.field === "amount"} />{!transaction && nativeAIAvailable && <><button type="button" className="icon-button amount-scan" aria-label={scanning ? t("readingReceipt") : t("scanReceipt")} title={t("scanReceipt")} disabled={scanning || busy} onClick={(event) => { event.preventDefault(); receiptInput.current?.click(); }}><Camera size={18} /></button><input ref={receiptInput} type="file" accept="image/*" capture="environment" hidden tabIndex={-1} onChange={(e) => { void scanReceipt(e.target.files?.[0]); e.target.value = ""; }} /></>}</div>{fieldError?.field === "amount" && <span className="field-error" role="alert">{fieldError.message}</span>}</label>
      <div className="form-columns"><label className="field">{t("from")}<ChoiceField hideLabel label={t("from")} value={transferFrom} onValueChange={(value) => { setTransferFrom(value); setFieldError(null); }} options={accountChoices} /></label><label className="field">{t("to")}<ChoiceField hideLabel label={t("to")} value={transferTo} onValueChange={(value) => { setTransferTo(value); setFieldError(null); }} options={accountChoices} /></label></div>
      {fieldError?.field === "transfer" && <p className="field-error" role="alert">{fieldError.message}</p>}
      <label className="field">{t("date")}<LongDateInput max={today()} value={date} onValueChange={(value) => { setDate(value); setFieldError(null); }} aria-invalid={fieldError?.field === "date"} />{fieldError?.field === "date" && <span className="field-error" role="alert">{fieldError.message}</span>}</label>
      <label className="field">{t("note")} <span className="optional">{t("optional")}</span><textarea rows={2} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer">{transaction?.transferId && <button type="button" className="button danger" onClick={() => void onDeleteTransfer(transaction.transferId!)}>{t("delete")}</button>}<button className="button primary" disabled={busy}>{busy ? t("saving") : t("saveTransfer")}<Check size={16} /></button></div>
    </fieldset></form>
  </Modal>;
  return (
    <Modal
      title={transaction ? t("editTransaction") : t("addTransaction")}
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)}>
        <fieldset disabled={busy}>
          {modeControl}
          <label className="field">
            {t("amount")}
            <div className="amount-input" ref={amountField}>
              <span>Rp</span>
              <MoneyInput
                autoFocus
                min="1"
                max="1000000000000"
                step="1"
                value={amount}
                onValueChange={(value) => { setAmount(value); setFieldError(null); }}
                placeholder="0"
                aria-invalid={fieldError?.field === "amount"}
                aria-label={t("amountInRupiah")}
              />
            </div>
            {fieldError?.field === "amount" && <span className="field-error" role="alert">{fieldError.message}</span>}
          </label>
          {scanInfo && <p className="editor-help" role="status">{scanInfo}</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <label className="field">
            {type === "income" ? t("incomeName") : t("purchaseName")}
            <input
              ref={nameField}
              value={name}
              onChange={(e) => { setName(e.target.value); setFieldError(null); }}
              onBlur={learnPocket}
              placeholder={
                type === "income"
                  ? t("incomeExample")
                  : t("purchaseExample")
              }
              maxLength={100}
              aria-invalid={fieldError?.field === "name"}
            />
            {fieldError?.field === "name" && <span className="field-error" role="alert">{fieldError.message}</span>}
          </label>
          {type === "expense" && !special && <label className="field">{t("paidWith")}
            <ChoiceField hideLabel label={t("paidWith")} value={cardId ? `card:${cardId}` : `bank:${account}`} options={paymentChoices} onValueChange={(value) => {
              if (value.startsWith("card:")) setCardId(value.slice(5));
              else { setCardId(""); setAccount(value.slice(5)); }
            }} />{fieldError?.field === "card" && <span className="field-error" role="alert">{fieldError.message}</span>}
          </label>}
          {type === "expense" && (
            transaction?.kind !== "card_payment" &&
            <label className="field">
              {t("pocket")}
              <ChoiceField hideLabel label={t("pocket")} value={pocket} onValueChange={(value) => { setPocket(value); setPocketChosen(true); setFieldError(null); }} options={pocketChoices} />
              {fieldError?.field === "pocket" && <span className="field-error" role="alert">{fieldError.message}</span>}
            </label>
          )}
          <div className="form-columns">
            <div className="field date-field">
              <SegmentedChoice compact label={t("date")} value={dateChoice} onValueChange={(value) => { setPickingDate(value === "pick"); setFieldError(null); if (value !== "pick") setDate(daysAgo(Number(value))); }} options={[{ value: "0", label: t("today") }, { value: "1", label: t("yesterday") }, { value: "2", label: t("twoDaysAgo") }, { value: "pick", label: t("pick") }]} />
              {dateChoice === "pick" && <LongDateInput aria-label={t("date")} value={date} onValueChange={(value) => { setDate(value); setFieldError(null); }} max={today()} aria-invalid={fieldError?.field === "date"} />}
              {fieldError?.field === "date" && <span className="field-error" role="alert">{fieldError.message}</span>}
            </div>
            {(special || type === "income") && <label className="field">
              {t("account")}
              <ChoiceField hideLabel label={t("account")} value={account} onValueChange={setAccount} options={accountChoices} />
            </label>}
          </div>
          {cardId && type === "expense" && !special && <div className="form-columns">
            <label className="field">{t("paymentPlan")}
              <SegmentedChoice label={t("paymentPlan")} value={installments === "1" ? "one" : "installments"} onValueChange={(value) => setInstallments(value === "one" ? "1" : "3")} options={[{ value: "one", label: t("onePayment") }, { value: "installments", label: t("installments") }]} />
            </label>
            {installments !== "1" && <label className="field">{t("numberPayments")}<input type="number" min={2} max={60} value={installments} onChange={(e) => setInstallments(e.target.value)} /></label>}
            <label className="field">{t("firstDueMonth")}<input type="month" value={firstDueMonth} onChange={(e) => { setFirstDueMonth(e.target.value); setFieldError(null); }} />{fieldError?.field === "installments" && <span className="field-error" role="alert">{fieldError.message}</span>}</label>
          </div>}
          <details className="editor-more" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)}><summary>{t("moreDetails")} <span>{t("moreDetailsSubtitle")}</span></summary>
          {type === "expense" && !special && <label className="checkbox-label editor-option"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> {t("shared")}</label>}
          {shared && type === "expense" && !special && <div className="form-columns"><label className="field">{t("peopleIncludingYou")}<input type="number" min={2} max={30} value={people} onChange={(e) => { setPeople(e.target.value); setFieldError(null); }} /></label><label className="field">{t("yourShareRupiah")}<MoneyInput min={1} max={Number(amount) || undefined} placeholder={amount ? String(Math.ceil(Number(amount) / Number(people))) : ""} value={ownAmount} onValueChange={(value) => { setOwnAmount(value); setFieldError(null); }} />{fieldError?.field === "share" && <span className="field-error" role="alert">{fieldError.message}</span>}</label><p className="editor-help">{t("sharedPaymentHelp")}</p></div>}
          {!special && <label className="checkbox-label editor-option"><input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> {t("repeatMonthly")}</label>}
          {!transaction && !special && <label className="checkbox-label editor-option"><input type="checkbox" checked={saveFavorite} onChange={(e) => setSaveFavorite(e.target.checked)} /> {t("saveQuick")}</label>}
          {transaction?.split && <div className="repayment-review"><strong>{t("sharedPayment")}</strong><p>{t("othersOweRepaid", { amount: money(transaction.amount - transaction.split.ownAmount), repaid: money(data.transactions.filter((item) => item.forTransactionId === transaction.id).reduce((n, item) => n + item.amount, 0)) })}</p><div className="plans-fields"><label className="field">{t("repaymentRupiah")}<MoneyInput min={1} value={repayAmount} onValueChange={setRepayAmount} /></label><label className="field">{t("receivedIn")}<ChoiceField hideLabel label={t("repaymentAccount")} value={repayAccount} onValueChange={setRepayAccount} options={accountChoices} /></label><label className="field">{t("receivedOn")}<LongDateInput min={transaction.date} max={today()} value={repayDate} onValueChange={setRepayDate} /></label></div><button type="button" className="button secondary" disabled={busy || !validAmount(Number(repayAmount))} onClick={() => void onRepay(transaction.id, Number(repayAmount), repayAccount, repayDate).then(() => setRepayAmount(""))}>{t("recordRepayment")}</button></div>}
          <label className="field">
            {t("note")} <span className="optional">{t("optional")}</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder={t("notePrompt")}
            />
          </label>
          </details>
          {deleting ? (
            <div className="delete-confirm">
              <p>
                {t("deleteTransactionQuestion")}
              </p>
              <button
                type="button"
                className="button danger"
                onClick={() => void onDelete(transaction!.id)}
              >
                {t("deleteTransaction")}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setDeleting(false)}
              >
                {t("keepIt")}
              </button>
            </div>
          ) : (
            <div className="form-footer">
              {transaction && (
                <IconButton
                  label={t("deleteTransaction")}
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 size={18} />
                </IconButton>
              )}
              {!transaction && <button className="button secondary" type="button" onClick={(event) => { keepOpen.current = true; event.currentTarget.form?.requestSubmit(); keepOpen.current = false; }}>{t("saveAnother")}</button>}
              <button className="button primary" type="submit">
                {busy
                  ? t("saving")
                  : transaction
                    ? t("saveChanges")
                    : t("addTransaction")}
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
  focusBudget,
  month,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  data: Data;
  pocket?: Pocket;
  focusBudget?: boolean;
  month: string;
  busy: boolean;
  onClose: () => void;
  onSave: (p: Pocket) => Promise<void>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(pocket?.name || ""),
    [budget, setBudget] = useState(
      pocket ? String(budgetFor(pocket, month)) : "",
    ),
    [color, setColor] = useState(pocket?.color || COLORS[0]),
    [icon, setIcon] = useState(pocket?.icon || ICONS[0]),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      !Number.isSafeInteger(Number(budget)) ||
      Number(budget) < 0 ||
      Number(budget) > 1e12
    ) {
      setError(t("enterAWholeRupiahBudget"));
      return;
    }
    if (
      data.pockets.some(
        (p) =>
          p.id !== pocket?.id &&
          p.name.toLowerCase() === name.trim().toLowerCase(),
      )
    ) {
      setError(t("aPocketWithThisName"));
      return;
    }
    const base: Pocket = {
      id: pocket?.id || uid(),
      name: name.trim(),
      color,
      icon,
      budget: Number(budget),
      budgets: {},
      createdMonth: pocket?.createdMonth || month,
    };
    await onSave(pocket ? { ...setPocketBudgetFromMonth(pocket, month, Number(budget)), name: base.name, color, icon } : base);
  }
  return (
    <Modal
      title={pocket ? t("makeItYourOwn") : t("aPocketForYourPlans")}
      subtitle={t("monthlyBudgetFor", { month: monthLabel(month) })}
      onClose={onClose}
    >
      <form onSubmit={(e) => void submit(e)}>
        <fieldset disabled={busy}>
          <div className="pocket-preview">
            <PocketIcon name={icon} color={color} size={30} />
          </div>
          <label className="field">
            {t("pocketName")}
            <input
              autoFocus={!focusBudget}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("eGWeekendAdventures")}
              maxLength={40}
              required
              pattern=".*\S.*"
            />
          </label>
          <label className="field">
            {pocket ? t("budgetForThisMonth") : t("monthlyBudget")}
            <div className="amount-input">
              <span>Rp</span>
              <MoneyInput
                autoFocus={focusBudget}
                min="0"
                max="1000000000000"
                step="1"
                value={budget}
                onValueChange={setBudget}
                placeholder={groupDigits(100000)}
                required
                aria-label={t("pocketBudgetInRupiah")}
              />
            </div>
          </label>
          <span className="field-label">{t("color")}</span>
          <div className="color-swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                style={{ background: c }}
                aria-label={t("colorNamed", { color: c })}
                aria-pressed={c === color}
                className={c === color ? "chosen" : ""}
                onClick={() => setColor(c)}
              >
                {c === color && <Check size={18} />}
              </button>
            ))}
          </div>
          <span className="field-label">{t("icon")}</span>
          <div className="icon-choices">
            {ICONS.map((i) => (
              <button
                key={i}
                type="button"
                title={t(iconLabelKey(i))}
                aria-label={t("iconNamed", { name: t(iconLabelKey(i)) })}
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
            <div className="form-footer">
              {pocket && (
                <IconButton
                  label={t("deletePocket")}
                  onClick={onDelete}
                >
                  <Trash2 size={18} />
                </IconButton>
              )}
              <button
                className="button secondary"
                type="button"
                onClick={onClose}
              >
                {t("cancel")}
              </button>
              <button className="button primary" type="submit">
                {busy ? t("saving") : pocket ? t("saveChanges") : t("createPocket2")}
                <Check size={16} />
              </button>
            </div>
        </fieldset>
      </form>
    </Modal>
  );
}

function PocketDeleteEditor({ data, pocket, busy, onClose, onAddPocket, onSave }: { data: Data; pocket: Pocket; busy: boolean; onClose: () => void; onAddPocket: () => void; onSave: (targetId: string) => Promise<void> }) {
  const used = pocketHasReferences(data, pocket.id);
  const choices = data.pockets.filter((item) => item.id !== pocket.id).map((item) => ({ value: item.id, label: item.name }));
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  return <Modal title={t("deleteNamed", { name: pocket.name })} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); if (used && !target) { setError(t("chooseDestinationPocket")); return; } void onSave(target); }}>
      {used && <div className="field"><ChoiceField label={t("movePocketContentsTo")} value={target} onValueChange={(value) => { setTarget(value); setError(""); }} placeholder={t("choosePocket")} options={choices} />{error && <p className="field-error" role="alert">{error}</p>}</div>}
      {used && !choices.length && <button type="button" className="button secondary" onClick={onAddPocket}>{t("addPocket")}</button>}
      {!used && <p>{t("deleteThisPocketAndIts")}</p>}
      <div className="form-footer"><button type="button" className="button secondary" onClick={onClose}>{t("cancel")}</button><button className="button danger" disabled={busy}>{t("deletePocket")}</button></div>
    </form>
  </Modal>;
}

function PocketTransferEditor({ data, month, busy, toPocketId, initialAmount, onClose, onSave }: { data: Data; month: string; busy: boolean; toPocketId?: string; initialAmount?: number; onClose: () => void; onSave: (move: Data["pocketTransfers"][number]) => Promise<void> }) {
  const stats = summary(data, month);
  const [from, setFrom] = useState(() => stats.pockets.filter((p) => p.id !== toPocketId).sort((a, b) => (b.limit - b.spent) - (a.limit - a.spent))[0]?.id || "");
  const [to, setTo] = useState(toPocketId || data.pockets.find((p) => p.id !== from)?.id || "");
  const [amount, setAmount] = useState(initialAmount ? String(initialAmount) : "");
  const [fieldError, setFieldError] = useState<{ field: "from" | "to" | "amount"; message: string } | null>(null);
  const choices = stats.pockets.map((p) => ({ value: p.id, label: p.name, description: t("remainingAmount", { amount: money(Math.max(0, p.limit - p.spent)) }) }));
  function submit(event: FormEvent) {
    event.preventDefault();
    const source = stats.pockets.find((p) => p.id === from);
    const value = Number(amount);
    if (!source) { setFieldError({ field: "from", message: t("chooseBudgetSource") }); return; }
    if (!stats.pockets.some((p) => p.id === to)) { setFieldError({ field: "to", message: t("chooseBudgetDestination") }); return; }
    if (from === to) { setFieldError({ field: "to", message: t("chooseDifferentPocket") }); return; }
    if (!validAmount(value)) { setFieldError({ field: "amount", message: t("wholeRupiahError") }); return; }
    const available = Math.max(0, source.limit - source.spent);
    if (value > available) { setFieldError({ field: "amount", message: t("budgetMoveExceedsAvailable", { amount: money(available) }) }); return; }
    setFieldError(null);
    void onSave({ id: uid(), fromPocketId: from, toPocketId: to, amount: value, month });
  }
  return <Modal title={t("movePocketBudget")} subtitle={t("adjustMonthOnly", { month: monthLabel(month) })} onClose={onClose}><form onSubmit={submit}><fieldset disabled={busy}>
    <label className="field">{t("from")}<ChoiceField hideLabel label={t("pocketToMoveFrom")} value={from} onValueChange={(value) => { setFrom(value); setFieldError(null); }} options={choices} />{fieldError?.field === "from" && <span className="field-error" role="alert">{fieldError.message}</span>}</label>
    <label className="field">{t("to")}<ChoiceField hideLabel label={t("pocketToMoveTo")} value={to} onValueChange={(value) => { setTo(value); setFieldError(null); }} options={choices} />{fieldError?.field === "to" && <span className="field-error" role="alert">{fieldError.message}</span>}</label>
    <label className="field">{t("amount")}<div className="amount-input"><span>Rp</span><MoneyInput value={amount} onValueChange={(value) => { setAmount(value); setFieldError(null); }} aria-invalid={fieldError?.field === "amount"} /></div>{fieldError?.field === "amount" && <span className="field-error" role="alert">{fieldError.message}</span>}</label>
    <div className="form-footer"><button className="button primary">{t("moveBudget")}</button></div>
  </fieldset></form></Modal>;
}

function LoginScreen({ configured, busy, error, onLogin }: { configured: boolean; busy: boolean; error: string; onLogin: () => Promise<void> }) {
  const [accepted, setAccepted] = useState(false);
  const [agreementError, setAgreementError] = useState(false);
  const agreementField = useRef<HTMLInputElement>(null);
  return <main className="login-screen">
    <section className="login-panel">
      <span className="brand-mark"><SakuMark /></span><h1>Saku</h1>
      <p>{t("loginTagline")}</p>
      <details className="agreement"><summary>{t("agreementSummaryTitle")}</summary><p>{t("agreementSummary")} {t("readThe")} <a href={legalUrl("terms")} target="_blank" rel="noreferrer">{t("userAgreement")}</a> {t("and")} <a href={legalUrl("privacy")} target="_blank" rel="noreferrer">{t("privacyNotice")}</a>.</p></details>
      <label className="checkbox-label"><input ref={agreementField} type="checkbox" checked={accepted} onChange={(e) => { setAccepted(e.target.checked); setAgreementError(false); }} />{t("acceptAgreement", { version: AGREEMENT_VERSION })}</label>
      {agreementError && <p className="field-error" role="alert">{t("tickAgreementFirst")}</p>}
      <button className="button primary login-button" disabled={busy || !configured} onClick={() => { if (!accepted) { setAgreementError(true); agreementField.current?.focus(); return; } void onLogin(); }}><CircleUserRound size={18} />{busy ? t("connecting") : t("continueGoogle")}</button>
      {!configured && <p className="form-error">{t("signInNotConfigured")}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    </section>
  </main>;
}
function AgreementUpdate({ busy, error, onAccept, onSignOut }: { busy: boolean; error: string; onAccept: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const [accepted, setAccepted] = useState(false);
  const [agreementError, setAgreementError] = useState(false);
  const agreementField = useRef<HTMLInputElement>(null);
  return <main className="login-screen">
    <section className="login-panel">
      <span className="brand-mark"><ShieldCheck /></span><h1>{t("agreementUpdated")}</h1>
      <p>{t("agreementUpdateBody")}</p>
      <p>{t("readThe")} <a href={legalUrl("terms")} target="_blank" rel="noreferrer">{t("userAgreement")}</a> {t("and")} <a href={legalUrl("privacy")} target="_blank" rel="noreferrer">{t("privacyNotice")}</a>.</p>
      <label className="checkbox-label"><input ref={agreementField} type="checkbox" checked={accepted} onChange={(e) => { setAccepted(e.target.checked); setAgreementError(false); }} />{t("acceptAgreement", { version: AGREEMENT_VERSION })}</label>
      {agreementError && <p className="field-error" role="alert">{t("tickAgreementFirst")}</p>}
      <button className="button primary login-button" disabled={busy} onClick={() => { if (!accepted) { setAgreementError(true); agreementField.current?.focus(); return; } void onAccept(); }}><Check size={18} />{busy ? t("saving") : t("acceptContinue")}</button>
      <button className="button text-button" disabled={busy} onClick={() => void onSignOut()}><LogOut size={16} />{t("signOutInstead")}</button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  </main>;
}
function WorkspaceChoice({ local, remote, onChoose, onBackup }: { local: Data; remote: Data; onChoose: (data: Data, localWins: boolean) => Promise<void>; onBackup: () => void }) {
  return <main className="login-screen"><section className="login-panel workspace-choice"><ShieldCheck size={30} /><h1>{t("workspaceTitle")}</h1><p>{t("workspaceBody")}</p>
    <button className="workspace-option" onClick={() => void onChoose(local, true)}><strong>{t("keepPhone")}</strong><span>{t("transactionsPockets", { transactions: local.transactions.length, pockets: local.pockets.length })}</span></button>
    <button className="workspace-option" onClick={() => void onChoose(remote, false)}><strong>{remote.transactions.length || remote.pockets.length ? t("restoreCloud") : t("startFresh")}</strong><span>{t("transactionsPockets", { transactions: remote.transactions.length, pockets: remote.pockets.length })}</span></button>
    <button className="button secondary" onClick={onBackup}><Download size={17} />{t("exportFirst")}</button>
  </section></main>;
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
  languagePreference,
  onLanguageChange,
  onOpenAccount,
  onRemoveAccount,
  appLock,
  onAppLockChange,
  reminder,
  onReminderChange,
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
  languagePreference: LanguagePreference;
  onLanguageChange: (preference: LanguagePreference) => void;
  onOpenAccount: (account: string) => void;
  onRemoveAccount: (account: string) => void;
  appLock: AppLockSettings;
  onAppLockChange: (next: AppLockSettings, confirm: boolean) => Promise<boolean>;
  reminder: ReminderSettings;
  onReminderChange: (next: ReminderSettings) => Promise<void>;
}) {
  const [name, setName] = useState(data.name),
    [account, setAccount] = useState(""),
    [startingBalance, setStartingBalance] = useState(""),
    [accountError, setAccountError] = useState(""),
    [profileImage, setProfileImage] = useState<string | undefined>(),
    [restore, setRestore] = useState<Data | null>(null),
    [protectOpen, setProtectOpen] = useState(false),
    [lockedBackup, setLockedBackup] = useState<EncryptedBackup | null>(null),
    [backupPassword, setBackupPassword] = useState(""),
    [backupConfirm, setBackupConfirm] = useState(""),
    [backupError, setBackupError] = useState(""),
    [backupBusy, setBackupBusy] = useState(false),
    [cloudBusy, setCloudBusy] = useState(false),
    [pullConfirm, setPullConfirm] = useState(false),
    [deleteConfirm, setDeleteConfirm] = useState(false),
    [deleteText, setDeleteText] = useState(""),
    [signOutConfirm, setSignOutConfirm] = useState(false);
  const profileFile = useRef<HTMLInputElement>(null);
  async function cloudAction(action: () => Promise<void>) {
    setCloudBusy(true);
    try { await action(); }
    catch (error) { notify(error instanceof Error ? error.message : "Cloud action failed."); }
    finally { setCloudBusy(false); }
  }
  async function signOut() {
    const userId = cloud?.user?.id;
    await signOutGoogle();
    // A browser may be shared, so the web keeps no ledger after sign-out. Android keeps it for offline reopen.
    if (!Capacitor.isNativePlatform() && userId) {
      await removeUserData(userId);
      setData(emptyData());
    }
    setCloud(await loadCloudState());
    setSignOutConfirm(false);
    notify(t("signedOutOnThisDevice"));
  }
  async function backup() {
    try {
      await download(
        `saku-backup-${today()}.json`,
        JSON.stringify(data, null, 2),
        "application/json",
      );
    } catch {
      notify(t("backupCouldNotBeSaved"));
    }
  }
  async function protectedBackup() {
    if (backupPassword !== backupConfirm) { setBackupError(t("thePasswordsDonTMatch")); return; }
    setBackupBusy(true); setBackupError("");
    try {
      await download(`saku-backup-${today()}.saku.json`, await encryptBackup(JSON.stringify(data), backupPassword), "application/json");
      closeBackupDialog();
    } catch (e) { setBackupError(e instanceof Error ? e.message : t("backupCouldNotBeSaved")); }
    finally { setBackupBusy(false); }
  }
  async function unlockBackup() {
    if (!lockedBackup) return;
    setBackupBusy(true); setBackupError("");
    try {
      setRestore(validateData(JSON.parse(await decryptBackup(lockedBackup, backupPassword))));
      closeBackupDialog();
    } catch (e) { setBackupError(e instanceof Error ? e.message : t("invalidBackup")); }
    finally { setBackupBusy(false); }
  }
  function closeBackupDialog() { setProtectOpen(false); setLockedBackup(null); setBackupPassword(""); setBackupConfirm(""); setBackupError(""); }
  const update = useAppUpdate();
  async function readBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 20000000) throw new Error(t("backupTooLarge"));
      const parsed = JSON.parse(await file.text());
      if (isEncryptedBackup(parsed)) { setLockedBackup(parsed); return; }
      setRestore(validateData(parsed));
    } catch (e) {
      notify(e instanceof Error ? e.message : t("invalidBackup"));
    }
  }
  async function readProfileImage(file?: File) {
    if (!file || !file.type.startsWith("image/") || file.size > 8_000_000) { notify(t("chooseAnImageSmallerThan")); return; }
    const image = await createImageBitmap(file), canvas = document.createElement("canvas"), size = 512;
    canvas.width = size; canvas.height = size;
    const scale = Math.max(size / image.width, size / image.height), width = image.width * scale, height = image.height * scale;
    canvas.getContext("2d")?.drawImage(image, (size - width) / 2, (size - height) / 2, width, height); image.close();
    setProfileImage(canvas.toDataURL("image/webp", 0.82)); canvas.width = 0; canvas.height = 0;
  }
  return (
    <div className="settings-content">
      {notificationCaptureSupported() && <NotificationAccess data={data} userId={cloud?.signedIn ? cloud.user?.id : undefined} notify={notify} />}
      <SettingsCard title={t("yourAccounts")} summary={t("accountsCount", { count: data.accounts.length })} defaultOpen>
        <section>
          <h2>{t("yourAccounts")}</h2>
          <p>{t("keepCashBanksAndE")}</p>
          <div className="account-list">
            {data.accounts.map((a) => (
              <div className="account-row" key={a}>
                <button type="button" className="account-adjust-button" disabled={busy} onClick={() => onOpenAccount(a)} aria-label={t("viewAccountActivityNamed", { account: a })}>
                  <span className="account-list-icon"><Wallet size={19} /></span>
                  <span className="account-list-name"><strong>{a}</strong><small>{t("tapToViewAccount")}</small></span>
                  <strong className="account-list-balance">{money(accountBalance(data, a))}</strong>
                  <PencilLine size={16} aria-hidden="true" />
                </button>
                {!accountIsReferenced(data, a) &&
                  data.accounts.length > 1 && (
                    <IconButton
                      label={t("deleteAccountNamed", { account: a })}
                      disabled={busy}
                      onClick={() => onRemoveAccount(a)}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  )}
              </div>
            ))}
          </div>
          <form
            className="inline-form account-add-form"
            onSubmit={(e) => {
              e.preventDefault();
              const a = account.trim();
              if (!a) { setAccountError(t("accountNameNeeded")); return; }
              if (
                data.accounts.some((x) => x.toLowerCase() === a.toLowerCase())
              ) {
                setAccountError(t("thisAccountAlreadyExists"));
                return;
              }
              const balance = Number(startingBalance || 0);
              if (!Number.isSafeInteger(balance) || balance < 0 || balance > 1e12) { setAccountError(t("enterNewBalance")); return; }
              void commit(
                { ...data, accounts: [...data.accounts, a], transactions: balance > 0 ? [...data.transactions, { id: uid(), name: t("openingBalance"), amount: balance, type: "income", kind: "opening_balance", date: today(), pocketId: "", account: a, note: "" }] : data.transactions },
                t("accountAdded"),
              ).then((ok) => {
                if (ok) { setAccount(""); setStartingBalance(""); setAccountError(""); onOpenAccount(a); }
              });
            }}
          >
            <input
              aria-label={t("newAccountName")}
              placeholder={t("newAccountName")}
              maxLength={50}
              value={account}
              onChange={(e) => { setAccount(e.target.value); setAccountError(""); }}
            />
            <label className="field">{t("startingBalanceAmount")}<MoneyInput min="0" value={startingBalance} onValueChange={(value) => { setStartingBalance(value); setAccountError(""); }} /></label>
            {accountError && <p className="field-error" role="alert">{accountError}</p>}
            <button className="button secondary" disabled={busy}>
              <Plus size={16} />
              {t("addAccount2")}
            </button>
          </form>
        </section>
      </SettingsCard>
      <SettingsCard title={t("googleBackup")} summary={!cloud?.signedIn ? t("stateOff") : cloud.dirty ? t("changesWaiting") : cloud.sheetPending ? t("sheetPending") : cloud.lastSyncedAt ? `${t("upToDate")} · ${timeOfDay(Date.parse(cloud.lastSyncedAt))}` : t("upToDate")} defaultOpen={!!cloud?.dirty}>
        <section className="cloud-section">
          <div className="cloud-heading">
            <span className="connection-icon"><ShieldCheck size={24} /></span>
            <div>
              <h2>{t("googleBackup")}</h2>
              <p>{t("keepAPrivateBackupIn")}</p>
            </div>
          </div>
          {!cloud?.signedIn ? (
            <div className="cloud-signed-out">
              <p>{t("signingInAlsoCreatesYour")}</p>
              <button className="button primary" disabled={cloudBusy || !cloud?.configured} onClick={() => void cloudAction(async () => {
                const next = await signInGoogle();
                await onSignedIn(next);
                setName(next.user?.name || name);
                notify(t("googleAccountConnected"));
              })}>
                <CircleUserRound size={18} />
                {t(cloudBusy ? "connecting" : "continueGoogle")}
              </button>
              {!cloud?.configured && <small className="cloud-note">{t("googleSignInIsAvailable")}</small>}
            </div>
          ) : (
            <div className="cloud-account">
              <div className="cloud-user">
                <CircleUserRound size={21} />
                <span><strong>{cloud.user?.name}</strong><small>{cloud.user?.email}</small></span>
                <span className={`sync-state ${cloud.dirty || cloud.sheetPending ? "pending" : ""}`}>{cloud.dirty ? t("changesWaiting") : cloud.sheetPending ? t("sheetPending") : t("upToDate")}</span>
              </div>
              <div className="settings-actions">
                {(cloud.dirty || cloud.sheetPending) && <button className="button primary" disabled={cloudBusy} onClick={() => void cloudAction(syncNow)}><Upload size={17} />{t("retrySync")}</button>}
                {cloud.sheetPending && <button className="button secondary" disabled={cloudBusy} onClick={() => void cloudAction(async () => { setCloud(await connectGoogleDrive()); notify(t("googleDriveConnected")); })}><ExternalLink size={17} />{cloud.spreadsheetUrl ? t("reconnectGoogleDrive") : t("connectGoogleDrive")}</button>}
                <button className="button secondary" disabled={cloudBusy} onClick={() => setPullConfirm(true)}><Download size={17} />{t("restoreCloud")}</button>
                {cloud.spreadsheetUrl && <a className="button secondary" href={cloud.spreadsheetUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} />{t("openSheet")}</a>}
                <button className="button text-button" disabled={cloudBusy} onClick={() => { if (!Capacitor.isNativePlatform() && cloud.dirty) setSignOutConfirm(true); else void cloudAction(() => signOut()); }}><LogOut size={16} />{t("signOut")}</button>
              </div>
              <small className="cloud-note">{t("changesSyncAutomaticallyIncludingWidget")} {cloud.lastSyncedAt ? t("lastSynced", { time: new Date(cloud.lastSyncedAt).toLocaleString(localeTag()) }) : t("notBackedUpYet")}</small>
              {cloud.sheetPending && <p className="inline-warning">{t("yourCloudSnapshotIsSaved")}</p>}
              <SignedInDevices notify={notify} onSignedOutHere={async (id) => {
                // Revoking this session first would strand any changes still waiting to sync.
                if (cloud.dirty) await syncNow();
                const latest = await loadCloudState();
                if (!latest.signedIn || latest.user?.id !== cloud.user?.id || latest.dirty) throw new Error(t("syncYourChangesBeforeSigning"));
                await signOutDevice(id);
                await signOutGoogle();
                setCloud(await loadCloudState());
              }} />
            </div>
          )}
        </section>
      </SettingsCard>
      {remindersSupported() && <SettingsCard title={t("dailyReminder")} summary={reminder.enabled ? `${t("stateOn")} · ${reminder.time}` : t("stateOff")}><ReminderSection settings={reminder} onChange={onReminderChange} notify={notify} /></SettingsCard>}
      {appLockSupported() && <SettingsCard title={t("appLock")} summary={appLock.enabled ? t("stateOn") : t("stateOff")}><AppLockSection settings={appLock} onChange={onAppLockChange} /></SettingsCard>}
      <SettingsCard title={t("display")} summary={`${themePreference === "system" ? t("themeSystem") : themePreference === "light" ? t("light") : t("dark")} · ${languagePreference === "system" ? t("followDevice") : languagePreference === "id" ? t("indonesian") : t("english")}`}>
        <section className="appearance-section">
          <h2>{t("appearance")}</h2>
          <p>{t("chooseHowSakuLooksOn")}</p>
          <div className="appearance-options" role="group" aria-label={t("appearance")}>
            {(["system", "light", "dark"] as const).map((option) => <button key={option} type="button" aria-pressed={themePreference === option} className={themePreference === option ? "selected" : ""} onClick={() => onThemeChange(option)}>{option === "system" ? t("themeSystem") : option === "light" ? t("light") : t("dark")}</button>)}
          </div>
        </section>
        <section className="appearance-section">
          <h2>{t("language")}</h2>
          <p>{t("languageHelp")}</p>
          <div className="appearance-options" role="group" aria-label={t("language")}>
            {(["system", "id", "en"] as const).map((option) => <button key={option} type="button" aria-pressed={languagePreference === option} className={languagePreference === option ? "selected" : ""} onClick={() => onLanguageChange(option)}>{option === "system" ? t("followDevice") : option === "id" ? t("indonesian") : t("english")}</button>)}
          </div>
        </section>
      </SettingsCard>
      <SettingsCard title={t("localProfile")} summary={data.name}>
        <section>
          <h2>{t("localProfile")}</h2>
          <p>{t("yourWorkspaceOnThisDevice")}</p>
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              void cloudAction(async () => {
                if (!(await commit({ ...data, name: name.trim() }, t("profileUpdated")))) return;
                if (cloud?.signedIn) setCloud(await updateProfile(name.trim(), profileImage));
                setProfileImage(undefined);
              });
            }}
          >
            <label className="field">
              {t("yourName")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={40}
                pattern=".*\S.*"
              />
            </label>
            <div className="profile-photo-field"><span>{t("profilePhoto")} <span className="optional">{t("optional")}</span></span><button type="button" className="profile-photo-button" aria-label={t("chooseProfilePhoto")} onClick={() => profileFile.current?.click()}>{profileImage || avatarUrl ? <img src={profileImage || avatarUrl} alt="" /> : <span>{name.trim().slice(0, 1).toUpperCase() || "?"}</span>}<span className="profile-photo-edit"><Camera size={15} /></span></button><small>{t("tapThePhotoToChoose")}</small><input ref={profileFile} type="file" accept="image/*" hidden onChange={(e) => { void readProfileImage(e.target.files?.[0]); e.target.value = ""; }} /></div>
            <button className="button primary" disabled={busy}>
              {t("saveProfile")}
            </button>
          </form>
        </section>
      </SettingsCard>
      <SettingsCard title={t("yourDataStaysWithYou")} summary={t("yourDataSummary")}>
        <section>
          <h2>{t("yourDataStaysWithYou")}</h2>
          <p>{t("keepABackupBeforeSwitching")}</p>
          <div className="settings-actions">
            <button className="button secondary" onClick={() => void backup()}>
              <Download size={17} />
              {t("backUpData")}
            </button>
            <button className="button secondary" onClick={() => setProtectOpen(true)}>
              <LockKeyhole size={17} />
              {t("backUpWithPassword")}
            </button>
            <label className="button secondary">
              <Upload size={17} />
              {t("restoreBackup")}
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
          <p className="legal-links"><a href={legalUrl("privacy")} target="_blank" rel="noreferrer">{t("privacyNotice")}</a><span>·</span><a href={legalUrl("terms")} target="_blank" rel="noreferrer">{t("userAgreement")}</a><span>·</span><a href={legalUrl("account-deletion")} target="_blank" rel="noreferrer">{t("accountDeletion")}</a></p>
          {cloud?.signedIn && <div className="danger-zone"><div><strong>{t("deleteSakuAccount")}</strong><p>{t("permanentlyRemoveSakuCloudData")}</p></div><button className="button danger-button" disabled={cloudBusy} onClick={() => setDeleteConfirm(true)}><Trash2 size={16} />{t("deleteAccount")}</button></div>}
        </section>
      </SettingsCard>
      <SettingsCard title={t("about")} summary={update.available ? t("updateVersionReady", { version: update.release?.versionName ?? "" }) : `${appVersion} · ${t("upToDate")}`}>
        <AppUpdateSettings />
        <footer className="settings-footer">
          Saku {appVersion} <span>·</span> {t("madeForMindfulMonth")}
        </footer>
      </SettingsCard>
      {restore && (
        <Modal
          title={t("restoreThisBackup")}
          subtitle={t("yourCurrentWorkspaceWillBe")}
          onClose={() => setRestore(null)}
        >
          <div className="restore-summary">
            <strong>{t("workspaceOf", { name: restore.name })}</strong>
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
              {t("cancel")}
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void commit(restore, t("backupRestored")).then((ok) => {
                  if (ok) {
                    setName(restore.name);
                    setRestore(null);
                  }
                })
              }
            >
              {t("restoreBackup")}
            </button>
          </div>
        </Modal>
      )}
      {(protectOpen || lockedBackup) && (
        <Modal title={lockedBackup ? t("openProtectedBackup") : t("backUpWithPassword")} subtitle={lockedBackup ? t("enterThePasswordUsedWhen") : t("theFileIsEncryptedOn")} onClose={() => { if (!backupBusy) closeBackupDialog(); }}>
          <form onSubmit={(e) => { e.preventDefault(); void (lockedBackup ? unlockBackup() : protectedBackup()); }}>
            <label className="field">{t("password")}<input type="password" autoComplete={lockedBackup ? "current-password" : "new-password"} minLength={lockedBackup ? 1 : MIN_PASSWORD_LENGTH} value={backupPassword} onChange={(e) => setBackupPassword(e.target.value)} required autoFocus /></label>
            {!lockedBackup && <label className="field">{t("confirmPassword")}<input type="password" autoComplete="new-password" value={backupConfirm} onChange={(e) => setBackupConfirm(e.target.value)} required /></label>}
            {backupError && <p className="form-error" role="alert">{backupError}</p>}
            <div className="form-footer"><button type="button" className="button secondary" disabled={backupBusy} onClick={closeBackupDialog}>{t("cancel")}</button><button className="button primary" disabled={backupBusy}>{backupBusy ? t("working") : lockedBackup ? t("openBackup") : t("saveProtectedBackup")}</button></div>
          </form>
        </Modal>
      )}
      {pullConfirm && (
        <Modal title={t("restoreTheCloudCopy")} subtitle={t("thisReplacesTheWorkspaceOn")} onClose={() => setPullConfirm(false)}>
          <div className="form-footer">
            <button className="button secondary" disabled={cloudBusy} onClick={() => setPullConfirm(false)}>{t("cancel")}</button>
            <button className="button primary" disabled={cloudBusy} onClick={() => void cloudAction(async () => {
              const result = await pullCloud();
              if (!result.data) { notify(t("thereIsNoCloudBackup")); setPullConfirm(false); return; }
              await replaceData(result.data);
              setCloud(await adoptCloudSnapshot(result.state, true, result.data));
              setData(result.data);
              setName(result.data.name);
              setPullConfirm(false);
              notify(t("cloudBackupRestored"));
            })}>{t("restoreCloud")}</button>
          </div>
        </Modal>
      )}
      {signOutConfirm && (
        <Modal title={t("youHaveUnsyncedChanges")} subtitle={t("signingOutRemovesThisWorkspace")} onClose={() => setSignOutConfirm(false)}>
          <div className="form-footer">
            <button className="button secondary" disabled={cloudBusy} onClick={() => setSignOutConfirm(false)}>{t("cancel")}</button>
            <button className="button danger-button" disabled={cloudBusy} onClick={() => void cloudAction(() => signOut())}><LogOut size={16} />{t("signOutAndDiscard")}</button>
            <button className="button primary" disabled={cloudBusy} onClick={() => void cloudAction(async () => {
              await syncNow();
              if ((await loadCloudState()).dirty) { notify(t("syncDidNotFinishYour")); return; }
              await signOut();
            })}><Upload size={17} />{t("syncAndSignOut")}</button>
          </div>
        </Modal>
      )}
      {deleteConfirm && (
        <Modal title={t("deleteYourSakuAccount")} subtitle={t("thisPermanentlyDeletesYourSaku")} onClose={() => { setDeleteConfirm(false); setDeleteText(""); }}>
          <label className="field">{t("typeDeleteToConfirm")}<input autoCapitalize="characters" autoComplete="off" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} /></label>
          <div className="form-footer">
            <button className="button secondary" disabled={cloudBusy} onClick={() => { setDeleteConfirm(false); setDeleteText(""); }}>{t("cancel")}</button>
            <button className="button danger-button" disabled={cloudBusy || deleteText !== "DELETE"} onClick={() => void cloudAction(async () => {
              const userId = cloud?.user?.id;
              if (!userId) return;
              const deletion = await deleteCloudAccount();
              await removeUserData(userId);
              setData(emptyData());
              setCloud(await loadCloudState());
              setDeleteConfirm(false);
              setDeleteText("");
              notify(deletion.driveCleanupFailed ? t("sakuAccountDeletedRemoveIts") : t("sakuAccountDeleted"));
            })}><Trash2 size={16} />{t("deletePermanently")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function AppLockSection({ settings, onChange }: { settings: AppLockSettings; onChange: (next: AppLockSettings, confirm: boolean) => Promise<boolean> }) {
  const [available, setAvailable] = useState<boolean | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { void appLockStatus().then((status) => setAvailable(status.available)).catch(() => setAvailable(false)); }, []);
  const change = (next: AppLockSettings, confirm = false) => { setBusy(true); void onChange(next, confirm).finally(() => setBusy(false)); };
  return <section className="app-lock-section">
    <h2>{t("appLock")}</h2>
    <p>{t("askForYourFingerprintFace")}</p>
    {available === false && <p className="inline-warning">{t("setUpAScreenLock")}</p>}
    <label className="checkbox-label"><input type="checkbox" checked={settings.enabled} disabled={busy || (!available && !settings.enabled)} onChange={(event) => change({ ...settings, enabled: event.target.checked }, true)} /> {t("lockSaku")}</label>
    {settings.enabled && <>
      <SegmentedChoice compact label={t("lockAfter")} value={String(settings.after)} disabled={busy} onValueChange={(value) => change({ ...settings, after: Number(value) as LockAfter })} options={[{ value: "0", label: t("immediately") }, { value: "60", label: t("n1Min") }, { value: "300", label: t("n5Min") }]} />
      <label className="checkbox-label"><input type="checkbox" checked={settings.hideInRecents} disabled={busy} onChange={(event) => change({ ...settings, hideInRecents: event.target.checked })} /> {t("hideSakuInRecentsAlso")}</label>
    </>}
  </section>;
}

function ReminderSection({ settings, onChange, notify }: { settings: ReminderSettings; onChange: (next: ReminderSettings) => Promise<void>; notify: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      if (enabled && !(await requestReminderPermission())) { notify(t("allowNotificationsForSakuIn")); return; }
      await onChange({ ...settings, enabled });
    } catch { notify(t("theReminderSettingCouldNot")); }
    finally { setBusy(false); }
  }
  return <section className="reminder-section">
    <h2>{t("dailyReminder")}</h2>
    <p>{t("aQuietNudgeInThe")}</p>
    <label className="checkbox-label"><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => void toggle(event.target.checked)} /> {t("remindMeEachDay")}</label>
    {settings.enabled && <label className="field reminder-time">{t("time")}<input type="time" value={settings.time} disabled={busy} onChange={(event) => { if (/^\d{2}:\d{2}$/.test(event.target.value)) void onChange({ ...settings, time: event.target.value }); }} /></label>}
  </section>;
}

// The Worker labels sessions in English ("Chrome on Windows", "Android app", "Earlier sign-in").
function deviceLabelText(label: string) {
  if (label === "Android app") return t("deviceAndroidApp");
  if (label === "Earlier sign-in") return t("deviceEarlierSignIn");
  if (label === "A browser") return t("deviceBrowser");
  const [browser, system] = label.split(" on ");
  return system ? t("deviceBrowserOn", { browser: browser === "A browser" ? t("deviceBrowser") : browser, system }) : label;
}
const iconLabelKeys = { utensils: "iconUtensils", shopping: "iconShopping", car: "iconCar", game: "iconGame", home: "iconHome", heart: "iconHeart", plane: "iconPlane", book: "iconBook", coffee: "iconCoffee", gift: "iconGift" } as const;
function iconLabelKey(icon: string) { return iconLabelKeys[icon as keyof typeof iconLabelKeys] ?? "iconHome"; }
function SignedInDevices({ notify, onSignedOutHere }: { notify: (message: string) => void; onSignedOutHere: (id: string) => Promise<void> }) {
  const [devices, setDevices] = useState<SignedInDevice[] | null>(null), [busy, setBusy] = useState("");
  const load = () => listDevices().then(setDevices).catch(() => setDevices([]));
  useEffect(() => { void load(); }, []);
  async function signOut(device: SignedInDevice) {
    setBusy(device.id);
    try {
      if (device.current) { await onSignedOutHere(device.id); return; }
      await signOutDevice(device.id);
      notify(t("deviceSignedOut", { device: deviceLabelText(device.label) }));
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : t("thatDeviceCouldNotBe")); }
    finally { setBusy(""); }
  }
  if (!devices?.length) return null;
  return <div className="signed-in-devices">
    <strong>{t("signedInDevices")}</strong>
    <ul>{devices.map((device) => <li key={device.id}><span><b>{deviceLabelText(device.label)}{device.current ? ` · ${t("thisDevice")}` : ""}</b><small>{t("lastActive", { time: new Date(device.lastActiveAt).toLocaleString(localeTag()) })}</small></span><button className="button text-button" disabled={!!busy} onClick={() => void signOut(device)}><LogOut size={15} />{busy === device.id ? t("signingOut") : t("signOut")}</button></li>)}</ul>
  </div>;
}
