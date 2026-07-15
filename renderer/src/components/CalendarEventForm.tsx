import { useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarPlus, Trash2, Video, X } from 'lucide-react';
import type { CalendarAvailabilitySlot } from '../../../shared/calendarAvailability';
import type { CalendarEvent, CalendarEventCreateInput, CalendarEventRecurrence, CalendarEventUpdateInput, CalendarFreeBusyRequest, CalendarFreeBusyResult, CalendarListEntry, CalendarMutationScope, CalendarSettings } from '../../../shared/types';
import { findAvailabilitySlotsFromBusyIntervals, findRecurringCalendarConflicts, freeBusyWarningMessage } from '../../../shared/calendarAvailability';
import {
  calendarEventTimesFromLocalInput,
  calendarEventFormDefaultsFromRange,
  defaultCalendarEventFormForDate,
  localCalendarTimeZone,
  localDateInputValue,
  localTimeInputValue,
  normalizeCalendarRecurrenceRule,
  parseCalendarAttendeeEmails,
  parseNaturalLanguageCalendarEvent,
} from '../../../shared/calendarCreate';
import { CalendarGuestAvailability } from './CalendarGuestAvailability';
import {
  RECURRENCE_OPTIONS,
  attendeeInputValue,
  conflictTimeLabel,
  formDefaultsFromEvent,
  quickDraftLabel,
  sameBusyInterval,
} from '../lib/calendarEventFormHelpers';

interface CalendarEventFormProps {
  mode: 'create' | 'edit';
  event?: CalendarEvent | null;
  selectedDate: Date;
  defaultDurationMinutes: number;
  defaultConferenceProvider: 'none' | 'googleMeet' | 'calendly' | 'calCom';
  calendarSettings: CalendarSettings;
  calendarEvents: CalendarEvent[];
  calendars?: CalendarListEntry[];
  eventTemplates?: CalendarSettings['eventTemplates'];
  contactEmails?: string[];
  onSaveTemplate?: (template: Omit<CalendarSettings['eventTemplates'][number], 'id'>) => void;
  initialTitle?: string;
  initialAttendees?: string[];
  sourceMessageId?: string | null;
  sourceThreadId?: string | null;
  initialStartAt?: string | null;
  initialEndAt?: string | null;
  isSaving: boolean;
  isDeleting?: boolean;
  onCancel: () => void;
  onSubmit: (input: CalendarEventCreateInput | CalendarEventUpdateInput) => Promise<void>;
  onDelete?: (scope: CalendarMutationScope) => Promise<void>;
  onQueryFreeBusy?: (input: CalendarFreeBusyRequest) => Promise<CalendarFreeBusyResult>;
}

const EVENT_COLOR_OPTIONS = [
  ['1', 'Lavender'], ['2', 'Sage'], ['3', 'Grape'], ['4', 'Flamingo'], ['5', 'Banana'], ['6', 'Tangerine'],
  ['7', 'Peacock'], ['8', 'Graphite'], ['9', 'Blueberry'], ['10', 'Basil'], ['11', 'Tomato'],
] as const;

function nextCalendarDateInput(value: string, days = 1): string {
  const date = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return value;
  date.setDate(date.getDate() + days);
  return localDateInputValue(date);
}

export function CalendarEventForm({
  mode,
  event,
  selectedDate,
  defaultDurationMinutes,
  defaultConferenceProvider,
  calendarSettings,
  calendarEvents,
  calendars = [],
  eventTemplates = [],
  contactEmails = [],
  onSaveTemplate,
  initialTitle = '',
  initialAttendees = [],
  sourceMessageId = null,
  sourceThreadId = null,
  initialStartAt,
  initialEndAt,
  isSaving,
  isDeleting = false,
  onCancel,
  onSubmit,
  onDelete,
  onQueryFreeBusy,
}: CalendarEventFormProps) {
  const today = new Date();
  const initialRangeDefaults = !event && initialStartAt && initialEndAt
    ? calendarEventFormDefaultsFromRange(initialStartAt, initialEndAt, defaultDurationMinutes)
    : null;
  const defaults = event
    ? formDefaultsFromEvent(event, defaultDurationMinutes)
    : initialRangeDefaults || defaultCalendarEventFormForDate(selectedDate, defaultDurationMinutes, today);
  const hasExistingMeet = Boolean(event?.conferenceUrl);
  const [quickEventText, setQuickEventText] = useState('');
  const [title, setTitle] = useState(event?.summary || initialTitle);
  const [description, setDescription] = useState(event?.description || '');
  const [date, setDate] = useState(defaults.date);
  const [allDayEndDate, setAllDayEndDate] = useState(event?.endDate || nextCalendarDateInput(defaults.date));
  const [startTime, setStartTime] = useState(defaults.startTime);
  const [duration, setDuration] = useState(defaults.durationMinutes);
  const [location, setLocation] = useState(event?.location || '');
  const [guests, setGuests] = useState(event ? attendeeInputValue(event) : initialAttendees.join(', '));
  const [recurrence, setRecurrence] = useState<CalendarEventRecurrence | 'custom'>('none');
  const [customRecurrenceInput, setCustomRecurrenceInput] = useState('');
  const [mutationScope, setMutationScope] = useState<CalendarMutationScope>('single');
  const [calendarId, setCalendarId] = useState(event?.calendarId || calendarSettings.defaultCalendarId || calendars.find(calendar => calendar.primary)?.id || 'primary');
  const [isAllDay, setIsAllDay] = useState(event?.isAllDay === true);
  const [sendUpdates, setSendUpdates] = useState<'all' | 'none'>((event?.attendees.length || 0) > 0 ? 'all' : 'none');
  const [transparency, setTransparency] = useState<'opaque' | 'transparent'>(event?.transparency || 'opaque');
  const [visibility, setVisibility] = useState<'default' | 'public' | 'private' | 'confidential'>(event?.visibility || 'default');
  const [colorId, setColorId] = useState(event?.colorId || '');
  const [reminderMinutes, setReminderMinutes] = useState(event?.reminders?.overrides?.[0]?.minutes ?? calendarSettings.defaultReminderMinutes ?? 10);
  const [timeZone] = useState(() => localCalendarTimeZone());
  const [addMeet, setAddMeet] = useState(mode === 'create' && defaultConferenceProvider === 'googleMeet');
  const [deletePending, setDeletePending] = useState(false);
  const [isFindingTimes, setIsFindingTimes] = useState(false);
  const [suggestedSlots, setSuggestedSlots] = useState<CalendarAvailabilitySlot[]>([]);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const quickEventDraft = useMemo(
    () => mode === 'create'
      ? parseNaturalLanguageCalendarEvent(quickEventText, selectedDate, defaultDurationMinutes, today)
      : null,
    [defaultDurationMinutes, mode, quickEventText, selectedDate, today],
  );
  const proposedEventTimes = useMemo(() => {
    const quickValues = mode === 'create' && title.trim() ? null : quickEventDraft;
    if (isAllDay) {
      const start = new Date(`${quickValues?.date || date}T00:00:00`);
      const end = new Date(`${allDayEndDate}T00:00:00`);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
      return { startAt: start.toISOString(), endAt: end.toISOString() };
    }
    return calendarEventTimesFromLocalInput(
      quickValues?.date || date,
      quickValues?.startTime || startTime,
      quickValues?.durationMinutes || duration,
    );
  }, [allDayEndDate, date, duration, isAllDay, mode, quickEventDraft, startTime, title]);
  const normalizedCustomRecurrence = recurrence === 'custom' ? normalizeCalendarRecurrenceRule(customRecurrenceInput) : null;
  const proposedRecurrence: CalendarEventRecurrence = mode === 'create'
    ? (title.trim() ? (recurrence === 'custom' ? 'none' : recurrence) : quickEventDraft?.recurrence || (recurrence === 'custom' ? 'none' : recurrence))
    : 'none';
  const proposedConflicts = useMemo(
    () => proposedEventTimes
      ? findRecurringCalendarConflicts(
        calendarEvents,
        proposedEventTimes.startAt,
        proposedEventTimes.endAt,
        proposedRecurrence,
        { excludeEventId: event?.id, horizonDays: 90, maxOccurrences: 24 },
      ).slice(0, 3)
      : [],
    [calendarEvents, event?.id, proposedEventTimes, proposedRecurrence],
  );
  const parsedGuests = useMemo(() => parseCalendarAttendeeEmails(guests), [guests]);
  const canSubmit = Boolean(title.trim() || quickEventDraft?.title)
    && parsedGuests.invalid.length === 0
    && Boolean(proposedEventTimes)
    && (recurrence !== 'custom' || Boolean(normalizedCustomRecurrence));
  const canFindGuestTimes = Boolean(onQueryFreeBusy)
    && parsedGuests.emails.length > 0
    && parsedGuests.invalid.length === 0
    && Boolean(proposedEventTimes);

  function applyQuickEventDraft() {
    if (!quickEventDraft) return;
    setTitle(quickEventDraft.title);
    setDate(quickEventDraft.date);
    setAllDayEndDate(nextCalendarDateInput(quickEventDraft.date));
    setStartTime(quickEventDraft.startTime);
    setDuration(quickEventDraft.durationMinutes);
    setLocation(quickEventDraft.location || '');
    setGuests(quickEventDraft.attendees.join(', '));
    setRecurrence(quickEventDraft.recurrence);
    setQuickEventText('');
  }

  async function submitForm(formEvent: FormEvent) {
    formEvent.preventDefault();
    const quickValues = mode === 'create' && title.trim() ? null : quickEventDraft;
    const times = proposedEventTimes;
    const summary = title.trim() || quickValues?.title.trim() || '';
    if (!times || !summary || parsedGuests.invalid.length > 0) return;
    const conferenceProvider = addMeet && !hasExistingMeet ? 'googleMeet' : 'none';
    const attendees = quickValues?.attendees.length ? quickValues.attendees : parsedGuests.emails;
    const baseInput: CalendarEventCreateInput = {
      calendarId,
      summary,
      description: description.trim() || null,
      location: quickValues ? quickValues.location : location.trim() || null,
      startAt: times.startAt,
      endAt: times.endAt,
      attendees,
      conferenceProvider,
      recurrence: mode === 'create' ? (quickValues?.recurrence || (recurrence === 'custom' ? 'none' : recurrence)) : 'none',
      recurrenceRules: mode === 'create' && !quickValues && normalizedCustomRecurrence ? [normalizedCustomRecurrence] : undefined,
      timeZone,
      isAllDay,
      startDate: isAllDay ? (quickValues?.date || date) : null,
      endDate: isAllDay ? allDayEndDate : null,
      sendUpdates,
      transparency,
      visibility,
      colorId: colorId || null,
      reminders: reminderMinutes < 0
        ? { useDefault: true }
        : { useDefault: false, overrides: [{ method: 'popup', minutes: reminderMinutes }] },
      sourceMessageId,
      sourceThreadId,
    };

    if (mode === 'edit' && event) {
      await onSubmit({
        ...baseInput,
        eventId: event.id,
        calendarId,
        originalCalendarId: event.calendarId || 'primary',
        recurringEventId: event.recurringEventId,
        originalStartAt: event.originalStartAt,
        mutationScope,
        etag: event.etag,
      });
      return;
    }
    await onSubmit(baseInput);
  }

  async function findGuestAvailability() {
    const times = proposedEventTimes;
    if (!times || !onQueryFreeBusy || parsedGuests.emails.length === 0 || parsedGuests.invalid.length > 0) return;
    setIsFindingTimes(true);
    setAvailabilityError(null);
    setSuggestedSlots([]);
    try {
      const rangeStart = new Date(times.startAt);
      const rangeEnd = new Date(rangeStart);
      rangeEnd.setDate(rangeEnd.getDate() + Math.max(1, Math.floor(calendarSettings.availabilityLookaheadDays || 5)));
      const result = await onQueryFreeBusy({
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        attendees: parsedGuests.emails,
        timeZone,
      });
      const warning = freeBusyWarningMessage(result, parsedGuests.emails);
      if (warning) {
        setAvailabilityError(`${warning} Ask the guest to share free/busy access or reauthorize Calendar in Settings.`);
        return;
      }
      const busy = event
        ? result.busy.filter(interval => !sameBusyInterval(interval.startAt, interval.endAt, event.startAt, event.endAt))
        : result.busy;
      const slots = findAvailabilitySlotsFromBusyIntervals(
        busy,
        { ...calendarSettings, defaultMeetingDurationMinutes: duration },
        rangeStart,
        5,
      );
      setSuggestedSlots(slots);
      if (slots.length === 0) setAvailabilityError('No shared free time found in your configured window.');
    } catch (error) {
      console.error('Calendar free/busy query failed:', error);
      setAvailabilityError('Could not check guest availability. Reauthorize Calendar in Settings if this is the first time using FreeBusy.');
    } finally {
      setIsFindingTimes(false);
    }
  }

  function applySuggestedSlot(slot: CalendarAvailabilitySlot) {
    const slotStart = new Date(slot.startAt);
    const slotEnd = new Date(slot.endAt);
    setDate(localDateInputValue(slotStart));
    setStartTime(localTimeInputValue(slotStart));
    const durationMs = slotEnd.getTime() - slotStart.getTime();
    if (Number.isFinite(durationMs) && durationMs > 0) {
      setDuration(Math.max(15, Math.round(durationMs / 60_000)));
    }
  }

  return (
    <form onSubmit={submitForm} className="dm-panel rounded-md border border-[var(--border)] bg-[var(--panel-bg)] p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[calc(10px*var(--font-scale))] font-semibold uppercase text-[var(--text-secondary)]">
          {mode === 'edit' ? 'Edit event' : 'New event'}
        </span>
        <button
          type="button"
          title="Close"
          onClick={onCancel}
          className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {mode === 'create' && (
          <>
            {eventTemplates.length > 0 && (
              <select
                defaultValue=""
                onChange={inputEvent => {
                  const template = eventTemplates.find(item => item.id === inputEvent.target.value);
                  if (!template) return;
                  setTitle(template.summary);
                  setDuration(template.durationMinutes);
                  setLocation(template.location || '');
                  setRecurrence(template.recurrence || 'none');
                  inputEvent.target.value = '';
                }}
                className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]"
              >
                <option value="">Use an event template…</option>
                {eventTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            )}
            <div className="flex gap-1.5">
              <input
                value={quickEventText}
                onChange={(inputEvent) => setQuickEventText(inputEvent.target.value)}
                onKeyDown={(keyEvent) => {
                  if (keyEvent.key === 'Enter' && quickEventDraft) {
                    keyEvent.preventDefault();
                    applyQuickEventDraft();
                  }
                }}
                placeholder="Lunch with Sarah tomorrow 1pm @ Cafe"
                className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={applyQuickEventDraft}
                disabled={!quickEventDraft}
                className="rounded-md border border-[var(--border)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)] disabled:opacity-50"
              >
                Use
              </button>
            </div>
            {quickEventText.trim() && quickEventDraft && (
              <button
                type="button"
                onClick={applyQuickEventDraft}
                className="flex min-w-0 items-center gap-1.5 rounded-md border border-[var(--accent)]/25 bg-[var(--accent)]/8 px-2 py-1.5 text-left text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] hover:border-[var(--accent)]/45"
              >
                <CalendarPlus className="h-3 w-3 shrink-0 text-[var(--accent)]" />
                <span className="truncate">{quickDraftLabel(quickEventDraft)}</span>
              </button>
            )}
          </>
        )}
        {mode === 'edit' && event?.recurringEventId && (
          <label className="flex flex-col gap-1">
            <span className="text-[calc(9px*var(--font-scale))] font-semibold uppercase text-[var(--text-tertiary)]">Apply changes to</span>
            <select value={mutationScope} onChange={inputEvent => setMutationScope(inputEvent.target.value as CalendarMutationScope)} className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)]">
              <option value="single">This event</option>
              <option value="following">This and following events</option>
              <option value="series">Entire series</option>
            </select>
          </label>
        )}
        <input
          value={title}
          onChange={(inputEvent) => setTitle(inputEvent.target.value)}
          placeholder="Title"
          className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        {calendars.length > 0 && (mode === 'create' || !event?.recurringEventId) && (
          <select
            value={calendarId}
            onChange={(inputEvent) => setCalendarId(inputEvent.target.value)}
            className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            {calendars.filter(calendar => calendar.accessRole === 'writer' || calendar.accessRole === 'owner').map(calendar => (
              <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
          <input type="checkbox" checked={isAllDay} onChange={inputEvent => setIsAllDay(inputEvent.target.checked)} className="accent-[var(--accent)]" />
          All-day event
        </label>
        <div className={`grid gap-1.5 ${isAllDay ? 'grid-cols-2' : 'grid-cols-[1.2fr_0.9fr_0.8fr]'}`}>
          <input
            type="date"
            value={date}
            aria-label="Event start date"
            onChange={(inputEvent) => {
              const value = inputEvent.target.value;
              setDate(value);
              if (allDayEndDate <= value) setAllDayEndDate(nextCalendarDateInput(value));
            }}
            className="min-w-0 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          {isAllDay && <input
            type="date"
            value={allDayEndDate}
            min={nextCalendarDateInput(date)}
            aria-label="Event end date (exclusive)"
            onChange={(inputEvent) => setAllDayEndDate(inputEvent.target.value)}
            title="End date is exclusive"
            className="min-w-0 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />}
          {!isAllDay && <input
            type="time"
            value={startTime}
            onChange={(inputEvent) => setStartTime(inputEvent.target.value)}
            className="min-w-0 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />}
          {!isAllDay && <input
            type="number"
            min={15}
            max={480}
            step={15}
            value={duration}
            onChange={(inputEvent) => setDuration(Math.max(15, Math.min(480, Number(inputEvent.target.value) || 30)))}
            className="min-w-0 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />}
        </div>
        {mode === 'create' && (
          <select
            value={recurrence}
            onChange={(inputEvent) => setRecurrence(inputEvent.target.value as CalendarEventRecurrence | 'custom')}
            className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            {RECURRENCE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
            <option value="custom">Custom RRULE…</option>
          </select>
        )}
        {mode === 'create' && recurrence === 'custom' && (
          <label className="flex flex-col gap-1">
            <span className="text-[calc(9px*var(--font-scale))] font-semibold uppercase text-[var(--text-tertiary)]">Custom recurrence</span>
            <input value={customRecurrenceInput} onChange={event => setCustomRecurrenceInput(event.target.value)} placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE" aria-invalid={customRecurrenceInput.length > 0 && !normalizedCustomRecurrence} className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
            {customRecurrenceInput && !normalizedCustomRecurrence && <span className="text-[calc(9px*var(--font-scale))] text-[var(--danger)]">Enter an RFC 5545 rule beginning with FREQ=.</span>}
          </label>
        )}
        <input
          value={location}
          onChange={(inputEvent) => setLocation(inputEvent.target.value)}
          placeholder="Location"
          className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <textarea
          value={description}
          onChange={(inputEvent) => setDescription(inputEvent.target.value)}
          placeholder="Notes"
          rows={3}
          className="resize-y rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <label className="flex flex-col gap-1">
          <span className="text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-tertiary)]">Participants</span>
          <input
            value={guests}
            onChange={(inputEvent) => setGuests(inputEvent.target.value)}
            placeholder="Add email addresses"
            list="calendar-contact-emails"
            className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </label>
        <datalist id="calendar-contact-emails">
          {contactEmails.slice(0, 250).map(email => <option key={email} value={email} />)}
        </datalist>
        {parsedGuests.invalid.length > 0 && (
          <div className="rounded-md border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--danger)]">
            Invalid guest: {parsedGuests.invalid[0]}
          </div>
        )}
        {!isAllDay && <CalendarGuestAvailability
          guestCount={parsedGuests.emails.length}
          canFindTimes={canFindGuestTimes}
          isFindingTimes={isFindingTimes}
          availabilityError={availabilityError}
          suggestedSlots={suggestedSlots}
          onFindTimes={() => void findGuestAvailability()}
          onApplySlot={applySuggestedSlot}
        />}
        <div className="grid grid-cols-2 gap-1.5">
          <select value={reminderMinutes} onChange={event => setReminderMinutes(Number(event.target.value))} className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            <option value={-1}>Default reminder</option>
            <option value={0}>At start time</option>
            <option value={5}>5 minutes before</option>
            <option value={10}>10 minutes before</option>
            <option value={15}>15 minutes before</option>
            <option value={30}>30 minutes before</option>
            <option value={60}>1 hour before</option>
            <option value={1440}>1 day before</option>
          </select>
          <select value={visibility} onChange={event => setVisibility(event.target.value as typeof visibility)} className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            <option value="default">Default visibility</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
            <option value="confidential">Confidential</option>
          </select>
          <select value={transparency} onChange={event => setTransparency(event.target.value as typeof transparency)} className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            <option value="opaque">Busy</option>
            <option value="transparent">Free</option>
          </select>
          <select value={sendUpdates} onChange={event => setSendUpdates(event.target.value as typeof sendUpdates)} className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            <option value="all">Email guests</option>
            <option value="externalOnly">Email external guests only</option>
            <option value="none">Do not email guests</option>
          </select>
          <select value={colorId} onChange={event => setColorId(event.target.value)} aria-label="Event color" className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            <option value="">Default event color</option>
            {EVENT_COLOR_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {proposedConflicts.length > 0 && (
          <div className="rounded-md border border-[var(--warning)]/35 bg-[var(--warning)]/10 px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--warning)]">
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              {proposedConflicts.length === 1 ? 'Schedule conflict' : `${proposedConflicts.length} schedule conflicts`}
            </div>
            <div className="flex flex-col gap-0.5">
              {proposedConflicts.map(conflict => (
                <div key={`${conflict.event.calendarId}:${conflict.event.id}`} className="flex min-w-0 justify-between gap-2">
                  <span className="min-w-0 truncate">{conflict.event.summary}</span>
                  <span className="shrink-0">{conflictTimeLabel(conflict)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          {mode === 'edit' && onDelete ? (
            <button
              type="button"
              onClick={() => {
                if (!deletePending) {
                  setDeletePending(true);
                  return;
                }
                void onDelete(mutationScope);
              }}
              disabled={isSaving || isDeleting}
              className="flex items-center gap-1.5 rounded-md border border-[var(--danger)]/40 px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isDeleting ? 'Deleting...' : deletePending ? 'Confirm delete' : 'Delete'}
            </button>
          ) : (
            <button
              type="button"
              disabled={hasExistingMeet}
              onClick={() => setAddMeet(value => !value)}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[calc(10px*var(--font-scale))] ${
                addMeet || hasExistingMeet
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              } disabled:opacity-70`}
            >
              <Video className="h-3.5 w-3.5" />
              {hasExistingMeet ? 'Google Meet' : 'Add Meet'}
            </button>
          )}
          <button
            type="submit"
            disabled={!canSubmit || isSaving || isDeleting}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[calc(10px*var(--font-scale))] font-semibold text-white disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : mode === 'edit' ? 'Save' : 'Create'}
          </button>
        </div>
        {mode === 'create' && onSaveTemplate && title.trim() && (
          <button type="button" onClick={() => onSaveTemplate({ name: title.trim(), summary: title.trim(), durationMinutes: duration, location: location.trim() || null, recurrence: recurrence === 'custom' ? 'none' : recurrence })} className="w-fit text-[calc(9px*var(--font-scale))] font-medium text-[var(--text-tertiary)] hover:text-[var(--accent)]">Save current fields as template</button>
        )}
        {mode === 'edit' && !hasExistingMeet && (
          <button
            type="button"
            onClick={() => setAddMeet(value => !value)}
            className={`w-fit rounded-md border px-2 py-1 text-[calc(10px*var(--font-scale))] ${
              addMeet
                ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Add Google Meet
          </button>
        )}
      </div>
    </form>
  );
}
