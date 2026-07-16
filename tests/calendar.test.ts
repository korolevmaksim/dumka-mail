import { describe, expect, it } from 'vitest';
import { calendarInvitesFromMessage, calendarResponseFromGoogleRsvpUrl, parseIcsInvite } from '../shared/calendar';
import type { MailMessage } from '../shared/types';

const sampleIcs = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:meeting-123@example.com',
  'SUMMARY:Product Review',
  'DESCRIPTION:Discuss roadmap\\nNext steps',
  'LOCATION:Google Meet',
  'DTSTART:20260701T120000Z',
  'DTEND:20260701T123000Z',
  'ORGANIZER;CN=Alex:mailto:alex@example.com',
  'ATTENDEE;CN=Maksim;ROLE=REQ-PARTICIPANT:mailto:maksim@example.com',
  'SEQUENCE:2',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseIcsInvite', () => {
  it('extracts the meeting identity, time, organizer and attendees', () => {
    const invite = parseIcsInvite(sampleIcs);

    expect(invite).toMatchObject({
      uid: 'meeting-123@example.com',
      method: 'REQUEST',
      summary: 'Product Review',
      description: 'Discuss roadmap\nNext steps',
      location: 'Google Meet',
      startAt: '2026-07-01T12:00:00.000Z',
      endAt: '2026-07-01T12:30:00.000Z',
      isAllDay: false,
      organizerEmail: 'alex@example.com',
      sequence: 2,
    });
    expect(invite?.attendees).toEqual([
      {
        email: 'maksim@example.com',
        displayName: 'Maksim',
        responseStatus: null,
        optional: false,
      },
    ]);
  });

  it('reads calendar attachments from cached mail messages', () => {
    const msg: MailMessage = {
      id: 'm1',
      threadId: 't1',
      accountId: 'me@example.com',
      senderName: 'Alex',
      senderEmail: 'alex@example.com',
      subject: 'Invite',
      snippet: '',
      receivedAt: '2026-06-30T12:00:00.000Z',
      labelIds: ['INBOX'],
      hasAttachments: true,
      isUnread: true,
      to: [],
      cc: [],
      bcc: [],
      bodyHtml: '',
      bodyPlain: '',
      attachments: [{
        id: 'invite',
        filename: 'invite.ics',
        mimeType: 'text/calendar',
        sizeBytes: sampleIcs.length,
        base64Data: Buffer.from(sampleIcs, 'utf-8').toString('base64'),
      }],
    };

    expect(calendarInvitesFromMessage(msg)).toHaveLength(1);
    expect(calendarInvitesFromMessage(msg)[0].uid).toBe('meeting-123@example.com');
  });

  it('deduplicates equivalent calendar MIME attachments', () => {
    const base64Data = Buffer.from(sampleIcs, 'utf-8').toString('base64');
    const msg: MailMessage = {
      id: 'm1',
      threadId: 't1',
      accountId: 'me@example.com',
      senderName: 'Alex',
      senderEmail: 'alex@example.com',
      subject: 'Invite',
      snippet: '',
      receivedAt: '2026-06-30T12:00:00.000Z',
      labelIds: ['INBOX'],
      hasAttachments: true,
      isUnread: true,
      to: [],
      cc: [],
      bcc: [],
      attachments: [
        { id: 'invite-text', filename: 'invite.ics', mimeType: 'text/calendar', sizeBytes: sampleIcs.length, base64Data },
        { id: 'invite-app', filename: 'invite.ics', mimeType: 'application/ics', sizeBytes: sampleIcs.length, base64Data },
      ],
    };

    expect(calendarInvitesFromMessage(msg)).toHaveLength(1);
  });

  it('converts TZID date-times and keeps recurrence rules for Google Calendar', () => {
    const invite = parseIcsInvite([
      'BEGIN:VCALENDAR',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:timezone-meeting@example.com',
      'SUMMARY:New York Standup',
      'DTSTART;TZID=America/New_York:20260701T090000',
      'DTEND;TZID=America/New_York:20260701T100000',
      'RRULE:FREQ=WEEKLY;COUNT=3',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'));

    expect(invite).toMatchObject({
      uid: 'timezone-meeting@example.com',
      startAt: '2026-07-01T13:00:00.000Z',
      endAt: '2026-07-01T14:00:00.000Z',
      isAllDay: false,
      timeZone: 'America/New_York',
      recurrenceRules: ['RRULE:FREQ=WEEKLY;COUNT=3'],
    });
  });

  it('parses all-day events with DURATION when DTEND is omitted', () => {
    const invite = parseIcsInvite([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:offsite@example.com',
      'SUMMARY:Company Offsite',
      'DTSTART;VALUE=DATE:20260704',
      'DURATION:P2D',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'));

    expect(invite).toMatchObject({
      uid: 'offsite@example.com',
      isAllDay: true,
      startDate: '2026-07-04',
      endDate: '2026-07-06',
    });
  });
});

describe('Google Calendar RSVP links', () => {
  it.each([
    ['1', 'accepted'],
    ['2', 'declined'],
    ['3', 'tentative'],
  ] as const)('maps rst=%s to %s', (rst, expected) => {
    expect(calendarResponseFromGoogleRsvpUrl(`https://calendar.google.com/calendar/event?action=RESPOND&eid=redacted&rst=${rst}`)).toBe(expected);
  });

  it('rejects non-RSVP, non-Google, and insecure links', () => {
    expect(calendarResponseFromGoogleRsvpUrl('https://calendar.google.com/calendar/event?action=VIEW&rst=1')).toBeNull();
    expect(calendarResponseFromGoogleRsvpUrl('https://calendar.google.com.evil.example/calendar/event?action=RESPOND&rst=1')).toBeNull();
    expect(calendarResponseFromGoogleRsvpUrl('http://calendar.google.com/calendar/event?action=RESPOND&rst=1')).toBeNull();
    expect(calendarResponseFromGoogleRsvpUrl('not a url')).toBeNull();
  });
});
