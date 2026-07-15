import { useMemo } from 'react';
import { Bell, BellOff, ChevronDown, ChevronLeft, ChevronRight, Plus, Users } from 'lucide-react';
import type { Account, CalendarEvent, CalendarListEntry, CalendarLocalTask, CalendarSettings, MailActionLog, MailThread } from '../../../shared/types';
import { calendarEventsForDate, calendarMonthDays } from '../../../shared/calendarWorkspace';
import { localCalendarDateKey, secondaryCalendarTimeLabel } from './calendarWorkspaceUtils';

interface CalendarSidebarProps {
  accounts: Account[];
  accountEmail: string;
  anchor: Date;
  selectedDate: Date;
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

export function CalendarSidebar(props: CalendarSidebarProps) {
  const miniDays = calendarMonthDays(props.anchor, props.settings.weekStartsOn);
  const miniWeeks = Array.from({ length: 6 }, (_, index) => miniDays.slice(index * 7, index * 7 + 7));
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][(index + props.settings.weekStartsOn) % 7]);
  const selectedKey = localCalendarDateKey(props.selectedDate);
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
    <aside className="dm-calendar-sidebar w-[272px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--rail-bg)] px-3 pb-4 pt-3">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0 text-[calc(19px*var(--font-scale))] font-semibold tracking-[-0.025em] text-[var(--text-primary)]">
          {props.anchor.toLocaleDateString([], { month: 'long' })}{' '}
          <span className="font-medium text-[var(--accent)]">{props.anchor.getFullYear()}</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => props.onNavigateMonth(-1)} aria-label="Previous month" className="cursor-pointer rounded-md p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => props.onNavigateMonth(1)} aria-label="Next month" className="cursor-pointer rounded-md p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><ChevronRight className="h-4 w-4" /></button>
          <button type="button" onClick={() => props.onCreate(props.selectedDate)} aria-label="Create event" className="ml-1 cursor-pointer rounded-full bg-[var(--raised-surface)] p-2 text-[var(--text-secondary)] shadow-[inset_0_0_0_1px_var(--border)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><Plus className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="mb-3 px-1">
        <div className="grid grid-cols-7 text-center">
          {weekdayLabels.map((label, index) => <span key={`${label}-${index}`} className="py-1 text-[calc(8px*var(--font-scale))] font-semibold text-[var(--text-tertiary)]">{label}</span>)}
        </div>
        <div className="space-y-0.5">
          {miniWeeks.map((week, weekIndex) => {
            const weekSelected = week.some(day => day.key === selectedKey);
            return (
              <div key={weekIndex} className={`grid grid-cols-7 rounded-md px-0.5 ${weekSelected ? 'bg-[var(--selected-row)]' : ''}`}>
                {week.map(day => {
                  const dayEvents = calendarEventsForDate(props.events, day.date).slice(0, 3);
                  const selected = day.key === selectedKey;
                  return (
                    <button
                      key={day.key}
                      type="button"
                      aria-pressed={selected}
                      aria-label={day.date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                      onClick={() => props.onSelectDate(day.date)}
                      className={`relative flex h-8 cursor-pointer flex-col items-center justify-center rounded-full text-[calc(10px*var(--font-scale))] font-medium focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${day.inMonth ? 'text-[var(--text-secondary)] hover:bg-[var(--hover-row)]' : 'text-[var(--text-tertiary)] opacity-35'} ${selected ? 'bg-[var(--accent)] text-white opacity-100 hover:bg-[var(--accent)]' : day.isToday ? 'ring-1 ring-inset ring-[var(--accent)] text-[var(--accent)]' : ''}`}
                    >
                      <span>{day.date.getDate()}</span>
                      {dayEvents.length > 0 && (
                        <span className="absolute bottom-[2px] flex gap-[2px]" aria-hidden="true">
                          {dayEvents.map(event => <span key={`${event.accountId}:${event.calendarId}:${event.id}`} className="h-[3px] w-[3px] rounded-full" style={{ backgroundColor: selected ? '#ffffff' : calendarByKey.get(`${event.accountId}:${event.calendarId}`)?.backgroundColor || 'var(--accent)' }} />)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {props.accounts.length > 0 && (
        <label className="relative mb-4 flex items-center rounded-lg bg-[var(--panel-bg)] shadow-[inset_0_0_0_1px_var(--border)] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--accent)]">
          <Users className="pointer-events-none ml-2.5 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <select value={props.accountEmail} onChange={event => props.onAccountChange(event.target.value)} aria-label="Calendar account" className="min-w-0 flex-1 cursor-pointer appearance-none bg-transparent py-2 pl-2 pr-7 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)] outline-none">
            <option value="unified">All connected accounts</option>
            {props.accounts.map(account => <option key={account.id} value={account.email}>{account.email}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        </label>
      )}

      <section className="mb-4">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Up next</h2>
          <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">from {props.selectedDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
        </div>
        {upcomingGroups.length === 0 ? (
          <button type="button" onClick={() => props.onCreate(props.selectedDate)} className="w-full cursor-pointer rounded-lg bg-[var(--panel-bg)] px-3 py-3 text-left text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)] shadow-[inset_0_0_0_1px_var(--border)] hover:text-[var(--accent)]">No upcoming events. Create one.</button>
        ) : (
          <div className="space-y-3.5">
            {upcomingGroups.map(group => (
              <div key={localCalendarDateKey(group.date)}>
                <div className="mb-1.5 flex items-center gap-2 px-1">
                  <div className="shrink-0 text-[calc(11px*var(--font-scale))] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
                    {group.date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                  </div>
                  <div aria-hidden="true" className="h-px min-w-3 flex-1 bg-[var(--border)]" />
                </div>
                <div className="space-y-0.5">
                  {group.events.map(event => {
                    const calendar = calendarByKey.get(`${event.accountId}:${event.calendarId}`);
                    return (
                      <button key={`${event.accountId}:${event.calendarId}:${event.id}`} type="button" onClick={() => props.onSelectEvent(event)} className="group flex w-full cursor-pointer items-start gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-[var(--hover-row)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: calendar?.backgroundColor || 'var(--accent)' }} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{event.isAllDay ? 'All day' : new Date(event.startAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                          <span className="block truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">{event.summary}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-[var(--border)] pt-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Calendars</h2>
          {props.calendars.length === 0 && props.mutationAccount && <button type="button" onClick={props.onAuthorize} className="cursor-pointer text-[calc(9px*var(--font-scale))] font-semibold text-[var(--accent)]">Connect</button>}
        </div>
        <div className="mb-2 flex items-center gap-1">
          <select value={props.settings.activeCalendarSetId || ''} onChange={event => props.onApplyCalendarSet(event.target.value)} aria-label="Calendar set" className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] outline-none focus:border-[var(--accent)]">
            <option value="">All calendars</option>
            {props.settings.calendarSets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}
          </select>
          <button type="button" onClick={props.onCreateCalendarSet} title="Save visible calendars as a set" className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5 text-[var(--text-secondary)] hover:text-[var(--accent)]">+</button>
          {props.settings.activeCalendarSetId && <button type="button" onClick={props.onDeleteCalendarSet} title="Delete active calendar set" className="cursor-pointer rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5 text-[var(--danger)]">−</button>}
        </div>
        <div className="flex flex-col gap-0.5">
          {props.calendars.map(calendar => {
            const visible = !props.settings.hiddenCalendarIds.includes(`${calendar.accountId}:${calendar.id}`) && !props.settings.hiddenCalendarIds.includes(calendar.id);
            const alertsMuted = props.settings.mutedNotificationCalendarKeys.includes(`${calendar.accountId}:${calendar.id}`);
            return (
              <div key={`${calendar.accountId}:${calendar.id}`} className="group flex items-center rounded-md pr-1 hover:bg-[var(--hover-row)]">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1.5 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  <input type="checkbox" checked={visible} onChange={() => props.onToggleCalendar(calendar.accountId, calendar.id)} className="sr-only" />
                  <span className={`h-3 w-3 rounded-full border-2 ${visible ? '' : 'bg-transparent opacity-40'}`} style={{ backgroundColor: visible ? calendar.backgroundColor : 'transparent', borderColor: calendar.backgroundColor }} />
                  <span className="min-w-0 flex-1 truncate">{calendar.summary}</span>
                  <span className="text-[calc(8px*var(--font-scale))] text-[var(--text-tertiary)]">{props.accountEmail === 'unified' ? calendar.accountId.split('@')[0] : calendar.primary ? 'primary' : ''}</span>
                </label>
                <button type="button" onClick={() => props.onToggleCalendarAlerts(calendar.accountId, calendar.id)} title={alertsMuted ? 'Enable alerts for this calendar' : 'Mute alerts for this calendar'} className="cursor-pointer text-[var(--text-tertiary)] opacity-0 hover:text-[var(--accent)] group-hover:opacity-100 focus:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{alertsMuted ? <BellOff className="h-3 w-3" /> : <Bell className="h-3 w-3" />}</button>
              </div>
            );
          })}
        </div>
      </section>

      {props.mailTasks.length > 0 && <section className="mt-4 border-t border-[var(--border)] pt-3">
        <h3 className="mb-2 px-1 text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Mail tasks</h3>
        <div className="flex flex-col gap-1">{props.mailTasks.slice(0, 8).map(task => {
          const thread = props.threads.find(item => item.accountId === task.accountId && item.id === task.threadId);
          return <div key={task.id} className="dm-inset group flex items-start gap-2 rounded-md bg-[var(--panel-bg)] p-2 shadow-[inset_0_0_0_1px_var(--border)]">
            <button type="button" onClick={() => props.onCompleteTask(task)} aria-label={`Complete ${task.title}`} className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border border-[var(--accent)] hover:bg-[var(--accent)]" />
            <button type="button" disabled={!thread} onClick={() => thread && props.onOpenThread(thread)} className="min-w-0 flex-1 cursor-pointer text-left"><span className="block truncate text-[calc(9px*var(--font-scale))] font-medium text-[var(--text-primary)]">{task.title}</span><span className="block text-[calc(8px*var(--font-scale))] text-[var(--text-tertiary)]">{new Date(task.dueAt).toLocaleString()} · {task.source === 'threadReminder' ? 'Reminder' : 'Reply pipeline'}</span></button>
            <button type="button" onClick={() => props.onSnoozeTask(task)} title="Snooze until tomorrow" className="cursor-pointer text-[calc(8px*var(--font-scale))] text-[var(--text-tertiary)] opacity-0 hover:text-[var(--accent)] group-hover:opacity-100">+1d</button>
          </div>;
        })}</div>
      </section>}

      {props.settings.favoriteTimeZones.length > 0 && <section className="dm-inset mt-3 rounded-md bg-[var(--panel-bg)] p-2 text-[calc(9px*var(--font-scale))] shadow-[inset_0_0_0_1px_var(--border)]"><h3 className="mb-1 font-semibold text-[var(--text-primary)]">World clock</h3>{props.settings.favoriteTimeZones.map(timeZone => { const label = secondaryCalendarTimeLabel(timeZone); return label ? <div key={timeZone} className="flex justify-between gap-2 text-[var(--text-secondary)]"><span className="truncate">{timeZone}</span><span className="shrink-0">{label.split(' ')[0]}</span></div> : null; })}</section>}
      {props.syncIssues.length > 0 && <section className="mt-3 rounded-md border border-[var(--warning)]/35 bg-[var(--warning)]/10 p-2"><h3 className="mb-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--warning)]">Calendar sync issues</h3><div className="flex flex-col gap-1">{props.syncIssues.map(action => <div key={action.id} className="rounded bg-[var(--app-bg)]/70 px-2 py-1.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]"><div className="font-medium text-[var(--text-primary)]">{isConflict(action) ? 'Remote edit conflict' : action.status === 'pending_sync' ? 'Waiting for connection' : 'Change not applied'}</div>{action.failureMessage && <div className="mt-0.5 line-clamp-2">{action.failureMessage}</div>}{isConflict(action) && <div className="mt-1.5 flex gap-1"><button type="button" onClick={() => props.onResolveConflict(action, 'remote')} className="cursor-pointer rounded border border-[var(--border)] px-1.5 py-1 font-medium hover:text-[var(--accent)]">Use remote</button><button type="button" onClick={() => props.onResolveConflict(action, 'local')} className="cursor-pointer rounded border border-[var(--warning)]/50 px-1.5 py-1 font-medium text-[var(--warning)]">Use local</button></div>}</div>)}</div></section>}
    </aside>
  );
}
