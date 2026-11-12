// The 28 inbox conversations of the synthetic work mailbox
// (design-review/stage0/harness/dataset.cjs, `workInbox`). Only the fields the
// decision engine reads are copied: senders, subjects, Gmail labels, extra
// headers and calendar invites. Everything is fictional (`*.example`).
import type { AttachmentMetadata, MailMessage } from '../../shared/types';

export interface FixturePerson {
  name: string;
  email: string;
}

export interface FixtureMessage {
  from: FixturePerson;
  subject: string;
  /** Per-message labels; defaults to the thread labels. */
  labels?: string[];
  headers?: [string, string][];
  /** Attach a METHOD:REQUEST invite with the account as a NEEDS-ACTION attendee. */
  invite?: { uid: string; summary: string; organizer: FixturePerson };
  attachments?: { filename: string; mimeType: string }[];
}

export interface FixtureThread {
  key: string;
  labels: string[];
  unread: boolean;
  messages: FixtureMessage[];
}

export const WORK_ACCOUNT: FixturePerson = { email: 'alex.morgan@northwind.example', name: 'Alex Morgan' };

const P = {
  priya: { name: 'Priya Raman', email: 'priya.raman@lumenlabs.example' },
  daniel: { name: 'Daniel Okafor', email: 'daniel.okafor@northwind.example' },
  sofia: { name: 'Sofia Lindqvist', email: 'sofia@harborpine.example' },
  marcus: { name: 'Marcus Lee', email: 'marcus.lee@northwind.example' },
  hannah: { name: 'Hannah Weiss', email: 'hannah.weiss@northwind.example' },
  nora: { name: 'Nora Petrov', email: 'nora.petrov@northwind.example' },
  yuki: { name: 'Yuki Tanaka', email: 'yuki.tanaka@northwind.example' },
  ben: { name: 'Ben Carter', email: 'ben.carter@northwind.example' },
  ines: { name: 'Inès Moreau', email: 'ines.moreau@northwind.example' },
  engAnnounce: { name: 'Eng Announce', email: 'eng-announce@northwind.example' },
  codeforge: { name: 'CodeForge', email: 'notifications@codeforge.example' },
  trackline: { name: 'Trackline', email: 'noreply@trackline.example' },
  status: { name: 'Northwind Status', email: 'noreply@status.northwind.example' },
  docs: { name: 'Pagewise Docs', email: 'comments-noreply@pagewise.example' },
  skyline: { name: 'Skyline Air', email: 'bookings@skylineair.example' },
  paperclip: { name: 'Paperclip Cloud', email: 'billing@paperclip.example' },
  parcelo: { name: 'Parcelo', email: 'tracking@parcelo.example' },
  dispatch: { name: 'The Pragmatic Dispatch', email: 'hello@pragmaticdispatch.example' },
  productWeekly: { name: 'Product Weekly', email: 'newsletter@productweekly.example' },
  people: { name: 'Northwind People Team', email: 'people@northwind.example' },
  devconf: { name: 'DevConf Europe', email: 'news@devconf.example' },
  fieldnote: { name: 'Fieldnote Pro', email: 'offers@fieldnote.example' },
  loft: { name: 'Loft & Linen', email: 'hello@loftandlinen.example' },
  linkedin: { name: 'LinkedIn', email: 'notifications-noreply@linkedin.example' },
  sso: { name: 'Northwind SSO', email: 'security-noreply@northwind.example' },
} satisfies Record<string, FixturePerson>;

const person = ['INBOX', 'IMPORTANT', 'CATEGORY_PERSONAL'];
const updates = ['INBOX', 'CATEGORY_UPDATES'];
const promos = ['INBOX', 'CATEGORY_PROMOTIONS'];

const unsub = (slug: string): [string, string][] => [
  ['List-Unsubscribe', `<https://links.example/unsubscribe/${slug}>, <mailto:unsubscribe@${slug}.example>`],
  ['List-Unsubscribe-Post', 'List-Unsubscribe=One-Click'],
  ['Precedence', 'bulk'],
];

const feedbackSenders = [P.yuki, P.ben, P.ines, P.yuki, P.nora, P.ben, P.ines, P.yuki, P.ben, P.daniel, P.ines, P.yuki, P.ben, P.ines];

export const WORK_INBOX: FixtureThread[] = [
  // People: reply needed
  { key: 'pilot-date', labels: person, unread: true, messages: [{ from: P.priya, subject: 'Q3 rollout: can we move the pilot to the 24th?' }] },
  { key: 'board-numbers', labels: person, unread: true, messages: [{ from: P.daniel, subject: "Need your numbers for Thursday's board deck" }] },
  { key: 'redlines', labels: person, unread: true, messages: [
    { from: WORK_ACCOUNT, subject: 'Contract redlines v2', labels: ['SENT'] },
    { from: P.sofia, subject: 'Re: Contract redlines v3 — two open points', attachments: [{ filename: 'MSA-redlines-v3.pdf', mimeType: 'application/pdf' }] },
  ] },
  { key: 'interview-loop', labels: person, unread: true, messages: [{ from: P.marcus, subject: 'Interview loop for Jamie Chen — are you free Wed 2–3pm?' }] },
  { key: 'intro-tomas', labels: person, unread: false, messages: [{ from: P.hannah, subject: 'Intro: Alex <> Tomás (Brightwave)' }] },
  // People: FYI
  { key: 'onboarding-feedback', labels: ['INBOX', 'CATEGORY_PERSONAL'], unread: true, messages: feedbackSenders.map((from, index) => ({
    from, subject: `${index === 0 ? '' : 'Re: '}Onboarding flow v4 — feedback round`,
  })) },
  { key: 'offsite-moved', labels: person, unread: true, messages: [{ from: P.daniel, subject: 'FYI: offsite moved to October' }] },
  { key: 'invoice-approved', labels: person, unread: false, messages: [{ from: P.nora, subject: 'Re: Invoice #2291 approved' }] },
  { key: 'deploy-freeze', labels: ['INBOX', 'CATEGORY_FORUMS'], unread: true, messages: [{
    from: P.engAnnounce, subject: 'Deploy freeze Fri 18:00 – Mon 09:00',
    headers: [['List-Id', 'Eng Announce <eng-announce.northwind.example>'], ['Precedence', 'list']],
  }] },
  // Calendar
  { key: 'invite-weekly', labels: person, unread: true, messages: [{
    from: P.priya, subject: 'Invitation: Lumen Labs weekly sync',
    invite: { uid: 'weekly-sync-001@lumenlabs.example', summary: 'Lumen Labs weekly sync', organizer: P.priya },
  }] },
  { key: 'invite-1on1', labels: person, unread: false, messages: [{
    from: P.daniel, subject: 'Updated invitation: 1:1 Daniel / Alex',
    invite: { uid: 'one-on-one-778@northwind.example', summary: '1:1 Daniel / Alex', organizer: P.daniel },
  }] },
  // Notifications / automation
  { key: 'pr-482', labels: updates, unread: true, messages: [{
    from: P.codeforge, subject: '[northwind/api] Fix retry backoff for webhook delivery (#482)',
    headers: [['List-Id', 'northwind/api <api.northwind.codeforge.example>'], ['List-Unsubscribe', '<https://codeforge.example/unsub/abc>']],
  }] },
  { key: 'ci-failed', labels: updates, unread: true, messages: [{
    from: P.codeforge, subject: '[northwind/api] Run failed: CI on main (build #9121)',
    headers: [['List-Unsubscribe', '<https://codeforge.example/unsub/def>']],
  }] },
  { key: 'nw-1432', labels: updates, unread: true, messages: [{
    from: P.trackline, subject: '[Trackline] NW-1432 assigned to you: Export fails for large accounts',
    headers: [['Auto-Submitted', 'auto-generated']],
  }] },
  { key: 'nw-1398', labels: updates, unread: false, messages: [{
    from: P.trackline, subject: '[Trackline] NW-1398 moved to Done',
    headers: [['Auto-Submitted', 'auto-generated']],
  }] },
  { key: 'status-resolved', labels: updates, unread: true, messages: [
    { from: P.status, subject: 'Investigating: Elevated API latency (eu-west)' },
    { from: P.status, subject: 'Identified: Elevated API latency (eu-west)' },
    { from: P.status, subject: 'Resolved: Elevated API latency (eu-west)' },
  ] },
  { key: 'doc-comment', labels: updates, unread: true, messages: [{ from: P.docs, subject: 'Priya Raman commented on "Pilot plan"' }] },
  // Purchases / travel
  { key: 'eticket', labels: updates, unread: true, messages: [{
    from: P.skyline, subject: 'Your e-ticket: BER → LIS, 14 Oct',
    attachments: [{ filename: 'e-ticket-SK7Q2M.pdf', mimeType: 'application/pdf' }],
  }] },
  { key: 'receipt', labels: updates, unread: false, messages: [{
    from: P.paperclip, subject: 'Receipt for your subscription — €29.00',
    attachments: [{ filename: 'invoice-PC-2025-10-04412.pdf', mimeType: 'application/pdf' }],
  }] },
  { key: 'parcel', labels: updates, unread: true, messages: [{ from: P.parcelo, subject: 'Your package arrives tomorrow' }] },
  // Newsletters
  { key: 'dispatch-212', labels: ['INBOX', 'CATEGORY_UPDATES'], unread: true, messages: [{
    from: P.dispatch, subject: 'Issue #212: The hidden cost of flaky tests', headers: unsub('pragmaticdispatch'),
  }] },
  { key: 'product-weekly', labels: ['INBOX', 'CATEGORY_UPDATES'], unread: true, messages: [{
    from: P.productWeekly, subject: '5 onboarding teardown lessons', headers: unsub('productweekly'),
  }] },
  { key: 'people-newsletter', labels: ['INBOX', 'CATEGORY_UPDATES'], unread: true, messages: [{
    from: P.people, subject: 'October newsletter: benefits enrollment, new joiners, office move',
    headers: [['List-Id', 'All Staff <all.northwind.example>'], ['Precedence', 'bulk']],
  }] },
  { key: 'devconf-cfp', labels: promos, unread: true, messages: [{
    from: P.devconf, subject: 'Call for papers closes Friday', headers: unsub('devconf'),
  }] },
  // Promotions
  { key: 'fieldnote-promo', labels: promos, unread: true, messages: [{
    from: P.fieldnote, subject: 'Last chance: 40% off annual plans', headers: unsub('fieldnote'),
  }] },
  { key: 'loft-promo', labels: promos, unread: true, messages: [{
    from: P.loft, subject: 'New arrivals for autumn', headers: unsub('loftandlinen'),
  }] },
  // Social / security
  { key: 'linkedin-requests', labels: ['INBOX', 'CATEGORY_SOCIAL'], unread: true, messages: [{
    from: P.linkedin, subject: 'You have 3 new connection requests', headers: unsub('linkedin'),
  }] },
  { key: 'sso-signin', labels: updates, unread: true, messages: [{ from: P.sso, subject: 'New sign-in from Chrome on macOS' }] },
];

/**
 * Mailing-list mail outside the 28 work-inbox conversations (review item 7):
 * a person's post to a discussion list (Mailman / Google Groups headers, plain
 * List-Unsubscribe without one-click) must stay with People.
 */
export const MAILING_LIST_POSTS: FixtureThread[] = [
  { key: 'list-discussion', labels: ['INBOX', 'CATEGORY_FORUMS'], unread: true, messages: [{
    from: { name: 'Lena Brandt', email: 'lena.brandt@fjordworks.example' },
    subject: '[api-design] Re: Pagination cursors vs offsets',
    headers: [
      ['List-Id', 'API design discussion <api-design.lists.openspec.example>'],
      ['Precedence', 'list'],
      ['List-Unsubscribe', '<mailto:api-design-leave@lists.openspec.example>, <https://lists.openspec.example/options/api-design>'],
    ],
  }] },
];

/**
 * An invitation from a scheduling service whose only calendar part is a Gmail
 * attachment (it has an attachmentId and no inline data, as `mapMessage`
 * leaves a named `invite.ics`): the invite state cannot be read locally.
 */
export const ATTACHMENT_ONLY_INVITES: FixtureThread[] = [
  { key: 'scheduler-invite', labels: ['INBOX', 'CATEGORY_UPDATES'], unread: true, messages: [{
    from: { name: 'Slotwise', email: 'no-reply@slotwise.example' },
    subject: 'Invitation: Vendor review @ Tue 14 Oct 15:00',
    headers: [['Auto-Submitted', 'auto-generated']],
    attachments: [{ filename: 'invite.ics', mimeType: 'application/ics' }],
  }] },
];

/** Same shape as `icsInvite` in dataset.cjs. */
export function inviteIcs(
  invite: { uid: string; summary: string; organizer: FixturePerson },
  attendee: FixturePerson = WORK_ACCOUNT,
  options: { method?: string; partstat?: string | null } = {},
): string {
  const method = options.method ?? 'REQUEST';
  const partstat = options.partstat === undefined ? 'NEEDS-ACTION' : options.partstat;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Synthetic//Design Review//EN', `METHOD:${method}`,
    'BEGIN:VEVENT', `UID:${invite.uid}`, 'DTSTAMP:20261010T090000Z', 'DTSTART:20261014T100000Z', 'DTEND:20261014T103000Z',
    `SUMMARY:${invite.summary}`, `ORGANIZER;CN=${invite.organizer.name}:mailto:${invite.organizer.email}`,
    `ATTENDEE;CN=${attendee.name};RSVP=TRUE${partstat ? `;PARTSTAT=${partstat}` : ''}:mailto:${attendee.email}`,
    'LOCATION:Video call', 'STATUS:CONFIRMED', 'SEQUENCE:0', 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

export function icsAttachment(ics: string, id = 'invite'): AttachmentMetadata {
  return {
    id,
    filename: 'invite.ics',
    mimeType: 'text/calendar',
    sizeBytes: ics.length,
    base64Data: Buffer.from(ics, 'utf-8').toString('base64'),
    attachmentId: null,
    partId: '2',
  };
}

/** Builds `MailMessage`s the way `mapMessage` would for this fixture thread. */
export function fixtureMessages(thread: FixtureThread, accountId = WORK_ACCOUNT.email): MailMessage[] {
  const base = Date.parse('2026-10-10T12:00:00.000Z');
  const lastIndex = thread.messages.length - 1;
  return thread.messages.map((message, index) => {
    const id = `${thread.key}-m${index}`;
    const labelIds = new Set(message.labels || thread.labels);
    if (thread.unread && index === lastIndex && !labelIds.has('SENT')) labelIds.add('UNREAD');
    const attachments: AttachmentMetadata[] = [
      ...(message.invite ? [icsAttachment(inviteIcs(message.invite), `${id}-ics`)] : []),
      ...(message.attachments || []).map((attachment, attachmentIndex) => ({
        id: `${id}-att${attachmentIndex}`,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: 1000,
        attachmentId: `${id}-att${attachmentIndex}`,
      })),
    ];
    return {
      id,
      threadId: thread.key,
      accountId,
      senderName: message.from.name,
      senderEmail: message.from.email,
      subject: message.subject,
      snippet: '',
      receivedAt: new Date(base + index * 60_000).toISOString(),
      labelIds: Array.from(labelIds),
      hasAttachments: attachments.length > 0,
      isUnread: labelIds.has('UNREAD'),
      to: [WORK_ACCOUNT],
      cc: [],
      bcc: [],
      bodyHtml: null,
      bodyPlain: '',
      attachments,
      headers: [
        { name: 'From', value: `${message.from.name} <${message.from.email}>` },
        { name: 'Subject', value: message.subject },
        ...(message.headers || []).map(([name, value]) => ({ name, value })),
      ],
    };
  });
}
