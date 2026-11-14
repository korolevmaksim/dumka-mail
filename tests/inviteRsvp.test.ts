import { describe, expect, it } from 'vitest';
import {
  classifyRsvpError,
  inviteOrganizerLabel,
  MissingInviteError,
  rsvpFailureMessage,
  rsvpSuccessMessage,
  threadNeedsInviteAnswer,
} from '../shared/inviteRsvp';
import { EMPTY_THREAD_SIGNALS } from '../shared/threadSignals';

describe('threadNeedsInviteAnswer', () => {
  it('is true only with the signal set', () => {
    expect(threadNeedsInviteAnswer({ signals: { ...EMPTY_THREAD_SIGNALS, inviteNeedsAnswer: true } })).toBe(true);
    expect(threadNeedsInviteAnswer({ signals: { ...EMPTY_THREAD_SIGNALS, hasCalendarInvite: true } })).toBe(false);
    expect(threadNeedsInviteAnswer({})).toBe(false);
    expect(threadNeedsInviteAnswer(null)).toBe(false);
  });
});

describe('inviteOrganizerLabel', () => {
  const messages = [{ senderName: 'Priya Raman', senderEmail: 'priya.raman@lumenlabs.example' }];

  it('prefers the attendee display name, then the sender name, then the address', () => {
    expect(inviteOrganizerLabel({
      organizerEmail: 'priya.raman@lumenlabs.example',
      attendees: [{ email: 'PRIYA.RAMAN@lumenlabs.example', displayName: 'Priya R.' }],
    }, messages)).toBe('Priya R.');
    expect(inviteOrganizerLabel({ organizerEmail: 'priya.raman@lumenlabs.example', attendees: [] }, messages)).toBe('Priya Raman');
    expect(inviteOrganizerLabel({ organizerEmail: 'calendar@devconf.example', attendees: [] }, messages)).toBe('calendar@devconf.example');
  });

  it('falls back to the latest sender without an organizer', () => {
    expect(inviteOrganizerLabel({ organizerEmail: null, attendees: [] }, messages)).toBe('Priya Raman');
    expect(inviteOrganizerLabel({ organizerEmail: null, attendees: [] }, [])).toBe('the organizer');
  });
});

describe('RSVP copy', () => {
  it('says what was sent and what Undo does', () => {
    expect(rsvpSuccessMessage('accepted', 'Priya Raman')).toBe('Accepted. Sent to Priya Raman. Undo returns the conversation to the inbox.');
    expect(rsvpSuccessMessage('declined', 'Daniel Okafor')).toBe('Declined. Sent to Daniel Okafor. Undo returns the conversation to the inbox.');
    expect(rsvpSuccessMessage('tentative', 'Daniel Okafor', null)).toBe('Answered Maybe. Sent to Daniel Okafor.');
  });

  it('classifies failures in plain words', () => {
    expect(classifyRsvpError(new Error('TypeError: fetch failed'))).toBe('offline');
    expect(classifyRsvpError(new Error('getaddrinfo ENOTFOUND www.googleapis.com'))).toBe('offline');
    expect(classifyRsvpError(new Error('Calendar RSVP update error: 403 Forbidden'))).toBe('permission');
    expect(classifyRsvpError(new Error('invalid_grant'))).toBe('signIn');
    expect(classifyRsvpError(new MissingInviteError())).toBe('missingInvite');
    expect(classifyRsvpError(new Error('boom'))).toBe('unknown');
    expect(rsvpFailureMessage('offline')).toMatch(/offline.*stays in your inbox/);
    expect(rsvpFailureMessage('permission')).toMatch(/did not allow/);
  });
});
