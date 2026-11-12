// Scripted, fully synthetic answers for the fake model. Keyed on the subject found in the prompt.
'use strict';

const SUMMARIES = [
  [/pilot to the 24th/i, [
    'Priya (Lumen Labs) asks to move the pilot kickoff from the 17th to Thursday the 24th.',
    'Reason: their security review slipped by a few days.',
    'Fallback if the 24th fails: the morning of the 25th.',
    'She must confirm with their CISO by end of day tomorrow.',
  ], 'Reply today with a yes/no on the 24th.'],
  [/board deck/i, [
    'Daniel needs three inputs for Thursday\'s board deck by Wednesday 5pm.',
    'Pilot conversion (trial → paid) for Q3.',
    'Net revenue retention, trailing 12 months — Nora can help pull it.',
    'One slide on the Lumen Labs rollout risk; a rough draft is fine.',
  ], 'Confirm the Wednesday deadline and ask Nora for the retention figures.'],
  [/redlines/i, [
    'Sofia (Harbor & Pine) sent contract v3; everything is accepted except two points.',
    'Liability cap: they offer 12 months of fees instead of 24.',
    'Termination notice: 60 days is fine if it is mutual.',
    'Legal can issue the signature copy this week once both are confirmed.',
  ], 'Confirm or counter the two open points.'],
  [/Onboarding flow v4/i, [
    'Design feedback round for onboarding flow v4, 14 messages, you are on Cc.',
    'Main changes: workspace name moved after the first success moment; dark-mode contrast and focus order fixed.',
    'Final frames are locked and built behind the flag onboarding_v4.',
    'QA passed on Chrome, Safari and Firefox; it ships with the Thursday release train.',
  ], 'No action needed unless you object to shipping.'],
];

const DRAFTS = [
  [/pilot to the 24th/i, 'Hi Priya,\n\nThursday the 24th works for us — same attendees, same agenda. I will move the kickoff invite today so you can confirm with your CISO.\n\nBest,\nAlex'],
  [/board deck/i, 'Daniel,\n\nUnderstood — you will have all three by Wednesday 5pm. I am asking Nora for the retention figures now and will send the rollout-risk slide as a rough draft first.\n\nAlex'],
  [/redlines/i, 'Hi Sofia,\n\nThanks for v3. Both points work for us: a liability cap of 12 months of fees, and a mutual 60-day termination notice. Please go ahead and issue the signature copy.\n\nKind regards,\nAlex'],
  [/Jamie Chen/i, 'Hey Marcus,\n\nWednesday 2:00–3:00pm works. Please send the invite and I will review the resume and scorecard beforehand.\n\nAlex'],
  [/Intro: Alex/i, 'Thanks, Hannah (moving you to Bcc).\n\nHi Tomás, good to meet you. Happy to walk you through how we ran the Lumen Labs pilot. Would a 30-minute call on Tuesday or Wednesday next week work?\n\nBest,\nAlex'],
];

function subjectOf(text) {
  const match = /Subject:\s*(.+)/.exec(text);
  return match ? match[1].trim() : '';
}

const TRIAGE = [
  [/pilot to the 24th/i, 'reply', 'Client asks a yes/no on moving the pilot to the 24th; answer due tomorrow.', 96],
  [/board deck/i, 'reply', 'Manager needs three numbers by Wednesday 5pm.', 93],
  [/redlines/i, 'reviewAttachment', 'Contract v3 attached; two open points need your confirmation.', 90],
  [/Jamie Chen/i, 'reply', 'Scheduling question: Wednesday 2–3pm or Thursday 11:00.', 84],
  [/Intro: Alex/i, 'reply', 'Warm intro waiting for a first reply since yesterday.', 72],
  [/Invitation: Lumen/i, 'readNow', 'New recurring invite; needs an RSVP.', 66],
  [/offsite moved/i, 'markDoneCandidate', 'FYI only — sender says nothing to do right now.', 30],
  [/Updated invitation/i, 'markDoneCandidate', 'Calendar update, already reflected in the invite.', 28],
];

function triage(user) {
  const items = [];
  const re = /threadId=(\S+)\s*\n\s*subject=(.*)/g;
  let match;
  while ((match = re.exec(user)) && items.length < 8) {
    const hit = TRIAGE.find(([pattern]) => pattern.test(match[2]));
    items.push({ threadId: match[1], recommendation: hit ? hit[1] : 'markDoneCandidate', reason: hit ? hit[2] : 'Automated or informational; safe to archive.', priority: hit ? hit[3] : 20 });
  }
  return JSON.stringify({ items });
}

// --- new pipeline (system line 1 = "DUMKA_TASK: <name>") ---------------------------------------
const DECISIONS = [
  [/pilot to the 24th/i, 'reply', 'Asks yes or no on moving the pilot to Thu 24th; she must confirm by tomorrow.'],
  [/board deck/i, 'reply', 'Needs three inputs by Wednesday 5pm; Nora can pull retention.'],
  [/redlines/i, 'reply', 'Wants both open points confirmed so legal can issue the signature copy.'],
  [/Jamie Chen/i, 'reply', 'Scheduling question: Wed 14:00 or Thu 11:00.'],
  [/Intro: Alex/i, 'reply', 'Intro waiting for your first reply since yesterday.'],
  [/Onboarding flow v4/i, 'read', 'You are on Cc. QA passed, ships Thursday; no action unless you object.'],
  [/offsite moved/i, 'read', 'Offsite moves to 14–15 Oct. Nothing to do now.'],
  [/Invoice #2291/i, 'read', 'Approved and scheduled for the next payment run.'],
  [/#482/i, 'later', 'yuki-t requested your review: +84 −31, 4 files.'],
  [/NW-1432/i, 'later', 'Assigned to you, high priority, sprint 41.'],
  [/commented on/i, 'later', 'Priya asks to add rollback criteria to section 3.'],
  [/Run failed/i, 'clear', 'CI failed on a commit that is not yours (ben-carter).'],
  [/NW-1398/i, 'clear', 'Status change only.'],
  [/e-ticket/i, 'clear', 'E-ticket SK7Q2M, 14 Oct 09:25, seat 14C.'],
  [/Receipt for your subscription/i, 'clear', 'Receipt, €29.00.'],
  [/package arrives/i, 'clear', 'Delivery tomorrow 10:00–14:00.'],
];

function tomorrowNine() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function inboxDecisions(user) {
  let threads = [];
  try { threads = JSON.parse(user.slice(user.indexOf('{', user.indexOf('Threads (JSON)')))).threads || []; } catch (error) { threads = []; }
  const items = threads.map(t => {
    const hit = DECISIONS.find(([re]) => re.test(t.subject || ''));
    if (!hit) return null;
    return { threadId: t.threadId, decision: hit[1], reason: hit[2], laterAt: hit[1] === 'later' ? tomorrowNine() : null };
  }).filter(Boolean);
  return JSON.stringify({ items });
}

function pipeline({ system, user }) {
  const task = (/^DUMKA_TASK:\s*([\w-]+)/.exec(system || '') || [])[1];
  if (!task) return null;
  if (task === 'inbox-decisions') return inboxDecisions(user);
  if (task === 'reply-draft') {
    const hit = DRAFTS.find(([re]) => re.test(user));
    return hit ? hit[1] : 'Hi,\n\nThanks for the update — noted on my side. [confirm next step]\n\nBest,\nAlex';
  }
  if (task === 'thread-summary') {
    const hit = SUMMARIES.find(([re]) => re.test(user));
    return (hit ? hit[1] : ['The thread is informational.', 'No decision is asked of you.']).map(line => `- ${line}`).join('\n');
  }
  if (task === 'chat') return 'Three conversations need a reply today: the pilot date, the board numbers and the contract redlines. The rest is informational.';
  return null;
}

function reply({ user, system }) {
  const piped = pipeline({ system, user });
  if (piped !== null) return piped;
  if (/Action:\s*triage/.test(user)) return triage(user);
  const subject = subjectOf(user);
  const instruction = (/Current user instruction:\s*([\s\S]*?)\n\s*\n/.exec(user) || [])[1] || user.slice(-400);
  const action = (/Action:\s*(\w+)/.exec(user) || [])[1] || '';
  const wantsSummary = /summari[sz]e/i.test(instruction);
  const wantsDraft = /draft|reply|respond/i.test(instruction) || /draft/i.test(action);

  if (wantsSummary) {
    const hit = SUMMARIES.find(([re]) => re.test(subject));
    if (hit) return `${hit[1].map(line => `- ${line}`).join('\n')}\n\nNext step: ${hit[2]}`;
    return `- ${subject || 'This message'} is informational.\n- Nothing in it asks you for a decision.\n- No deadline is mentioned.\n\nNext step: Archive unless you want to follow up.`;
  }
  if (wantsDraft) {
    const hit = DRAFTS.find(([re]) => re.test(subject));
    if (hit) return hit[1];
    return 'Hi,\n\nThanks for the update — noted on my side.\n\nBest,\nAlex';
  }
  return null;
}

module.exports = { reply };
