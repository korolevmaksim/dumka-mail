// The event form of the calendar panel: every field has a visible label,
// dates and times read in the app's vocabulary, and Save / Cancel sit in a
// footer that stays visible while the fields scroll.
//
// Behaviour (quick add, templates, conflicts, guest availability, recurring
// scopes, Meet, reminders, visibility, guest emails, colour) is the one of the
// former `components/CalendarEventForm.tsx`, which this replaces in the
// calendar workspace.
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, CalendarPlus, X } from 'lucide-react';
import type { CalendarAvailabilitySlot } from '../../../shared/calendarAvailability';
import type { CalendarEvent, CalendarEventCreateInput, CalendarEventRecurrence, CalendarEventUpdateInput, CalendarFreeBusyRequest, CalendarFreeBusyResult, CalendarListEntry, CalendarMutationScope, CalendarSettings, Recipient } from '../../../shared/types';
import { isValidEmail } from '../../../shared/compose';
import { findAvailabilitySlotsFromBusyIntervals, findRecurringCalendarConflicts, freeBusyWarningMessage } from '../../../shared/calendarAvailability';
import {
  calendarEventTimesFromLocalInput,
  calendarEventFormDefaultsFromRange,
  defaultCalendarEventFormForDate,
  localCalendarTimeZone,
  localDateInputValue,
  localTimeInputValue,
  normalizeCalendarRecurrenceRule,
  parseNaturalLanguageCalendarEvent,
} from '../../../shared/calendarCreate';
import { CALENDAR_DELETE_SCOPE_OPTIONS } from '../../../shared/calendarDeleteCopy';
import { formatDuration, formatTimeRange, formatWeekdayDay } from '../../../shared/dateFormat';
import { CalendarGuestAvailability } from '../components/CalendarGuestAvailability';
import { CalendarParticipantPicker } from '../components/CalendarParticipantPicker';
import { SETTINGS_INPUT_CLASS, SETTINGS_SELECT_CLASS, Toggle } from '../components/settings/SettingsControls';
import {
  RECURRENCE_OPTIONS,
  attendeeRecipients,
  calendarSelectionKey,
  conflictTimeLabel,
  EVENT_COLOR_OPTIONS,
  eventEndClock,
  formDefaultsFromEvent,
  initialCalendarSelection,
  nextCalendarDateInput,
  quickDraftLabel,
  sameBusyInterval,
} from '../lib/calendarEventFormHelpers';
import { CalendarDateField, CalendarTimeField } from './CalendarDateField';
import { CAL_BUTTON, CAL_FIELD_LABEL, CAL_FOCUS, CAL_LINK, CAL_PRIMARY_BUTTON, CAL_SMALL_ICON_BUTTON } from './calendarUi';

export interface CalendarEventEditorProps {
  mode: 'create' | 'edit';
  event?: CalendarEvent | null;
  selectedDate: Date;
  defaultDurationMinutes: number;
  defaultConferenceProvider: 'none' | 'googleMeet' | 'calendly' | 'calCom';
  calendarSettings: CalendarSettings;
  calendarEvents: CalendarEvent[];
  calendars?: CalendarListEntry[];
  defaultAccountId?: string;
  eventTemplates?: CalendarSettings['eventTemplates'];
  onSaveTemplate?: (template: Omit<CalendarSettings['eventTemplates'][number], 'id'>) => void;
  initialTitle?: string;
  initialAttendees?: string[];
  sourceMessageId?: string | null;
  sourceThreadId?: string | null;
  initialStartAt?: string | null;
  initialEndAt?: string | null;
  isSaving: boolean;
  onCancel: () => void;
  onClose: () => void;
  onSubmit: (input: CalendarEventCreateInput | CalendarEventUpdateInput, accountId: string) => Promise<void>;
  onQueryFreeBusy?: (input: CalendarFreeBusyRequest, accountId: string) => Promise<CalendarFreeBusyResult>;
}

const MIN_DURATION = 5;
const MAX_DURATION = 24 * 60;

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className={CAL_FIELD_LABEL}>{label}</label>
      {children}
      {hint}
    </div>
  );
}

export function CalendarEventEditor({
  mode,
  event,
  selectedDate,
  defaultDurationMinutes,
  defaultConferenceProvider,
  calendarSettings,
  calendarEvents,
  calendars = [],
  defaultAccountId = '',
  eventTemplates = [],
  onSaveTemplate,
  initialTitle = '',
  initialAttendees = [],
  sourceMessageId = null,
  sourceThreadId = null,
  initialStartAt,
  initialEndAt,
  isSaving,
  onCancel,
  onClose,
  onSubmit,
  onQueryFreeBusy,
}: CalendarEventEditorProps) {
  const id = useId();
  const today = useMemo(() => new Date(), []);
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
  const [durationText, setDurationText] = useState(String(defaults.durationMinutes));
  const [location, setLocation] = useState(event?.location || '');
  const [participants, setParticipants] = useState<Recipient[]>(() => attendeeRecipients(event, initialAttendees));
  const [recurrence, setRecurrence] = useState<CalendarEventRecurrence | 'custom'>('none');
  const [customRecurrenceInput, setCustomRecurrenceInput] = useState('');
  const [mutationScope, setMutationScope] = useState<CalendarMutationScope>('single');
  const writableCalendars = useMemo(
    () => calendars.filter(calendar => calendar.accessRole === 'writer' || calendar.accessRole === 'owner'),
    [calendars],
  );
  const [calendarSelection, setCalendarSelection] = useState(() => initialCalendarSelection(
    calendars,
    event,
    event?.accountId || defaultAccountId,
    calendarSettings.defaultCalendarId,
  ));
  const selectedCalendar = writableCalendars.find(calendar => calendarSelectionKey(calendar) === calendarSelection);
  const selectedAccountId = selectedCalendar?.accountId || event?.accountId || defaultAccountId;
  const calendarId = selectedCalendar?.id || event?.calendarId || calendarSettings.defaultCalendarId || 'primary';
  const [isAllDay, setIsAllDay] = useState(event?.isAllDay === true);
  // True while the start field holds text that is not a time: saving then would use the previous time.
  const [startTimeInvalid, setStartTimeInvalid] = useState(false);
  const [sendUpdates, setSendUpdates] = useState<'all' | 'externalOnly' | 'none'>((event?.attendees.length || 0) > 0 ? 'all' : 'none');
  const [transparency, setTransparency] = useState<'opaque' | 'transparent'>(event?.transparency || 'opaque');
  const [visibility, setVisibility] = useState<'default' | 'public' | 'private' | 'confidential'>(event?.visibility || 'default');
  const [colorId, setColorId] = useState(event?.colorId || '');
  const [reminderMinutes, setReminderMinutes] = useState(event?.reminders?.overrides?.[0]?.minutes ?? calendarSettings.defaultReminderMinutes ?? 10);
  const [timeZone] = useState(() => localCalendarTimeZone());
  const [addMeet, setAddMeet] = useState(mode === 'create' && defaultConferenceProvider === 'googleMeet');
  const [isFindingTimes, setIsFindingTimes] = useState(false);
  const [suggestedSlots, setSuggestedSlots] = useState<CalendarAvailabilitySlot[]>([]);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const fieldId = (name: string) => `${id}-${name}`;

  useEffect(() => {
    if (selectedCalendar || writableCalendars.length === 0) return;
    setCalendarSelection(initialCalendarSelection(
      writableCalendars,
      event,
      event?.accountId || defaultAccountId,
      calendarSettings.defaultCalendarId,
    ));
  }, [calendarSettings.defaultCalendarId, defaultAccountId, event, selectedCalendar, writableCalendars]);

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
  const participantEmails = useMemo(() => participants.map(participant => participant.email.trim()).filter(Boolean), [participants]);
  const invalidParticipants = useMemo(() => participantEmails.filter(email => !isValidEmail(email)), [participantEmails]);
  const hasTitle = Boolean(title.trim() || quickEventDraft?.title);
  const timeProblem = !isAllDay && startTimeInvalid;
  const canSubmit = hasTitle
    && invalidParticipants.length === 0
    && Boolean(proposedEventTimes)
    && !timeProblem
    && (recurrence !== 'custom' || Boolean(normalizedCustomRecurrence));
  const canFindGuestTimes = Boolean(onQueryFreeBusy)
    && participantEmails.length > 0
    && invalidParticipants.length === 0
    && Boolean(proposedEventTimes);
  const endClock = isAllDay ? null : eventEndClock(date, startTime, duration);
  const lastAllDay = nextCalendarDateInput(allDayEndDate, -1);
  const submitBlocker = !hasTitle
    ? 'Add a title to save.'
    : invalidParticipants.length > 0
      ? `Check the guest address ${invalidParticipants[0]}.`
      : !proposedEventTimes || timeProblem
        ? 'Check the date and time.'
        : recurrence === 'custom' && !normalizedCustomRecurrence
          ? 'Check the repeat rule.'
          : null;

  function applyDuration(minutes: number) {
    const next = Math.max(MIN_DURATION, Math.min(MAX_DURATION, Math.round(minutes)));
    setDuration(next);
    setDurationText(String(next));
  }

  function applyQuickEventDraft() {
    if (!quickEventDraft) return;
    setTitle(quickEventDraft.title);
    setDate(quickEventDraft.date);
    setAllDayEndDate(nextCalendarDateInput(quickEventDraft.date));
    setStartTime(quickEventDraft.startTime);
    applyDuration(quickEventDraft.durationMinutes);
    setLocation(quickEventDraft.location || '');
    setParticipants(attendeeRecipients(null, quickEventDraft.attendees));
    setRecurrence(quickEventDraft.recurrence);
    setQuickEventText('');
  }

  async function submitForm(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!canSubmit || isSaving) return;
    const quickValues = mode === 'create' && title.trim() ? null : quickEventDraft;
    const times = proposedEventTimes;
    const summary = title.trim() || quickValues?.title.trim() || '';
    if (!times || !summary || invalidParticipants.length > 0) return;
    const conferenceProvider = addMeet && !hasExistingMeet ? 'googleMeet' : 'none';
    const attendees = quickValues?.attendees.length ? quickValues.attendees : participantEmails;
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
      }, selectedAccountId);
      return;
    }
    await onSubmit(baseInput, selectedAccountId);
  }

  async function findGuestAvailability() {
    const times = proposedEventTimes;
    if (!times || !onQueryFreeBusy || participantEmails.length === 0 || invalidParticipants.length > 0) return;
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
        attendees: participantEmails,
        timeZone,
      }, selectedAccountId);
      const warning = freeBusyWarningMessage(result, participantEmails);
      if (warning) {
        setAvailabilityError(`${warning} Ask the guest to share their availability, or reconnect Calendar in Settings.`);
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
      // The shared helper labels slots in the system locale; show them in the app's vocabulary.
      setSuggestedSlots(slots.map(slot => {
        const dayLabel = formatWeekdayDay(slot.startAt);
        const timeLabel = formatTimeRange(slot.startAt, slot.endAt);
        return { ...slot, dayLabel, timeLabel, label: `${dayLabel}, ${timeLabel}` };
      }));
      if (slots.length === 0) setAvailabilityError('No time when everyone is free in your working hours.');
    } catch (error) {
      console.error('Calendar free/busy query failed:', error);
      setAvailabilityError('Could not check guest availability. Reconnect Calendar in Settings and try again.');
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
    if (Number.isFinite(durationMs) && durationMs > 0) applyDuration(durationMs / 60_000);
  }

  const heading = mode === 'edit' ? 'Edit event' : 'New event';
  return (
    <form data-calendar-editor onSubmit={submitForm} className="flex h-full min-h-0 flex-col" aria-labelledby={fieldId('heading')}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <h2 id={fieldId('heading')} className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{heading}</h2>
        <button type="button" title="Close" aria-label="Close" onClick={onClose} className={CAL_SMALL_ICON_BUTTON}>
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {mode === 'create' && (
          <>
            <Field
              label="Quick add"
              htmlFor={fieldId('quick')}
              hint={quickEventText.trim() && quickEventDraft ? (
                <button type="button" onClick={applyQuickEventDraft} className={`flex min-w-0 items-center gap-1.5 rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--raised-surface)] px-2 py-1.5 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)] ${CAL_FOCUS}`}>
                  <CalendarPlus aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--accent-ink)]" />
                  <span className="min-w-0 truncate">Use: {quickDraftLabel(quickEventDraft)}</span>
                </button>
              ) : <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Type the event in a sentence and press Enter.</span>}
            >
              <input
                id={fieldId('quick')}
                value={quickEventText}
                onChange={inputEvent => setQuickEventText(inputEvent.target.value)}
                onKeyDown={keyEvent => {
                  if (keyEvent.key === 'Enter') {
                    keyEvent.preventDefault();
                    applyQuickEventDraft();
                  }
                }}
                placeholder="Lunch with Sarah tomorrow at 13:00 @ Cafe"
                autoFocus
                className={SETTINGS_INPUT_CLASS}
              />
            </Field>
            {eventTemplates.length > 0 && (
              <Field label="Template" htmlFor={fieldId('template')}>
                <select
                  id={fieldId('template')}
                  defaultValue=""
                  onChange={inputEvent => {
                    const template = eventTemplates.find(item => item.id === inputEvent.target.value);
                    if (!template) return;
                    setTitle(template.summary);
                    applyDuration(template.durationMinutes);
                    setLocation(template.location || '');
                    setRecurrence(template.recurrence || 'none');
                    inputEvent.target.value = '';
                  }}
                  className={`${SETTINGS_SELECT_CLASS} w-full`}
                >
                  <option value="">Start from a template…</option>
                  {eventTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
              </Field>
            )}
          </>
        )}

        {mode === 'edit' && event?.recurringEventId && (
          <Field label="Apply changes to" htmlFor={fieldId('scope')}>
            <select id={fieldId('scope')} value={mutationScope} onChange={inputEvent => setMutationScope(inputEvent.target.value as CalendarMutationScope)} className={`${SETTINGS_SELECT_CLASS} w-full`}>
              {CALENDAR_DELETE_SCOPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        )}

        <Field label="Title" htmlFor={fieldId('title')}>
          <input
            id={fieldId('title')}
            value={title}
            autoFocus={mode === 'edit'}
            onChange={inputEvent => setTitle(inputEvent.target.value)}
            placeholder={mode === 'create' && quickEventDraft?.title ? quickEventDraft.title : 'Event title'}
            className={SETTINGS_INPUT_CLASS}
          />
        </Field>

        {writableCalendars.length > 0 && (mode === 'create' || !event?.recurringEventId) && (
          <Field label="Calendar" htmlFor={fieldId('calendar')}>
            <select id={fieldId('calendar')} value={calendarSelection} onChange={inputEvent => setCalendarSelection(inputEvent.target.value)} className={`${SETTINGS_SELECT_CLASS} w-full`}>
              {[...new Set(writableCalendars.map(calendar => calendar.accountId))].map(accountId => (
                <optgroup key={accountId} label={accountId}>
                  {writableCalendars.filter(calendar => calendar.accountId === accountId).map(calendar => (
                    <option key={calendarSelectionKey(calendar)} value={calendarSelectionKey(calendar)}>{calendar.summary}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
        )}

        <div className="flex items-center justify-between gap-3">
          <span id={fieldId('allday')} className="text-[calc(12px*var(--font-scale))] text-[var(--text-primary)]">All day</span>
          <Toggle
            checked={isAllDay}
            onChange={value => {
              setIsAllDay(value);
              // The date may have moved while the event was timed: the last day never precedes the first.
              if (value && allDayEndDate <= date) setAllDayEndDate(nextCalendarDateInput(date));
            }}
            ariaLabelledBy={fieldId('allday')}
          />
        </div>

        {isAllDay ? (
          <div className="grid grid-cols-2 gap-2">
            <CalendarDateField
              label="First day"
              value={date}
              weekStartsOn={calendarSettings.weekStartsOn}
              onChange={value => {
                setDate(value);
                if (allDayEndDate <= value) setAllDayEndDate(nextCalendarDateInput(value));
              }}
            />
            <CalendarDateField
              label="Last day"
              value={lastAllDay}
              min={date}
              weekStartsOn={calendarSettings.weekStartsOn}
              onChange={value => setAllDayEndDate(nextCalendarDateInput(value))}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.9fr)] gap-2">
              <CalendarDateField label="Date" value={date} weekStartsOn={calendarSettings.weekStartsOn} onChange={setDate} />
              <CalendarTimeField label="Start" value={startTime} onChange={setStartTime} onValidityChange={valid => setStartTimeInvalid(!valid)} />
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={fieldId('duration')} className={CAL_FIELD_LABEL}>Duration</label>
                <div className="relative">
                  <input
                    id={fieldId('duration')}
                    type="number"
                    inputMode="numeric"
                    min={MIN_DURATION}
                    max={MAX_DURATION}
                    step={5}
                    value={durationText}
                    aria-describedby={fieldId('ends')}
                    onChange={inputEvent => {
                      setDurationText(inputEvent.target.value);
                      const value = Number(inputEvent.target.value);
                      if (Number.isFinite(value) && value >= MIN_DURATION && value <= MAX_DURATION) setDuration(Math.round(value));
                    }}
                    onBlur={() => applyDuration(Number(durationText) || duration)}
                    style={{ paddingRight: 34 }}
                    className={`${SETTINGS_INPUT_CLASS} tabular-nums`}
                  />
                  <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">min</span>
                </div>
              </div>
            </div>
            <span id={fieldId('ends')} className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
              {endClock ? `Ends ${endClock} · ${formatDuration(duration)}` : 'Check the start time.'}
            </span>
          </div>
        )}

        {mode === 'create' && (
          <Field label="Repeat" htmlFor={fieldId('repeat')}>
            <select id={fieldId('repeat')} value={recurrence} onChange={inputEvent => setRecurrence(inputEvent.target.value as CalendarEventRecurrence | 'custom')} className={`${SETTINGS_SELECT_CLASS} w-full`}>
              {RECURRENCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              <option value="custom">Custom rule…</option>
            </select>
          </Field>
        )}
        {mode === 'create' && recurrence === 'custom' && (
          <Field
            label="Repeat rule"
            htmlFor={fieldId('rrule')}
            hint={customRecurrenceInput && !normalizedCustomRecurrence
              ? <span className="text-[calc(11px*var(--font-scale))] text-[var(--danger-solid)]">Start the rule with FREQ=, for example FREQ=WEEKLY;BYDAY=MO,WE.</span>
              : null}
          >
            <input id={fieldId('rrule')} value={customRecurrenceInput} onChange={inputEvent => setCustomRecurrenceInput(inputEvent.target.value)} placeholder="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE" aria-invalid={customRecurrenceInput.length > 0 && !normalizedCustomRecurrence} className={SETTINGS_INPUT_CLASS} />
          </Field>
        )}

        <Field label="Location" htmlFor={fieldId('location')}>
          <input id={fieldId('location')} value={location} onChange={inputEvent => setLocation(inputEvent.target.value)} placeholder="Room, address or link" className={SETTINGS_INPUT_CLASS} />
        </Field>

        <div className="flex items-center justify-between gap-3">
          <span id={fieldId('meet')} className="text-[calc(12px*var(--font-scale))] text-[var(--text-primary)]">
            {hasExistingMeet ? 'Google Meet link added' : 'Add a Google Meet link'}
          </span>
          <Toggle checked={addMeet || hasExistingMeet} disabled={hasExistingMeet} onChange={setAddMeet} ariaLabelledBy={fieldId('meet')} />
        </div>

        <div className="flex flex-col gap-1">
          <CalendarParticipantPicker accountId={selectedAccountId} recipients={participants} onChange={setParticipants} />
          {invalidParticipants.length > 0 && (
            <div role="alert" className="text-[calc(11px*var(--font-scale))] text-[var(--danger-solid)]">Not a valid address: {invalidParticipants[0]}</div>
          )}
        </div>
        {!isAllDay && <CalendarGuestAvailability
          guestCount={participantEmails.length}
          canFindTimes={canFindGuestTimes}
          isFindingTimes={isFindingTimes}
          availabilityError={availabilityError}
          suggestedSlots={suggestedSlots}
          onFindTimes={() => void findGuestAvailability()}
          onApplySlot={applySuggestedSlot}
        />}

        <Field label="Notes" htmlFor={fieldId('notes')}>
          <textarea id={fieldId('notes')} value={description} onChange={inputEvent => setDescription(inputEvent.target.value)} rows={3} style={{ height: 'auto', minHeight: 64, paddingTop: 6, paddingBottom: 6 }} className={`${SETTINGS_INPUT_CLASS} resize-y`} />
        </Field>

        {proposedConflicts.length > 0 && (
          <div role="status" className="rounded-[var(--control-radius)] border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-2.5 py-2 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]">
            <div className="mb-1 flex items-center gap-1.5 font-semibold text-[var(--warning-solid)]">
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
              {proposedConflicts.length === 1 ? 'Overlaps another event' : `Overlaps ${proposedConflicts.length} events`}
            </div>
            <ul className="flex flex-col gap-0.5">
              {proposedConflicts.map(conflict => (
                <li key={`${conflict.event.calendarId}:${conflict.event.id}`} className="flex min-w-0 justify-between gap-2">
                  <span className="min-w-0 truncate">{conflict.event.summary}</span>
                  <span className="shrink-0 tabular-nums text-[var(--text-secondary)]">{conflictTimeLabel(conflict)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-[var(--border)] pt-2">
          <button type="button" aria-expanded={showMore} aria-controls={fieldId('more')} onClick={() => setShowMore(value => !value)} className={CAL_LINK}>
            {showMore ? 'Fewer options' : 'More options'}
          </button>
          {showMore && (
            <div id={fieldId('more')} className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Reminder" htmlFor={fieldId('reminder')}>
                <select id={fieldId('reminder')} value={reminderMinutes} onChange={inputEvent => setReminderMinutes(Number(inputEvent.target.value))} className={`${SETTINGS_SELECT_CLASS} w-full min-w-0`}>
                  <option value={-1}>Calendar default</option>
                  <option value={0}>At start time</option>
                  <option value={5}>5 min before</option>
                  <option value={10}>10 min before</option>
                  <option value={15}>15 min before</option>
                  <option value={30}>30 min before</option>
                  <option value={60}>1 h before</option>
                  <option value={1440}>1 day before</option>
                </select>
              </Field>
              <Field label="Show me as" htmlFor={fieldId('busy')}>
                <select id={fieldId('busy')} value={transparency} onChange={inputEvent => setTransparency(inputEvent.target.value as typeof transparency)} className={`${SETTINGS_SELECT_CLASS} w-full min-w-0`}>
                  <option value="opaque">Busy</option>
                  <option value="transparent">Free</option>
                </select>
              </Field>
              <Field label="Visibility" htmlFor={fieldId('visibility')}>
                <select id={fieldId('visibility')} value={visibility} onChange={inputEvent => setVisibility(inputEvent.target.value as typeof visibility)} className={`${SETTINGS_SELECT_CLASS} w-full min-w-0`}>
                  <option value="default">Calendar default</option>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                  <option value="confidential">Confidential</option>
                </select>
              </Field>
              <Field label="Colour" htmlFor={fieldId('color')}>
                <select id={fieldId('color')} value={colorId} onChange={inputEvent => setColorId(inputEvent.target.value)} className={`${SETTINGS_SELECT_CLASS} w-full min-w-0`}>
                  <option value="">Calendar colour</option>
                  {EVENT_COLOR_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <div className="col-span-2">
                <Field label="Email guests about this change" htmlFor={fieldId('notify')}>
                  <select id={fieldId('notify')} value={sendUpdates} onChange={inputEvent => setSendUpdates(inputEvent.target.value as typeof sendUpdates)} className={`${SETTINGS_SELECT_CLASS} w-full min-w-0`}>
                    <option value="all">Email all guests</option>
                    <option value="externalOnly">Only guests outside my organisation</option>
                    <option value="none">Don't email guests</option>
                  </select>
                </Field>
              </div>
            </div>
          )}
        </div>

        {mode === 'create' && onSaveTemplate && title.trim() && (
          <button
            type="button"
            onClick={() => onSaveTemplate({ name: title.trim(), summary: title.trim(), durationMinutes: duration, location: location.trim() || null, recurrence: recurrence === 'custom' ? 'none' : recurrence })}
            className={`${CAL_LINK} self-start`}
          >
            Save as a template
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2.5">
        {submitBlocker && <span className="mr-auto min-w-0 truncate text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]" title={submitBlocker}>{submitBlocker}</span>}
        <button type="button" onClick={onCancel} className={CAL_BUTTON}>Cancel</button>
        <button type="submit" disabled={!canSubmit || isSaving} className={CAL_PRIMARY_BUTTON}>
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
