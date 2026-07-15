import type { CalendarAttendeeResponse, CalendarEvent } from '../../../shared/types';

export interface CalendarEventParticipant {
  email: string;
  displayName: string | null;
  responseStatus: CalendarAttendeeResponse | null;
  optional: boolean;
  isOrganizer: boolean;
  isSelf: boolean;
}

function normalizedEmail(email: string): string {
  return email.trim().toLocaleLowerCase();
}

export function calendarParticipantDisplayName(participant: Pick<CalendarEventParticipant, 'displayName' | 'email'>): string {
  return participant.displayName?.trim() || participant.email;
}

function calendarParticipantCompactName(participant: CalendarEventParticipant): string {
  const displayName = participant.displayName?.trim();
  if (displayName) return displayName.split(/\s+/)[0] || displayName;
  return participant.email.split('@')[0] || participant.email;
}

export function calendarEventParticipants(event: CalendarEvent): CalendarEventParticipant[] {
  const organizerEmail = event.organizerEmail?.trim() || null;
  const organizerKey = organizerEmail ? normalizedEmail(organizerEmail) : null;
  const selfKey = normalizedEmail(event.accountId);
  const participants = new Map<string, CalendarEventParticipant>();

  if (organizerEmail && organizerKey) {
    participants.set(organizerKey, {
      email: organizerEmail,
      displayName: null,
      responseStatus: null,
      optional: false,
      isOrganizer: true,
      isSelf: organizerKey === selfKey,
    });
  }

  for (const attendee of event.attendees) {
    const email = attendee.email.trim();
    const key = normalizedEmail(email);
    if (!key) continue;
    const existing = participants.get(key);
    participants.set(key, {
      email,
      displayName: attendee.displayName?.trim() || existing?.displayName || null,
      responseStatus: attendee.responseStatus || existing?.responseStatus || null,
      optional: attendee.optional === true,
      isOrganizer: existing?.isOrganizer === true || key === organizerKey,
      isSelf: key === selfKey,
    });
  }

  return [...participants.values()];
}

export function calendarParticipantPreview(event: CalendarEvent): string | null {
  if (event.attendees.length === 0) return null;
  const participants = calendarEventParticipants(event);
  const otherParticipants = participants.filter(participant => !participant.isSelf);
  const visibleParticipants = otherParticipants.length > 0 ? otherParticipants : participants;
  const lead = visibleParticipants[0];
  if (!lead) return null;
  const remainingCount = visibleParticipants.length - 1;
  return `${calendarParticipantCompactName(lead)}${remainingCount > 0 ? ` +${remainingCount}` : ''}`;
}

export function calendarParticipantsAccessibleLabel(event: CalendarEvent): string | null {
  const participants = calendarEventParticipants(event);
  if (participants.length === 0) return null;
  const names = participants.map(participant => calendarParticipantDisplayName(participant)).join(', ');
  return `${participants.length} ${participants.length === 1 ? 'participant' : 'participants'}: ${names}`;
}
