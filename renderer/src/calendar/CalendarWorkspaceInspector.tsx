import { Copy, Download, MailPlus, Video, X } from 'lucide-react';
import type { CalendarAttendeeResponse, CalendarEvent, CalendarEventCreateInput, CalendarEventUpdateInput, CalendarInvite, CalendarListEntry, CalendarMutationScope, CalendarSettings } from '../../../shared/types';
import { calendarEventDurationMinutes } from '../../../shared/calendarWorkspace';
import { CalendarEventForm } from '../components/CalendarEventForm';
import { useAppStore } from '../stores/AppStore';
import { CalendarEventParticipants } from './CalendarEventParticipants';
import { CalendarRsvpActions } from './CalendarRsvpActions';

interface CalendarImportPreviewProps {
  preview: { filename: string; invite: CalendarInvite };
  calendarId: string;
  calendars: CalendarListEntry[];
  isSaving: boolean;
  onChangeCalendar: (calendarId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function CalendarImportPreview({ preview, calendarId, calendars, isSaving, onChangeCalendar, onClose, onConfirm }: CalendarImportPreviewProps) {
  return (
    <div className="dm-panel rounded-lg border border-[var(--accent)]/35 bg-[var(--app-bg)] p-3">
      <div className="mb-3 flex items-start justify-between gap-2"><div><div className="text-[calc(9px*var(--font-scale))] font-semibold uppercase text-[var(--accent)]">Import preview</div><div className="mt-1 text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{preview.invite.summary}</div></div><button type="button" onClick={onClose} className="text-[var(--text-tertiary)]"><X className="h-4 w-4" /></button></div>
      <div className="space-y-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
        <div>{new Date(preview.invite.startAt).toLocaleString()} – {new Date(preview.invite.endAt).toLocaleString()}</div>
        {preview.invite.location && <div>{preview.invite.location}</div>}
        {preview.invite.description && <div className="max-h-28 overflow-y-auto whitespace-pre-wrap">{preview.invite.description}</div>}
        <div>{preview.invite.attendees.length} attendees · {preview.filename}</div>
        <label className="flex flex-col gap-1"><span className="text-[var(--text-tertiary)]">Destination calendar</span><select value={calendarId} onChange={event => onChangeCalendar(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5">{calendars.filter(calendar => calendar.accessRole === 'owner' || calendar.accessRole === 'writer').map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}</select></label>
        <div className="dm-inset rounded border border-[var(--border)] bg-[var(--raised-surface)] p-2 text-[calc(9px*var(--font-scale))]">No event will be written until you confirm. Guest emails are disabled for imports.</div>
        <button type="button" disabled={isSaving} onClick={onConfirm} className="w-full rounded-md bg-[var(--accent)] px-3 py-2 font-semibold text-white disabled:opacity-50">{isSaving ? 'Importing…' : 'Import event'}</button>
      </div>
    </div>
  );
}

interface CalendarWorkspaceEventSummaryProps {
  mode: 'readOnly' | 'edit';
  event: CalendarEvent;
  isResponding: boolean;
  travelTimeMinutes: number;
  onClose: () => void;
  onRespond: (status: CalendarAttendeeResponse) => void;
  onDuplicate: () => void;
  onDraftFollowUp: () => void;
  onAddTravel: () => void;
}

export function CalendarWorkspaceEventSummary({
  mode,
  event,
  isResponding,
  travelTimeMinutes,
  onClose,
  onRespond,
  onDuplicate,
  onDraftFollowUp,
  onAddTravel,
}: CalendarWorkspaceEventSummaryProps) {
  if (mode === 'readOnly') {
    return (
      <div className="dm-panel rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div><div className="text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{event.summary}</div><div className="mt-1 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">Read-only calendar</div></div>
          <button type="button" onClick={onClose} aria-label="Close event" className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--hover-row)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
          <div>{event.isAllDay ? 'All day' : new Date(event.startAt).toLocaleString()}</div>
          {event.location && <div>{event.location}</div>}
          {event.description && <div className="whitespace-pre-wrap">{event.description}</div>}
          <CalendarEventParticipants event={event} />
          {event.selfResponseStatus && <CalendarRsvpActions currentStatus={event.selfResponseStatus} disabled={isResponding} onRespond={onRespond} />}
          <button type="button" onClick={onDuplicate} className="flex items-center gap-1 font-semibold text-[var(--accent)]"><Copy className="h-3.5 w-3.5" />Duplicate to writable calendar</button>
          {event.attendees.length > 0 && <button type="button" onClick={onDraftFollowUp} className="flex items-center gap-1 font-semibold text-[var(--accent)]"><MailPlus className="h-3.5 w-3.5" />Draft follow-up</button>}
          {event.htmlLink && <a href={event.htmlLink} target="_blank" rel="noreferrer" className="inline-block font-semibold text-[var(--accent)]">Open in Google Calendar</a>}
        </div>
      </div>
    );
  }

  return (
    <div className="dm-inset mb-2 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-2.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
      <div className="flex items-center justify-between gap-2">
        <span>{event.isAllDay ? 'All day' : `${new Date(event.startAt).toLocaleString()} · ${calendarEventDurationMinutes(event)} min`}</span>
        <span className="flex items-center gap-2">{event.conferenceUrl && <a href={event.conferenceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[var(--accent)]"><Video className="h-3 w-3" />Join</a>}<button type="button" onClick={() => void window.electronAPI.exportCalendarEventIcs(event)} title="Export .ics" className="text-[var(--text-tertiary)] hover:text-[var(--accent)]"><Download className="h-3.5 w-3.5" /></button></span>
      </div>
      <div className="mt-2"><CalendarEventParticipants event={event} /></div>
      {event.selfResponseStatus && <div className="mt-2"><CalendarRsvpActions currentStatus={event.selfResponseStatus} disabled={isResponding} onRespond={onRespond} /></div>}
      <button type="button" onClick={onDuplicate} className="mt-2 flex items-center gap-1 font-semibold text-[var(--accent)]"><Copy className="h-3.5 w-3.5" />Duplicate</button>
      {event.attendees.length > 0 && <button type="button" onClick={onDraftFollowUp} className="mt-2 flex items-center gap-1 font-semibold text-[var(--accent)]"><MailPlus className="h-3.5 w-3.5" />Draft follow-up</button>}
      {!event.isAllDay && travelTimeMinutes > 0 && <button type="button" onClick={onAddTravel} className="mt-2 block font-semibold text-[var(--accent)]">Add {travelTimeMinutes}m travel block</button>}
    </div>
  );
}

interface CalendarWorkspaceEventFormProps {
  mode: 'create' | 'edit';
  event: CalendarEvent | null;
  selectedDate: Date;
  defaultAccountId: string;
  draftSeed: { summary: string; attendees: string[]; sourceMessageId?: string | null; sourceThreadId?: string | null } | null;
  initialRange: { startAt: string; endAt: string } | null;
  isSaving: boolean;
  isDeleting: boolean;
  onCancel: () => void;
  onSubmit: (input: CalendarEventCreateInput | CalendarEventUpdateInput, accountId: string) => Promise<void>;
  onDelete?: (scope: CalendarMutationScope) => Promise<void>;
  onSaveTemplate: (template: Omit<CalendarSettings['eventTemplates'][number], 'id'>) => void;
}

export function CalendarWorkspaceEventForm({
  mode,
  event,
  selectedDate,
  defaultAccountId,
  draftSeed,
  initialRange,
  isSaving,
  isDeleting,
  onCancel,
  onSubmit,
  onDelete,
  onSaveTemplate,
}: CalendarWorkspaceEventFormProps) {
  const store = useAppStore();
  const settings = store.settings.calendar;
  const calendars = mode === 'edit' && event
    ? store.calendarLists.filter(calendar => calendar.accountId === event.accountId)
    : store.calendarLists;

  return <CalendarEventForm
    mode={mode}
    event={event}
    selectedDate={selectedDate}
    defaultDurationMinutes={settings.defaultMeetingDurationMinutes}
    defaultConferenceProvider={settings.defaultConferenceProvider}
    calendarSettings={settings}
    calendarEvents={store.calendarEvents}
    calendars={calendars}
    defaultAccountId={event?.accountId || defaultAccountId}
    eventTemplates={settings.eventTemplates}
    onSaveTemplate={onSaveTemplate}
    initialTitle={draftSeed?.summary}
    initialAttendees={draftSeed?.attendees}
    sourceMessageId={draftSeed?.sourceMessageId}
    sourceThreadId={draftSeed?.sourceThreadId}
    initialStartAt={initialRange?.startAt}
    initialEndAt={initialRange?.endAt}
    isSaving={isSaving}
    isDeleting={isDeleting}
    onCancel={onCancel}
    onSubmit={onSubmit}
    onDelete={onDelete}
    onQueryFreeBusy={(input, targetAccountId) => store.queryCalendarFreeBusy({
      ...input,
      calendarIds: store.calendarLists
        .filter(calendar => calendar.accountId === targetAccountId
          && !(settings.hiddenCalendarIds || []).includes(`${calendar.accountId}:${calendar.id}`)
          && calendar.accessRole !== 'none'
          && calendar.accessRole !== 'freeBusyReader')
        .map(calendar => calendar.id),
    }, targetAccountId)}
  />;
}
