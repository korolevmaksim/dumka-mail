import { Notification, shell, type BrowserWindow, type NotificationAction } from 'electron';
import { isCalendarReminderDue } from '../shared/calendarReminderSchedule';
import { CalendarEventsRepo, SettingsRepo } from './database';
import { GoogleWorkspaceService } from './googleWorkspace';

interface CalendarNotificationSettings {
  enabled: boolean;
  sound: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  defaultReminderMinutes: number;
  hideDetails: boolean;
  mutedCalendarKeys: string[];
}

const liveNotifications = new Set<Notification>();

function readSettings(): CalendarNotificationSettings {
  try {
    const parsed = JSON.parse(SettingsRepo.get('appSettings') || '{}');
    return {
      enabled: parsed.notifications?.desktopNotifications !== false && parsed.notifications?.reminderNotifications !== false,
      sound: parsed.notifications?.sound === true,
      quietHoursEnabled: parsed.notifications?.quietHoursEnabled === true,
      quietHoursStart: parsed.notifications?.quietHoursStart || '22:00',
      quietHoursEnd: parsed.notifications?.quietHoursEnd || '07:00',
      defaultReminderMinutes: Math.max(0, Number(parsed.calendar?.defaultReminderMinutes ?? 10)),
      hideDetails: parsed.calendar?.hideNotificationDetails === true,
      mutedCalendarKeys: Array.isArray(parsed.calendar?.mutedNotificationCalendarKeys) ? parsed.calendar.mutedNotificationCalendarKeys : [],
    };
  } catch {
    return { enabled: true, sound: false, quietHoursEnabled: false, quietHoursStart: '22:00', quietHoursEnd: '07:00', defaultReminderMinutes: 10, hideDetails: false, mutedCalendarKeys: [] };
  }
}

function clockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null;
}

function isQuiet(settings: CalendarNotificationSettings, now: Date): boolean {
  if (!settings.quietHoursEnabled) return false;
  const start = clockMinutes(settings.quietHoursStart);
  const end = clockMinutes(settings.quietHoursEnd);
  if (start === null || end === null || start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

let running = false;

export async function runCalendarNotificationPass(getWindow: () => BrowserWindow | null, now = new Date()): Promise<void> {
  if (running) return;
  const settings = readSettings();
  if (!settings.enabled || isQuiet(settings, now) || !Notification.isSupported()) return;
  running = true;
  try {
    const start = new Date(now.getTime() - 24 * 60 * 60_000);
    const end = new Date(now.getTime() + 24 * 60 * 60_000);
    for (const event of CalendarEventsRepo.listNotificationCandidates(start.toISOString(), end.toISOString(), 50, now.toISOString())) {
      if (settings.mutedCalendarKeys.includes(`${event.accountId}:${event.calendarId}`)) continue;
      if (!isCalendarReminderDue(event, settings.defaultReminderMinutes, now)) continue;
      const startLabel = event.isAllDay ? 'All day' : new Date(event.startAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const actions: NotificationAction[] = [
        { type: 'button', text: event.conferenceUrl ? 'Join' : 'Open' },
        { type: 'button', text: 'Snooze 5 min' },
      ];
      if (event.selfResponseStatus && event.selfResponseStatus !== 'accepted') actions.push({ type: 'button', text: 'Accept' });
      const notification = new Notification({
        title: settings.hideDetails ? 'Upcoming calendar event' : event.summary || 'Calendar event',
        body: settings.hideDetails ? startLabel : [startLabel, event.location].filter(Boolean).join(' · '),
        silent: !settings.sound,
        actions,
      });
      liveNotifications.add(notification);
      notification.on('click', () => {
        const window = getWindow();
        window?.show();
        window?.focus();
        window?.webContents.send('api:openCalendar', { accountId: event.accountId, eventId: event.id });
        liveNotifications.delete(notification);
      });
      notification.on('action', (_event, index) => {
        if (index === 2) {
          void GoogleWorkspaceService.respondToCalendarEvent(event.accountId, event.calendarId, event.id, 'accepted')
            .then(updated => {
              CalendarEventsRepo.saveMany([updated]);
              getWindow()?.webContents.send('api:calendarChanged', { accountId: event.accountId });
            })
            .catch(error => console.error('Calendar notification RSVP failed:', error));
        } else if (index === 1) {
          CalendarEventsRepo.snoozeNotification(event, new Date(Date.now() + 5 * 60_000).toISOString());
        } else if (index === 0 && event.conferenceUrl) {
          void shell.openExternal(event.conferenceUrl);
        } else {
          const window = getWindow();
          window?.show();
          window?.focus();
          window?.webContents.send('api:openCalendar', { accountId: event.accountId, eventId: event.id });
        }
        liveNotifications.delete(notification);
      });
      notification.on('close', () => liveNotifications.delete(notification));
      notification.on('failed', () => liveNotifications.delete(notification));
      notification.show();
      CalendarEventsRepo.markNotified(event);
    }
  } finally {
    running = false;
  }
}

export function startCalendarNotificationWorker(getWindow: () => BrowserWindow | null, intervalMs = 30_000): NodeJS.Timeout {
  void runCalendarNotificationPass(getWindow);
  const timer = setInterval(() => void runCalendarNotificationPass(getWindow), intervalMs);
  timer.unref?.();
  return timer;
}
