import { describe, expect, it } from 'vitest';
import { calendarInvitesFromMessage, parseIcsInvite } from '../shared/calendar';
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
});
