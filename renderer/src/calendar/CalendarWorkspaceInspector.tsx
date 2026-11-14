import { useId, useState, type ReactNode } from 'react';
import { CalendarClock, Download, ExternalLink, MailPlus, MapPin, Repeat, Route, Video, X } from 'lucide-react';
import type { CalendarAttendeeResponse, CalendarEvent, CalendarEventCreateInput, CalendarEventUpdateInput, CalendarInvite, CalendarListEntry, CalendarMutationScope, CalendarSettings, MailThread } from '../../../shared/types';
import { CALENDAR_DELETE_SCOPE_OPTIONS, calendarDeleteButtonLabel } from '../../../shared/calendarDeleteCopy';
import { SETTINGS_SELECT_CLASS } from '../components/settings/SettingsControls';
import { useAppStore } from '../stores/AppStore';
import { CalendarEventParticipants } from './CalendarEventParticipants';
import { CalendarRsvpActions } from './CalendarRsvpActions';
import { CalendarRelatedMail } from './CalendarRelatedMail';
import { CalendarEventEditor } from './CalendarEventEditor';
import { calendarEventTimeZoneNote, calendarEventWhenLabel } from './calendarDateLabels';
import { calendarEventColor } from './calendarEventColors';
import { CAL_BUTTON, CAL_DANGER_BUTTON, CAL_DANGER_FILL_BUTTON, CAL_FIELD_LABEL, CAL_LINK, CAL_PRIMARY_BUTTON, CAL_SMALL_ICON_BUTTON } from './calendarUi';

const BODY = 'text-[calc(12px*var(--font-scale))]';
const SMALL = 'text-[calc(11px*var(--font-scale))]';

function PanelHeader({ id, title, onClose, children }: { id: string; title: string; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <h2 id={id} className="break-words text-[calc(15px*var(--font-scale))] font-semibold leading-snug text-[var(--text-primary)]">{title}</h2>
        {children}
      </div>
      <button type="button" onClick={onClose} title="Close" aria-label="Close" className={`${CAL_SMALL_ICON_BUTTON} -mr-1 mt-0.5`}>
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

function DetailRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 items-start gap-2 ${BODY} text-[var(--text-primary)]`}>
      <span aria-hidden="true" className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center text-[var(--text-secondary)]">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function isWebLink(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

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
  const id = useId();
  const writable = calendars.filter(calendar => calendar.accessRole === 'owner' || calendar.accessRole === 'writer');
  const guests = preview.invite.attendees.length;
  return (
    <section className="flex h-full min-h-0 flex-col" aria-labelledby={`${id}-title`}>
      <PanelHeader id={`${id}-title`} title={preview.invite.summary || '(no title)'} onClose={onClose}>
        <p className={`${SMALL} mt-0.5 text-[var(--text-secondary)]`}>Import from {preview.filename}</p>
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <DetailRow icon={<CalendarClock className="h-4 w-4" />}>{calendarEventWhenLabel(preview.invite)}</DetailRow>
        {preview.invite.location && <DetailRow icon={<MapPin className="h-4 w-4" />}><span className="break-words">{preview.invite.location}</span></DetailRow>}
        {guests > 0 && <p className={`${BODY} text-[var(--text-secondary)]`}>{guests} {guests === 1 ? 'guest' : 'guests'}</p>}
        {preview.invite.description && <p className={`${BODY} max-h-40 overflow-y-auto whitespace-pre-wrap text-[var(--text-primary)]`}>{preview.invite.description}</p>}
        <label className="flex flex-col gap-1">
          <span className={CAL_FIELD_LABEL}>Add to calendar</span>
          <select value={calendarId} onChange={event => onChangeCalendar(event.target.value)} className={`${SETTINGS_SELECT_CLASS} w-full`}>
            {writable.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}
          </select>
        </label>
        <p className={`${SMALL} text-[var(--text-secondary)]`}>Nothing is added until you press Import. Guests are not emailed.</p>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-2.5">
        <button type="button" onClick={onClose} className={CAL_BUTTON}>Cancel</button>
        <button type="button" disabled={isSaving || writable.length === 0} onClick={onConfirm} className={CAL_PRIMARY_BUTTON}>{isSaving ? 'Importing…' : 'Import'}</button>
      </div>
    </section>
  );
}

interface CalendarEventDetailsProps {
  event: CalendarEvent;
  calendar?: CalendarListEntry;
  writable: boolean;
  isResponding: boolean;
  isDeleting: boolean;
  travelTimeMinutes: number;
  threads: MailThread[];
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: (scope: CalendarMutationScope) => void;
  onRespond: (status: CalendarAttendeeResponse) => void;
  onDraftFollowUp: () => void;
  onAddTravel: () => void;
  onOpenThread: (thread: MailThread) => void;
}

/** Read view of an event: what, when, where, who, your answer; editing is one click away. */
export function CalendarEventDetails({
  event,
  calendar,
  writable,
  isResponding,
  isDeleting,
  travelTimeMinutes,
  threads,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
  onRespond,
  onDraftFollowUp,
  onAddTravel,
  onOpenThread,
}: CalendarEventDetailsProps) {
  const id = useId();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteScope, setDeleteScope] = useState<CalendarMutationScope>('single');
  const recurring = Boolean(event.recurringEventId);
  const timeZoneNote = calendarEventTimeZoneNote(event);
  const color = calendarEventColor(event, calendar);
  const location = event.location?.trim() || '';

  return (
    <section className="flex h-full min-h-0 flex-col" aria-labelledby={`${id}-title`}>
      <PanelHeader id={`${id}-title`} title={event.summary || '(no title)'} onClose={onClose}>
        <p className={`${SMALL} mt-1 flex min-w-0 items-center gap-1.5 text-[var(--text-secondary)]`}>
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />
          <span className="min-w-0 truncate" title={`${calendar?.summary || 'Calendar'} · ${event.accountId}`}>
            {calendar?.summary ? `${calendar.summary} · ` : ''}{event.accountId}
          </span>
          {!writable && <span className="shrink-0">· View only</span>}
        </p>
      </PanelHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <DetailRow icon={<CalendarClock className="h-4 w-4" />}>
          <div>{calendarEventWhenLabel(event)}</div>
          {timeZoneNote && <div className={`${SMALL} text-[var(--text-secondary)]`}>{timeZoneNote}</div>}
        </DetailRow>
        {recurring && <DetailRow icon={<Repeat className="h-4 w-4" />}>Repeats</DetailRow>}
        {location && (
          <DetailRow icon={<MapPin className="h-4 w-4" />}>
            {isWebLink(location)
              ? <a href={location} target="_blank" rel="noreferrer" className={`${CAL_LINK} break-all`}>{location}</a>
              : <span className="break-words">{location}</span>}
          </DetailRow>
        )}
        {event.conferenceUrl && (
          <a href={event.conferenceUrl} target="_blank" rel="noreferrer" className={`${CAL_BUTTON} self-start`}>
            <Video aria-hidden="true" className="h-3.5 w-3.5" />
            Join video call
          </a>
        )}
        {event.status === 'pending' && (
          <p className={`${SMALL} text-[var(--text-secondary)]`}>Saved here; waiting to reach Google Calendar.</p>
        )}

        {event.selfResponseStatus && (
          <CalendarRsvpActions currentStatus={event.selfResponseStatus} disabled={isResponding} onRespond={onRespond} />
        )}

        <CalendarEventParticipants event={event} />

        {event.description?.trim() && (
          <section aria-labelledby={`${id}-notes`}>
            <h3 id={`${id}-notes`} className={`${BODY} mb-1 font-semibold text-[var(--text-primary)]`}>Notes</h3>
            <p className={`${BODY} whitespace-pre-wrap break-words text-[var(--text-primary)]`}>{event.description}</p>
          </section>
        )}

        <CalendarRelatedMail event={event} threads={threads} onOpen={onOpenThread} />

        <div className="flex flex-col items-start gap-1 border-t border-[var(--border)] pt-2">
          {event.attendees.length > 0 && (
            <button type="button" onClick={onDraftFollowUp} className={CAL_LINK}><MailPlus aria-hidden="true" className="h-3.5 w-3.5" />Write a follow-up</button>
          )}
          {writable && !event.isAllDay && travelTimeMinutes > 0 && (
            <button type="button" onClick={onAddTravel} className={CAL_LINK}><Route aria-hidden="true" className="h-3.5 w-3.5" />Block {travelTimeMinutes} min of travel before</button>
          )}
          <button type="button" onClick={() => void window.electronAPI.exportCalendarEventIcs(event)} className={CAL_LINK}><Download aria-hidden="true" className="h-3.5 w-3.5" />Save as .ics file</button>
          {event.htmlLink && (
            <a href={event.htmlLink} target="_blank" rel="noreferrer" className={CAL_LINK}><ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />Open in Google Calendar</a>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2.5">
        {confirmDelete ? (
          <div className="flex flex-col gap-2" role="group" aria-label="Delete event">
            <p className={`${BODY} font-medium text-[var(--text-primary)]`}>
              Delete this event?{event.attendees.length > 0 ? ' Guests will be told.' : ''}
            </p>
            {recurring && (
              <select value={deleteScope} onChange={change => setDeleteScope(change.target.value as CalendarMutationScope)} aria-label="Which events to delete" className={`${SETTINGS_SELECT_CLASS} w-full`}>
                {CALENDAR_DELETE_SCOPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={isDeleting} className={CAL_BUTTON}>Cancel</button>
              <button type="button" onClick={() => onDelete(deleteScope)} disabled={isDeleting} autoFocus className={CAL_DANGER_FILL_BUTTON}>
                {calendarDeleteButtonLabel(recurring, deleteScope, isDeleting ? 'deleting' : 'confirm')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {writable && <button type="button" onClick={onEdit} className={CAL_BUTTON}>Edit</button>}
            <button type="button" onClick={onDuplicate} title={writable ? 'Make a copy of this event' : 'Copy this event to one of your calendars'} className={CAL_BUTTON}>Duplicate</button>
            {writable && <button type="button" onClick={() => setConfirmDelete(true)} className={`${CAL_DANGER_BUTTON} ml-auto`}>Delete</button>}
          </div>
        )}
      </div>
    </section>
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
  onCancel: () => void;
  onClose: () => void;
  onSubmit: (input: CalendarEventCreateInput | CalendarEventUpdateInput, accountId: string) => Promise<void>;
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
  onCancel,
  onClose,
  onSubmit,
  onSaveTemplate,
}: CalendarWorkspaceEventFormProps) {
  const store = useAppStore();
  const settings = store.settings.calendar;
  const calendars = mode === 'edit' && event
    ? store.calendarLists.filter(calendar => calendar.accountId === event.accountId)
    : store.calendarLists;

  return <CalendarEventEditor
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
    onCancel={onCancel}
    onClose={onClose}
    onSubmit={onSubmit}
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
