import { useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, CalendarPlus, Trash2, Video, X } from 'lucide-react';
import type { CalendarAvailabilitySlot } from '../../../shared/calendarAvailability';
import type { CalendarEvent, CalendarEventCreateInput, CalendarEventRecurrence, CalendarEventUpdateInput, CalendarFreeBusyRequest, CalendarFreeBusyResult, CalendarSettings } from '../../../shared/types';
import { findAvailabilitySlotsFromBusyIntervals, findRecurringCalendarConflicts, freeBusyWarningMessage } from '../../../shared/calendarAvailability';
import {
  calendarEventTimesFromLocalInput,
  defaultCalendarEventFormForDate,
  localCalendarTimeZone,
  localDateInputValue,
  localTimeInputValue,
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
  isSaving: boolean;
  isDeleting?: boolean;
  onCancel: () => void;
  onSubmit: (input: CalendarEventCreateInput | CalendarEventUpdateInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onQueryFreeBusy?: (input: CalendarFreeBusyRequest) => Promise<CalendarFreeBusyResult>;
}

export function CalendarEventForm({
  mode,
  event,
  selectedDate,
  defaultDurationMinutes,
  defaultConferenceProvider,
  calendarSettings,
  calendarEvents,
  isSaving,
  isDeleting = false,
  onCancel,
  onSubmit,
  onDelete,
  onQueryFreeBusy,
}: CalendarEventFormProps) {
  const today = new Date();
  const defaults = event
    ? formDefaultsFromEvent(event, defaultDurationMinutes)
    : defaultCalendarEventFormForDate(selectedDate, defaultDurationMinutes, today);
  const hasExistingMeet = Boolean(event?.conferenceUrl);
  const [quickEventText, setQuickEventText] = useState('');
  const [title, setTitle] = useState(event?.summary || '');
  const [date, setDate] = useState(defaults.date);
  const [startTime, setStartTime] = useState(defaults.startTime);
  const [duration, setDuration] = useState(defaults.durationMinutes);
  const [location, setLocation] = useState(event?.location || '');
  const [guests, setGuests] = useState(attendeeInputValue(event));
  const [recurrence, setRecurrence] = useState<CalendarEventRecurrence>('none');
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
    return calendarEventTimesFromLocalInput(
      quickValues?.date || date,
      quickValues?.startTime || startTime,
      quickValues?.durationMinutes || duration,
    );
  }, [date, duration, mode, quickEventDraft, startTime, title]);
  const proposedRecurrence = mode === 'create'
    ? (title.trim() ? recurrence : quickEventDraft?.recurrence || recurrence)
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
  const canSubmit = Boolean(title.trim() || quickEventDraft?.title) && parsedGuests.invalid.length === 0 && Boolean(proposedEventTimes);
  const canFindGuestTimes = Boolean(onQueryFreeBusy)
    && parsedGuests.emails.length > 0
    && parsedGuests.invalid.length === 0
    && Boolean(proposedEventTimes);

  function applyQuickEventDraft() {
    if (!quickEventDraft) return;
    setTitle(quickEventDraft.title);
    setDate(quickEventDraft.date);
    setStartTime(quickEventDraft.startTime);
    setDuration(quickEventDraft.durationMinutes);
    setLocation(quickEventDraft.location || '');
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
    const baseInput: CalendarEventCreateInput = {
      summary,
      location: quickValues ? quickValues.location : location.trim() || null,
      startAt: times.startAt,
      endAt: times.endAt,
      attendees: parsedGuests.emails,
      conferenceProvider,
      recurrence: mode === 'create' ? (quickValues?.recurrence || recurrence) : 'none',
      timeZone,
    };

    if (mode === 'edit' && event) {
      await onSubmit({
        ...baseInput,
        eventId: event.id,
        calendarId: event.calendarId || 'primary',
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
    <form onSubmit={submitForm} className="rounded-md border border-[var(--border)] bg-[var(--panel-bg)] p-2.5">
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
        <input
          value={title}
          onChange={(inputEvent) => setTitle(inputEvent.target.value)}
          placeholder="Title"
          className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <div className="grid grid-cols-[1.2fr_0.9fr_0.8fr] gap-1.5">
          <input
            type="date"
            value={date}
            onChange={(inputEvent) => setDate(inputEvent.target.value)}
            className="min-w-0 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <input
            type="time"
            value={startTime}
            onChange={(inputEvent) => setStartTime(inputEvent.target.value)}
            className="min-w-0 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <input
            type="number"
            min={15}
            max={480}
            step={15}
            value={duration}
            onChange={(inputEvent) => setDuration(Math.max(15, Math.min(480, Number(inputEvent.target.value) || 30)))}
            className="min-w-0 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </div>
        {mode === 'create' && (
          <select
            value={recurrence}
            onChange={(inputEvent) => setRecurrence(inputEvent.target.value as CalendarEventRecurrence)}
            className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            {RECURRENCE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        )}
        <input
          value={location}
          onChange={(inputEvent) => setLocation(inputEvent.target.value)}
          placeholder="Location"
          className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        <input
          value={guests}
          onChange={(inputEvent) => setGuests(inputEvent.target.value)}
          placeholder="Guests"
          className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        />
        {parsedGuests.invalid.length > 0 && (
          <div className="rounded-md border border-[var(--danger)]/35 bg-[var(--danger)]/10 px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--danger)]">
            Invalid guest: {parsedGuests.invalid[0]}
          </div>
        )}
        <CalendarGuestAvailability
          guestCount={parsedGuests.emails.length}
          canFindTimes={canFindGuestTimes}
          isFindingTimes={isFindingTimes}
          availabilityError={availabilityError}
          suggestedSlots={suggestedSlots}
          onFindTimes={() => void findGuestAvailability()}
          onApplySlot={applySuggestedSlot}
        />
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
                void onDelete();
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
