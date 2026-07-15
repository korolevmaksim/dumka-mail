import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarCheck, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock, MapPin, Pencil, RefreshCw } from 'lucide-react';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';
import { CalendarEventForm } from './CalendarEventForm';
import type { CalendarEvent, CalendarEventCreateInput, CalendarEventUpdateInput } from '../../../shared/types';
import { findAvailabilitySlots, type CalendarAvailabilitySlot } from '../../../shared/calendarAvailability';
import { calendarEventTimesFromLocalInput, localCalendarTimeZone, parseNaturalLanguageCalendarEvent } from '../../../shared/calendarCreate';
import {
  MINI_CALENDAR_WEEKDAYS,
  addLocalDays,
  addLocalMonths,
  buildMiniCalendarMonth,
  calendarEventsForDay,
  countCalendarEventsByDay,
  monthTitle,
  sameLocalDay,
  startOfLocalDay,
  visibleMiniCalendarRange,
} from '../../../shared/calendarMini';
import { quickDraftLabel } from '../lib/calendarEventFormHelpers';
import { agendaEventTime, upcomingAgendaDateTimeLabel } from '../lib/calendarAgenda';

function dayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function CalendarAgendaPanel() {
  const store = useAppStore();
  const enabled = store.googleIntegrationStatus?.calendarEnabled === true;
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [isQuickCreating, setIsQuickCreating] = useState(false);
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [createSlot, setCreateSlot] = useState<CalendarAvailabilitySlot | null>(null);
  const [quickEventText, setQuickEventText] = useState('');
  const defaultMeetingDurationMinutes = store.settings.calendar.defaultMeetingDurationMinutes;
  const calendarWeeks = useMemo(
    () => buildMiniCalendarMonth(visibleMonth, selectedDate, today),
    [selectedDate, today, visibleMonth],
  );
  const quickEventDraft = useMemo(
    () => enabled
      ? parseNaturalLanguageCalendarEvent(quickEventText, selectedDate, defaultMeetingDurationMinutes, new Date())
      : null,
    [defaultMeetingDurationMinutes, enabled, quickEventText, selectedDate],
  );
  const eventCounts = useMemo(() => countCalendarEventsByDay(store.calendarEvents), [store.calendarEvents]);
  const selectedDayStart = startOfLocalDay(selectedDate);
  const selectedDayEnd = addLocalDays(selectedDayStart, 1);
  const selectedEvents = calendarEventsForDay(store.calendarEvents, selectedDate, 8);
  const upcoming = store.calendarEvents
    .filter(event => new Date(event.startAt).getTime() >= selectedDayEnd.getTime())
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 4);
  const canShowAvailability = enabled && selectedDayStart.getTime() >= startOfLocalDay(today).getTime();
  const availabilityAnchor = sameLocalDay(selectedDate, today) ? today : selectedDayStart;
  const availabilitySlots = canShowAvailability
    ? findAvailabilitySlots(store.calendarEvents, store.settings.calendar, availabilityAnchor, 3)
    : [];

  useEffect(() => {
    if (!enabled) return;
    void store.syncCalendarAgenda(undefined, visibleMiniCalendarRange(visibleMonth));
  }, [enabled, store.syncCalendarAgenda, visibleMonth]);

  function showMonth(offset: number) {
    const nextMonth = addLocalMonths(visibleMonth, offset);
    setVisibleMonth(nextMonth);
    setSelectedDate(current => (
      current.getFullYear() === nextMonth.getFullYear() && current.getMonth() === nextMonth.getMonth()
        ? current
        : nextMonth
    ));
  }

  function selectDay(date: Date) {
    setSelectedDate(date);
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  function selectToday() {
    const next = new Date();
    setSelectedDate(next);
    setVisibleMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  }

  function openCreateForm() {
    setCreateSlot(null);
    setEditingEvent(null);
    setIsCreating(true);
  }

  function openCreateFormForSlot(slot: CalendarAvailabilitySlot) {
    const slotStart = new Date(slot.startAt);
    if (Number.isFinite(slotStart.getTime())) {
      setSelectedDate(slotStart);
      setVisibleMonth(new Date(slotStart.getFullYear(), slotStart.getMonth(), 1));
    }
    setCreateSlot(slot);
    setEditingEvent(null);
    setIsCreating(true);
  }

  function openEditForm(event: CalendarEvent) {
    setCreateSlot(null);
    setIsCreating(false);
    setEditingEvent(event);
  }

  function closeEventForm() {
    setIsCreating(false);
    setEditingEvent(null);
    setCreateSlot(null);
  }

  async function submitEventForm(input: CalendarEventCreateInput | CalendarEventUpdateInput, targetAccountId: string) {
    if (!enabled || isSavingEvent) return;
    setIsSavingEvent(true);
    try {
      const saved = 'eventId' in input
        ? await store.updateCalendarEvent(input, editingEvent?.accountId || targetAccountId)
        : await store.createCalendarEvent(input, targetAccountId);
      const start = new Date(saved.startAt);
      setSelectedDate(start);
      setVisibleMonth(new Date(start.getFullYear(), start.getMonth(), 1));
      closeEventForm();
      emitToast({ type: 'success', message: 'eventId' in input ? 'Calendar event updated.' : 'Calendar event created.' });
    } catch (error) {
      console.error('Calendar event save failed:', error);
      emitToast({ type: 'error', message: 'Could not save calendar event.' });
    } finally {
      setIsSavingEvent(false);
    }
  }

  async function submitQuickEvent(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!enabled) {
      emitToast({ type: 'info', message: 'Enable Calendar in Settings before creating events.' });
      return;
    }
    if (!quickEventDraft || isQuickCreating) return;
    const times = calendarEventTimesFromLocalInput(
      quickEventDraft.date,
      quickEventDraft.startTime,
      quickEventDraft.durationMinutes,
    );
    if (!times) {
      emitToast({ type: 'error', message: 'Could not parse that event time.' });
      return;
    }

    setIsQuickCreating(true);
    try {
      const saved = await store.createCalendarEvent({
        summary: quickEventDraft.title,
        location: quickEventDraft.location,
        startAt: times.startAt,
        endAt: times.endAt,
        attendees: quickEventDraft.attendees,
        conferenceProvider: store.settings.calendar.defaultConferenceProvider === 'googleMeet' ? 'googleMeet' : 'none',
        recurrence: quickEventDraft.recurrence,
        timeZone: localCalendarTimeZone(),
      });
      const start = new Date(saved.startAt);
      setSelectedDate(start);
      setVisibleMonth(new Date(start.getFullYear(), start.getMonth(), 1));
      setQuickEventText('');
      emitToast({ type: 'success', message: 'Calendar event created.' });
    } catch (error) {
      console.error('Quick calendar event create failed:', error);
      emitToast({ type: 'error', message: 'Could not create calendar event.' });
    } finally {
      setIsQuickCreating(false);
    }
  }

  async function deleteEditingEvent() {
    if (!editingEvent || isDeletingEvent) return;
    setIsDeletingEvent(true);
    try {
      await store.deleteCalendarEvent(editingEvent);
      closeEventForm();
      emitToast({ type: 'success', message: 'Calendar event deleted.' });
    } catch (error) {
      console.error('Calendar event delete failed:', error);
      emitToast({ type: 'error', message: 'Could not delete calendar event.' });
    } finally {
      setIsDeletingEvent(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-chrome text-[var(--text-secondary)] flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          AGENDA
          {enabled && (
            <button
              type="button"
              onClick={() => void store.syncCalendarAgenda()}
              title="Sync Calendar"
              className="p-1 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-[background-color,color] duration-150 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
        </span>
        <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-[var(--success)]' : 'bg-[var(--text-tertiary)]'}`} />
      </h3>

      <div className="dm-panel border border-[var(--border)] rounded-lg p-3 bg-[var(--app-bg)] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-[var(--accent)]" />
            <div className="flex flex-col">
              <span className="text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{dayLabel(selectedDate)}</span>
              <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{selectedEvents.length} event{selectedEvents.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {enabled && (
              <button
                type="button"
                onClick={openCreateForm}
                title="New event"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--accent)]"
              >
                <CalendarPlus className="h-3.5 w-3.5" />
              </button>
            )}
            {!sameLocalDay(selectedDate, today) && (
              <button
                type="button"
                onClick={selectToday}
                className="rounded-md border border-[var(--border)] px-2 py-1 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)]"
              >
                Today
              </button>
            )}
          </div>
        </div>

        <div className="dm-inset rounded-md border border-[var(--border)] bg-[var(--panel-bg)] p-2">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => showMonth(-1)}
              title="Previous month"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-0 truncate text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
              {monthTitle(visibleMonth)}
            </span>
            <button
              type="button"
              onClick={() => showMonth(1)}
              title="Next month"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-tertiary)]">
            {MINI_CALENDAR_WEEKDAYS.map(day => <span key={day}>{day}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {calendarWeeks.flat().map(day => {
              const count = eventCounts[day.key] || 0;
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => selectDay(day.date)}
                  title={`${day.key}${count > 0 ? `, ${count} event${count === 1 ? '' : 's'}` : ''}`}
                  className={`relative flex aspect-square min-h-7 items-center justify-center rounded-md text-[calc(10px*var(--font-scale))] font-medium transition-colors ${
                    day.isSelected
                      ? 'bg-[var(--accent)] text-white'
                      : day.isToday
                        ? 'border border-[var(--accent)] text-[var(--text-primary)]'
                        : day.isCurrentMonth
                          ? 'text-[var(--text-primary)] hover:bg-[var(--hover-row)]'
                          : 'text-[var(--text-tertiary)] hover:bg-[var(--hover-row)]'
                  }`}
                >
                  <span>{day.dayNumber}</span>
                  {count > 0 && (
                    <span className={`absolute bottom-1 h-1 w-1 rounded-full ${day.isSelected ? 'bg-white' : 'bg-[var(--accent)]'}`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {enabled && !isCreating && !editingEvent && (
          <form onSubmit={submitQuickEvent} className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <input
                value={quickEventText}
                onChange={(inputEvent) => setQuickEventText(inputEvent.target.value)}
                placeholder="Demo tomorrow 2-3pm with sam@example.com"
                className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="submit"
                title="Create event"
                disabled={!quickEventDraft || isQuickCreating}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-white disabled:opacity-50"
              >
                <CalendarPlus className="h-3.5 w-3.5" />
              </button>
            </div>
            {quickEventText.trim() && quickEventDraft && (
              <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-[var(--accent)]/25 bg-[var(--accent)]/8 px-2 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                <CalendarPlus className="h-3 w-3 shrink-0 text-[var(--accent)]" />
                <span className="truncate">{quickDraftLabel(quickEventDraft)}</span>
              </div>
            )}
          </form>
        )}

        {!enabled ? (
          <button
            type="button"
            onClick={() => void store.authorizeGoogleIntegration('calendar')}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-[calc(11px*var(--font-scale))] font-semibold text-white"
          >
            <CalendarCheck className="h-3.5 w-3.5" />
            Enable Calendar
          </button>
        ) : isCreating || editingEvent ? (
          <CalendarEventForm
            key={editingEvent ? `${editingEvent.calendarId}:${editingEvent.id}` : createSlot?.startAt || selectedDayStart.toISOString()}
            mode={editingEvent ? 'edit' : 'create'}
            event={editingEvent}
            selectedDate={selectedDate}
            defaultDurationMinutes={defaultMeetingDurationMinutes}
            defaultConferenceProvider={store.settings.calendar.defaultConferenceProvider}
            calendarSettings={store.settings.calendar}
            calendarEvents={store.calendarEvents}
            calendars={editingEvent
              ? store.calendarLists.filter(calendar => calendar.accountId === editingEvent.accountId)
              : store.calendarLists}
            defaultAccountId={editingEvent?.accountId
              || (store.activeAccount && store.activeAccount.id !== 'unified' ? store.activeAccount.email : store.accounts[0]?.email)
              || ''}
            initialStartAt={createSlot?.startAt}
            initialEndAt={createSlot?.endAt}
            isSaving={isSavingEvent}
            isDeleting={isDeletingEvent}
            onCancel={closeEventForm}
            onSubmit={submitEventForm}
            onDelete={editingEvent ? deleteEditingEvent : undefined}
            onQueryFreeBusy={(input, targetAccountId) => store.queryCalendarFreeBusy(input, targetAccountId)}
          />
        ) : selectedEvents.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
            No events on this day.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {selectedEvents.map(event => (
              <div key={`${event.calendarId}:${event.id}`} className="rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-2">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0 truncate text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{event.summary}</div>
                  <button
                    type="button"
                    onClick={() => openEditForm(event)}
                    title="Edit event"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--hover-row)] hover:text-[var(--accent)]"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                  <Clock className="h-3 w-3" />
                  <span>{agendaEventTime(event)}</span>
                </div>
                {event.location && (
                  <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{event.location}</span>
                  </div>
                )}
                {event.conferenceUrl && (
                  <a
                    href={event.conferenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex text-[calc(10px*var(--font-scale))] font-medium text-[var(--accent)] hover:underline"
                  >
                    Join call
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {canShowAvailability && availabilitySlots.length > 0 && (
          <div className="border-t border-[var(--border)] pt-2">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold uppercase text-[var(--text-secondary)]">Availability</span>
            <div className="mt-1.5 flex flex-col gap-1">
              {availabilitySlots.map(slot => (
                <button
                  key={slot.startAt}
                  type="button"
                  onClick={() => openCreateFormForSlot(slot)}
                  title="Create event at this time"
                  className="flex min-w-0 items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-[calc(10px*var(--font-scale))] hover:bg-[var(--hover-row)]"
                >
                  <span className="min-w-0 truncate text-[var(--text-primary)]">{slot.dayLabel}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-[var(--text-secondary)]">
                    {slot.timeLabel}
                    <CalendarPlus className="h-3 w-3 text-[var(--accent)]" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {enabled && upcoming.length > 0 && (
          <div className="border-t border-[var(--border)] pt-2">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold uppercase text-[var(--text-secondary)]">Next</span>
            <div className="mt-1.5 flex flex-col gap-1">
              {upcoming.map(event => (
                <div key={`${event.calendarId}:${event.id}`} className="flex min-w-0 items-center justify-between gap-2 text-[calc(10px*var(--font-scale))]">
                  <span className="min-w-0 truncate text-[var(--text-primary)]">{event.summary}</span>
                  <span className="shrink-0 text-[var(--text-secondary)]">{upcomingAgendaDateTimeLabel(event)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
