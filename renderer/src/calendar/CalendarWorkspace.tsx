import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarAttendeeResponse, CalendarEvent, CalendarEventCreateInput, CalendarEventUpdateInput, CalendarLocalTask, CalendarMutationScope, CalendarSettings, CalendarWorkspaceView, MailActionLog } from '../../../shared/types';
import { calendarDeleteSuccessMessage } from '../../../shared/calendarDeleteCopy';
import {
  calendarNavigationDate,
  calendarViewRange,
  filterCalendarEvents,
} from '../../../shared/calendarWorkspace';
import { parseIcsInvite } from '../../../shared/calendar';
import type { CalendarInvite } from '../../../shared/types';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';
import { CalendarMonthView } from './CalendarMonthView';
import { CalendarTimeGrid } from './CalendarTimeGrid';
import { CalendarAgendaView, CalendarOverviewView } from './CalendarOverviewViews';
import { CalendarSidebar } from './CalendarSidebar';
import { calendarDuplicateInput, calendarEventFormKey, calendarEventUpdateInput, localCalendarDateKey, resolveCalendarAccountScope, restoredCalendarAnchor, secondaryCalendarTimeLabel } from './calendarWorkspaceUtils';
import { CalendarHeader, CALENDAR_VIEW_OPTIONS } from './CalendarHeader';
import { CalendarEventDetails, CalendarImportPreview, CalendarWorkspaceEventForm } from './CalendarWorkspaceInspector';
import { calendarEventKey } from './calendarTimeLayout';
import { useElementSize } from './useElementSize';

/** Below this workspace width an open event panel hides the sidebar, so all day columns stay visible. */
const NARROW_WORKSPACE_WIDTH = 1200;

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
  const [formSession, setFormSession] = useState(0);
  const [initialRange, setInitialRange] = useState<{ startAt: string; endAt: string } | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CalendarEvent[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** Sidebar shown on request although a narrow window hid it for the event panel. */
  const [sidebarOverride, setSidebarOverride] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [icsPreview, setIcsPreview] = useState<{ filename: string; invite: CalendarInvite } | null>(null);
  const [icsCalendarId, setIcsCalendarId] = useState('primary');
  const [draftSeed, setDraftSeed] = useState<{ summary: string; attendees: string[]; sourceMessageId?: string | null; sourceThreadId?: string | null } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const { width: workspaceWidth } = useElementSize(workspaceRef);
  const loadedCalendarAccountsRef = useRef(new Set<string>());
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
    const calendarOnlyEmails = store.accounts.map(account => account.email).filter(email => !emails.includes(email) && !loadedCalendarAccountsRef.current.has(email));
    calendarOnlyEmails.forEach(email => loadedCalendarAccountsRef.current.add(email));
    void Promise.allSettled(calendarOnlyEmails.map(email => store.syncCalendarLists(email)));
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
  }, [accountEmail, accountEmailsKey, range.endAt, range.startAt, store.syncCalendarAgenda, store.syncCalendarLists]);
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
    if (formMode === null && selectedEvent === null && icsPreview === null) setSidebarOverride(false);
  }, [formMode, icsPreview, selectedEvent]);
  useEffect(() => {
    const dateKey = localCalendarDateKey(anchor);
    if (settings.lastAnchorDate === dateKey) return;
    void store.updateSettings(draft => { draft.calendar.lastAnchorDate = dateKey; });
  }, [anchor, settings.lastAnchorDate, store.updateSettings]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (store.workspaceView !== 'calendar') return;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      const isEditing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable
        || Boolean(target?.closest?.('[data-calendar-editor], [role="dialog"]'));
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
        if (query) {
          setQuery('');
          searchRef.current?.blur();
        } else if (formMode === 'edit' && selectedEvent) {
          setFormMode(null);
        } else {
          closePanel();
        }
      } else if (event.altKey) {
        return;
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
    openEvent(event);
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

  /** `+N more`, a week column's day name: show that whole day. */
  function openDay(date: Date) {
    setSelectedDate(date);
    setAnchor(date);
    changeView('day');
  }

  function closePanel() {
    setFormMode(null);
    setSelectedEvent(null);
    setDraftSeed(null);
    setIcsPreview(null);
  }
  function openCreate(date: Date, rangeOverride?: { startAt: string; endAt: string }, preserveSeed = false) {
    setIcsPreview(null);
    if (!preserveSeed) setDraftSeed(null);
    setSelectedDate(date);
    setSelectedEvent(null);
    setInitialRange(rangeOverride || null);
    setFormSession(session => session + 1);
    setFormMode('create');
  }

  function calendarFor(event: CalendarEvent) {
    return store.calendarLists.find(item => item.accountId === event.accountId && item.id === event.calendarId);
  }

  function isWritable(event: CalendarEvent): boolean {
    const role = calendarFor(event)?.accessRole;
    return role === 'writer' || role === 'owner';
  }

  /** Opens the read view of an event (editing is a separate step). */
  function openEvent(event: CalendarEvent) {
    setIcsPreview(null);
    setSelectedEvent(event);
    setSelectedDate(new Date(event.startAt));
    setInitialRange(null);
    setFormMode(null);
  }

  function editEvent(event: CalendarEvent) {
    if (!isWritable(event)) return;
    setIcsPreview(null);
    setSelectedEvent(event);
    setInitialRange(null);
    setFormSession(session => session + 1);
    setFormMode('edit');
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

  async function submitEvent(input: CalendarEventCreateInput | CalendarEventUpdateInput, targetAccountId: string) {
    setIsSaving(true);
    try {
      const saved = formMode === 'edit'
        ? await store.updateCalendarEvent(input as CalendarEventUpdateInput, selectedEvent?.accountId || targetAccountId)
        : await store.createCalendarEvent(input as CalendarEventCreateInput, targetAccountId);
      const savedDate = new Date(saved.startAt);
      setSelectedEvent(saved);
      setSelectedDate(savedDate);
      setAnchor(savedDate);
      setDraftSeed(null);
      setFormMode(null);
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
    const wasRecurring = Boolean(selectedEvent.recurringEventId);
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
      emitToast({ type: 'success', message: calendarDeleteSuccessMessage(wasRecurring, mutationScope) });
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
        openEvent(existing);
        emitToast({ type: 'warning', message: 'This event is already in your calendar.' });
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
      openEvent(saved);
      emitToast({ type: 'success', message: 'Event imported.' });
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
      setSelectedEvent(saved); setSelectedDate(new Date(saved.startAt)); setInitialRange(null); setFormSession(session => session + 1); setFormMode('edit');
      emitToast({ type: 'success', message: 'Copy created. Guests were not emailed.' });
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
      emitToast({ type: 'success', message: `${durationMinutes} min of travel blocked before the event.` });
    } catch (error) {
      console.error('Travel block creation failed:', error); emitToast({ type: 'error', message: 'Could not create the travel block.' });
    }
  }

  async function respondToEvent(status: CalendarAttendeeResponse) {
    if (!selectedEvent) return;
    setIsResponding(true);
    try {
      const updated = await store.respondToCalendarEvent(selectedEvent, status);
      setSelectedEvent(updated); emitToast({ type: 'success', message: `Answered ${status === 'accepted' ? 'Yes' : status === 'declined' ? 'No' : 'Maybe'}.` });
    } catch (error) {
      console.error('Calendar RSVP failed:', error); emitToast({ type: 'error', message: 'Could not update the invitation response.' });
    } finally {
      setIsResponding(false);
    }
  }

  const inspectorOpen = formMode !== null || selectedEvent !== null || icsPreview !== null;
  const narrow = workspaceWidth > 0 && workspaceWidth < NARROW_WORKSPACE_WIDTH;
  const sidebarAutoHidden = inspectorOpen && narrow && !sidebarOverride;
  const showSidebar = sidebarOpen && !sidebarAutoHidden;

  function toggleSidebar() {
    if (sidebarOpen && sidebarAutoHidden) setSidebarOverride(true);
    else if (sidebarOpen && inspectorOpen && narrow) { setSidebarOverride(false); setSidebarOpen(false); }
    else setSidebarOpen(value => !value);
  }
  const selectedEventKey = selectedEvent ? calendarEventKey(selectedEvent) : null;
  const selectedCalendar = selectedEvent ? calendarFor(selectedEvent) : undefined;

  return (
    <div ref={workspaceRef} className="dm-calendar-workspace flex h-full min-h-0 flex-col bg-[var(--app-bg)]" aria-label="Calendar">
      <CalendarHeader
        anchor={anchor}
        view={view}
        weekStartsOn={settings.weekStartsOn}
        sidebarOpen={showSidebar}
        secondaryTime={secondaryTime}
        secondaryTimeZone={settings.secondaryTimeZone}
        query={query}
        searchInputRef={searchRef}
        searchResults={visibleSearchResults}
        isSyncing={isSyncing}
        onToggleSidebar={toggleSidebar}
        onPrevious={() => setAnchor(current => calendarNavigationDate(current, view, -1))}
        onToday={() => { setAnchor(new Date()); setSelectedDate(new Date()); }}
        onNext={() => setAnchor(current => calendarNavigationDate(current, view, 1))}
        onChangeView={changeView}
        onChangeQuery={setQuery}
        onSelectSearchResult={event => { setAnchor(new Date(event.startAt)); setQuery(''); openEvent(event); }}
        onRefresh={() => void refresh()}
        onImport={() => void chooseIcsImport()}
        onCreate={() => openCreate(selectedDate)}
      />
      {syncError && <div role="status" className="shrink-0 border-b border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--warning-solid)]">{syncError}</div>}
      <div className="dm-calendar-body flex min-h-0 flex-1">
        {showSidebar && <CalendarSidebar accounts={store.accounts} accountEmail={accountEmail} anchor={anchor} selectedDate={selectedDate} selectedEventKey={selectedEventKey} events={visibleEvents} calendars={accountCalendars} mutationAccount={mutationAccount} settings={settings} mailTasks={mailTasks} threads={store.threads} syncIssues={syncIssues} onAccountChange={changeAccountScope} onSelectDate={selectDate} onSelectEvent={openEvent} onNavigateMonth={delta => { const next = calendarNavigationDate(anchor, 'month', delta); setAnchor(next); setSelectedDate(next); }} onCreate={openCreate} onAuthorize={() => void store.authorizeGoogleIntegration('calendar', mutationAccount)} onApplyCalendarSet={applyCalendarSet} onCreateCalendarSet={createCalendarSet} onDeleteCalendarSet={deleteActiveCalendarSet} onToggleCalendar={toggleCalendar} onToggleCalendarAlerts={toggleCalendarAlerts} onCompleteTask={task => void completeMailTask(task)} onSnoozeTask={task => void snoozeMailTask(task)} onOpenThread={thread => void store.openThreadFromCalendar(thread)} onResolveConflict={(action, strategy) => void resolveConflict(action, strategy)} />}
        <main className="dm-calendar-canvas min-w-0 flex-1 overflow-hidden" aria-label="Calendar view">
          {view === 'month' && <CalendarMonthView anchor={anchor} selectedDate={selectedDate} events={visibleEvents} calendars={accountCalendars} weekStartsOn={settings.weekStartsOn} showWeekends={settings.showWeekends} selectedEventKey={selectedEventKey} onSelectDate={selectDate} onOpenDay={openDay} onCreate={openCreate} onSelectEvent={openEvent} onMoveEvent={(event, update) => void moveEvent(event, update.startAt, update.endAt, update.startDate, update.endDate)} />}
          {(view === 'day' || view === 'week') && <CalendarTimeGrid anchor={anchor} mode={view} events={visibleEvents} calendars={accountCalendars} weekStartsOn={settings.weekStartsOn} showWeekends={settings.showWeekends} workingDays={settings.workingDays} workingHoursStart={settings.availabilityStartTime} workingHoursEnd={settings.availabilityEndTime} selectedEventKey={selectedEventKey} onSelectDate={selectDate} onOpenDay={openDay} onCreateRange={(startAt, endAt) => openCreate(new Date(startAt), { startAt, endAt })} onSelectEvent={openEvent} onMoveEvent={(event, startAt, endAt) => void moveEvent(event, startAt, endAt)} onResizeEvent={(event, endAt) => void moveEvent(event, event.startAt, endAt)} />}
          {view === 'agenda' && <CalendarAgendaView anchor={anchor} events={visibleEvents} calendars={accountCalendars} selectedEventKey={selectedEventKey} onSelectDate={selectDate} onSelectEvent={openEvent} onCreate={openCreate} />}
          {(view === 'quarter' || view === 'year') && <CalendarOverviewView anchor={anchor} events={visibleEvents} mode={view} weekStartsOn={settings.weekStartsOn} onSelectDate={selectDate} onCreate={openCreate} />}
        </main>
        {inspectorOpen && (
          <aside className="dm-calendar-inspector flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--panel-bg)]" aria-label={formMode ? (formMode === 'edit' ? 'Edit event' : 'New event') : icsPreview ? 'Import event' : 'Event details'}>
            {icsPreview && !formMode && (
              <CalendarImportPreview preview={icsPreview} calendarId={icsCalendarId} calendars={mutationCalendars} isSaving={isSaving} onChangeCalendar={setIcsCalendarId} onClose={() => setIcsPreview(null)} onConfirm={() => void confirmIcsImport()} />
            )}
            {!formMode && !icsPreview && selectedEvent && (
              <CalendarEventDetails
                key={calendarEventKey(selectedEvent)}
                event={selectedEvent}
                calendar={selectedCalendar}
                writable={isWritable(selectedEvent)}
                isResponding={isResponding}
                isDeleting={isDeleting}
                travelTimeMinutes={settings.defaultTravelTimeMinutes}
                threads={store.threads}
                onClose={closePanel}
                onEdit={() => editEvent(selectedEvent)}
                onDuplicate={() => void duplicateEvent(selectedEvent)}
                onDelete={scope => void deleteSelectedEvent(scope)}
                onRespond={status => void respondToEvent(status)}
                onDraftFollowUp={() => draftMeetingFollowUp(selectedEvent)}
                onAddTravel={() => void addTravelBlock(selectedEvent)}
                onOpenThread={thread => void store.openThreadFromCalendar(thread)}
              />
            )}
            {formMode && <CalendarWorkspaceEventForm
              key={calendarEventFormKey(formMode, selectedEvent, formSession)}
              mode={formMode}
              event={formMode === 'edit' ? selectedEvent : null}
              selectedDate={selectedDate}
              defaultAccountId={selectedEvent?.accountId || mutationAccount}
              onSaveTemplate={saveEventTemplate}
              draftSeed={draftSeed}
              initialRange={initialRange}
              isSaving={isSaving}
              onCancel={() => {
                if (formMode === 'edit' && selectedEvent) setFormMode(null);
                else closePanel();
              }}
              onClose={closePanel}
              onSubmit={submitEvent}
            />}
          </aside>
        )}
      </div>
    </div>
  );
}
