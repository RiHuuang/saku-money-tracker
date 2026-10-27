import { t } from "./i18n";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";
import { cardDue, catchUpGap, shiftDate, shiftMonth, type Data } from "./domain";

export type ReminderSettings = { enabled: boolean; time: string };
export type PlannedReminder = { id: number; at: Date; title: string; body: string; extra: { kind: "catchup" | "card"; cardId?: string } };

// Device-local: the reminder belongs to this phone, not to the synced ledger.
const key = "saku-reminder-v1";
const DAILY_IDS = 1000, CARD_IDS = 2000, DAYS_AHEAD = 7;
export const defaultReminder: ReminderSettings = { enabled: false, time: "20:00" };
export const remindersSupported = () => Capacitor.isNativePlatform();
const isOurs = (id: number) => id >= DAILY_IDS && id < CARD_IDS + 100;
const localISO = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const at = (day: string, time: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), Number(time.slice(0, 2)), Number(time.slice(3, 5)));

export function parseReminder(value: string | null): ReminderSettings {
  try {
    const raw = JSON.parse(value || "null");
    return { enabled: raw?.enabled === true, time: typeof raw?.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time) ? raw.time : defaultReminder.time };
  } catch { return defaultReminder; }
}

// One notification per day for the coming week, each worded for the ledger as it stands, so it is
// rescheduled whenever the ledger changes. Card reminders never include amounts: they show on the lock screen.
export function reminderPlan(data: Data, settings: ReminderSettings, now: Date): PlannedReminder[] {
  if (!settings.enabled) return [];
  const today = localISO(now), plan: PlannedReminder[] = [];
  for (let offset = 0; offset < DAYS_AHEAD; offset++) {
    const day = shiftDate(today, offset), when = at(day, settings.time);
    if (when <= now) continue;
    const gap = catchUpGap(data, day).length;
    plan.push({ id: DAILY_IDS + offset, at: when, title: "Saku", body: gap ? t(gap === 1 ? "reminderCatchUpOne" : "reminderCatchUpMany", { count: gap }) : t("reminderAnythingElse"), extra: { kind: "catchup" } });
  }
  data.creditCards.forEach((card, index) => {
    for (let monthOffset = 0; monthOffset < 2; monthOffset++) {
      const month = shiftMonth(today.slice(0, 7), monthOffset);
      const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
      const remindOn = shiftDate(`${month}-${String(Math.min(card.dueDay, lastDay)).padStart(2, "0")}`, -3), when = at(remindOn, settings.time);
      if (when > now && cardDue(data, card.id, month) > 0)
        plan.push({ id: CARD_IDS + index * 2 + monthOffset, at: when, title: "Saku", body: t("reminderCardDue", { card: card.name }), extra: { kind: "card", cardId: card.id } });
    }
  });
  return plan;
}

export async function loadReminder() {
  return remindersSupported() ? parseReminder((await Preferences.get({ key })).value) : defaultReminder;
}
export async function saveReminder(settings: ReminderSettings) {
  await Preferences.set({ key, value: JSON.stringify(settings) });
}
export async function requestReminderPermission() {
  const current = await LocalNotifications.checkPermissions();
  return (current.display === "granted" ? current : await LocalNotifications.requestPermissions()).display === "granted";
}
const REMINDER_CHANNEL = "saku-reminders";
export async function cancelReminders() {
  if (!remindersSupported()) return;
  const pending = (await LocalNotifications.getPending()).notifications.filter((item) => isOurs(item.id));
  if (pending.length) await LocalNotifications.cancel({ notifications: pending.map((item) => ({ id: item.id })) });
}
export async function scheduleReminders(data: Data, settings: ReminderSettings) {
  if (!remindersSupported()) return;
  await cancelReminders();
  const plan = reminderPlan(data, settings, new Date());
  if (!plan.length) return;
  // A named channel lets people quiet reminders in Android settings without muting anything else.
  await LocalNotifications.createChannel({ id: REMINDER_CHANNEL, name: t("reminderChannelName"), importance: 3 }).catch(() => undefined);
  await LocalNotifications.schedule({ notifications: plan.map((item) => ({ id: item.id, title: item.title, body: item.body, channelId: REMINDER_CHANNEL, schedule: { at: item.at, allowWhileIdle: true }, isExactNotification: false, smallIcon: "ic_stat_saku", extra: item.extra })) });
}
// Schedules and cancellations run in order, so a schedule still in flight can't re-add
// reminders after the user turned them off: the last requested state always wins.
let pendingSync: Promise<void> = Promise.resolve();
export function syncReminders(data: Data, settings: ReminderSettings) {
  pendingSync = pendingSync.catch(() => undefined).then(() => settings.enabled ? scheduleReminders(data, settings) : cancelReminders());
  return pendingSync;
}
