// Invitation answers from the inbox row and the reader (`Y` / `N`, Yes / No
// chips). Pure copy and classification helpers; the renderer owns the calls.
import type { CalendarAttendeeResponse, CalendarInvite, MailMessage, MailThread } from './types';

export type InviteAnswer = Extract<CalendarAttendeeResponse, 'accepted' | 'declined' | 'tentative'>;

export function threadNeedsInviteAnswer(thread: Pick<MailThread, 'signals'> | null | undefined): boolean {
  return thread?.signals?.inviteNeedsAnswer === true;
}

/** Person the answer goes to: the organizer's name when known, else their address. */
export function inviteOrganizerLabel(
  invite: Pick<CalendarInvite, 'organizerEmail' | 'attendees'>,
  messages: readonly Pick<MailMessage, 'senderName' | 'senderEmail'>[] = [],
): string {
  const organizer = (invite.organizerEmail || '').trim().toLowerCase();
  if (organizer) {
    const attendee = invite.attendees.find(entry => entry.email.trim().toLowerCase() === organizer && entry.displayName?.trim());
    if (attendee?.displayName) return attendee.displayName.trim();
    const sender = messages.find(message => message.senderEmail.trim().toLowerCase() === organizer && message.senderName?.trim());
    if (sender) return sender.senderName.trim();
    return invite.organizerEmail!.trim();
  }
  const latest = messages[messages.length - 1];
  return latest?.senderName?.trim() || latest?.senderEmail?.trim() || 'the organizer';
}

export const RSVP_UNDO_NOTE = 'Undo returns the conversation to the inbox.';

/** `note` follows the sentence; pass null when the thread was not archived. */
export function rsvpSuccessMessage(answer: InviteAnswer, organizer: string, note: string | null = RSVP_UNDO_NOTE): string {
  const verb = answer === 'accepted' ? 'Accepted' : answer === 'declined' ? 'Declined' : 'Answered Maybe';
  return note ? `${verb}. Sent to ${organizer}. ${note}` : `${verb}. Sent to ${organizer}.`;
}

export type RsvpFailureKind = 'offline' | 'permission' | 'signIn' | 'missingInvite' | 'unknown';

export class MissingInviteError extends Error {
  constructor() {
    super('The calendar invitation in this conversation could not be read.');
    this.name = 'MissingInviteError';
  }
}

export function classifyRsvpError(error: unknown): RsvpFailureKind {
  if (error instanceof MissingInviteError) return 'missingInvite';
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/\b(fetch failed|network|offline|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timed? ?out)\b/i.test(message)) return 'offline';
  if (/\b401\b|invalid_grant|unauthenticated|sign in again|reauth/i.test(message)) return 'signIn';
  if (/\b403\b|forbidden|insufficient|permission/i.test(message)) return 'permission';
  return 'unknown';
}

export function rsvpFailureMessage(kind: RsvpFailureKind): string {
  switch (kind) {
    case 'offline':
      return 'You are offline, so the answer was not sent. The invitation stays in your inbox.';
    case 'permission':
      return 'Google Calendar did not allow this answer. Reconnect Calendar and try again. The invitation stays in your inbox.';
    case 'signIn':
      return 'Google needs you to sign in again before the answer can be sent. The invitation stays in your inbox.';
    case 'missingInvite':
      return 'Could not read the invitation in this conversation. Open it to answer from the invitation card.';
    default:
      return 'Could not send your answer to Google Calendar. The invitation stays in your inbox.';
  }
}
