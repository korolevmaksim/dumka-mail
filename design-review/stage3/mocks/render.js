// Mock renderer. location.hash = "<direction>-<screen>", e.g. #d1-inbox.
// Directions: d1 "Decision sections", d2 "Review pass", d3 "Quiet inbox". Shared screens use "sh".
(() => {
  const D = window.DATA;
  const T = Object.fromEntries(D.threads.map(t => [t.id, t]));
  const by = decision => D.threads.filter(t => t.decision === decision);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // ---- icons -------------------------------------------------------------------------------
  const svg = (d, size = 16, fill = false) => `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const I = {
    inbox: s => svg('<path d="M2 9h3.2l1 2h3.6l1-2H14"/><path d="M3.6 3h8.8L14 9v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9z"/>', s),
    clock: s => svg('<circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/>', s),
    archive: s => svg('<rect x="2" y="3" width="12" height="3" rx="1"/><path d="M3 6v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 9h3"/>', s),
    cal: s => svg('<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/>', s),
    gear: s => svg('<path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7"/><circle cx="10.5" cy="4.5" r="1.5"/><circle cx="5.5" cy="11.5" r="1.5"/>', s),
    search: s => svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.4 10.4L14 14"/>', s),
    spark: (s = 12) => `<span class="spark">${svg('<path d="M8 1l1.7 5.3L15 8l-5.3 1.7L8 15l-1.7-5.3L1 8l5.3-1.7z"/>', s, true)}</span>`,
    check: s => svg('<path d="M3.5 8.5l3 3 6-7"/>', s),
    clip: s => svg('<path d="M10.5 4.5l-5 5a1.8 1.8 0 0 0 2.5 2.5l5.5-5.5a3 3 0 0 0-4.2-4.2L3.7 7.9"/>', s),
    send: s => svg('<path d="M14 2L7 9M14 2l-4.5 12L7 9 2 6.5z"/>', s),
    warn: s => svg('<path d="M8 2.2l6 10.6H2z"/><path d="M8 6.5v3M8 11.3v.1"/>', s),
    chev: s => svg('<path d="M4 6l4 4 4-4"/>', s),
    activity: s => svg('<path d="M2 8h3l2-4.5 3 9 2-4.5h2"/>', s),
  };
  const k = (...keys) => keys.map(x => `<kbd>${x}</kbd>`).join(' ');

  // ---- shell -------------------------------------------------------------------------------
  function shell({ nav = 'inbox', badge = '', status = 'Synced just now', dot = '', search = 'Search all mail', searchFocus = false, body, overlay = '', footer = '' }) {
    const item = (id, icon, extra = '') => `<div class="nav ${nav === id ? 'on' : ''}">${icon}${extra}</div>`;
    return `
      <div class="rail">
        <div class="av work">AM<i>⌘1</i></div>
        <div class="av home">AM<i>⌘2</i></div>
        <div class="sep"></div>
        ${item('inbox', I.inbox(18), badge ? `<b class="num">${badge}</b>` : '')}
        ${item('later', I.clock(18))}
        ${item('all', I.archive(18))}
        ${item('activity', I.activity(18))}
        ${item('cal', I.cal(18))}
        <div class="spacer"></div>
        ${item('settings', I.gear(18))}
      </div>
      <div class="main">
        <div class="top">
          <div class="search ${searchFocus ? 'focus' : ''}">${I.search(14)}<span class="grow trunc">${search}</span>${searchFocus ? '' : k('/')}</div>
          <div class="grow"></div>
          <div class="status"><span class="dot ${dot}"></span>${status}</div>
        </div>
        ${body}
        ${footer}
      </div>${overlay}`;
  }

  // ---- rows --------------------------------------------------------------------------------
  const twoLine = (t, { sel = false, right = '', why = true, read = false } = {}) => `
    <div class="r ${sel ? 'sel' : ''} ${read ? 'read' : ''}">
      <span class="unread ${read ? 'off' : ''}"></span>
      <div class="grow col gap4">
        <div class="row gap8"><span class="who trunc" style="max-width:150px">${esc(t.from)}</span><span class="subj trunc grow">${esc(t.subject)}</span>${t.attach ? `<span class="faint">${I.clip(13)}</span>` : ''}${right}<span class="t num">${t.time}</span></div>
        ${why ? `<div class="why">${I.spark(11)}<span class="trunc">${esc(t.why)}</span></div>` : ''}
      </div>
    </div>`;
  const oneLine = (t, { sel = false, right = '', lead = '', text = null } = {}) => { const tail = text ?? t.why; return `
    <div class="r one ${sel ? 'sel' : ''}">
      ${lead}<span class="who trunc" style="width:150px;flex:none">${esc(t.from)}</span>
      <span class="grow trunc"><span class="subj">${esc(t.subject)}</span>${tail ? ` <span class="muted">— ${esc(tail)}</span>` : ''}</span>
      ${right}<span class="t num">${t.time}</span>
    </div>`; };
  const sec = (title, n, act = '') => `<div class="sec"><strong>${title}</strong><span class="n num">${n}</span>${act ? `<span class="act">${act}</span>` : ''}</div>`;
  const listHead = (title, count, right = '') => `<div class="list-head"><h1>${title}</h1><span class="count num">${count}</span><span class="grow"></span>${right}</div>`;

  // ---- reader ------------------------------------------------------------------------------
  function reader({ t = T.pilot, draft = 'ready', why = true, acts = true, whyTitle = 'Why this needs you', sendLabel = 'Send and archive', remind = false, extraFoot = '' }) {
    const draftBlock = {
      ready: `<div class="to">${I.spark(12)}<span style="color:var(--agent);font-weight:600">Draft prepared by the agent</span><span class="faint">Nothing is sent until you press Send. To: priya.raman@lumenlabs.example</span></div>
              <div class="draft">${D.pilotDraft.map((p, i) => `<p>${esc(p)}${i === 1 ? '<span class="caret"></span>' : ''}</p>`).join('')}</div>`,
      failed: `<div class="to"><span style="color:var(--warn)">${I.warn(13)}</span><span style="font-weight:600">Draft unavailable</span><span class="faint">The model did not answer (503). Your mail and rules are not affected.</span>
               <span class="btn sm">Retry</span></div>
              <div class="draft"><p class="faint">Write your reply<span class="caret"></span></p><p class="faint">Alex Morgan\nHead of Rollouts · Northwind</p></div>`,
      manual: `<div class="to"><span class="faint">To: priya.raman@lumenlabs.example</span></div>
              <div class="draft"><p class="faint">Write your reply<span class="caret"></span></p><p class="faint">Alex Morgan\nHead of Rollouts · Northwind</p></div>`,
    }[draft];
    return `
      <div class="reader">
        <div class="rd-head">
          <div class="row gap12" style="align-items:flex-start">
            <div class="grow"><h2>${esc(t.subject)}</h2>
              <div class="row gap8 muted" style="font-size:12.5px"><b style="color:var(--t1);font-weight:600">${esc(t.from)}</b><span>${esc(t.org || '')}</span><span class="faint">to you, today ${t.time}</span></div></div>
            ${acts ? `<div class="rd-acts"><span class="btn">Reply ${k('R')}</span><span class="btn">Archive ${k('E')}</span><span class="btn">Later ${k('H')}</span><span class="btn ghost">More</span></div>` : ''}
          </div>
        </div>
        <div class="rd-body">
          ${why ? `<div class="agentbox">${I.spark(13)}<div><b style="font-weight:620">${whyTitle}.</b> ${esc(t.why)} <span class="src">Source: this message, paragraphs 1–2.</span></div></div>` : ''}
          <div class="msg">${D.pilotBody.map(p => `<p>${esc(p)}</p>`).join('')}</div>
        </div>
        <div class="dock">
          ${draftBlock}
          <div class="foot">
            <span class="btn primary">${I.send(14)}${sendLabel} ${k('⌘', '↩')}</span>
            <span class="btn">${remind ? 'Send, remind me in 3 days' : 'Send only'} ${k('⌘', '⇧', '↩')}</span>
            ${extraFoot}
            <span class="grow"></span><span class="faint" style="font-size:12px">Undo send for 10 s. Esc keeps the draft.</span>
          </div>
        </div>
      </div>`;
  }

  const prepared = (title, lines, foot) => `
    <div class="pane">
      <div class="row gap8">${I.spark(15)}<h2>${title}</h2></div>
      <div class="card" style="max-width:600px">${lines.map(([n, text, key]) => `<div class="cr"><b class="num" style="width:26px;font-size:15px">${n}</b><span class="grow">${text}</span>${key || ''}</div>`).join('')}</div>
      ${foot}
    </div>`;

  // =========================================================================================
  // Direction 1 — Decision sections
  // =========================================================================================
  const d1 = {};
  const d1List = ({ width = 620, sel = null, expandClear = false, model = true, loading = 0 } = {}) => {
    const reply = by('reply'), read = by('read'), event = by('event'), later = by('later'), clear = by('clear'), unsub = by('unsub');
    const people = [...reply, ...read.filter(t => t.id !== 'sso' && t.id !== 'freeze')];
    const clearSummary = 'CodeForge, Trackline, Status, Skyline Air, Paperclip, Parcelo, 4 newsletters, LinkedIn';
    return `<div class="list" style="width:${width}px">
      ${listHead('Inbox', loading ? `fetching ${loading} of 28` : model ? '28 left, 6 decisions' : '28 left', `<span class="faint" style="font-size:12px">${model ? '' : 'Basic sorting'}</span>`)}
      ${model
        ? sec('Reply', 5, `Open first ${k('↩')}`) + reply.map(t => twoLine(t, { sel: sel === t.id, right: t.due ? `<span class="chip warn">${t.due}</span>` : '' })).join('')
          + sec('Read', 5) + read.map(t => oneLine(t, { sel: sel === t.id })).join('')
        : sec('People', 8, `Open first ${k('↩')}`) + people.map(t => oneLine(t, { sel: sel === t.id, text: '' })).join('')
          + sec('Read', 2) + [T.freeze, T.sso].map(t => oneLine(t, { text: '' })).join('')}
      ${loading ? '' : sec('Event', 2) + event.map(t => oneLine(t, { right: `<span class="chip reply">Yes ${k('Y')}</span><span class="chip">No ${k('N')}</span>` })).join('')}
      ${loading ? `<div class="r one"><div class="skel" style="width:120px"></div><div class="skel grow"></div></div><div class="r one"><div class="skel" style="width:90px"></div><div class="skel grow"></div></div><div class="r one"><div class="skel" style="width:140px"></div><div class="skel grow"></div></div>` : ''}
      ${loading || !model ? '' : sec('Later', 3, `All to tomorrow 09:00 ${k('⇧', 'H')}`) + later.map(t => oneLine(t, { right: `<span class="chip agent">${t.when}</span>` })).join('')}
      ${loading || model ? '' : `<div class="sec" style="height:38px"><strong>Automated, not sorted</strong><span class="n num">9</span><span class="muted trunc grow">CodeForge 2, Trackline 2, Pagewise, Status, 3 receipts</span><span class="act">One by one ${k('↩')}</span></div>`}
      ${loading ? '' : !model
        ? `<div class="sec" style="height:38px"><strong>Clear</strong><span class="n num">5</span><span class="muted trunc grow">4 newsletters, LinkedIn — list mail</span><span class="act">Archive 5 ${k('⇧', 'E')}</span></div>`
        : expandClear
        ? sec('Clear', 11, `Archive 11 ${k('⇧', 'E')}`) + clear.map(t => oneLine(t, { lead: `<span class="check on">${I.check(11)}</span>`, sel: t.id === 'ci' })).join('')
        : `<div class="sec" style="height:38px"><strong>Clear</strong><span class="n num">11</span><span class="muted trunc grow">${clearSummary}</span><span class="act">Archive 11 ${k('⇧', 'E')}</span></div>`}
      ${loading ? '' : `<div class="sec" style="height:38px"><strong>Unsubscribe</strong><span class="n num">2</span><span class="muted trunc grow">Fieldnote Pro, Loft &amp; Linen — promotions you never open</span><span class="act">Review, asks first</span></div>`}
    </div>`;
  };
  d1.inbox = () => shell({ badge: 28, body: `<div class="body">${d1List()}${prepared('Prepared for you', [
      [5, 'replies drafted in the composer, one with a follow-up reminder', k('↩')],
      [1, 'long thread summarised (14 messages)'],
      [2, 'invitations checked against your calendar', k('Y') + ' ' + k('N')],
      [3, 'notifications scheduled for tomorrow 09:00', k('⇧', 'H')],
      [11, 'routine conversations ready to archive together', k('⇧', 'E')],
      [2, 'senders you can unsubscribe from, always with a confirmation'],
    ], `<p>Nothing has changed in Gmail yet. Archiving and Later can be undone with ${k('Z')}. Sending, RSVP and unsubscribing always ask first.</p>
        <div class="row gap8 faint" style="font-size:12px">${k('J')} ${k('K')} move ${k('E')} archive ${k('H')} later ${k('⇧', 'E')} ${k('⇧', 'H')} the whole section ${k('V')} move to another section</div>`)}</div>` });
  d1.thread = () => shell({ badge: 28, body: `<div class="body">${d1List({ width: 440, sel: 'pilot' })}${reader({ remind: false })}</div>` });
  d1.agent = () => shell({ badge: 28, body: `<div class="body">${d1List({ expandClear: true })}
      <div class="pane">
        <h2>Archive 11 conversations</h2>
        <p>They leave the inbox and stay in All mail. Nothing is deleted and nothing is sent to these senders.</p>
        <div class="card" style="max-width:600px">
          <div class="cr">${I.spark(13)}<span class="grow"><b style="font-weight:600">Why these.</b> Automated senders with list headers, receipts, and notifications that ask nothing of you.</span></div>
          <div class="cr"><span class="grow muted">Kept out of this group: anything from a person you have written to, security notices, invitations.</span></div>
          <div class="cr"><span class="grow muted">Uncheck a row to keep it. ${k('V')} moves it to another section and the agent remembers the correction.</span></div>
        </div>
        <div class="row gap8"><span class="btn primary">Archive 11 ${k('⇧', 'E')}</span><span class="btn">Open one by one ${k('↩')}</span><span class="grow"></span></div>
        <p class="faint" style="font-size:12px">One ${k('Z')} brings all 11 back.</p>
      </div></div>` });
  d1.confirm = () => shell({ badge: 28, body: `<div class="body">${d1List()}<div class="pane"></div></div>`, overlay: unsubSheet() });
  d1.empty = () => shell({ badge: '', status: 'Synced just now', body: `<div class="body"><div class="list" style="width:620px">${listHead('Inbox', 'clear')}
      <div class="pane" style="background:transparent;padding:40px 24px"><h2>Inbox is clear</h2><p>28 conversations handled in this pass.</p></div></div>
      ${doneSummary()}</div>` });
  d1.loading = () => shell({ badge: 12, status: 'Fetching inbox, 12 of 28', dot: 'busy', body: `<div class="banner agent">${I.spark(13)}<span>Connected to alex.morgan@northwind.example. Sorting as mail arrives. Nothing changes in Gmail until you act.</span><span class="grow"></span><span class="faint">Older mail: 0 of 6,034 indexed</span></div><div class="body">${d1List({ loading: 12 })}
      <div class="pane"><h2>Getting your inbox</h2><p>The first conversations are already here. You can open and answer them while the rest arrives.</p>
        <div style="max-width:420px" class="col gap6"><div class="bar"><i style="width:43%"></i></div><span class="faint" style="font-size:12px">12 of 28 in the inbox. Search covers older mail as it is indexed.</span></div></div></div>` });
  d1.error = () => shell({ badge: 28, status: 'Model unavailable', dot: 'warn', body: `<div class="banner warn"><span style="color:var(--warn)">${I.warn(14)}</span><span>Couldn't reach the model, so this is basic sorting: no summaries or drafts, and automated mail is not split into Later and Clear. Your mail is untouched.</span><span class="grow"></span><span class="btn sm">Retry</span><span class="btn sm ghost">Details</span></div>
      <div class="body">${d1List({ width: 440, model: false, sel: 'pilot' })}${reader({ draft: 'failed', why: false })}</div>` });

  // =========================================================================================
  // Direction 2 — Review pass
  // =========================================================================================
  const d2 = {};
  const d2Flat = ({ width = 620 } = {}) => {
    const people = [...by('reply'), ...by('read'), ...by('event')];
    return `<div class="list" style="width:${width}px">
      ${listHead('Inbox', '28 open', `<span class="btn primary sm">Review 28 ${k('↩')}</span>`)}
      ${people.map(t => oneLine(t, { right: `<span class="chip ${t.decision === 'reply' ? 'reply' : ''}">${{ reply: 'Reply', read: 'Read', event: 'Invite' }[t.decision]}</span>` })).join('')}
      <div class="r one"><span class="who" style="width:150px;flex:none">3 notifications</span><span class="grow trunc muted">CodeForge #482, Trackline NW-1432, Pagewise comment</span><span class="chip agent">Later, together</span></div>
      <div class="r one"><span class="who" style="width:150px;flex:none">11 routine</span><span class="grow trunc muted">CodeForge, Trackline, Status, Skyline Air, Paperclip, Parcelo, 4 newsletters, LinkedIn</span><span class="chip agent">Archive, together</span></div>
      <div class="r one"><span class="who" style="width:150px;flex:none">2 promotions</span><span class="grow trunc muted">Fieldnote Pro, Loft &amp; Linen</span><span class="chip agent">Unsubscribe, asks first</span></div>
    </div>`;
  };
  const stepNames = ['Reply to Priya Raman', 'Reply to Daniel Okafor', 'Reply to Sofia Lindqvist', 'Reply to Marcus Lee', 'Reply to Hannah Weiss', 'Read: Onboarding flow v4', 'Read: 4 short updates', 'Invitation: weekly sync', 'Invitation: 1:1, new time', 'Later: 3 notifications', 'Archive: 11 routine', 'Unsubscribe: 2 senders'];
  const d2Steps = now => `<div class="steps">
      <div class="list-head"><h1>Review</h1><span class="count num">${now >= stepNames.length ? 'all 12 steps done' : `step ${now + 1} of ${stepNames.length}`}</span></div>
      ${stepNames.map((name, i) => `<div class="step ${i < now ? 'done' : i === now ? 'now' : ''}"><span class="ix num">${i < now ? '✓' : i + 1}</span><span class="grow trunc">${name}</span></div>`).join('')}
      <div class="grow"></div>
      <div style="padding:12px 16px" class="col gap6"><div class="bar"><i style="width:${Math.round(100 * now / stepNames.length)}%"></i></div><span class="faint" style="font-size:11.5px">${now ? `${[0, 1, 2, 3, 4, 5, 6, 10, 11, 12, 15, 26, 28][now]} of 28 conversations done` : 'About 4 minutes'}. ${k('Esc')} leaves the review, progress is kept.</span></div>
    </div>`;
  const flowbar = inner => `<div class="flowbar">${inner}</div>`;
  d2.inbox = () => shell({ badge: 28, body: `<div class="body">${d2Flat()}${prepared('A 12-step review is ready', [
      [5, 'replies, each with a draft to check'],
      [2, 'reading steps: one long thread summarised, four short updates on one screen'],
      [2, 'invitations to accept or decline'],
      [3, 'groups to confirm: Later 3, Archive 11, Unsubscribe 2'],
    ], `<div class="row gap8"><span class="btn primary">Start review ${k('↩')}</span><span class="faint" style="font-size:12px">28 conversations, about 4 minutes. You can stop at any step.</span></div>
        <p>One decision per screen, most urgent first. New mail waits behind a “New mail” button and never reorders the review under your cursor.</p>`)}</div>` });
  d2.thread = () => shell({ badge: 28, body: `<div class="body">${d2Steps(0)}<div class="col grow" style="min-width:0">${reader({ acts: false, sendLabel: 'Send, archive and continue' })}</div></div>`,
    footer: '' });
  d2.agent = () => shell({ badge: 3, body: `<div class="body">${d2Steps(10)}
      <div class="col grow" style="min-width:0">
        <div class="pane" style="padding:22px 28px 0;gap:12px">
          <h2>Archive 11 routine conversations</h2>
          <p>They leave the inbox and stay in All mail. Uncheck anything you want to keep; it becomes its own step.</p>
          <div class="card">${by('clear').map(t => `<div class="cr"><span class="check on">${I.check(11)}</span><b style="width:170px;font-weight:600" class="trunc">${esc(t.from)}</b><span class="grow trunc">${esc(t.subject)} <span class="muted">— ${esc(t.why)}</span></span><span class="faint">${t.kind}</span></div>`).join('')}</div>
        </div>
        <div class="grow" style="background:var(--app)"></div>
        ${flowbar(`<span class="btn primary">Archive 11 and continue ${k('↩')}</span><span class="btn">Open one by one</span><span class="btn ghost">Skip this step ${k('S')}</span><span class="grow"></span><span class="faint" style="font-size:12px">${k('Z')} brings all 11 back</span>`)}
      </div></div>` });
  d2.confirm = () => shell({ badge: 2, body: `<div class="body">${d2Steps(11)}<div class="pane"></div></div>`, overlay: unsubSheet('Unsubscribe and finish review') });
  d2.empty = () => shell({ badge: '', body: `<div class="body">${d2Steps(12)}${doneSummary('Review finished')}</div>` });
  d2.loading = () => shell({ badge: 12, status: 'Fetching inbox, 12 of 28', dot: 'busy', body: `<div class="body">${`<div class="list" style="width:620px">${listHead('Inbox', 'fetching 12 of 28')}${[...by('reply'), ...by('read')].slice(0, 8).map(t => oneLine(t)).join('')}
        <div class="r one"><div class="skel" style="width:120px"></div><div class="skel grow"></div></div><div class="r one"><div class="skel" style="width:90px"></div><div class="skel grow"></div></div><div class="r one"><div class="skel" style="width:140px"></div><div class="skel grow"></div></div></div>`}
      <div class="pane"><h2>Connected</h2><p>You can read and answer what is already here. The review is prepared when the inbox has arrived.</p>
        <div class="card" style="max-width:480px">
          <div class="cr"><span style="color:var(--ok)">${I.check(14)}</span><span class="grow">Connected to alex.morgan@northwind.example</span></div>
          <div class="cr"><span class="dot busy"></span><span class="grow">Fetching inbox</span><span class="faint num">12 of 28</span></div>
          <div class="cr"><span class="dot" style="background:var(--line-strong)"></span><span class="grow muted">Preparing the review</span></div>
          <div class="cr"><span class="dot" style="background:var(--line-strong)"></span><span class="grow muted">Indexing older mail for search</span><span class="faint num">0 of 6,034</span></div>
        </div></div></div>` });
  d2.error = () => shell({ badge: 28, status: 'Model unavailable', dot: 'warn', body: `<div class="body">${d2Steps(0)}<div class="col grow" style="min-width:0">${reader({ acts: false, draft: 'failed', why: false, sendLabel: 'Send, archive and continue', extraFoot: `<span class="btn ghost">Skip this step ${k('S')}</span>` })}</div></div>` });

  // =========================================================================================
  // Direction 3 — Quiet inbox
  // =========================================================================================
  const d3 = {};
  const word = { reply: 'Reply', read: 'Read', event: 'RSVP', later: 'Later', unsub: 'Unsubscribe' };
  const d3List = ({ width = 620, sel = null, handled = 'done', model = true } = {}) => {
    const now = [...by('reply'), ...by('event'), ...by('read'), ...by('later')];
    const handledRow = {
      done: `<div class="sec" style="height:40px">${I.spark(12)}<strong>Handled for you</strong><span class="n num">11</span><span class="muted trunc grow">archived by your rules since yesterday 17:00</span><span class="act">Review ${k('↩')}</span></div>`,
      first: `<div class="sec" style="height:40px">${I.spark(12)}<strong>Automated mail</strong><span class="n num">11</span><span class="muted trunc grow">from 9 senders. Archive it and handle these senders this way from now on?</span><span class="act">Review ${k('↩')}</span></div>`,
    }[handled];
    return `<div class="list" style="width:${width}px">
      ${listHead('Now', handled === 'first' ? '16 need you, 11 automated' : '16 need you', `<span class="faint" style="font-size:12px">${model ? '' : 'Rules only'}</span>`)}
      ${handledRow}
      ${now.map(t => (t.decision === 'reply'
        ? twoLine(t, { sel: sel === t.id, why: model, right: `<span class="chip reply">Reply</span>` })
        : oneLine(t, { sel: sel === t.id, right: t.decision === 'later' ? `<span class="chip agent">${t.when} ${k('↩')}</span>` : t.rsvp ? `<span class="chip reply">RSVP ${k('Y')}</span>` : `<span class="chip">${word[t.decision]}</span>` }))).join('')}
      <div class="r one"><span class="who" style="width:150px;flex:none">2 promotions</span><span class="grow trunc muted">Fieldnote Pro, Loft &amp; Linen — never opened</span><span class="chip danger">Unsubscribe, asks first</span></div>
    </div>`;
  };
  const ledger = first => `<div class="pane" style="gap:12px">
      <div class="row gap8">${I.spark(15)}<h2>${first ? 'Handle these 9 senders automatically?' : 'Handled for you since yesterday 17:00'}</h2></div>
      <p>${first ? 'Their mail would be archived on arrival and listed here. Mail from people, security notices and invitations is never handled automatically.' : 'Archived on arrival by rules you approved. Everything is in All mail and can be brought back.'}</p>
      <div class="card">${by('clear').map(t => `<div class="cr">${first ? `<span class="check on">${I.check(11)}</span>` : ''}<b style="width:160px;font-weight:600" class="trunc">${esc(t.from)}</b><span class="grow trunc">${esc(t.subject)} <span class="muted">— ${esc(t.why)}</span></span><span class="faint">${first ? t.kind : 'Rule: ' + t.kind.toLowerCase()}</span>${first ? '' : '<span class="btn sm ghost">Bring back</span>'}</div>`).join('')}</div>
      <div class="row gap8">${first
        ? `<span class="btn primary">Archive 11 and remember 9 senders ${k('↩')}</span><span class="btn">Archive 11 only this time</span><span class="btn ghost">Keep them in Now</span>`
        : `<span class="btn">Bring all 11 back ${k('Z')}</span><span class="btn ghost">Edit rules for this account</span>`}</div>
      <p class="faint" style="font-size:12px">${first ? 'Rules belong to alex.morgan@northwind.example only. A sender you bring back twice stops being handled automatically.' : 'Brought back 0 of 11 today. A sender you bring back twice stops being handled automatically.'}</p>
    </div>`;
  d3.inbox = () => shell({ badge: 16, body: `<div class="body">${d3List()}${ledger(false)}</div>` });
  d3.thread = () => shell({ badge: 16, body: `<div class="body">${d3List({ width: 440, sel: 'pilot' })}${reader({})}</div>` });
  d3.agent = () => shell({ badge: 27, body: `<div class="body">${d3List({ handled: 'first' })}${ledger(true)}</div>` });
  d3.confirm = () => shell({ badge: 16, body: `<div class="body">${d3List()}${ledger(false)}</div>`, overlay: unsubSheet() });
  d3.empty = () => shell({ badge: '', body: `<div class="body"><div class="list" style="width:620px">${listHead('Now', 'nothing needs you')}
      <div class="sec" style="height:40px">${I.spark(12)}<strong>Handled for you</strong><span class="n num">11</span><span class="muted trunc grow">archived by your rules since yesterday 17:00</span><span class="act">Review ${k('↩')}</span></div>
      <div class="pane" style="background:transparent;padding:40px 24px"><h2>Nothing needs you</h2><p>16 decisions made today. New mail that needs you appears here; the rest is handled and listed above.</p></div></div>
      ${doneSummary()}</div>` });
  d3.loading = () => shell({ badge: 12, status: 'Fetching inbox, 12 of 28', dot: 'busy', body: `<div class="banner agent">${I.spark(13)}<span>Connected. On the first day nothing is archived automatically: rules start only after you approve them.</span><span class="grow"></span><span class="faint">Older mail: 0 of 6,034 indexed</span></div>
      <div class="body"><div class="list" style="width:620px">${listHead('Now', 'fetching 12 of 28')}${[...by('reply'), ...by('event')].map(t => (t.decision === 'reply' ? twoLine(t, { right: '<span class="chip reply">Reply</span>' }) : oneLine(t))).join('')}
        <div class="r one"><div class="skel" style="width:120px"></div><div class="skel grow"></div></div><div class="r one"><div class="skel" style="width:90px"></div><div class="skel grow"></div></div><div class="r one"><div class="skel" style="width:140px"></div><div class="skel grow"></div></div></div>
      <div class="pane"><h2>Getting your inbox</h2><p>Mail from people comes first. Automated mail is grouped below as it arrives and waits for your decision.</p>
        <div style="max-width:420px" class="col gap6"><div class="bar"><i style="width:43%"></i></div><span class="faint" style="font-size:12px">12 of 28 in the inbox.</span></div></div></div>` });
  d3.error = () => shell({ badge: 16, status: 'Model unavailable', dot: 'warn', body: `<div class="banner warn"><span style="color:var(--warn)">${I.warn(14)}</span><span>Couldn't reach the model: no drafts or summaries for now. Your rules keep working and your mail is untouched.</span><span class="grow"></span><span class="btn sm">Retry</span></div>
      <div class="body">${d3List({ width: 440, sel: 'pilot', model: false })}${reader({ draft: 'failed', why: false })}</div>` });

  // ---- shared pieces ------------------------------------------------------------------------
  function unsubSheet(primary = 'Unsubscribe from 2 senders') {
    return `<div class="scrim"><div class="sheet">
      <div class="hd"><h3>Unsubscribe from 2 senders?</h3><div class="muted" style="margin-top:4px;font-size:12.5px">Account: alex.morgan@northwind.example</div></div>
      <div class="notice">This sends a request to each sender and cannot be undone from Dumka Mail.</div>
      <div class="it"><span class="check on">${I.check(11)}</span><div class="grow"><b style="font-weight:600">Fieldnote Pro</b> <span class="muted">offers@fieldnote.example</span><div class="muted">One-click request (List-Unsubscribe). 9 promotions in 30 days, none opened.</div></div></div>
      <div class="it"><span class="check on">${I.check(11)}</span><div class="grow"><b style="font-weight:600">Loft &amp; Linen</b> <span class="muted">hello@loftandlinen.example</span><div class="muted">One-click request (List-Unsubscribe). 6 promotions in 30 days, none opened.</div></div></div>
      <div class="it"><span class="check on">${I.check(11)}</span><div class="grow">Also archive their 2 messages in the inbox <span class="muted">(this part can be undone with ${k('Z')})</span></div></div>
      <div class="ft"><span class="btn ghost">Cancel ${k('Esc')}</span><span class="btn danger">${primary} ${k('⌘', '↩')}</span></div>
    </div></div>`;
  }
  function doneSummary(title = 'What happened in this pass') {
    return `<div class="pane"><h2>${title}</h2>
      <div class="card" style="max-width:600px">
        <div class="cr"><b class="num" style="width:26px;font-size:15px">5</b><span class="grow">replies sent</span><span class="chip warn">1 can still be undone, 6 s</span></div>
        <div class="cr"><b class="num" style="width:26px;font-size:15px">16</b><span class="grow">archived: 11 routine, 5 read</span><span class="btn sm ghost">Undo ${k('Z')}</span></div>
        <div class="cr"><b class="num" style="width:26px;font-size:15px">4</b><span class="grow">come back later: 3 tomorrow 09:00, 1 follow-up Wednesday</span><span class="faint">Later</span></div>
        <div class="cr"><b class="num" style="width:26px;font-size:15px">2</b><span class="grow">senders unsubscribed</span><span class="faint">cannot be undone</span></div>
        <div class="cr"><b class="num" style="width:26px;font-size:15px">2</b><span class="grow">invitations answered: Priya Raman, Daniel Okafor</span></div>
      </div>
      <p>An empty inbox is not the end of the work: 4 conversations are waiting in Later and 5 replies are waiting for an answer.</p>
      <div class="row gap8"><span class="btn">Open Later</span><span class="btn">Open Waiting</span><span class="btn ghost">Activity</span></div></div>`;
  }

  // =========================================================================================
  // Shared screens (the five proposals agree on these)
  // =========================================================================================
  const sh = {};
  sh.firstrun = () => `<div style="width:1440px;height:900px;display:grid;place-items:center;background:var(--app)">
      <div class="col gap16" style="width:440px;text-align:center;align-items:center">
        <div style="width:52px;height:52px;border-radius:14px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center">${I.inbox(26)}</div>
        <h2 style="font-size:24px;margin:0;font-weight:640;letter-spacing:-.3px">Connect your Gmail</h2>
        <p class="muted" style="margin:0;font-size:14px;line-height:1.55">Dumka Mail keeps a copy of your mail on this Mac and sorts it there. Sign in with Google in your browser; your password never reaches the app.</p>
        <span class="btn primary" style="height:38px;padding:0 20px;font-size:14px">Connect Gmail</span>
        <span class="faint" style="font-size:12px">Calendar and an AI model are optional and can be added later.</span>
      </div></div>`;
  sh.firstrunerror = () => `<div style="width:1440px;height:900px;display:grid;place-items:center;background:var(--app)">
      <div class="col gap16" style="width:480px;align-items:flex-start">
        <div class="row gap8" style="color:var(--warn)">${I.warn(18)}<h2 style="font-size:20px;margin:0;font-weight:640;color:var(--t1)">Sign-in could not start</h2></div>
        <p class="muted" style="margin:0;font-size:13.5px;line-height:1.55">This build has no Google sign-in configuration, so the browser window was never opened. Nothing is wrong with your Google account.</p>
        <div class="card" style="width:100%"><div class="cr"><span class="grow muted">Expected file</span><span>~/.config/dumka-mail/google-oauth-client.json</span></div><div class="cr"><span class="grow muted">What to do</span><span>Install a release build, or add the file and retry</span></div></div>
        <div class="row gap8"><span class="btn primary">Retry</span><span class="btn">Open setup guide</span><span class="btn ghost">Copy details</span></div>
      </div></div>`;
  sh.search = () => {
    const hits = [T.pilot, T.doccomment, { ...T.pilot, id: 'x1', from: 'You', subject: 'Pilot plan — draft for review', why: 'Sent 11 Nov', time: '11 Nov', archived: 'Sent' }, { id: 'x2', from: 'Priya Raman', subject: 'Notes on pilot feedback', why: 'Archived, 3 messages', time: '28 Oct' }, { id: 'x3', from: 'Daniel Okafor', subject: 'Decision needed: pilot feedback', why: 'Archived', time: '14 Oct' }, { id: 'x4', from: 'Sofia Lindqvist', subject: 'Follow-up: pilot feedback', why: 'Archived', time: '2 Oct' }];
    return shell({ badge: 28, search: 'pilot', searchFocus: true, status: 'Indexing older mail, 4,200 of 6,034', dot: 'busy', body: `<div class="body"><div class="list" style="width:620px">
      <div class="list-head" style="gap:6px"><span class="chip reply">All mail</span><span class="chip">From</span><span class="chip">Date</span><span class="chip">Has attachment</span><span class="chip">This account</span><span class="grow"></span><span class="count num">23 results</span></div>
      <div class="banner">Older mail is still being indexed (70%). Results before 2 March may be missing.</div>
      ${hits.map((t, i) => oneLine(t, { sel: i === 0, right: `<span class="chip">${i < 2 ? 'Inbox' : t.archived || 'Archived'}</span>` })).join('')}
      </div><div class="pane"><p class="faint">${k('↩')} open ${k('Esc')} closes filters first, then search ${k('⌘', '↩')} search on Gmail if nothing is found here</p></div></div>` });
  };
  sh.settings = () => shell({ nav: 'settings', badge: 28, body: `<div class="body">
      <div class="set-nav">
        <div class="lab">Accounts</div>
        <div class="it on"><span class="rail" style="all:unset"><span class="av work" style="width:20px;height:20px;border-radius:6px;font-size:8px;box-shadow:none;display:grid;place-items:center;background:#4B6FD0;color:#fff;font-weight:650">AM</span></span>alex.morgan@northwind…</div>
        <div class="it"><span style="width:20px;height:20px;border-radius:6px;font-size:8px;display:grid;place-items:center;background:#3F8F7A;color:#fff;font-weight:650">AM</span>alex@morgan-family…</div>
        <div class="it muted">Add account</div>
        <div class="lab">App</div>
        <div class="it">Appearance</div><div class="it">Shortcuts</div><div class="it">AI model</div><div class="it">Privacy and data</div><div class="it">About</div>
      </div>
      <div class="pane" style="gap:14px;padding:22px 32px">
        <div class="row gap12"><h2>alex.morgan@northwind.example</h2><span class="chip ok">Connected</span><span class="grow"></span><span class="btn sm">Reconnect</span><span class="btn sm danger">Disconnect</span></div>
        <p>Settings on this page apply to this account only. Anything you have not changed follows the app defaults.</p>
        <div class="card" style="max-width:820px">
          <div class="set-row"><div class="l"><b>Signature</b><span>Alex Morgan, Head of Rollouts · Northwind</span></div><span class="inherit custom">Customised</span><span class="btn sm">Edit</span></div>
          <div class="set-row"><div class="l"><b>After sending a reply</b><span>Archive the conversation</span></div><span class="inherit">App default</span><div class="select">Archive ${I.chev(12)}</div></div>
          <div class="set-row"><div class="l"><b>Notifications</b><span>Only mail from people</span></div><span class="inherit custom">Customised</span><div class="select">People only ${I.chev(12)}</div></div>
        </div>
        <div class="card" style="max-width:820px">
          <div class="set-row"><div class="l"><b>What the agent may do on its own</b><span>Sort, summarise and draft. It never sends, unsubscribes, answers invitations or deletes.</span></div><span class="inherit">App default</span><div class="select">Prepare only ${I.chev(12)}</div></div>
          <div class="set-row"><div class="l"><b>Mail text may be sent to the model</b><span>Off keeps sorting on this Mac by rules only</span></div><span class="inherit">App default</span><span class="sw on"></span></div>
          <div class="set-row"><div class="l"><b>Sender rules</b><span>9 senders archived on arrival, 2 corrections remembered</span></div><span class="btn sm">Review rules</span></div>
        </div>
        <div class="card" style="max-width:820px">
          <div class="set-row"><div class="l"><b>Calendar</b><span>Needed to answer invitations from the inbox</span></div><span class="btn sm">Connect</span></div>
          <div class="set-row"><div class="l"><b>Advanced</b><span>Follow-up window, indexing, labels</span></div><span class="faint">${I.chev(14)}</span></div>
        </div>
      </div></div>` });

  // ---- route --------------------------------------------------------------------------------
  const [dir, screen] = (location.hash.replace('#', '') || 'd1-inbox').split('-');
  const table = { d1, d2, d3, sh };
  const names = { d1: 'direction 1 · Decision sections', d2: 'direction 2 · Review pass', d3: 'direction 3 · Quiet inbox', sh: 'shared by all directions' };
  const html = (table[dir] && table[dir][screen]) ? table[dir][screen]() : `<div class="pane">Unknown mock ${location.hash}</div>`;
  document.getElementById('root').innerHTML = html + `<div class="tag-corner">Mock · ${names[dir] || ''} · synthetic data</div>`;
  document.title = `${names[dir]} — ${screen}`;
})();
