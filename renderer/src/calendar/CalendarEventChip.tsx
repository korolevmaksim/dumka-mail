import { Users, Video } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { CalendarEvent, CalendarListEntry } from '../../../shared/types';
import { calendarParticipantPreview, calendarParticipantsAccessibleLabel } from './calendarParticipants';
import { EVENT_TINT, EVENT_TINT_SELECTED, calendarEventColor, eventTintCss } from './calendarEventColors';
import { calendarEventTimeLabel, calendarEventWhenLabel, clockLabel } from './calendarDateLabels';
import { CAL_FOCUS } from './calendarUi';

export const CALENDAR_EVENT_DRAG_TYPE = 'application/x-dumka-calendar-event';

interface CalendarEventChipProps {
  event: CalendarEvent;
  calendar?: CalendarListEntry;
  /**
   * `block`: a time-grid block that fills its positioned parent (title, then the
   * time range when `twoLines`). `chip`: one line in month cells and the
   * all-day row. `row`: a roomier line for the agenda.
   */
  variant?: 'block' | 'chip' | 'row';
  twoLines?: boolean;
  selected?: boolean;
  draggable?: boolean;
  /** Bars spanning several days: square the edge that continues. */
  continuesBefore?: boolean;
  continuesAfter?: boolean;
  onSelect: (event: CalendarEvent) => void;
}

export function calendarEventIsWritable(calendar?: CalendarListEntry): boolean {
  return calendar?.accessRole === 'writer' || calendar?.accessRole === 'owner';
}

export function calendarEventAccessibleLabel(event: CalendarEvent, calendar?: CalendarListEntry): string {
  return [
    event.summary || '(no title)',
    calendarEventWhenLabel(event),
    calendar ? `${calendar.summary} calendar` : null,
    event.location,
    calendarParticipantsAccessibleLabel(event),
    event.selfResponseStatus === 'declined' ? 'you declined' : event.selfResponseStatus === 'tentative' ? 'you answered maybe' : null,
    event.status === 'pending' ? 'waiting to sync' : null,
  ].filter(Boolean).join(', ');
}

export function CalendarEventChip({
  event,
  calendar,
  variant = 'chip',
  twoLines = false,
  selected = false,
  draggable = true,
  continuesBefore = false,
  continuesAfter = false,
  onSelect,
}: CalendarEventChipProps) {
  const color = calendarEventColor(event, calendar);
  const participantPreview = calendarParticipantPreview(event);
  const title = event.summary || '(no title)';
  const declined = event.selfResponseStatus === 'declined';
  const pending = event.status === 'pending';
  const style: CSSProperties = {
    background: eventTintCss(color, selected ? EVENT_TINT_SELECTED : EVENT_TINT),
    borderLeftColor: continuesBefore ? 'transparent' : color,
    ...(pending ? { borderTop: `1px dashed ${color}`, borderRight: `1px dashed ${color}`, borderBottom: `1px dashed ${color}` } : null),
    ...(selected ? { boxShadow: `inset 0 0 0 1px ${color}` } : null),
    borderTopLeftRadius: continuesBefore ? 0 : undefined,
    borderBottomLeftRadius: continuesBefore ? 0 : undefined,
    borderTopRightRadius: continuesAfter ? 0 : undefined,
    borderBottomRightRadius: continuesAfter ? 0 : undefined,
  };
  const shape = variant === 'block'
    ? 'h-full flex-col items-stretch justify-start overflow-hidden px-1.5 py-[3px]'
    : variant === 'row'
      ? 'min-h-8 items-center gap-2 px-2.5 py-1.5'
      : 'h-6 items-center gap-1 px-1.5';
  const timeText = event.isAllDay ? null : variant === 'block' ? calendarEventTimeLabel(event) : clockLabel(event.startAt);

  return (
    <button
      type="button"
      draggable={draggable && calendarEventIsWritable(calendar)}
      onDragStart={(dragEvent) => {
        dragEvent.dataTransfer.effectAllowed = 'move';
        dragEvent.dataTransfer.setData(CALENDAR_EVENT_DRAG_TYPE, JSON.stringify({
          accountId: event.accountId,
          calendarId: event.calendarId,
          eventId: event.id,
        }));
      }}
      onClick={(clickEvent) => {
        clickEvent.stopPropagation();
        onSelect(event);
      }}
      onDoubleClick={(clickEvent) => clickEvent.stopPropagation()}
      title={[title, calendarEventWhenLabel(event), calendar?.summary, event.location, pending ? 'Waiting to sync' : null].filter(Boolean).join(' · ')}
      aria-label={calendarEventAccessibleLabel(event, calendar)}
      aria-current={selected ? 'true' : undefined}
      className={`dm-calendar-event flex w-full min-w-0 cursor-pointer rounded-[var(--control-radius)] border-l-[3px] text-left text-[var(--text-primary)] ${CAL_FOCUS} ${shape}`}
      style={style}
    >
      {variant === 'block' ? (
        <>
          <span className={`block min-w-0 truncate text-[calc(11px*var(--font-scale))] font-semibold leading-[14px] ${declined ? 'line-through' : ''}`}>
            {!twoLines && timeText ? <span className="font-normal tabular-nums">{clockLabel(event.startAt)} </span> : null}
            {title}
          </span>
          {twoLines && timeText && (
            <span className="block min-w-0 truncate text-[calc(11px*var(--font-scale))] leading-[14px] tabular-nums">{timeText}</span>
          )}
          {twoLines && event.location && (
            <span className="block min-w-0 truncate text-[calc(11px*var(--font-scale))] leading-[14px]">{event.location}</span>
          )}
        </>
      ) : (
        <>
          {timeText && <span className={`shrink-0 tabular-nums text-[calc(11px*var(--font-scale))] ${variant === 'row' ? 'w-[92px] truncate' : ''}`}>{variant === 'row' ? calendarEventTimeLabel(event) : timeText}</span>}
          {variant === 'row' && event.isAllDay && <span className="w-[92px] shrink-0 text-[calc(11px*var(--font-scale))]">All day</span>}
          <span className={`min-w-0 flex-1 truncate font-semibold ${variant === 'row' ? 'text-[calc(12px*var(--font-scale))]' : 'text-[calc(11px*var(--font-scale))]'} ${declined ? 'line-through' : ''}`}>{title}</span>
          {participantPreview && variant === 'row' && (
            <span className="dm-calendar-participant-preview ml-auto flex min-w-0 max-w-[40%] shrink items-center gap-1 text-[calc(11px*var(--font-scale))]">
              <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="dm-calendar-participant-preview-name truncate">{participantPreview}</span>
            </span>
          )}
          {event.conferenceUrl && variant === 'row' && <Video className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        </>
      )}
    </button>
  );
}
