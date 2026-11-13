import { useMemo } from 'react';
import { Bell, BellOff, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { Account, CalendarEvent, CalendarListEntry, CalendarLocalTask, CalendarSettings, MailActionLog, MailThread } from '../../../shared/types';
import { calendarEventsForDate, calendarMonthDays } from '../../../shared/calendarWorkspace';
import { formatDateTime, formatDay, formatWeekdayDay } from '../../../shared/dateFormat';
import { SETTINGS_SELECT_CLASS } from '../components/settings/SettingsControls';
import { localCalendarDateKey } from './calendarWorkspaceUtils';
import { calendarEventTimeLabel, monthYearLabel, secondaryClockLabel, spokenDayLabel, timeZoneCityName, weekdayInitials } from './calendarDateLabels';
import { calendarEventColor, calendarListColor } from './calendarEventColors';
import { calendarEventKey } from './calendarTimeLayout';
import { CAL_FOCUS, CAL_LINK, CAL_SECTION_HEADING, CAL_SMALL_ICON_BUTTON } from './calendarUi';

interface CalendarSidebarProps {
  accounts: Account[];
  accountEmail: string;
  anchor: Date;
  selectedDate: Date;
  selectedEventKey: string | null;
  events: CalendarEvent[];
  calendars: CalendarListEntry[];
  mutationAccount: string;
  settings: CalendarSettings;
  mailTasks: CalendarLocalTask[];
  threads: MailThread[];
  syncIssues: MailActionLog[];
  onAccountChange: (email: string) => void;
  onSelectDate: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onNavigateMonth: (delta: -1 | 1) => void;
  onCreate: (date: Date) => void;
  onAuthorize: () => void;
  onApplyCalendarSet: (setId: string) => void;
  onCreateCalendarSet: () => void;
  onDeleteCalendarSet: () => void;
  onToggleCalendar: (accountId: string, calendarId: string) => void;
  onToggleCalendarAlerts: (accountId: string, calendarId: string) => void;
  onCompleteTask: (task: CalendarLocalTask) => void;
  onSnoozeTask: (task: CalendarLocalTask) => void;
  onOpenThread: (thread: MailThread) => void;
  onResolveConflict: (action: MailActionLog, strategy: 'local' | 'remote') => void;
}

function isConflict(action: MailActionLog): boolean {
  if (!action.payloadJson) return false;
  try {
    return JSON.parse(action.payloadJson).conflict === true;
  } catch {
    return false;
  }
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

const SMALL_TEXT = 'text-[calc(11px*var(--font-scale))]';
const BODY_TEXT = 'text-[calc(12px*var(--font-scale))]';

export function CalendarSidebar(props: CalendarSidebarProps) {
  const miniDays = calendarMonthDays(props.anchor, props.settings.weekStartsOn);
  const miniWeeks = Array.from({ length: 6 }, (_, index) => miniDays.slice(index * 7, index * 7 + 7));
  const initials = weekdayInitials(props.settings.weekStartsOn);
  const selectedKey = localCalendarDateKey(props.selectedDate);
  const now = new Date();
  const calendarByKey = useMemo(
    () => new Map(props.calendars.map(calendar => [`${calendar.accountId}:${calendar.id}`, calendar])),
    [props.calendars],
  );
  const upcomingGroups = useMemo(() => {
    const threshold = startOfDay(props.selectedDate).getTime();
    const upcoming = props.events
      .filter(event => Date.parse(event.endAt) > threshold)
      .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))
      .slice(0, 10);
    const groups = new Map<string, { date: Date; events: CalendarEvent[] }>();
    for (const event of upcoming) {
      const eventDate = new Date(Math.max(Date.parse(event.startAt), threshold));
      const key = localCalendarDateKey(eventDate);
      const group = groups.get(key) || { date: eventDate, events: [] };
      group.events.push(event);
      groups.set(key, group);
    }
    return Array.from(groups.values());
  }, [props.events, props.selectedDate]);

  return (
    <aside className="dm-calendar-sidebar flex w-[264px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-[var(--border)] bg-[var(--rail-bg)] px-3 pb-4 pt-3" aria-label="Calendar sidebar">
      <section aria-label="Month">
        <div className="mb-1 flex items-center justify-between gap-2 pl-1">
          <h2 className={`min-w-0 truncate ${BODY_TEXT} font-semibold text-[var(--text-primary)]`}>{monthYearLabel(props.anchor)}</h2>
          <div className="flex shrink-0 items-center">
            <button type="button" onClick={() => props.onNavigateMonth(-1)} aria-label="Previous month" title="Previous month" className={CAL_SMALL_ICON_BUTTON}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
            <button type="button" onClick={() => props.onNavigateMonth(1)} aria-label="Next month" title="Next month" className={CAL_SMALL_ICON_BUTTON}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center" aria-hidden="true">
          {initials.map((label, index) => <span key={`${label}-${index}`} className={`py-1 ${SMALL_TEXT} font-medium text-[var(--text-tertiary)]`}>{label}</span>)}
        </div>
        <div className="flex flex-col gap-0.5">
          {miniWeeks.map((week, weekIndex) => (
            <div key={weekIndex} className="grid grid-cols-7">
              {week.map(day => {
                const dayEvents = calendarEventsForDate(props.events, day.date);
                const selected = day.key === selectedKey;
                return (
                  <button
                    key={day.key}
                    type="button"
                    aria-pressed={selected}
                    aria-current={day.isToday ? 'date' : undefined}
                    aria-label={`${spokenDayLabel(day.date)}${day.isToday ? ', today' : ''}${dayEvents.length > 0 ? `, ${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}` : ''}`}
                    onClick={() => props.onSelectDate(day.date)}
                    className={`relative mx-auto flex h-8 w-8 cursor-pointer flex-col items-center justify-center rounded-full ${BODY_TEXT} tabular-nums ${CAL_FOCUS} ${
                      selected
                        ? 'bg-[var(--accent-fill)] font-semibold text-[var(--on-accent)]'
                        : day.isToday
                          ? 'font-semibold text-[var(--accent-ink)] shadow-[inset_0_0_0_1.5px_var(--accent)] hover:bg-[var(--hover-row)]'
                          : day.inMonth
                            ? 'text-[var(--text-primary)] hover:bg-[var(--hover-row)]'
                            : 'text-[var(--text-tertiary)] hover:bg-[var(--hover-row)]'
                    }`}
                  >
                    <span className="leading-none">{day.date.getDate()}</span>
                    {dayEvents.length > 0 && (
                      <span className="absolute bottom-[3px] flex gap-[2px]" aria-hidden="true">
                        {dayEvents.slice(0, 3).map(event => (
                          <span
                            key={calendarEventKey(event)}
                            className="h-[3px] w-[3px] rounded-full"
                            style={{ backgroundColor: selected ? 'var(--on-accent)' : calendarEventColor(event, calendarByKey.get(`${event.accountId}:${event.calendarId}`)) }}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {props.accounts.length > 1 && (
        <label className="flex flex-col gap-1">
          <span className={CAL_SECTION_HEADING}>Accounts</span>
          <select value={props.accountEmail} onChange={event => props.onAccountChange(event.target.value)} className={`${SETTINGS_SELECT_CLASS} w-full min-w-0`}>
            <option value="unified">All accounts</option>
            {props.accounts.map(account => <option key={account.id} value={account.email}>{account.email}</option>)}
          </select>
        </label>
      )}

      <section aria-labelledby="calendar-up-next">
        <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
          <h2 id="calendar-up-next" className={`${BODY_TEXT} font-semibold text-[var(--text-primary)]`}>Up next</h2>
          <span className={`${SMALL_TEXT} text-[var(--text-secondary)]`}>from {formatDay(props.selectedDate, now)}</span>
        </div>
        {upcomingGroups.length === 0 ? (
          <div className={`rounded-[var(--control-radius)] border border-dashed border-[var(--strong-border)] px-3 py-3 ${BODY_TEXT} text-[var(--text-secondary)]`}>
            Nothing scheduled.{' '}
            <button type="button" onClick={() => props.onCreate(props.selectedDate)} className={CAL_LINK}>New event</button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {upcomingGroups.map(group => (
              <div key={localCalendarDateKey(group.date)}>
                <h3 className={`mb-0.5 px-1 ${SMALL_TEXT} font-semibold text-[var(--text-secondary)]`}>{formatWeekdayDay(group.date, now)}</h3>
                <ul className="flex flex-col">
                  {group.events.map(event => {
                    const calendar = calendarByKey.get(`${event.accountId}:${event.calendarId}`);
                    const key = calendarEventKey(event);
                    const selected = key === props.selectedEventKey;
                    const title = event.summary || '(no title)';
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          onClick={() => props.onSelectEvent(event)}
                          title={[title, calendar?.summary].filter(Boolean).join(' · ')}
                          aria-current={selected ? 'true' : undefined}
                          className={`flex w-full min-w-0 cursor-pointer items-start gap-2 rounded-[var(--control-radius)] px-1.5 py-1.5 text-left ${CAL_FOCUS} ${selected ? 'bg-[var(--selected-row)]' : 'hover:bg-[var(--hover-row)]'}`}
                        >
                          <span aria-hidden="true" className="mt-[5px] h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: calendarEventColor(event, calendar) }} />
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate ${BODY_TEXT} font-medium text-[var(--text-primary)]`}>{title}</span>
                            <span className={`block truncate ${SMALL_TEXT} tabular-nums text-[var(--text-secondary)]`}>
                              {calendarEventTimeLabel(event, now)}
                              {props.accountEmail === 'unified' && calendar ? ` · ${calendar.summary}` : ''}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="calendar-list-heading" className="border-t border-[var(--border)] pt-3">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <h2 id="calendar-list-heading" className={`${BODY_TEXT} font-semibold text-[var(--text-primary)]`}>Calendars</h2>
          {props.calendars.length === 0 && props.mutationAccount && <button type="button" onClick={props.onAuthorize} className={CAL_LINK}>Connect</button>}
        </div>
        {(props.settings.calendarSets.length > 0 || props.calendars.length > 1) && (
          <div className="mb-1.5 flex items-center gap-1">
            <select value={props.settings.activeCalendarSetId || ''} onChange={event => props.onApplyCalendarSet(event.target.value)} aria-label="Calendar set" className={`${SETTINGS_SELECT_CLASS} min-w-0 flex-1`}>
              <option value="">All calendars</option>
              {props.settings.calendarSets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}
            </select>
            <button type="button" onClick={props.onCreateCalendarSet} title="Save the shown calendars as a set" aria-label="Save the shown calendars as a set" className={CAL_SMALL_ICON_BUTTON}><Plus aria-hidden="true" className="h-3.5 w-3.5" /></button>
            {props.settings.activeCalendarSetId && <button type="button" onClick={props.onDeleteCalendarSet} title="Delete this set" aria-label="Delete this calendar set" className={CAL_SMALL_ICON_BUTTON}><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></button>}
          </div>
        )}
        <ul className="flex flex-col">
          {props.calendars.map(calendar => {
            const key = `${calendar.accountId}:${calendar.id}`;
            const visible = !props.settings.hiddenCalendarIds.includes(key) && !props.settings.hiddenCalendarIds.includes(calendar.id);
            const alertsMuted = props.settings.mutedNotificationCalendarKeys.includes(key);
            const color = calendarListColor(calendar);
            const detail = props.accountEmail === 'unified' ? calendar.accountId : calendar.primary ? 'Main calendar' : '';
            return (
              <li key={key} className="group flex items-center gap-1 rounded-[var(--control-radius)] pr-0.5 hover:bg-[var(--hover-row)]">
                <label className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[var(--control-radius)] px-1.5 py-1.5 ${BODY_TEXT} text-[var(--text-primary)] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--accent)]`} title={[calendar.summary, detail].filter(Boolean).join(' · ')}>
                  <input type="checkbox" checked={visible} onChange={() => props.onToggleCalendar(calendar.accountId, calendar.id)} className="sr-only" />
                  <span aria-hidden="true" className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border-2" style={{ backgroundColor: visible ? color : 'transparent', borderColor: color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{calendar.summary}</span>
                    {detail && <span className={`block truncate ${SMALL_TEXT} text-[var(--text-secondary)]`}>{detail}</span>}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => props.onToggleCalendarAlerts(calendar.accountId, calendar.id)}
                  title={alertsMuted ? 'Turn alerts on for this calendar' : 'Mute alerts for this calendar'}
                  aria-label={`${alertsMuted ? 'Turn alerts on' : 'Mute alerts'} for ${calendar.summary}`}
                  aria-pressed={alertsMuted}
                  className={`${CAL_SMALL_ICON_BUTTON} ${alertsMuted ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
                >
                  {alertsMuted ? <BellOff aria-hidden="true" className="h-3.5 w-3.5" /> : <Bell aria-hidden="true" className="h-3.5 w-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {props.mailTasks.length > 0 && (
        <section aria-labelledby="calendar-mail-tasks" className="border-t border-[var(--border)] pt-3">
          <h2 id="calendar-mail-tasks" className={`mb-1.5 px-1 ${BODY_TEXT} font-semibold text-[var(--text-primary)]`}>Mail to follow up</h2>
          <ul className="flex flex-col gap-0.5">
            {props.mailTasks.slice(0, 8).map(task => {
              const thread = props.threads.find(item => item.accountId === task.accountId && item.id === task.threadId);
              return (
                <li key={task.id} className="group flex items-start gap-1.5 rounded-[var(--control-radius)] px-1 py-1 hover:bg-[var(--hover-row)]">
                  <button type="button" onClick={() => props.onCompleteTask(task)} aria-label={`Mark done: ${task.title}`} title="Mark done" className={`mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded ${CAL_FOCUS}`}>
                    <span aria-hidden="true" className="h-3.5 w-3.5 rounded-[3px] border-2 border-[var(--strong-border)] group-hover:border-[var(--accent)]" />
                  </button>
                  <button type="button" disabled={!thread} onClick={() => thread && props.onOpenThread(thread)} title={task.title} className={`min-w-0 flex-1 cursor-pointer rounded py-0.5 text-left disabled:cursor-default ${CAL_FOCUS}`}>
                    <span className={`block truncate ${BODY_TEXT} text-[var(--text-primary)]`}>{task.title}</span>
                    <span className={`block truncate ${SMALL_TEXT} text-[var(--text-secondary)]`}>{formatDateTime(task.dueAt, now)} · {task.source === 'threadReminder' ? 'Reminder' : 'Reply follow-up'}</span>
                  </button>
                  <button type="button" onClick={() => props.onSnoozeTask(task)} title="Move to tomorrow 09:00" aria-label={`Move ${task.title} to tomorrow`} className={`h-6 shrink-0 cursor-pointer rounded px-1.5 ${SMALL_TEXT} font-medium text-[var(--text-secondary)] opacity-0 hover:text-[var(--text-primary)] group-hover:opacity-100 focus-visible:opacity-100 ${CAL_FOCUS}`}>Tomorrow</button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {props.settings.favoriteTimeZones.length > 0 && (
        <section aria-labelledby="calendar-world-clock" className="border-t border-[var(--border)] pt-3">
          <h2 id="calendar-world-clock" className={`mb-1 px-1 ${BODY_TEXT} font-semibold text-[var(--text-primary)]`}>World clock</h2>
          <ul className="flex flex-col gap-0.5 px-1">
            {props.settings.favoriteTimeZones.map(timeZone => {
              const label = secondaryClockLabel(timeZone, now);
              return label ? (
                <li key={timeZone} className={`flex justify-between gap-2 ${BODY_TEXT} text-[var(--text-secondary)]`}>
                  <span className="truncate" title={timeZone}>{timeZoneCityName(timeZone)}</span>
                  <span className="shrink-0 tabular-nums text-[var(--text-primary)]">{label.split(' ')[0]}</span>
                </li>
              ) : null;
            })}
          </ul>
        </section>
      )}

      {props.syncIssues.length > 0 && (
        <section aria-labelledby="calendar-sync-issues" className="rounded-[var(--control-radius)] border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-2">
          <h2 id="calendar-sync-issues" className={`mb-1 ${SMALL_TEXT} font-semibold text-[var(--warning-solid)]`}>Changes not yet in Google Calendar</h2>
          <ul className="flex flex-col gap-1">
            {props.syncIssues.map(action => (
              <li key={action.id} className={`rounded bg-[var(--app-bg)] px-2 py-1.5 ${SMALL_TEXT} text-[var(--text-secondary)]`}>
                <div className="font-medium text-[var(--text-primary)]">{isConflict(action) ? 'Changed in Google Calendar too' : action.status === 'pending_sync' ? 'Waiting for connection' : 'Change not applied'}</div>
                {action.failureMessage && <div className="mt-0.5 line-clamp-2">{action.failureMessage}</div>}
                {isConflict(action) && (
                  <div className="mt-1.5 flex gap-1">
                    <button type="button" onClick={() => props.onResolveConflict(action, 'remote')} className={`h-6 cursor-pointer rounded border border-[var(--strong-border)] px-1.5 font-medium text-[var(--text-primary)] hover:bg-[var(--hover-row)] ${CAL_FOCUS}`}>Keep Google's</button>
                    <button type="button" onClick={() => props.onResolveConflict(action, 'local')} className={`h-6 cursor-pointer rounded border border-[var(--strong-border)] px-1.5 font-medium text-[var(--text-primary)] hover:bg-[var(--hover-row)] ${CAL_FOCUS}`}>Keep mine</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
