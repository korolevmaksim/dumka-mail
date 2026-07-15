import { Users } from 'lucide-react';
import type { CalendarEvent, CalendarListEntry } from '../../../shared/types';
import { calendarParticipantPreview, calendarParticipantsAccessibleLabel } from './calendarParticipants';

interface CalendarEventChipProps {
  event: CalendarEvent;
  calendar?: CalendarListEntry;
  compact?: boolean;
  draggable?: boolean;
  onSelect: (event: CalendarEvent) => void;
}

function eventTime(event: CalendarEvent): string {
  if (event.isAllDay) return '';
  return new Date(event.startAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function accessibleEventLabel(event: CalendarEvent, calendar?: CalendarListEntry): string {
  const timing = event.isAllDay
    ? `all day, ${event.startDate || new Date(event.startAt).toLocaleDateString()} through ${event.endDate || new Date(event.endAt).toLocaleDateString()}`
    : `${new Date(event.startAt).toLocaleString()} to ${new Date(event.endAt).toLocaleString()}`;
  return [event.summary, timing, calendar?.summary, event.location, calendarParticipantsAccessibleLabel(event), event.status === 'pending' ? 'waiting to sync' : null]
    .filter(Boolean)
    .join(', ');
}

export function CalendarEventChip({ event, calendar, compact = false, draggable = true, onSelect }: CalendarEventChipProps) {
  const backgroundColor = calendar?.backgroundColor || '#3b82f6';
  const foregroundColor = calendar?.foregroundColor || '#ffffff';
  const participantPreview = calendarParticipantPreview(event);
  const participantLabel = calendarParticipantsAccessibleLabel(event);
  return (
    <button
      type="button"
      draggable={draggable && (calendar?.accessRole === 'writer' || calendar?.accessRole === 'owner')}
      onDragStart={(dragEvent) => {
        dragEvent.dataTransfer.effectAllowed = 'move';
        dragEvent.dataTransfer.setData('application/x-dumka-calendar-event', JSON.stringify({
          accountId: event.accountId,
          calendarId: event.calendarId,
          eventId: event.id,
        }));
      }}
      onClick={(clickEvent) => {
        clickEvent.stopPropagation();
        onSelect(event);
      }}
      title={[event.summary, event.location, participantLabel].filter(Boolean).join(' · ')}
      aria-label={accessibleEventLabel(event, calendar)}
      className={`dm-calendar-event flex w-full min-w-0 items-center gap-1 rounded px-1.5 text-left font-medium shadow-sm outline-none ring-offset-1 ring-offset-[var(--app-bg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${event.status === 'pending' ? 'border border-dashed border-white/70 opacity-80' : ''} ${
        compact ? 'h-[18px] text-[calc(9px*var(--font-scale))]' : 'min-h-[22px] py-1 text-[calc(10px*var(--font-scale))]'
      }`}
      style={{ backgroundColor, color: foregroundColor }}
    >
      {!event.isAllDay && <span className="shrink-0 opacity-75">{eventTime(event)}</span>}
      <span className="min-w-0 flex-1 truncate">{event.summary}</span>
      {participantPreview && (
        <span className="dm-calendar-participant-preview ml-auto flex min-w-0 max-w-[40%] shrink items-center gap-0.5 opacity-80" aria-label={participantLabel || undefined}>
          <Users className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          <span className="dm-calendar-participant-preview-name truncate">{participantPreview}</span>
        </span>
      )}
      {event.conferenceUrl && <span className="shrink-0 opacity-80" aria-label="Video meeting">⌁</span>}
      {event.status === 'pending' && <span className="shrink-0 text-[8px] uppercase opacity-75">sync</span>}
    </button>
  );
}
