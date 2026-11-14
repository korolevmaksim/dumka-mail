// Synthetic mailbox generator for the Dumka Mail design review.
// Everything here is fictional: people, companies and reserved `.example` domains.
// No real mail, addresses or names are read or produced.
'use strict';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const WORK = { email: 'alex.morgan@northwind.example', name: 'Alex Morgan' };
const HOME = { email: 'alex@morgan-family.example', name: 'Alex Morgan' };

const P = {
  priya: { name: 'Priya Raman', email: 'priya.raman@lumenlabs.example' },
  daniel: { name: 'Daniel Okafor', email: 'daniel.okafor@northwind.example' },
  sofia: { name: 'Sofia Lindqvist', email: 'sofia@harborpine.example' },
  marcus: { name: 'Marcus Lee', email: 'marcus.lee@northwind.example' },
  hannah: { name: 'Hannah Weiss', email: 'hannah.weiss@northwind.example' },
  tomas: { name: 'Tomás Ibarra', email: 'tomas@brightwave.example' },
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
  // personal
  mara: { name: 'Mara Morgan', email: 'mara@morgan-family.example' },
  leo: { name: 'Leo Fischer', email: 'leo.fischer@postbox.example' },
  bank: { name: 'Meridian Bank', email: 'statements@meridianbank.example' },
  power: { name: 'Cityline Energy', email: 'billing@citylineenergy.example' },
  school: { name: 'Oakridge School', email: 'office@oakridge-school.example' },
  landlord: { name: 'Greta Holm', email: 'greta.holm@holmproperties.example' },
  gym: { name: 'Pulse Fitness', email: 'members@pulsefitness.example' },
  streambox: { name: 'Streambox', email: 'info@streambox.example' },
  bookclub: { name: 'Jonas Reed', email: 'jonas.reed@postbox.example' },
  dentist: { name: 'Bright Smile Dental', email: 'appointments@brightsmile.example' },
  grocer: { name: 'FreshCart', email: 'orders@freshcart.example' },
  travel: { name: 'Wanderlist', email: 'deals@wanderlist.example' },
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plainToHtml = text => `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${
  esc(text).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
}</div>`;

function newsletterHtml(title, sections, footer) {
  const blocks = sections.map(([heading, body], i) => `
    <tr><td style="padding:20px 32px;border-bottom:1px solid #e5e7eb">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="72" valign="top"><div style="width:56px;height:56px;border-radius:8px;background:${['#dbeafe', '#fde68a', '#dcfce7', '#fce7f3', '#e0e7ff'][i % 5]}"></div></td>
        <td valign="top"><h2 style="margin:0 0 6px;font:600 17px Georgia,serif;color:#111827">${esc(heading)}</h2>
        <p style="margin:0;font:14px/1.55 Arial,sans-serif;color:#374151">${esc(body)}</p>
        <p style="margin:8px 0 0"><a href="https://links.example/read/${i + 1}" style="font:600 13px Arial,sans-serif;color:#2563eb">Read more →</a></p></td>
      </tr></table></td></tr>`).join('');
  return `<html><body style="margin:0;background:#f3f4f6">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 0">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden">
    <tr><td style="padding:28px 32px;background:#111827"><h1 style="margin:0;font:700 22px Georgia,serif;color:#ffffff">${esc(title)}</h1></td></tr>
    ${blocks}
    <tr><td style="padding:18px 32px;font:12px/1.5 Arial,sans-serif;color:#6b7280">${esc(footer)}<br>
      <a href="https://links.example/unsubscribe" style="color:#6b7280">Unsubscribe</a> · <a href="https://links.example/preferences" style="color:#6b7280">Preferences</a></td></tr>
  </table></td></tr></table></body></html>`;
}

function icsInvite({ uid, summary, start, end, organizer, attendee, method = 'REQUEST' }) {
  const fmt = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Synthetic//Design Review//EN', `METHOD:${method}`,
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${fmt(start - DAY)}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:${summary}`, `ORGANIZER;CN=${organizer.name}:mailto:${organizer.email}`,
    `ATTENDEE;CN=${attendee.name};RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${attendee.email}`,
    'LOCATION:Video call', 'STATUS:CONFIRMED', 'SEQUENCE:0', 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

/**
 * A thread spec: { key, labels, unread, messages:[{from,to,cc,ago,subject,text,html,attachments,headers,ics}] }
 * `ago` is milliseconds before "now".
 */
function workInbox(now) {
  const me = WORK;
  const T = [];
  const add = (key, labels, unread, messages, extra = {}) => T.push({ key, labels, unread, messages, ...extra });
  const person = ['INBOX', 'IMPORTANT', 'CATEGORY_PERSONAL'];
  const updates = ['INBOX', 'CATEGORY_UPDATES'];
  const promos = ['INBOX', 'CATEGORY_PROMOTIONS'];

  // --- People: reply needed -------------------------------------------------
  add('pilot-date', person, true, [{
    from: P.priya, to: [me], ago: 38 * MIN, subject: 'Q3 rollout: can we move the pilot to the 24th?',
    text: `Hi Alex,\n\nOur security review slipped by a few days, so the 17th is now tight for us. Could we move the pilot kickoff to Thursday the 24th instead? Same attendees, same agenda.\n\nIf the 24th does not work, the 25th morning is our fallback. I need to confirm with our CISO by end of day tomorrow.\n\nThanks,\nPriya`,
  }]);
  add('board-numbers', person, true, [{
    from: P.daniel, to: [me], cc: [P.nora], ago: 1.6 * HOUR, subject: "Need your numbers for Thursday's board deck",
    text: `Alex,\n\nI'm assembling the board deck and still need three things from you by Wednesday 5pm:\n\n1. Pilot conversion (trial → paid) for Q3\n2. Net revenue retention, trailing 12 months\n3. One slide on the Lumen Labs rollout risk\n\nA rough draft is fine. Nora can help pull the retention figures.\n\nDaniel`,
  }]);
  add('redlines', person, true, [
    { from: me, to: [P.sofia], ago: 2 * DAY, subject: 'Contract redlines v2', labels: ['SENT'],
      text: `Hi Sofia,\n\nAttached are our comments on v2. The main open items are the liability cap and the termination notice period.\n\nBest,\nAlex` },
    { from: P.sofia, to: [me], ago: 3.1 * HOUR, subject: 'Re: Contract redlines v3 — two open points',
      text: `Hi Alex,\n\nThanks for the quick turnaround. v3 is attached. We accepted everything except two points:\n\n- Liability cap: we can go to 12 months of fees, not 24.\n- Termination notice: 60 days works for us if it is mutual.\n\nCan you confirm both so legal can issue the signature copy this week?\n\nKind regards,\nSofia Lindqvist\nHarbor & Pine`,
      attachments: [{ filename: 'MSA-redlines-v3.pdf', mimeType: 'application/pdf', size: 248113 }] },
  ]);
  add('interview-loop', person, true, [{
    from: P.marcus, to: [me], ago: 4.4 * HOUR, subject: 'Interview loop for Jamie Chen — are you free Wed 2–3pm?',
    text: `Hey Alex,\n\nWe'd like you on the system design round for Jamie Chen (Senior Backend). Are you free Wednesday 2:00–3:00pm? If not, Thursday 11:00 also works for the panel.\n\nScorecard and resume are in the hiring tool.\n\nThanks!\nMarcus`,
  }]);
  add('intro-tomas', person, false, [{
    from: P.hannah, to: [me, P.tomas], ago: 20 * HOUR, subject: 'Intro: Alex <> Tomás (Brightwave)',
    text: `Alex, meet Tomás — he leads partnerships at Brightwave and is exploring a data-sharing pilot similar to what you ran with Lumen Labs.\n\nTomás, Alex owns our rollout program and is the right person to talk to.\n\nI'll let you two take it from here.\n\nHannah`,
  }]);

  // --- People: FYI ----------------------------------------------------------
  const fb = [];
  const fbPeople = [P.yuki, P.ben, P.ines, P.yuki, P.nora, P.ben, P.ines, P.yuki, P.ben, P.daniel, P.ines, P.yuki, P.ben, P.ines];
  const fbLines = [
    'Kicking off the feedback round for onboarding flow v4. Figma link is in the doc. Please comment by Friday.',
    'First pass: step 2 asks for too much before showing any value. Can we defer the workspace name?',
    'Agree with Ben. Also the progress dots are not readable in dark mode.',
    'Good catches. I moved workspace name to after the first success moment — updated frames are in.',
    'From the finance side: the plan picker must show annual pricing with the VAT note. Legal asked for it.',
    'New frames look better. Empty state copy on step 3 still reads like an error message.',
    'Suggestion for step 3: "Nothing here yet — connect a source to see your first report."',
    'Taking that copy as-is. Dark mode contrast fixed (4.7:1 on the dots now).',
    'One more: keyboard focus skips the "Skip for now" link on step 4.',
    'Looks solid from my side. Alex — FYI only, no action needed unless you object to shipping this in the next release.',
    'Focus order fixed. Added a reduced-motion variant for the confetti.',
    'Final frames are locked. Handoff notes are attached to the ticket.',
    'Built behind the flag onboarding_v4. QA pass tomorrow morning.',
    'QA passed on Chrome, Safari and Firefox. Shipping with the Thursday release train.',
  ];
  fbPeople.forEach((who, i) => {
    const quoted = i === 0 ? '' : `\n\nOn an earlier message, ${fbPeople[i - 1].name} wrote:\n> ${fbLines[i - 1]}`;
    fb.push({
      from: who, to: [{ name: 'Design Team', email: 'design-team@northwind.example' }], cc: [me],
      ago: (14 - i) * 5.1 * HOUR + 5.2 * HOUR, subject: `${i === 0 ? '' : 'Re: '}Onboarding flow v4 — feedback round`,
      text: `${fbLines[i]}${quoted}\n\n— ${who.name.split(' ')[0]}`,
    });
  });
  add('onboarding-feedback', ['INBOX', 'CATEGORY_PERSONAL'], true, fb);

  add('offsite-moved', person, true, [{
    from: P.daniel, to: [{ name: 'Leadership', email: 'leads@northwind.example' }], cc: [me], ago: 6.2 * HOUR,
    subject: 'FYI: offsite moved to October',
    text: `Team,\n\nThe leadership offsite is moving from 26–27 September to 14–15 October because of the venue. Nothing to do right now — updated invites will follow next week.\n\nDaniel`,
  }]);
  add('invoice-approved', person, false, [{
    from: P.nora, to: [me], ago: 7.5 * HOUR, subject: 'Re: Invoice #2291 approved',
    text: `Approved and scheduled for the next payment run. Thanks for chasing it!\n\nNora`,
  }]);
  add('deploy-freeze', ['INBOX', 'CATEGORY_FORUMS'], true, [{
    from: P.engAnnounce, to: [{ name: 'Engineering', email: 'eng@northwind.example' }], ago: 9 * HOUR,
    subject: 'Deploy freeze Fri 18:00 – Mon 09:00',
    text: `Reminder: production deploys are frozen from Friday 18:00 to Monday 09:00 for the data-centre migration. Hotfixes need on-call approval.\n\n— Platform team`,
    headers: [['List-Id', 'Eng Announce <eng-announce.northwind.example>'], ['Precedence', 'list']],
  }]);

  // --- Calendar -------------------------------------------------------------
  const syncStart = now + 2 * DAY + 3 * HOUR;
  add('invite-weekly', person, true, [{
    from: P.priya, to: [me], ago: 2.3 * HOUR, subject: 'Invitation: Lumen Labs weekly sync',
    text: `You have been invited to: Lumen Labs weekly sync\nWhen: weekly, 30 minutes\nWhere: Video call\nOrganizer: Priya Raman`,
    ics: icsInvite({ uid: 'weekly-sync-001@lumenlabs.example', summary: 'Lumen Labs weekly sync', start: syncStart, end: syncStart + 30 * MIN, organizer: P.priya, attendee: me }),
  }]);
  const oneStart = now + DAY + 5 * HOUR;
  add('invite-1on1', person, false, [{
    from: P.daniel, to: [me], ago: 11 * HOUR, subject: 'Updated invitation: 1:1 Daniel / Alex',
    text: `This event has been updated.\n1:1 Daniel / Alex\nNew time: tomorrow, 45 minutes`,
    ics: icsInvite({ uid: 'one-on-one-778@northwind.example', summary: '1:1 Daniel / Alex', start: oneStart, end: oneStart + 45 * MIN, organizer: P.daniel, attendee: me }),
  }]);

  // --- Notifications / automation -------------------------------------------
  add('pr-482', updates, true, [{
    from: P.codeforge, to: [me], ago: 52 * MIN, subject: '[northwind/api] Fix retry backoff for webhook delivery (#482)',
    text: `yuki-t requested your review on #482.\n\nFix retry backoff for webhook delivery\n+84 −31 · 4 files changed\n\nView it on CodeForge: https://codeforge.example/northwind/api/pull/482\n\n—\nYou are receiving this because your review was requested.`,
    headers: [['List-Id', 'northwind/api <api.northwind.codeforge.example>'], ['List-Unsubscribe', '<https://codeforge.example/unsub/abc>']],
  }]);
  add('ci-failed', updates, true, [{
    from: P.codeforge, to: [me], ago: 3.4 * HOUR, subject: '[northwind/api] Run failed: CI on main (build #9121)',
    text: `The workflow CI failed on main.\n\nJob integration-tests failed after 6m 12s.\nCommit 9f3c2ab by ben-carter: "Bump client SDK to 4.2"\n\nView results: https://codeforge.example/northwind/api/actions/runs/9121`,
    headers: [['List-Unsubscribe', '<https://codeforge.example/unsub/def>']],
  }]);
  add('nw-1432', updates, true, [{
    from: P.trackline, to: [me], ago: 5 * HOUR, subject: '[Trackline] NW-1432 assigned to you: Export fails for large accounts',
    text: `Inès Moreau assigned NW-1432 to you.\n\nExport fails for large accounts\nPriority: High · Sprint 41\n\nCustomers with more than 50k rows receive a timeout when exporting CSV.\n\nView issue: https://trackline.example/browse/NW-1432`,
    headers: [['Auto-Submitted', 'auto-generated']],
  }]);
  add('nw-1398', updates, false, [{
    from: P.trackline, to: [me], ago: 8.2 * HOUR, subject: '[Trackline] NW-1398 moved to Done',
    text: `Ben Carter moved NW-1398 "Webhook signature docs" from In Review to Done.\n\nView issue: https://trackline.example/browse/NW-1398`,
    headers: [['Auto-Submitted', 'auto-generated']],
  }]);
  add('status-resolved', updates, true, [
    { from: P.status, to: [me], ago: 13 * HOUR, subject: 'Investigating: Elevated API latency (eu-west)',
      text: `We are investigating elevated API latency in eu-west. Next update in 30 minutes.` },
    { from: P.status, to: [me], ago: 12.4 * HOUR, subject: 'Identified: Elevated API latency (eu-west)',
      text: `The issue has been identified as a saturated connection pool. A fix is rolling out.` },
    { from: P.status, to: [me], ago: 11.6 * HOUR, subject: 'Resolved: Elevated API latency (eu-west)',
      text: `This incident has been resolved. Latency returned to normal at 02:14 UTC. A post-incident review will follow.` },
  ]);
  add('doc-comment', updates, true, [{
    from: P.docs, to: [me], ago: 4.9 * HOUR, subject: 'Priya Raman commented on "Pilot plan"',
    text: `Priya Raman left a comment on Pilot plan:\n\n"Can we add the rollback criteria to section 3? Our CISO will ask."\n\nOpen the document: https://pagewise.example/d/pilot-plan#c41`,
  }]);

  // --- Purchases / travel ---------------------------------------------------
  add('eticket', updates, true, [{
    from: P.skyline, to: [me], ago: 15 * HOUR, subject: 'Your e-ticket: BER → LIS, 14 Oct',
    text: `Booking reference: SK7Q2M\n\nBerlin (BER) → Lisbon (LIS)\n14 October · 09:25 – 12:10 · Seat 14C\n\nTotal paid: €212.40\n\nCheck-in opens 30 hours before departure.`,
    attachments: [{ filename: 'e-ticket-SK7Q2M.pdf', mimeType: 'application/pdf', size: 91230 }],
  }]);
  add('receipt', updates, false, [{
    from: P.paperclip, to: [me], ago: 17 * HOUR, subject: 'Receipt for your subscription — €29.00',
    text: `Thanks for your payment.\n\nPaperclip Cloud Team plan · 1 Oct – 31 Oct\nAmount: €29.00 (incl. VAT)\nInvoice: PC-2025-10-04412\n\nYour next charge is on 1 November.`,
    attachments: [{ filename: 'invoice-PC-2025-10-04412.pdf', mimeType: 'application/pdf', size: 48110 }],
  }]);
  add('parcel', updates, true, [{
    from: P.parcelo, to: [me], ago: 6.8 * HOUR, subject: 'Your package arrives tomorrow',
    text: `Good news — your parcel from Fieldnote is out for delivery tomorrow between 10:00 and 14:00.\n\nTracking number: PZ 4410 2281 09\nTrack it: https://parcelo.example/t/PZ4410228109`,
  }]);

  // --- Newsletters ----------------------------------------------------------
  const unsub = slug => [['List-Unsubscribe', `<https://links.example/unsubscribe/${slug}>, <mailto:unsubscribe@${slug}.example>`], ['List-Unsubscribe-Post', 'List-Unsubscribe=One-Click'], ['Precedence', 'bulk']];
  add('dispatch-212', ['INBOX', 'CATEGORY_UPDATES'], true, [{
    from: P.dispatch, to: [me], ago: 10.5 * HOUR, subject: 'Issue #212: The hidden cost of flaky tests',
    text: `The hidden cost of flaky tests — and four other reads for this week.`,
    html: newsletterHtml('The Pragmatic Dispatch · Issue #212', [
      ['The hidden cost of flaky tests', 'Teams underestimate retries by an order of magnitude. A field study of 40 codebases shows where the time actually goes.'],
      ['Queues are a design decision', 'Why back-pressure belongs in your API contract, not in a runbook.'],
      ['The two-pizza review', 'A short argument for capping pull requests at 200 changed lines.'],
      ['Postgres 18 notes', 'What changed for async I/O and why your connection pool settings may need another look.'],
      ['Reader question', 'How do you decommission a service that nobody owns?'],
    ], 'You are receiving this because you subscribed at pragmaticdispatch.example.'),
    headers: unsub('pragmaticdispatch'),
  }]);
  add('product-weekly', ['INBOX', 'CATEGORY_UPDATES'], true, [{
    from: P.productWeekly, to: [me], ago: 19 * HOUR, subject: '5 onboarding teardown lessons',
    text: `Five onboarding teardowns and what they have in common.`,
    html: newsletterHtml('Product Weekly', [
      ['Lesson 1: show value before asking', 'The best flows deliver one useful result before the first form field.'],
      ['Lesson 2: defaults are the product', 'Fewer than 5% of users change a default. Choose them as if nobody will.'],
      ['Lesson 3: empty states are onboarding', 'An empty screen is the most-viewed tutorial you will ever ship.'],
      ['Lesson 4: one decision per screen', 'Decision fatigue starts earlier than most funnels assume.'],
      ['Lesson 5: undo beats confirm', 'Reversible actions remove the need for most confirmation dialogs.'],
    ], 'Product Weekly · sent every Tuesday.'),
    headers: unsub('productweekly'),
  }]);
  add('people-newsletter', ['INBOX', 'CATEGORY_UPDATES'], true, [{
    from: P.people, to: [{ name: 'All Staff', email: 'all@northwind.example' }], ago: 22 * HOUR, subject: 'October newsletter: benefits enrollment, new joiners, office move',
    text: `Benefits enrollment opens on the 6th. Welcome to our 7 new joiners. The Berlin office moves to the 4th floor on the 20th.`,
    html: newsletterHtml('Northwind People · October', [
      ['Benefits enrollment opens 6 October', 'You have until the 20th to confirm or change your plan. No action means your current plan continues.'],
      ['Welcome, new joiners', 'Seven people joined us this month across Engineering, Sales and Support.'],
      ['Berlin office move', 'We are moving to the 4th floor on 20 October. Pack your desk by the 17th.'],
    ], 'Internal communication for Northwind employees.'),
    headers: [['List-Id', 'All Staff <all.northwind.example>'], ['Precedence', 'bulk']],
  }]);
  add('devconf-cfp', promos, true, [{
    from: P.devconf, to: [me], ago: 25 * HOUR, subject: 'Call for papers closes Friday',
    text: `DevConf Europe 2026 — the call for papers closes this Friday at 23:59 CET. Submit a 30-minute talk or a lightning talk.`,
    html: newsletterHtml('DevConf Europe 2026', [
      ['Call for papers closes Friday', 'Submit a 30-minute talk or a 10-minute lightning talk. First-time speakers get mentoring.'],
      ['Early-bird tickets', 'Early-bird pricing ends when the schedule is published.'],
    ], 'You are receiving this because you attended DevConf Europe 2025.'),
    headers: unsub('devconf'),
  }]);

  // --- Promotions -----------------------------------------------------------
  add('fieldnote-promo', promos, true, [{
    from: P.fieldnote, to: [me], ago: 14 * HOUR, subject: 'Last chance: 40% off annual plans',
    text: `Ends tonight — 40% off every annual plan with code AUTUMN40.`,
    html: newsletterHtml('Fieldnote Pro · Autumn sale', [
      ['40% off annual plans', 'Use code AUTUMN40 at checkout. Offer ends tonight at midnight.'],
      ['New: offline notebooks', 'Take your notes anywhere, sync when you are back online.'],
    ], 'Promotional email from Fieldnote Pro.'),
    headers: unsub('fieldnote'),
  }]);
  add('loft-promo', promos, true, [{
    from: P.loft, to: [me], ago: 23.5 * HOUR, subject: 'New arrivals for autumn',
    text: `Warm textures, new colours. Discover the autumn collection.`,
    html: newsletterHtml('Loft & Linen', [
      ['The autumn collection', 'Wool throws, linen bedding and stoneware in four new colours.'],
      ['Free delivery over €60', 'This week only.'],
    ], 'You are receiving this because you made a purchase at loftandlinen.example.'),
    headers: unsub('loftandlinen'),
  }]);

  // --- Social / security ----------------------------------------------------
  add('linkedin-requests', ['INBOX', 'CATEGORY_SOCIAL'], true, [{
    from: P.linkedin, to: [me], ago: 16 * HOUR, subject: 'You have 3 new connection requests',
    text: `Tomás Ibarra, Inès Moreau and 1 other person want to connect with you.\n\nView invitations: https://linkedin.example/mynetwork/invitations`,
    headers: unsub('linkedin'),
  }]);
  add('sso-signin', updates, true, [{
    from: P.sso, to: [me], ago: 26 * HOUR, subject: 'New sign-in from Chrome on macOS',
    text: `We noticed a new sign-in to your Northwind account.\n\nDevice: Chrome on macOS\nLocation: Berlin, Germany\n\nIf this was you, no action is needed. If not, reset your password immediately: https://sso.northwind.example/reset`,
  }]);

  return T;
}

function workSent(now) {
  const me = WORK;
  const mk = (key, to, ago, subject, text) => ({ key, labels: ['SENT'], unread: false, messages: [{ from: me, to: [to], ago, subject, text }] });
  return [
    mk('sent-1', P.priya, 1.2 * DAY, 'Pilot plan — draft for review', `Hi Priya,\n\nAttached is the draft pilot plan. Could you send comments by Friday?\n\nAlex`),
    mk('sent-2', P.daniel, 1.5 * DAY, 'Re: Headcount for Q4', `Daniel,\n\nTwo backend and one data engineer covers the rollout. Details in the sheet.\n\nAlex`),
    mk('sent-3', P.tomas, 4.2 * DAY, 'Following up on the data-sharing pilot', `Hi Tomás,\n\nJust checking whether you had a chance to look at the pilot outline I sent last week.\n\nBest,\nAlex`),
    mk('sent-4', P.yuki, 2.2 * DAY, 'Re: Webhook retry design', `Looks good. Please add jitter and cap the total retry window at 24h.\n\nAlex`),
    mk('sent-5', P.nora, 3 * DAY, 'Invoice #2291 — still pending?', `Hi Nora,\n\nThe vendor asked about invoice #2291 again. Could you check the status?\n\nThanks,\nAlex`),
    mk('sent-6', P.marcus, 6 * DAY, 'Re: Interview feedback — R. Novak', `Strong hire on system design, lean hire on communication. Scorecard submitted.\n\nAlex`),
  ];
}

function homeInbox(now) {
  const me = HOME;
  const T = [];
  const add = (key, labels, unread, messages) => T.push({ key, labels, unread, messages });
  const person = ['INBOX', 'IMPORTANT', 'CATEGORY_PERSONAL'];
  const updates = ['INBOX', 'CATEGORY_UPDATES'];
  const promos = ['INBOX', 'CATEGORY_PROMOTIONS'];
  const unsub = slug => [['List-Unsubscribe', `<https://links.example/unsubscribe/${slug}>`], ['List-Unsubscribe-Post', 'List-Unsubscribe=One-Click']];

  add('weekend', person, true, [{ from: P.mara, to: [me], ago: 1.1 * HOUR, subject: 'Weekend plan — lake or city?',
    text: `Hey,\n\nWeather looks good on Saturday. Lake with the kids, or the city museum and lunch? I need to book the car by tonight if we go to the lake.\n\nMara` }]);
  add('lease', person, true, [{ from: P.landlord, to: [me], ago: 5.5 * HOUR, subject: 'Lease renewal — please confirm by the 30th',
    text: `Dear Alex,\n\nYour lease ends on 31 December. I can offer a 12-month renewal at the same rent. Please confirm by the 30th so I can prepare the paperwork.\n\nBest regards,\nGreta Holm`,
    attachments: [{ filename: 'lease-renewal-2026.pdf', mimeType: 'application/pdf', size: 132004 }] }]);
  add('bookclub', person, true, [{ from: P.bookclub, to: [me, P.leo], ago: 9 * HOUR, subject: 'Book club: next pick + date',
    text: `Hi both,\n\nProposal for next month: "The Overstory". Thursday the 9th at mine, 7pm? Reply if that works.\n\nJonas` }]);
  add('leo-photos', person, false, [{ from: P.leo, to: [me], ago: 27 * HOUR, subject: 'Photos from the hike',
    text: `Finally sorted them. The album is shared — the one at the summit is my favourite.\n\nLeo` }]);
  add('bank', updates, true, [{ from: P.bank, to: [me], ago: 12 * HOUR, subject: 'Your September statement is ready',
    text: `Your statement for the period 1–30 September is available in online banking. This is an automated message.`,
    attachments: [{ filename: 'statement-2025-09.pdf', mimeType: 'application/pdf', size: 70221 }] }]);
  add('power', updates, true, [{ from: P.power, to: [me], ago: 14 * HOUR, subject: 'Your bill is due on 12 October — €84.20',
    text: `Amount due: €84.20\nDue date: 12 October\nCustomer number: 44-218-07\n\nPay online: https://citylineenergy.example/pay` }]);
  add('school', updates, true, [{ from: P.school, to: [{ name: 'Parents 3B', email: 'parents-3b@oakridge-school.example' }], ago: 18 * HOUR, subject: 'Class 3B: trip permission slip due Friday',
    text: `Dear parents,\n\nClass 3B visits the science museum on the 16th. Please return the signed permission slip by Friday.\n\nOakridge School office`,
    attachments: [{ filename: 'permission-slip.pdf', mimeType: 'application/pdf', size: 38012 }] }]);
  add('dentist', updates, true, [{ from: P.dentist, to: [me], ago: 21 * HOUR, subject: 'Appointment reminder: Tuesday 08:30',
    text: `This is a reminder of your appointment on Tuesday at 08:30. Reply C to confirm or call us to reschedule.` }]);
  add('freshcart', updates, false, [{ from: P.grocer, to: [me], ago: 3 * HOUR, subject: 'Your order is on its way',
    text: `Order FC-88213 will arrive today between 18:00 and 20:00.\n\n12 items · €61.35` }]);
  add('gym', promos, true, [{ from: P.gym, to: [me], ago: 30 * HOUR, subject: 'Bring a friend for free this month',
    text: `Bring a friend to any class in October — free.`,
    html: newsletterHtml('Pulse Fitness', [['Bring a friend for free', 'Any class, all October.'], ['New: early-bird yoga', 'Tuesdays and Thursdays at 06:30.']], 'Member newsletter.'),
    headers: unsub('pulsefitness') }]);
  add('streambox', promos, true, [{ from: P.streambox, to: [me], ago: 33 * HOUR, subject: 'New this week on Streambox',
    text: `Six new series and a documentary you will like.`,
    html: newsletterHtml('Streambox · New this week', [['Northern Lines', 'A slow-burn detective series in six parts.'], ['The Long Table', 'A documentary about one restaurant and forty years.']], 'You can change what we send you in settings.'),
    headers: unsub('streambox') }]);
  add('wanderlist', promos, true, [{ from: P.travel, to: [me], ago: 40 * HOUR, subject: 'Lisbon from €79 — this week\'s fare drops',
    text: `Fare drops from your home airport this week.`,
    html: newsletterHtml('Wanderlist fare drops', [['Lisbon from €79', 'Selected dates in November.'], ['Oslo from €64', 'Weekend returns.']], 'Deals email.'),
    headers: unsub('wanderlist') }]);
  return T;
}

/** Bulk archive used to measure list, search and account-switch responsiveness at scale. */
function bulkArchive(account, count, seed, now, inboxCount = 0) {
  const rand = mulberry32(seed);
  const pick = list => list[Math.floor(rand() * list.length)];
  const people = account === WORK
    ? [P.priya, P.daniel, P.sofia, P.marcus, P.hannah, P.nora, P.yuki, P.ben, P.ines, P.tomas]
    : [P.mara, P.leo, P.bookclub, P.landlord];
  const bots = account === WORK
    ? [P.codeforge, P.trackline, P.status, P.docs, P.dispatch, P.productWeekly, P.people, P.paperclip, P.skyline, P.linkedin, P.fieldnote, P.devconf]
    : [P.bank, P.power, P.school, P.grocer, P.gym, P.streambox, P.travel, P.dentist];
  const topics = ['rollout plan', 'budget review', 'webhook retries', 'pilot feedback', 'contract renewal', 'hiring plan', 'incident review', 'roadmap draft', 'pricing page', 'export job', 'data migration', 'onboarding copy', 'security questionnaire', 'quarterly goals', 'vendor shortlist', 'release notes', 'support escalation', 'analytics dashboard', 'design tokens', 'access request'];
  const verbs = ['Notes on', 'Question about', 'Follow-up:', 'Update on', 'Draft:', 'Decision needed:', 'Quick sync on', 'Summary:', 'Thoughts on', 'Next steps for'];
  const botSubjects = ['Weekly digest', 'Your receipt', 'Build passed on main', 'Issue updated', 'New comment on your document', 'Maintenance window scheduled', 'Your statement is ready', 'Order confirmed', 'This week\'s picks', 'Reminder'];
  const sentences = [
    'I went through the latest numbers and the trend is holding.',
    'Can you take a look before the review on Thursday?',
    'The main open question is ownership after the migration.',
    'We agreed to keep the scope as is and revisit next sprint.',
    'Attaching the notes from the call for reference.',
    'Let me know if the timeline still works on your side.',
    'I think we can simplify this by dropping the second step.',
    'The customer confirmed the fix works in their staging environment.',
    'Legal asked for one more change in section four.',
    'No action needed, sharing for visibility.',
  ];
  const threads = [];
  for (let i = 0; i < count; i += 1) {
    const isBot = rand() < 0.62;
    const ago = 2 * DAY + Math.floor(rand() * 700 * DAY * (i / count + 0.02));
    if (isBot) {
      const from = pick(bots);
      const subject = `${pick(botSubjects)} #${1000 + Math.floor(rand() * 9000)}`;
      threads.push({ key: `bulk-${seed}-${i}`, labels: [...(i < inboxCount ? ['INBOX'] : []), rand() < 0.5 ? 'CATEGORY_UPDATES' : 'CATEGORY_PROMOTIONS'], unread: i < inboxCount && rand() < 0.4,
        messages: [{ from, to: [account], ago, subject, text: `${pick(sentences)} ${pick(sentences)}\n\nReference ${Math.floor(rand() * 1e6)}.` }] });
    } else {
      const from = pick(people);
      const subject = `${pick(verbs)} ${pick(topics)}`;
      const n = 1 + Math.floor(rand() * rand() * 5);
      const messages = [];
      for (let m = 0; m < n; m += 1) {
        const mine = m % 2 === 1;
        messages.push({ from: mine ? account : from, to: [mine ? from : account], ago: ago - m * (20 * MIN + Math.floor(rand() * 6 * HOUR)),
          subject: `${m === 0 ? '' : 'Re: '}${subject}`, labels: mine ? ['SENT'] : undefined,
          text: `${pick(sentences)} ${pick(sentences)} ${pick(sentences)}\n\n${mine ? 'Alex' : from.name.split(' ')[0]}` });
      }
      threads.push({ key: `bulk-${seed}-${i}`, labels: [...(i < inboxCount ? ['INBOX'] : []), 'CATEGORY_PERSONAL', ...(rand() < 0.3 ? ['IMPORTANT'] : [])], unread: i < inboxCount && rand() < 0.4, messages });
    }
  }
  return threads;
}

function b64url(text) {
  return Buffer.from(text, 'utf-8').toString('base64url');
}

let globalHistoryId = 500000;
function nextHistoryId() { globalHistoryId += 7; return String(globalHistoryId); }

function materialize(account, specs, now, idPrefix) {
  const fmtAddr = a => (a.name ? `${a.name} <${a.email}>` : a.email);
  const out = new Map();
  specs.forEach((spec, ti) => {
    const threadId = `${idPrefix}t${ti.toString(16).padStart(6, '0')}`;
    const lastIndex = spec.messages.length - 1;
    const messages = spec.messages.map((m, mi) => {
      const id = `${idPrefix}m${ti.toString(16).padStart(6, '0')}${mi.toString(16).padStart(2, '0')}`;
      const date = now - m.ago;
      const labelIds = new Set(m.labels || spec.labels);
      if (spec.unread && mi === lastIndex && !labelIds.has('SENT')) labelIds.add('UNREAD');
      const text = m.text || '';
      const html = m.html || plainToHtml(text);
      const parts = [
        { partId: '0', mimeType: 'text/plain', headers: [], body: { size: text.length, data: b64url(text) } },
        { partId: '1', mimeType: 'text/html', headers: [], body: { size: html.length, data: b64url(html) } },
      ];
      if (m.ics) {
        parts.push({ partId: '2', mimeType: 'text/calendar', filename: 'invite.ics', headers: [{ name: 'Content-Type', value: 'text/calendar; method=REQUEST' }], body: { size: m.ics.length, data: b64url(m.ics) } });
      }
      (m.attachments || []).forEach((att, ai) => {
        parts.push({ partId: String(3 + ai), mimeType: att.mimeType, filename: att.filename,
          headers: [{ name: 'Content-Disposition', value: `attachment; filename="${att.filename}"` }],
          body: { size: att.size, attachmentId: `${id}-att${ai}` } });
      });
      const headers = [
        { name: 'From', value: fmtAddr(m.from) },
        { name: 'To', value: (m.to || []).map(fmtAddr).join(', ') },
        ...(m.cc && m.cc.length ? [{ name: 'Cc', value: m.cc.map(fmtAddr).join(', ') }] : []),
        { name: 'Subject', value: m.subject },
        { name: 'Date', value: new Date(date).toUTCString() },
        { name: 'Message-ID', value: `<${id}@mail.synthetic.example>` },
        ...(mi > 0 ? [{ name: 'In-Reply-To', value: `<${idPrefix}m${ti.toString(16).padStart(6, '0')}${(mi - 1).toString(16).padStart(2, '0')}@mail.synthetic.example>` }] : []),
        ...((m.headers || []).map(([name, value]) => ({ name, value }))),
      ];
      return {
        id, threadId, labelIds: Array.from(labelIds), snippet: text.replace(/\s+/g, ' ').slice(0, 180),
        historyId: nextHistoryId(), internalDate: String(date), sizeEstimate: text.length + html.length,
        payload: { partId: '', mimeType: 'multipart/mixed', filename: '', headers, body: { size: 0 }, parts },
      };
    });
    out.set(threadId, { id: threadId, key: spec.key, historyId: messages[messages.length - 1].historyId, messages });
  });
  return out;
}

function buildMailboxes(now, options = {}) {
  const workBulk = options.workBulk ?? 6000;
  const homeBulk = options.homeBulk ?? 1500;
  const bigInbox = options.bigInbox ?? 0;
  const work = materialize(WORK, [...workInbox(now), ...workSent(now), ...bulkArchive(WORK, workBulk, 11, now, bigInbox)], now, 'w');
  const home = materialize(HOME, [...homeInbox(now), ...bulkArchive(HOME, homeBulk, 29, now)], now, 'h');
  const labels = account => [
    ...['INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'STARRED', 'IMPORTANT', 'UNREAD', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS']
      .map(id => ({ id, name: id, type: 'system', messageListVisibility: 'show', labelListVisibility: 'labelShow' })),
    ...(account === WORK
      ? [['Label_1', 'Clients', '#16a765'], ['Label_2', 'Finance', '#f2a600'], ['Label_3', 'Hiring', '#4986e7'], ['Label_4', 'Clients/Lumen Labs', '#16a765']]
      : [['Label_1', 'Family', '#e07798'], ['Label_2', 'Home', '#4986e7'], ['Label_3', 'Receipts', '#f2a600']])
      .map(([id, name, bg]) => ({ id, name, type: 'user', messageListVisibility: 'show', labelListVisibility: 'labelShow', color: { backgroundColor: bg, textColor: '#ffffff' } })),
  ];
  return {
    [WORK.email]: { profile: WORK, threads: work, labels: labels(WORK), signature: '<div>Alex Morgan<br>Head of Rollouts · Northwind</div>', history: [] },
    [HOME.email]: { profile: HOME, threads: home, labels: labels(HOME), signature: '', history: [] },
  };
}

module.exports = { buildMailboxes, WORK, HOME, P, nextHistoryId, materialize, b64url, plainToHtml, MIN, HOUR, DAY };
