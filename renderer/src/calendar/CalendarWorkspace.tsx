import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, MailPlus, Video, X } from 'lucide-react';
import type { CalendarAttendeeResponse, CalendarEvent, CalendarEventCreateInput, CalendarEventUpdateInput, CalendarLocalTask, CalendarMutationScope, CalendarSettings, CalendarWorkspaceView, MailActionLog } from '../../../shared/types';
import {
  calendarEventDurationMinutes,
  calendarNavigationDate,
  calendarViewRange,
  filterCalendarEvents,
} from '../../../shared/calendarWorkspace';
import { parseIcsInvite } from '../../../shared/calendar';
import type { CalendarInvite } from '../../../shared/types';
import { useAppStore } from '../stores/AppStore';
import { CalendarEventForm } from '../components/CalendarEventForm';
import { emitToast } from '../lib/toastBus';
import { CalendarMonthView } from './CalendarMonthView';
import { CalendarTimeGrid } from './CalendarTimeGrid';
import { CalendarAgendaView, CalendarOverviewView } from './CalendarOverviewViews';
import { CalendarSidebar } from './CalendarSidebar';
import { calendarDuplicateInput, calendarEventUpdateInput, localCalendarDateKey, resolveCalendarAccountScope, restoredCalendarAnchor, secondaryCalendarTimeLabel } from './calendarWorkspaceUtils';
import { CalendarHeader, CALENDAR_VIEW_OPTIONS } from './CalendarHeader';
import { CalendarRsvpActions } from './CalendarRsvpActions';
import { CalendarRelatedMail } from './CalendarRelatedMail';
import { CalendarEventParticipants } from './CalendarEventParticipants';

export function CalendarWorkspace() {
  const store = useAppStore();
  const initialAccount = resolveCalendarAccountScope(
    store.settings.calendar.lastAccountScope,
    store.accounts.map(account => account.email),
  );
  const [accountEmail, setAccountEmail] = useState(initialAccount);
  const [view, setViewState] = useState<CalendarWorkspaceView>(store.settings.calendar.defaultView || 'month');
  const [anchor, setAnchor] = useState(() => restoredCalendarAnchor(store.settings.calendar.lastAnchorDate));
  const [selectedDate, setSelectedDate] = useState(() => restoredCalendarAnchor(store.settings.calendar.lastAnchorDate));
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [initialRange, setInitialRange] = useState<{ startAt: string; endAt: string } | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CalendarEvent[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [icsPreview, setIcsPreview] = useState<{ filename: string; invite: CalendarInvite } | null>(null);
  const [icsCalendarId, setIcsCalendarId] = useState('primary');
  const [draftSeed, setDraftSeed] = useState<{ summary: string; attendees: string[]; sourceMessageId?: string | null; sourceThreadId?: string | null } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const settings = store.settings.calendar;
  const accountEmailsKey = useMemo(() => store.accounts.map(account => account.email).sort().join('\n'), [store.accounts]);
  const scopedAccountIds = useMemo(
    () => accountEmail === 'unified' ? store.accounts.map(account => account.email) : accountEmail ? [accountEmail] : [],
    [accountEmail, accountEmailsKey],
  );
  const secondaryTime = useMemo(() => secondaryCalendarTimeLabel(settings.secondaryTimeZone), [settings.secondaryTimeZone]);
  const range = useMemo(() => calendarViewRange(anchor, view, settings.weekStartsOn), [anchor, settings.weekStartsOn, view]);
  const accountEvents = useMemo(() => store.calendarEvents.filter(event => accountEmail === 'unified' || event.accountId === accountEmail), [accountEmail, store.calendarEvents]);
  const accountCalendars = useMemo(() => store.calendarLists.filter(calendar => accountEmail === 'unified' || calendar.accountId === accountEmail), [accountEmail, store.calendarLists]);
  const mutationAccount = accountEmail === 'unified' ? store.accounts[0]?.email || '' : accountEmail;
  const mutationCalendars = useMemo(() => accountCalendars.filter(calendar => calendar.accountId === mutationAccount), [accountCalendars, mutationAccount]);
  const visibleEvents = useMemo(
    () => filterCalendarEvents(accountEvents, accountCalendars, settings.hiddenCalendarIds || [], query),
    [accountCalendars, accountEvents, query, settings.hiddenCalendarIds],
  );
  const visibleSearchResults = useMemo(
    () => filterCalendarEvents(searchResults, accountCalendars, settings.hiddenCalendarIds || [], ''),
    [accountCalendars, searchResults, settings.hiddenCalendarIds],
  );
  const syncIssues = useMemo(() => store.actionLog.filter(action =>
    ['createCalendarEvent', 'updateCalendarEvent', 'deleteCalendarEvent'].includes(action.kind)
    && (action.status === 'failed' || action.status === 'pending_sync')
    && (accountEmail === 'unified' || action.accountId === accountEmail)
  ).slice(0, 5), [accountEmail, store.actionLog]);
  const mailTasks = useMemo<CalendarLocalTask[]>(() => {
    const inScope = (candidateAccountId: string) => accountEmail === 'unified' || candidateAccountId === accountEmail;
    const reminders: CalendarLocalTask[] = store.threads
      .filter(thread => inScope(thread.accountId) && thread.reminderAt)
      .map(thread => ({ kind: 'task', id: `reminder:${thread.accountId}:${thread.id}`, accountId: thread.accountId, threadId: thread.id, title: thread.subject, dueAt: thread.reminderAt as string, priority: 50, source: 'threadReminder', status: 'pending' }));
    const pipeline: CalendarLocalTask[] = store.replyPipelineItems
      .filter(item => inScope(item.accountId) && (item.dueAt || item.snoozedUntil) && !['resolved', 'suppressed'].includes(item.status))
      .map(item => {
        const thread = store.threads.find(candidate => candidate.accountId === item.accountId && candidate.id === item.threadId);
        return { kind: 'task', id: `pipeline:${item.accountId}:${item.threadId}`, accountId: item.accountId, threadId: item.threadId, title: thread?.subject || 'Reply follow-up', dueAt: item.dueAt || item.snoozedUntil as string, priority: item.priority, source: 'replyPipeline', status: 'pending' };
      });
    return [...reminders, ...pipeline].sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt));
  }, [accountEmail, store.replyPipelineItems, store.threads]);

  useEffect(() => {
    if (!accountEmail) return;
    let active = true;
    setIsSyncing(true);
    setSyncError(null);
    const emails = accountEmail === 'unified' ? store.accounts.map(account => account.email) : [accountEmail];
    void Promise.allSettled(emails.map(email => store.syncCalendarAgenda(email, range)))
      .then(results => {
        if (!active) return;
        const failures = results.filter(result => result.status === 'rejected');
        if (failures.length === 0) return;
        console.error(`Calendar workspace sync failed for ${failures.length} of ${emails.length} accounts.`);
        setSyncError(failures.length === emails.length
          ? 'Offline cache is shown. Reconnect or reauthorize Calendar to refresh.'
          : 'Some accounts could not refresh. Select one in the sidebar to reconnect Calendar.');
      })
      .finally(() => { if (active) setIsSyncing(false); });
    return () => { active = false; };
  }, [accountEmail, accountEmailsKey, range.endAt, range.startAt, store.syncCalendarAgenda]);

  useEffect(() => {
    const emails = store.accounts.map(account => account.email);
    if (accountEmail && (accountEmail === 'unified' || emails.includes(accountEmail))) return;
    setAccountEmail(resolveCalendarAccountScope(settings.lastAccountScope, emails));
  }, [accountEmailsKey, settings.lastAccountScope]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || scopedAccountIds.length === 0) {
      setSearchResults([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void window.electronAPI.searchCalendarEvents(scopedAccountIds, trimmed, 50)
        .then(results => { if (active) setSearchResults(results); })
        .catch(error => {
          console.error('Calendar cache search failed:', error);
          if (active) setSearchResults([]);
        });
    }, 120);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, scopedAccountIds]);

  useEffect(() => {
    const dateKey = localCalendarDateKey(anchor);
    if (settings.lastAnchorDate === dateKey) return;
    void store.updateSettings(draft => { draft.calendar.lastAnchorDate = dateKey; });
  }, [anchor, settings.lastAnchorDate, store.updateSettings]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (store.workspaceView !== 'calendar') return;
      const target = event.target as HTMLElement | null;
      const isEditing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
      if (isEditing && event.key !== 'Escape') return;
      if (event.altKey && selectedEvent && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const start = new Date(selectedEvent.startAt);
        const end = new Date(selectedEvent.endAt);
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          const delta = event.key === 'ArrowLeft' ? -15 : 15;
          void moveEvent(selectedEvent, new Date(start.getTime() + delta * 60_000).toISOString(), new Date(end.getTime() + delta * 60_000).toISOString());
        } else {
          const delta = event.key === 'ArrowUp' ? -15 : 15;
          const nextEnd = new Date(Math.max(start.getTime() + 15 * 60_000, end.getTime() + delta * 60_000));
          void moveEvent(selectedEvent, selectedEvent.startAt, nextEnd.toISOString());
        }
      } else if (event.key === '/') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key.toLocaleLowerCase() === 't') {
        setAnchor(new Date());
        setSelectedDate(new Date());
      } else if (event.key.toLocaleLowerCase() === 'n' || event.key.toLocaleLowerCase() === 'c') {
        event.preventDefault();
        openCreate(selectedDate);
      } else if (event.key === 'ArrowLeft') {
        setAnchor(current => calendarNavigationDate(current, view, -1));
      } else if (event.key === 'ArrowRight') {
        setAnchor(current => calendarNavigationDate(current, view, 1));
      } else if (event.key === 'Escape') {
        setFormMode(null);
        setSelectedEvent(null);
        setQuery('');
        searchRef.current?.blur();
      } else {
        const option = CALENDAR_VIEW_OPTIONS.find(item => item.shortcut === event.key);
        if (option) changeView(option.id);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    if (!store.calendarDraftSeed) return;
    setDraftSeed(store.calendarDraftSeed);
    openCreate(new Date(), undefined, true);
    store.clearCalendarDraftSeed();
  }, [store.calendarDraftSeed]);

  useEffect(() => {
    const request = store.calendarFocusRequest;
    if (!request) return;
    const event = store.calendarEvents.find(item => item.accountId === request.accountId && item.id === request.eventId);
    if (!event) return;
    setAccountEmail(request.accountId);
    setAnchor(new Date(event.startAt));
    openEdit(event);
    store.clearCalendarFocusRequest();
  }, [store.calendarEvents, store.calendarFocusRequest]);

  function changeView(next: CalendarWorkspaceView) {
    setViewState(next);
    void store.updateSettings(draft => { draft.calendar.defaultView = next; });
  }

  function changeAccountScope(next: string) {
    setAccountEmail(next);
    void store.updateSettings(draft => { draft.calendar.lastAccountScope = next; });
  }

  function selectDate(date: Date) {
    setSelectedDate(date);
    setAnchor(date);
    if (view === 'quarter' || view === 'year') changeView('day');
  }

  function openCreate(date: Date, rangeOverride?: { startAt: string; endAt: string }, preserveSeed = false) {
    setIcsPreview(null);
    if (!preserveSeed) setDraftSeed(null);
    setSelectedDate(date);
    setSelectedEvent(null);
    setInitialRange(rangeOverride || null);
    setFormMode('create');
  }

  function openEdit(event: CalendarEvent) {
    setIcsPreview(null);
    setSelectedEvent(event);
    setSelectedDate(new Date(event.startAt));
    setInitialRange(null);
    const calendar = accountCalendars.find(item => item.accountId === event.accountId && item.id === event.calendarId);
    setFormMode(calendar?.accessRole === 'writer' || calendar?.accessRole === 'owner' ? 'edit' : null);
  }

  async function refresh() {
    if (!accountEmail) return;
    setIsSyncing(true);
    setSyncError(null);
    const emails = accountEmail === 'unified' ? store.accounts.map(account => account.email) : [accountEmail];
    const results = await Promise.allSettled(emails.map(email => store.syncCalendarAgenda(email, range)));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length > 0) {
      console.error(`Calendar refresh failed for ${failures.length} of ${emails.length} accounts.`);
      setSyncError(failures.length === emails.length
        ? 'Refresh failed. Cached events remain available.'
        : 'Some accounts could not refresh. Select one in the sidebar to reconnect Calendar.');
    }
    setIsSyncing(false);
  }

  async function submitEvent(input: CalendarEventCreateInput | CalendarEventUpdateInput) {
    setIsSaving(true);
    try {
      const saved = formMode === 'edit'
        ? await store.updateCalendarEvent(input as CalendarEventUpdateInput, selectedEvent?.accountId || mutationAccount)
        : await store.createCalendarEvent(input as CalendarEventCreateInput, mutationAccount);
      const savedDate = new Date(saved.startAt);
      setSelectedEvent(saved);
      setSelectedDate(savedDate);
      setAnchor(savedDate);
      setDraftSeed(null);
      setFormMode('edit');
      emitToast({ type: 'success', message: formMode === 'edit' ? 'Event updated.' : 'Event created.' });
      const savedRange = calendarViewRange(savedDate, view, settings.weekStartsOn);
      void store.syncCalendarAgenda(saved.accountId, savedRange).catch(error => {
        console.error('Calendar post-save refresh failed:', error);
      });
    } catch (error) {
      console.error('Calendar event save failed:', error);
      const message = error instanceof Error && (error.message.includes('Calendar conflict') || error.message.includes('requires a network connection'))
        ? error.message
        : 'Could not save the event. Check Calendar access and try again.';
      emitToast({ type: 'error', message });
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSelectedEvent(mutationScope: CalendarMutationScope = 'single') {
    if (!selectedEvent) return;
    setIsDeleting(true);
    try {
      await store.deleteCalendarEvent(selectedEvent, selectedEvent.accountId, {
        mutationScope,
        recurringEventId: selectedEvent.recurringEventId,
        originalStartAt: selectedEvent.originalStartAt,
        sendUpdates: 'all',
        isAllDay: selectedEvent.isAllDay,
      });
      setSelectedEvent(null);
      setFormMode(null);
      emitToast({ type: 'success', message: 'Event deleted.' });
    } catch (error) {
      console.error('Calendar event delete failed:', error);
      emitToast({ type: 'error', message: error instanceof Error && error.message.includes('requires a network connection') ? error.message : 'Could not delete the event.' });
    } finally {
      setIsDeleting(false);
    }
  }

  async function moveEvent(event: CalendarEvent, startAt: string, endAt: string, startDate?: string, endDate?: string) {
    const calendar = accountCalendars.find(item => item.accountId === event.accountId && item.id === event.calendarId);
    if (calendar?.accessRole !== 'writer' && calendar?.accessRole !== 'owner') {
      emitToast({ type: 'warning', message: 'This calendar is read-only.' });
      return;
    }
    try {
      await store.updateCalendarEvent(calendarEventUpdateInput(event, { startAt, endAt, startDate, endDate }), event.accountId);
      emitToast({
        type: 'success',
        message: startAt === event.startAt ? 'Event resized.' : 'Event moved.',
        actionLabel: 'Undo',
        onAction: () => {
          void store.updateCalendarEvent(calendarEventUpdateInput(event), event.accountId)
            .catch(error => {
              console.error('Calendar move undo failed:', error);
              emitToast({ type: 'error', message: 'Could not undo the calendar change.' });
            });
        },
      });
    } catch (error) {
      console.error('Calendar drag update failed:', error);
      emitToast({ type: 'error', message: 'Could not move the event.' });
    }
  }

  async function resolveConflict(action: MailActionLog, strategy: 'local' | 'remote') {
    try {
      await store.resolveCalendarConflict(action, strategy);
      emitToast({ type: 'success', message: strategy === 'local' ? 'Local version applied to Google Calendar.' : 'Remote version restored.' });
    } catch (error) {
      console.error('Calendar conflict resolution failed:', error);
      emitToast({ type: 'error', message: 'Could not resolve the calendar conflict. Check the connection and try again.' });
    }
  }

  function toggleCalendar(accountId: string, calendarId: string) {
    void store.updateSettings(draft => {
      const hidden = new Set(draft.calendar.hiddenCalendarIds || []);
      const key = `${accountId}:${calendarId}`;
      if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
      draft.calendar.hiddenCalendarIds = [...hidden];
    });
  }

  function toggleCalendarAlerts(accountId: string, calendarId: string) {
    void store.updateSettings(draft => {
      const key = `${accountId}:${calendarId}`;
      const muted = new Set(draft.calendar.mutedNotificationCalendarKeys || []);
      if (muted.has(key)) muted.delete(key); else muted.add(key);
      draft.calendar.mutedNotificationCalendarKeys = [...muted];
    });
  }

  function applyCalendarSet(setId: string) {
    void store.updateSettings(draft => {
      draft.calendar.activeCalendarSetId = setId || null;
      if (!setId) {
        draft.calendar.hiddenCalendarIds = [];
        return;
      }
      const set = draft.calendar.calendarSets.find(item => item.id === setId);
      if (!set) return;
      const visible = new Set(set.calendarKeys);
      draft.calendar.hiddenCalendarIds = store.calendarLists
        .map(calendar => `${calendar.accountId}:${calendar.id}`)
        .filter(key => !visible.has(key));
      if (set.defaultCalendarKey) {
        const separator = set.defaultCalendarKey.indexOf(':');
        draft.calendar.defaultCalendarId = separator >= 0 ? set.defaultCalendarKey.slice(separator + 1) : set.defaultCalendarKey;
      }
    });
  }

  function createCalendarSet() {
    const name = window.prompt('Calendar set name')?.trim();
    if (!name) return;
    void store.updateSettings(draft => {
      const id = crypto.randomUUID();
      const hidden = new Set(draft.calendar.hiddenCalendarIds || []);
      draft.calendar.calendarSets.push({
        id,
        name,
        calendarKeys: accountCalendars.map(calendar => `${calendar.accountId}:${calendar.id}`).filter(key => !hidden.has(key)),
        defaultCalendarKey: mutationAccount && settings.defaultCalendarId ? `${mutationAccount}:${settings.defaultCalendarId}` : null,
      });
      draft.calendar.activeCalendarSetId = id;
    });
  }

  function deleteActiveCalendarSet() {
    const activeId = settings.activeCalendarSetId;
    if (!activeId) return;
    void store.updateSettings(draft => {
      draft.calendar.calendarSets = draft.calendar.calendarSets.filter(item => item.id !== activeId);
      draft.calendar.activeCalendarSetId = null;
    });
  }

  function saveEventTemplate(template: Omit<CalendarSettings['eventTemplates'][number], 'id'>) {
    const name = window.prompt('Template name', template.name)?.trim();
    if (!name) return;
    void store.updateSettings(draft => {
      draft.calendar.eventTemplates.push({ ...template, id: crypto.randomUUID(), name });
    });
    emitToast({ type: 'success', message: 'Event template saved.' });
  }

  async function completeMailTask(task: CalendarLocalTask) {
    const thread = store.threads.find(item => item.accountId === task.accountId && item.id === task.threadId);
    if (task.source === 'threadReminder' && thread) await store.clearThreadReminder(thread);
    if (task.source === 'replyPipeline') {
      const pipeline = store.replyPipelineItems.find(item => item.accountId === task.accountId && item.threadId === task.threadId);
      if (pipeline) await store.resolveReplyPipelineItem(pipeline);
    }
  }

  async function snoozeMailTask(task: CalendarLocalTask) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const thread = store.threads.find(item => item.accountId === task.accountId && item.id === task.threadId);
    if (task.source === 'threadReminder' && thread) await store.snoozeThread(thread, tomorrow);
    if (task.source === 'replyPipeline') {
      const pipeline = store.replyPipelineItems.find(item => item.accountId === task.accountId && item.threadId === task.threadId);
      if (pipeline) await store.snoozeReplyPipelineItem(pipeline, tomorrow.toISOString());
    }
  }

  async function chooseIcsImport() {
    try {
      const file = await window.electronAPI.pickCalendarIcsFile();
      if (!file) return;
      const invite = parseIcsInvite(file.text);
      if (!invite) throw new Error('No supported VEVENT was found in this file.');
      const existing = accountEvents.find(event => event.iCalUID === invite.uid);
      if (existing) {
        openEdit(existing);
        emitToast({ type: 'warning', message: 'This calendar event is already in the local cache.' });
        return;
      }
      const defaultCalendar = mutationCalendars.find(calendar => calendar.id === settings.defaultCalendarId)
        || mutationCalendars.find(calendar => calendar.primary)
        || mutationCalendars[0];
      setIcsCalendarId(defaultCalendar?.id || 'primary');
      setSelectedEvent(null);
      setFormMode(null);
      setIcsPreview({ filename: file.filename, invite });
    } catch (error) {
      emitToast({ type: 'error', message: error instanceof Error ? error.message : 'Could not read the calendar file.' });
    }
  }

  async function confirmIcsImport() {
    if (!icsPreview || !mutationAccount) return;
    setIsSaving(true);
    try {
      const saved = await window.electronAPI.importCalendarInvite(mutationAccount, icsPreview.invite, icsCalendarId);
      await store.syncCalendarAgenda(mutationAccount, range);
      setIcsPreview(null);
      openEdit(saved);
      emitToast({ type: 'success', message: 'Calendar file imported.' });
    } catch (error) {
      console.error('Calendar ICS import failed:', error);
      emitToast({ type: 'error', message: 'Could not import the event.' });
    } finally {
      setIsSaving(false);
    }
  }

  function draftMeetingFollowUp(event: CalendarEvent) {
    const draft = store.startNewDraft(event.accountId, {
      to: event.attendees
        .filter(attendee => attendee.email.toLocaleLowerCase() !== event.accountId.toLocaleLowerCase())
        .map(attendee => ({ name: attendee.displayName || '', email: attendee.email })),
      subject: `Follow-up: ${event.summary}`,
    });
    if (!draft) { emitToast({ type: 'warning', message: 'Reconnect the event account before drafting a follow-up.' }); return; }
    store.updateDraftBody(`Hi,\n\nFollowing up on ${event.summary}.\n\n`);
    store.setWorkspaceView('mail');
  }

  async function duplicateEvent(event: CalendarEvent) {
    const writableCalendar = accountCalendars.find(calendar => calendar.accountId === event.accountId && calendar.id === event.calendarId && (calendar.accessRole === 'writer' || calendar.accessRole === 'owner'))
      || accountCalendars.find(calendar => calendar.accountId === event.accountId && (calendar.accessRole === 'writer' || calendar.accessRole === 'owner'));
    if (!writableCalendar) { emitToast({ type: 'warning', message: 'No writable calendar is available for this account.' }); return; }
    try {
      const saved = await store.createCalendarEvent(calendarDuplicateInput(event, writableCalendar.id), event.accountId);
      setSelectedEvent(saved); setSelectedDate(new Date(saved.startAt)); setFormMode('edit');
      emitToast({ type: 'success', message: 'Event duplicated. Guest emails were not sent.' });
    } catch (error) {
      console.error('Calendar duplicate failed:', error); emitToast({ type: 'error', message: 'Could not duplicate the event.' });
    }
  }

  async function addTravelBlock(event: CalendarEvent) {
    const durationMinutes = settings.defaultTravelTimeMinutes;
    if (durationMinutes <= 0 || event.isAllDay) return;
    const end = new Date(event.startAt);
    const start = new Date(end.getTime() - durationMinutes * 60_000);
    try {
      await store.createCalendarEvent({
        calendarId: event.calendarId,
        summary: `Travel to ${event.location || event.summary}`,
        location: event.location || null,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        attendees: [],
        conferenceProvider: 'none',
        recurrence: 'none',
        timeZone: event.timeZone,
        sendUpdates: 'none',
        transparency: 'opaque',
        visibility: event.visibility || 'default',
        reminders: { useDefault: false, overrides: [] },
        sourceThreadId: event.sourceThreadId,
        sourceMessageId: event.sourceMessageId,
      }, event.accountId);
      emitToast({ type: 'success', message: `${durationMinutes}-minute travel block created.` });
    } catch (error) {
      console.error('Travel block creation failed:', error); emitToast({ type: 'error', message: 'Could not create the travel block.' });
    }
  }

  async function respondToEvent(status: CalendarAttendeeResponse) {
    if (!selectedEvent) return;
    setIsResponding(true);
    try {
      const updated = await store.respondToCalendarEvent(selectedEvent, status);
      setSelectedEvent(updated); emitToast({ type: 'success', message: `Invitation ${status === 'accepted' ? 'accepted' : status === 'declined' ? 'declined' : 'marked tentative'}.` });
    } catch (error) {
      console.error('Calendar RSVP failed:', error); emitToast({ type: 'error', message: 'Could not update the invitation response.' });
    } finally {
      setIsResponding(false);
    }
  }

  const inspectorOpen = formMode !== null || selectedEvent !== null;

  return (
    <div className="dm-calendar-workspace flex h-full min-h-0 flex-col bg-[var(--app-bg)]" aria-label="Calendar workspace">
      <CalendarHeader
        anchor={anchor}
        view={view}
        sidebarOpen={sidebarOpen}
        secondaryTime={secondaryTime}
        secondaryTimeZone={settings.secondaryTimeZone}
        query={query}
        searchInputRef={searchRef}
        searchResults={visibleSearchResults}
        isSyncing={isSyncing}
        onToggleSidebar={() => setSidebarOpen(value => !value)}
        onPrevious={() => setAnchor(current => calendarNavigationDate(current, view, -1))}
        onToday={() => { setAnchor(new Date()); setSelectedDate(new Date()); }}
        onNext={() => setAnchor(current => calendarNavigationDate(current, view, 1))}
        onChangeView={changeView}
        onChangeQuery={setQuery}
        onSelectSearchResult={event => { setAnchor(new Date(event.startAt)); setQuery(''); openEdit(event); }}
        onRefresh={() => void refresh()}
        onImport={() => void chooseIcsImport()}
        onCreate={() => openCreate(selectedDate)}
      />
      {syncError && <div role="status" className="shrink-0 border-b border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--warning)]">{syncError}</div>}
      <div className="dm-calendar-body flex min-h-0 flex-1">
        {sidebarOpen && <CalendarSidebar accounts={store.accounts} accountEmail={accountEmail} anchor={anchor} selectedDate={selectedDate} events={visibleEvents} calendars={accountCalendars} mutationAccount={mutationAccount} settings={settings} mailTasks={mailTasks} threads={store.threads} syncIssues={syncIssues} onAccountChange={changeAccountScope} onSelectDate={selectDate} onSelectEvent={openEdit} onNavigateMonth={delta => { const next = calendarNavigationDate(anchor, 'month', delta); setAnchor(next); setSelectedDate(next); }} onCreate={openCreate} onAuthorize={() => void store.authorizeGoogleIntegration('calendar', mutationAccount)} onApplyCalendarSet={applyCalendarSet} onCreateCalendarSet={createCalendarSet} onDeleteCalendarSet={deleteActiveCalendarSet} onToggleCalendar={toggleCalendar} onToggleCalendarAlerts={toggleCalendarAlerts} onCompleteTask={task => void completeMailTask(task)} onSnoozeTask={task => void snoozeMailTask(task)} onOpenThread={thread => void store.openThreadFromCalendar(thread)} onResolveConflict={(action, strategy) => void resolveConflict(action, strategy)} />}
        <main className="dm-calendar-canvas min-w-0 flex-1 overflow-hidden">
          {view === 'month' && <CalendarMonthView anchor={anchor} selectedDate={selectedDate} events={visibleEvents} calendars={accountCalendars} weekStartsOn={settings.weekStartsOn} showWeekends={settings.showWeekends} onSelectDate={selectDate} onCreate={openCreate} onSelectEvent={openEdit} onMoveEvent={(event, update) => void moveEvent(event, update.startAt, update.endAt, update.startDate, update.endDate)} />}
          {(view === 'day' || view === 'week') && <CalendarTimeGrid anchor={anchor} mode={view} events={visibleEvents} calendars={accountCalendars} weekStartsOn={settings.weekStartsOn} showWeekends={settings.showWeekends} workingDays={settings.workingDays} workingHoursStart={settings.availabilityStartTime} workingHoursEnd={settings.availabilityEndTime} onSelectDate={selectDate} onCreateRange={(startAt, endAt) => openCreate(new Date(startAt), { startAt, endAt })} onSelectEvent={openEdit} onMoveEvent={(event, startAt, endAt) => void moveEvent(event, startAt, endAt)} onResizeEvent={(event, endAt) => void moveEvent(event, event.startAt, endAt)} />}
          {view === 'agenda' && <CalendarAgendaView anchor={anchor} events={visibleEvents} calendars={accountCalendars} onSelectDate={selectDate} onSelectEvent={openEdit} onCreate={openCreate} />}
          {(view === 'quarter' || view === 'year') && <CalendarOverviewView anchor={anchor} events={visibleEvents} mode={view} weekStartsOn={settings.weekStartsOn} onSelectDate={selectDate} onCreate={openCreate} />}
        </main>
        {(inspectorOpen || icsPreview) && (
          <aside className="dm-calendar-inspector w-[340px] shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--panel-bg)] p-3">
            {icsPreview && (
              <div className="dm-panel rounded-lg border border-[var(--accent)]/35 bg-[var(--app-bg)] p-3">
                <div className="mb-3 flex items-start justify-between gap-2"><div><div className="text-[calc(9px*var(--font-scale))] font-semibold uppercase text-[var(--accent)]">Import preview</div><div className="mt-1 text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{icsPreview.invite.summary}</div></div><button type="button" onClick={() => setIcsPreview(null)} className="text-[var(--text-tertiary)]"><X className="h-4 w-4" /></button></div>
                <div className="space-y-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                  <div>{new Date(icsPreview.invite.startAt).toLocaleString()} – {new Date(icsPreview.invite.endAt).toLocaleString()}</div>
                  {icsPreview.invite.location && <div>{icsPreview.invite.location}</div>}
                  {icsPreview.invite.description && <div className="max-h-28 overflow-y-auto whitespace-pre-wrap">{icsPreview.invite.description}</div>}
                  <div>{icsPreview.invite.attendees.length} attendees · {icsPreview.filename}</div>
                  <label className="flex flex-col gap-1"><span className="text-[var(--text-tertiary)]">Destination calendar</span><select value={icsCalendarId} onChange={event => setIcsCalendarId(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5">{mutationCalendars.filter(calendar => calendar.accessRole === 'owner' || calendar.accessRole === 'writer').map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}</select></label>
                  <div className="dm-inset rounded border border-[var(--border)] bg-[var(--raised-surface)] p-2 text-[calc(9px*var(--font-scale))]">No event will be written until you confirm. Guest emails are disabled for imports.</div>
                  <button type="button" disabled={isSaving} onClick={() => void confirmIcsImport()} className="w-full rounded-md bg-[var(--accent)] px-3 py-2 font-semibold text-white disabled:opacity-50">{isSaving ? 'Importing…' : 'Import event'}</button>
                </div>
              </div>
            )}
            {!formMode && selectedEvent && (
              <div className="dm-panel rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div><div className="text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{selectedEvent.summary}</div><div className="mt-1 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">Read-only calendar</div></div>
                  <button type="button" onClick={() => setSelectedEvent(null)} aria-label="Close event" className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--hover-row)]"><X className="h-4 w-4" /></button>
                </div>
                <div className="space-y-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                  <div>{selectedEvent.isAllDay ? 'All day' : new Date(selectedEvent.startAt).toLocaleString()}</div>
                  {selectedEvent.location && <div>{selectedEvent.location}</div>}
                  {selectedEvent.description && <div className="whitespace-pre-wrap">{selectedEvent.description}</div>}
                  <CalendarEventParticipants event={selectedEvent} />
                  {selectedEvent.selfResponseStatus && <CalendarRsvpActions currentStatus={selectedEvent.selfResponseStatus} disabled={isResponding} onRespond={status => void respondToEvent(status)} />}
                  <button type="button" onClick={() => void duplicateEvent(selectedEvent)} className="flex items-center gap-1 font-semibold text-[var(--accent)]"><Copy className="h-3.5 w-3.5" />Duplicate to writable calendar</button>
                  {selectedEvent.attendees.length > 0 && <button type="button" onClick={() => draftMeetingFollowUp(selectedEvent)} className="flex items-center gap-1 font-semibold text-[var(--accent)]"><MailPlus className="h-3.5 w-3.5" />Draft follow-up</button>}
                  {selectedEvent.htmlLink && <a href={selectedEvent.htmlLink} target="_blank" rel="noreferrer" className="inline-block font-semibold text-[var(--accent)]">Open in Google Calendar</a>}
                </div>
              </div>
            )}
            {formMode === 'edit' && selectedEvent && (
              <div className="dm-inset mb-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-2.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                <div className="flex items-center justify-between gap-2">
                  <span>{selectedEvent.isAllDay ? 'All day' : `${new Date(selectedEvent.startAt).toLocaleString()} · ${calendarEventDurationMinutes(selectedEvent)} min`}</span>
                  <span className="flex items-center gap-2">{selectedEvent.conferenceUrl && <a href={selectedEvent.conferenceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[var(--accent)]"><Video className="h-3 w-3" />Join</a>}<button type="button" onClick={() => void window.electronAPI.exportCalendarEventIcs(selectedEvent)} title="Export .ics" className="text-[var(--text-tertiary)] hover:text-[var(--accent)]"><Download className="h-3.5 w-3.5" /></button></span>
                </div>
                <div className="mt-2"><CalendarEventParticipants event={selectedEvent} /></div>
                {selectedEvent.selfResponseStatus && <div className="mt-2"><CalendarRsvpActions currentStatus={selectedEvent.selfResponseStatus} disabled={isResponding} onRespond={status => void respondToEvent(status)} /></div>}
                <button type="button" onClick={() => void duplicateEvent(selectedEvent)} className="mt-2 flex items-center gap-1 font-semibold text-[var(--accent)]"><Copy className="h-3.5 w-3.5" />Duplicate</button>
                {selectedEvent.attendees.length > 0 && <button type="button" onClick={() => draftMeetingFollowUp(selectedEvent)} className="mt-2 flex items-center gap-1 font-semibold text-[var(--accent)]"><MailPlus className="h-3.5 w-3.5" />Draft follow-up</button>}
                {!selectedEvent.isAllDay && settings.defaultTravelTimeMinutes > 0 && <button type="button" onClick={() => void addTravelBlock(selectedEvent)} className="mt-2 block font-semibold text-[var(--accent)]">Add {settings.defaultTravelTimeMinutes}m travel block</button>}
              </div>
            )}
            {formMode && <CalendarEventForm mode={formMode} event={selectedEvent} selectedDate={selectedDate} defaultDurationMinutes={settings.defaultMeetingDurationMinutes} defaultConferenceProvider={settings.defaultConferenceProvider} calendarSettings={settings} calendarEvents={accountEvents} calendars={formMode === 'edit' && selectedEvent ? accountCalendars.filter(calendar => calendar.accountId === selectedEvent.accountId) : mutationCalendars} eventTemplates={settings.eventTemplates} contactEmails={store.contacts.filter(contact => contact.accountId === (selectedEvent?.accountId || mutationAccount)).map(contact => contact.email)} onSaveTemplate={saveEventTemplate} initialTitle={draftSeed?.summary} initialAttendees={draftSeed?.attendees} sourceMessageId={draftSeed?.sourceMessageId} sourceThreadId={draftSeed?.sourceThreadId} initialStartAt={initialRange?.startAt} initialEndAt={initialRange?.endAt} isSaving={isSaving} isDeleting={isDeleting} onCancel={() => { setFormMode(null); setSelectedEvent(null); setDraftSeed(null); }} onSubmit={submitEvent} onDelete={selectedEvent ? deleteSelectedEvent : undefined} onQueryFreeBusy={input => store.queryCalendarFreeBusy({ ...input, calendarIds: accountCalendars.filter(calendar => calendar.accountId === (selectedEvent?.accountId || mutationAccount) && !(settings.hiddenCalendarIds || []).includes(`${calendar.accountId}:${calendar.id}`) && calendar.accessRole !== 'none' && calendar.accessRole !== 'freeBusyReader').map(calendar => calendar.id) }, selectedEvent?.accountId || mutationAccount)} />}
            {selectedEvent && <CalendarRelatedMail event={selectedEvent} threads={store.threads} onOpen={thread => void store.openThreadFromCalendar(thread)} />}
          </aside>
        )}
      </div>
    </div>
  );
}
