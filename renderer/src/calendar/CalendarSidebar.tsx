import { Bell, BellOff } from 'lucide-react';
import type { Account, CalendarListEntry, CalendarLocalTask, CalendarSettings, MailActionLog, MailThread } from '../../../shared/types';
import { calendarMonthDays } from '../../../shared/calendarWorkspace';
import { secondaryCalendarTimeLabel } from './calendarWorkspaceUtils';

interface CalendarSidebarProps {
  accounts: Account[];
  accountEmail: string;
  anchor: Date;
  calendars: CalendarListEntry[];
  mutationAccount: string;
  settings: CalendarSettings;
  mailTasks: CalendarLocalTask[];
  threads: MailThread[];
  syncIssues: MailActionLog[];
  onAccountChange: (email: string) => void;
  onSelectDate: (date: Date) => void;
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

export function CalendarSidebar(props: CalendarSidebarProps) {
  const miniDays = calendarMonthDays(props.anchor, props.settings.weekStartsOn);
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][(index + props.settings.weekStartsOn) % 7]);
  return (
    <aside className="w-[238px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--panel-bg)] p-3">
      {props.accounts.length > 1 && (
        <select value={props.accountEmail} onChange={event => props.onAccountChange(event.target.value)} aria-label="Calendar account" className="mb-3 w-full rounded-md border border-[var(--border)] bg-[var(--app-bg)] px-2 py-2 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)]">
          <option value="unified">All accounts</option>
          {props.accounts.map(account => <option key={account.id} value={account.email}>{account.email}</option>)}
        </select>
      )}
      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-2">
        <div className="mb-2 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{props.anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })}</div>
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {weekdayLabels.map((label, index) => <span key={`${label}-${index}`} className="py-1 text-[calc(8px*var(--font-scale))] font-semibold text-[var(--text-tertiary)]">{label}</span>)}
          {miniDays.map(day => <button key={day.key} type="button" onClick={() => props.onSelectDate(day.date)} className={`flex aspect-square items-center justify-center rounded text-[calc(9px*var(--font-scale))] ${day.inMonth ? 'text-[var(--text-secondary)] hover:bg-[var(--hover-row)]' : 'text-[var(--text-tertiary)] opacity-30'} ${day.isToday ? 'bg-[var(--accent)] text-white' : ''}`}>{day.date.getDate()}</button>)}
        </div>
      </div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[calc(10px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Calendars</h2>
        {props.calendars.length === 0 && props.mutationAccount && <button type="button" onClick={props.onAuthorize} className="text-[calc(9px*var(--font-scale))] font-semibold text-[var(--accent)]">Connect</button>}
      </div>
      <div className="mb-3 flex items-center gap-1">
        <select value={props.settings.activeCalendarSetId || ''} onChange={event => props.onApplyCalendarSet(event.target.value)} aria-label="Calendar set" className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
          <option value="">All calendars</option>
          {props.settings.calendarSets.map(set => <option key={set.id} value={set.id}>{set.name}</option>)}
        </select>
        <button type="button" onClick={props.onCreateCalendarSet} title="Save visible calendars as a set" className="rounded border border-[var(--border)] px-2 py-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">+</button>
        {props.settings.activeCalendarSetId && <button type="button" onClick={props.onDeleteCalendarSet} title="Delete active calendar set" className="rounded border border-[var(--border)] px-2 py-1.5 text-[var(--danger)]">−</button>}
      </div>
      <div className="flex flex-col gap-0.5">
        {props.calendars.map(calendar => {
          const visible = !props.settings.hiddenCalendarIds.includes(`${calendar.accountId}:${calendar.id}`) && !props.settings.hiddenCalendarIds.includes(calendar.id);
          const alertsMuted = props.settings.mutedNotificationCalendarKeys.includes(`${calendar.accountId}:${calendar.id}`);
          return (
            <div key={`${calendar.accountId}:${calendar.id}`} className="group flex items-center rounded-md pr-1 hover:bg-[var(--hover-row)]">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <input type="checkbox" checked={visible} onChange={() => props.onToggleCalendar(calendar.accountId, calendar.id)} className="sr-only" />
                <span className={`h-3 w-3 rounded-full border-2 ${visible ? '' : 'bg-transparent opacity-40'}`} style={{ backgroundColor: visible ? calendar.backgroundColor : 'transparent', borderColor: calendar.backgroundColor }} />
                <span className="min-w-0 flex-1 truncate">{calendar.summary}</span>
                <span className="text-[calc(8px*var(--font-scale))] text-[var(--text-tertiary)]">{props.accountEmail === 'unified' ? calendar.accountId.split('@')[0] : calendar.primary ? 'primary' : ''}</span>
              </label>
              <button type="button" onClick={() => props.onToggleCalendarAlerts(calendar.accountId, calendar.id)} title={alertsMuted ? 'Enable alerts for this calendar' : 'Mute alerts for this calendar'} className="text-[var(--text-tertiary)] opacity-0 hover:text-[var(--accent)] group-hover:opacity-100 focus:opacity-100">{alertsMuted ? <BellOff className="h-3 w-3" /> : <Bell className="h-3 w-3" />}</button>
            </div>
          );
        })}
      </div>
      {props.mailTasks.length > 0 && <section className="mt-4 border-t border-[var(--border)] pt-3">
        <h3 className="mb-2 text-[calc(9px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Mail tasks</h3>
        <div className="flex flex-col gap-1">{props.mailTasks.slice(0, 8).map(task => {
          const thread = props.threads.find(item => item.accountId === task.accountId && item.id === task.threadId);
          return <div key={task.id} className="group flex items-start gap-2 rounded-md border border-dashed border-[var(--border)] bg-[var(--app-bg)] p-2">
            <button type="button" onClick={() => props.onCompleteTask(task)} aria-label={`Complete ${task.title}`} className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border border-[var(--accent)] hover:bg-[var(--accent)]" />
            <button type="button" disabled={!thread} onClick={() => thread && props.onOpenThread(thread)} className="min-w-0 flex-1 text-left"><span className="block truncate text-[calc(9px*var(--font-scale))] font-medium text-[var(--text-primary)]">{task.title}</span><span className="block text-[calc(8px*var(--font-scale))] text-[var(--text-tertiary)]">{new Date(task.dueAt).toLocaleString()} · {task.source === 'threadReminder' ? 'Reminder' : 'Reply pipeline'}</span></button>
            <button type="button" onClick={() => props.onSnoozeTask(task)} title="Snooze until tomorrow" className="text-[calc(8px*var(--font-scale))] text-[var(--text-tertiary)] opacity-0 hover:text-[var(--accent)] group-hover:opacity-100">+1d</button>
          </div>;
        })}</div>
      </section>}
      <div className="mt-5 rounded-md bg-[var(--raised-surface)] p-2 text-[calc(9px*var(--font-scale))] leading-relaxed text-[var(--text-tertiary)]"><strong className="text-[var(--text-secondary)]">Shortcuts</strong><br />N new · T today · / search<br />← → navigate · 1–6 views<br />⌥←/→ move · ⌥↑/↓ resize</div>
      {props.settings.favoriteTimeZones.length > 0 && <section className="mt-3 rounded-md border border-[var(--border)] bg-[var(--app-bg)] p-2 text-[calc(9px*var(--font-scale))]"><h3 className="mb-1 font-semibold uppercase text-[var(--text-tertiary)]">World clock</h3>{props.settings.favoriteTimeZones.map(timeZone => { const label = secondaryCalendarTimeLabel(timeZone); return label ? <div key={timeZone} className="flex justify-between gap-2 text-[var(--text-secondary)]"><span className="truncate">{timeZone}</span><span className="shrink-0">{label.split(' ')[0]}</span></div> : null; })}</section>}
      {props.syncIssues.length > 0 && <section className="mt-3 rounded-md border border-[var(--warning)]/35 bg-[var(--warning)]/10 p-2"><h3 className="mb-1 text-[calc(9px*var(--font-scale))] font-semibold uppercase text-[var(--warning)]">Calendar sync issues</h3><div className="flex flex-col gap-1">{props.syncIssues.map(action => <div key={action.id} className="rounded bg-[var(--app-bg)]/70 px-2 py-1.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]"><div className="font-medium text-[var(--text-primary)]">{isConflict(action) ? 'Remote edit conflict' : action.status === 'pending_sync' ? 'Waiting for connection' : 'Change not applied'}</div>{action.failureMessage && <div className="mt-0.5 line-clamp-2">{action.failureMessage}</div>}{isConflict(action) && <div className="mt-1.5 flex gap-1"><button type="button" onClick={() => props.onResolveConflict(action, 'remote')} className="rounded border border-[var(--border)] px-1.5 py-1 font-medium hover:text-[var(--accent)]">Use remote</button><button type="button" onClick={() => props.onResolveConflict(action, 'local')} className="rounded border border-[var(--warning)]/50 px-1.5 py-1 font-medium text-[var(--warning)]">Use local</button></div>}</div>)}</div></section>}
    </aside>
  );
}
