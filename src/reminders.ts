import { t } from "./i18n";
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Preferences } from "@capacitor/preferences";
import { cardDue, shiftDate, shiftMonth, type Data } from "./domain";

export type ReminderSettings = { enabled: boolean; time: string };
// daily: repeats every day at this time until cancelled (master plan 4.4, option a). `at` is its next time.
export type PlannedReminder = { id: number; at: Date; title: string; body: string; extra: { kind: "catchup" | "card"; cardId?: string }; daily?: { hour: number; minute: number } };

// Device-local: the reminder belongs to this phone, not to the synced ledger.
const key = "saku-reminder-v1";
const DAILY_IDS = 1000, CARD_IDS = 2000;
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

// One plain reminder a day at the chosen time, repeating until reminders are turned off, so it keeps going even
// if Saku isn't opened for weeks. It names no amounts (it shows on the lock screen) and wakes nothing. Card
// reminders come 3 days before a due payment.
export function reminderPlan(data: Data, settings: ReminderSettings, now: Date): PlannedReminder[] {
  if (!settings.enabled) return [];
  const today = localISO(now), plan: PlannedReminder[] = [];
  const todayAt = at(today, settings.time);
  plan.push({ id: DAILY_IDS, at: todayAt > now ? todayAt : at(shiftDate(today, 1), settings.time), title: "Saku", body: t("reminderAnythingElse"), extra: { kind: "catchup" },
    daily: { hour: Number(settings.time.slice(0, 2)), minute: Number(settings.time.slice(3, 5)) } });
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
  // Without notification permission (it can be revoked in Android settings) schedule() never settles.
  if ((await LocalNotifications.checkPermissions()).display !== "granted") return;
  // A named channel lets people quiet reminders in Android settings without muting anything else.
  await LocalNotifications.createChannel({ id: REMINDER_CHANNEL, name: t("reminderChannelName"), importance: 3 }).catch(() => undefined);
  await LocalNotifications.schedule({ notifications: plan.map((item) => ({ id: item.id, title: item.title, body: item.body, channelId: REMINDER_CHANNEL, schedule: item.daily ? { on: item.daily, allowWhileIdle: false } : { at: item.at, allowWhileIdle: true }, isExactNotification: false, smallIcon: "ic_stat_saku", extra: item.extra })) });
}
// Schedules and cancellations run in order, so a schedule still in flight can't re-add
// reminders after the user turned them off: the last requested state always wins.
let pendingSync: Promise<void> = Promise.resolve();
export function syncReminders(data: Data, settings: ReminderSettings) {
  const run = () => settings.enabled ? scheduleReminders(data, settings) : cancelReminders();
  // A stuck native call must not hold up every later change, including turning reminders off.
  const bounded = () => Promise.race([run(), new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Reminder update timed out")), 10_000))]);
  pendingSync = pendingSync.catch(() => undefined).then(bounded);
  return pendingSync;
}
