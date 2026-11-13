// In-process fake of the Google + AI HTTP surface used by Dumka Mail's main process.
// It replaces globalThis.fetch, so the app never talks to a real network: every
// URL that is not explicitly faked here fails like an offline request.
'use strict';

const fs = require('fs');
const path = require('path');
const { buildMailboxes, WORK, HOME, nextHistoryId, materialize, MIN } = require('./dataset.cjs');
const { aiReply } = require('./fake-ai.cjs');

function createBackend({ logDir, now = Date.now(), workBulk, homeBulk, bigInbox }) {
  const mailboxes = buildMailboxes(now, { workBulk, homeBulk, bigInbox });
  const tokens = new Map(); // access/refresh token -> email
  const state = {
    offline: false,
    latencyMs: 40,
    aiLatencyMs: 900,
    failGmailStatus: 0, // e.g. 500 to simulate a Gmail outage
    revokeAccounts: new Set(), // emails whose refresh token is rejected
    aiFail: false,
    grantCalendar: true,
    requestCount: 0,
    blocked: [],
  };
  const log = (file, entry) => {
    try { fs.appendFileSync(path.join(logDir, file), `${JSON.stringify(entry)}\n`); } catch { /* ignore */ }
  };

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const networkError = url => {
    const error = new TypeError('fetch failed');
    error.cause = Object.assign(new Error(`getaddrinfo ENOTFOUND ${new URL(url).hostname}`), { code: 'ENOTFOUND' });
    return error;
  };

  const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'];
  const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
  const grantedScopes = () => [...GMAIL_SCOPES, ...(state.grantCalendar ? CALENDAR_SCOPES : [])].join(' ');

  /** A plausible working week around today, all `.example` people. */
  function syntheticEvents(email) {
    const work = email === 'alex.morgan@northwind.example';
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const at = (offsetDays, hour, minute = 0) => new Date(day.getTime() + offsetDays * 86400000 + hour * 3600000 + minute * 60000).toISOString();
    const dateOnly = offsetDays => new Date(day.getTime() + offsetDays * 86400000 + 12 * 3600000).toISOString().slice(0, 10);
    const me = { email, self: true, responseStatus: 'accepted' };
    const person = (name, email, responseStatus = 'accepted') => ({ displayName: name, email, responseStatus });
    const timed = (id, summary, offset, startHour, startMinute, minutes, attendees = [], extra = {}) => ({
      id, status: 'confirmed', summary, htmlLink: `https://calendar.synthetic.example/${id}`,
      start: { dateTime: at(offset, startHour, startMinute), timeZone: 'Europe/Berlin' },
      end: { dateTime: new Date(Date.parse(at(offset, startHour, startMinute)) + minutes * 60000).toISOString(), timeZone: 'Europe/Berlin' },
      organizer: { email: me.email, self: true }, attendees: attendees.length ? [me, ...attendees] : undefined,
      created: at(-10, 9), updated: at(-1, 9), ...extra,
    });
    // Each account has its own calendar: the personal one only carries private plans.
    if (!work) {
      return [
        timed('ev-dentist', 'Dentist', 5, 8, 30, 45),
        timed('ev-bookclub', 'Book club', 2, 19, 0, 120, [person('Leo Fischer', 'leo.fischer@postbox.example')]),
        timed('ev-lake', 'Weekend: lake with Mara', 2, 10, 0, 240),
      ];
    }
    return [
      timed('ev-standup', 'Rollouts stand-up', 0, 9, 30, 15, [person('Daniel Okafor', 'daniel.okafor@northwind.example'), person('Nora Petrov', 'nora.petrov@northwind.example')]),
      timed('ev-focus', 'Focus: board deck numbers', 0, 10, 30, 90),
      timed('ev-lumen', 'Lumen Labs weekly sync', 0, 14, 0, 45, [person('Priya Raman', 'priya.raman@lumenlabs.example')], { location: 'Video call', description: 'Pilot status, open risks, next steps.' }),
      timed('ev-1on1', '1:1 Daniel / Alex', 1, 11, 0, 30, [person('Daniel Okafor', 'daniel.okafor@northwind.example')]),
      timed('ev-interview', 'Interview loop: Jamie Chen', 1, 14, 0, 60, [person('Marcus Lee', 'marcus.lee@northwind.example', 'needsAction')]),
      timed('ev-contract', 'Contract redlines review', 2, 16, 0, 45, [person('Sofia Lindqvist', 'sofia@harborpine.example', 'tentative')]),
      timed('ev-design', 'Onboarding flow v4 walkthrough', -1, 15, 0, 60, [person('Yuki Tanaka', 'yuki.tanaka@northwind.example')]),
      timed('ev-board', 'Board deck dry run', 3, 13, 0, 90, [person('Daniel Okafor', 'daniel.okafor@northwind.example'), person('Nora Petrov', 'nora.petrov@northwind.example')]),
      { id: 'ev-freeze', status: 'confirmed', summary: 'Deploy freeze', start: { date: dateOnly(1) }, end: { date: dateOnly(4) }, organizer: { email: me.email, self: true }, created: at(-10, 9), updated: at(-1, 9) },
    ];
  }

  function handleCalendar(url, init) {
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body && typeof init.body === 'string' ? safeJson(init.body) : {};
    log('calendar-requests.jsonl', { at: new Date().toISOString(), method, path: url.pathname, body });
    if (url.pathname.endsWith('/users/me/calendarList')) {
      return json({ items: [{ id: 'primary', summary: mailboxes[emailForAuth(init)]?.profile?.name || 'Calendar', primary: true, accessRole: 'owner', selected: true, backgroundColor: emailForAuth(init) === 'alex.morgan@northwind.example' ? '#4986e7' : '#d06b64', foregroundColor: '#ffffff', timeZone: 'Europe/Berlin' }], nextSyncToken: 'cl-1' });
    }
    if (url.pathname.endsWith('/freeBusy')) return json({ calendars: {} });
    if (method === 'GET' && /\/events$/.test(url.pathname)) {
      // A first (full) listing gets the synthetic week; incremental syncs have nothing new.
      const items = url.searchParams.get('syncToken') ? [] : syntheticEvents(emailForAuth(init));
      return json({ items, nextSyncToken: 'ev-1', timeZone: 'Europe/Berlin' });
    }
    if (method === 'GET') return json({ error: { code: 404, message: 'Not Found' } }, 404);
    return json({ id: 'synthetic-event', status: 'confirmed', ...body });
  }

  const emailForAuth = init => {
    const headers = init?.headers || {};
    const raw = headers.Authorization || headers.authorization || '';
    const token = String(raw).replace(/^Bearer\s+/i, '');
    return tokens.get(token) || null;
  };

  const threadLabels = thread => new Set(thread.messages.flatMap(m => m.labelIds));
  const lastDate = thread => Number(thread.messages[thread.messages.length - 1].internalDate);

  function listThreads(box, query, maxResults, pageToken) {
    const q = (query || '').toLowerCase();
    let threads = Array.from(box.threads.values());
    if (q.includes('rfc822msgid')) threads = [];
    else if (q.includes('in:inbox')) threads = threads.filter(t => threadLabels(t).has('INBOX'));
    else if (q.includes('in:sent')) threads = threads.filter(t => threadLabels(t).has('SENT'));
    else threads = threads.filter(t => !threadLabels(t).has('TRASH') && !threadLabels(t).has('SPAM'));
    threads.sort((a, b) => lastDate(b) - lastDate(a));
    const offset = pageToken ? Number(pageToken) : 0;
    const page = threads.slice(offset, offset + maxResults);
    const next = offset + maxResults < threads.length ? String(offset + maxResults) : undefined;
    return {
      threads: page.map(t => ({ id: t.id, snippet: t.messages[t.messages.length - 1].snippet, historyId: t.historyId })),
      ...(next ? { nextPageToken: next } : {}),
      resultSizeEstimate: threads.length,
    };
  }

  function recordHistory(box, thread, kind) {
    const id = nextHistoryId();
    thread.historyId = id;
    thread.messages.forEach(m => { m.historyId = id; });
    box.history.push({ id, [kind]: [{ message: { id: thread.messages[thread.messages.length - 1].id, threadId: thread.id } }] });
    return id;
  }

  async function handleGmail(url, init) {
    const email = emailForAuth(init);
    if (!email) return json({ error: { code: 401, message: 'Invalid Credentials', status: 'UNAUTHENTICATED' } }, 401);
    if (state.failGmailStatus) return json({ error: { code: state.failGmailStatus, message: 'Backend Error' } }, state.failGmailStatus);
    const box = mailboxes[email];
    const p = url.pathname.replace('/gmail/v1/users/me', '');
    const method = (init?.method || 'GET').toUpperCase();
    const body = init?.body && typeof init.body === 'string' ? safeJson(init.body) : {};

    if (p === '/labels' && method === 'GET') return json({ labels: box.labels });
    if (p === '/labels' && method === 'POST') {
      const label = { id: `Label_${box.labels.length + 1}`, name: body.name, type: 'user', messageListVisibility: 'show', labelListVisibility: 'labelShow' };
      box.labels.push(label);
      return json(label);
    }
    if (p.startsWith('/labels/')) return json({});
    if (p === '/settings/sendAs') {
      return json({ sendAs: [{ sendAsEmail: email, isDefault: true, isPrimary: true, displayName: box.profile.name, signature: box.signature }] });
    }
    if (p === '/profile') return json({ emailAddress: email, messagesTotal: 0, threadsTotal: box.threads.size, historyId: box.history.at(-1)?.id || '500000' });
    if (p === '/history') {
      const start = BigInt(url.searchParams.get('startHistoryId') || '0');
      const history = box.history.filter(h => BigInt(h.id) > start);
      const latest = Array.from(box.threads.values()).reduce((max, t) => (BigInt(t.historyId) > max ? BigInt(t.historyId) : max), start);
      return json({ ...(history.length ? { history } : {}), historyId: String(latest) });
    }
    if (p === '/threads' && method === 'GET') {
      return json(listThreads(box, url.searchParams.get('q') || '', Number(url.searchParams.get('maxResults') || 100), url.searchParams.get('pageToken')));
    }
    const threadMatch = p.match(/^\/threads\/([^/]+)(\/(modify|trash|untrash))?$/);
    if (threadMatch) {
      const thread = box.threads.get(threadMatch[1]);
      if (!thread) return json({ error: { code: 404, message: 'Requested entity was not found.' } }, 404);
      const op = threadMatch[3];
      if (!op) return json({ id: thread.id, historyId: thread.historyId, messages: thread.messages });
      if (op === 'modify') {
        const add = body.addLabelIds || [];
        const remove = new Set(body.removeLabelIds || []);
        thread.messages.forEach(m => { m.labelIds = Array.from(new Set([...m.labelIds.filter(l => !remove.has(l)), ...add])); });
        recordHistory(box, thread, add.length ? 'labelsAdded' : 'labelsRemoved');
      } else if (op === 'trash') {
        thread.messages.forEach(m => { m.labelIds = Array.from(new Set([...m.labelIds.filter(l => l !== 'INBOX'), 'TRASH'])); });
        recordHistory(box, thread, 'labelsAdded');
      } else {
        thread.messages.forEach(m => { m.labelIds = m.labelIds.filter(l => l !== 'TRASH'); });
        recordHistory(box, thread, 'labelsRemoved');
      }
      return json({ id: thread.id, historyId: thread.historyId, messages: thread.messages });
    }
    if (p === '/messages' && method === 'GET') return json({ resultSizeEstimate: 0 });
    if (p === '/messages/send') {
      log('sent-mail.jsonl', { at: new Date().toISOString(), email, threadId: body.threadId || null, rawBytes: (body.raw || '').length });
      const id = `sent${Date.now().toString(16)}`;
      return json({ id, threadId: body.threadId || id, labelIds: ['SENT'] });
    }
    const attMatch = p.match(/^\/messages\/([^/]+)\/attachments\/(.+)$/);
    if (attMatch) return json({ size: 64, data: Buffer.from('%PDF-1.4 synthetic attachment for the design review').toString('base64url') });
    if (p.startsWith('/messages/')) return json({ error: { code: 404, message: 'Not Found' } }, 404);
    log('unhandled.jsonl', { url: String(url), method });
    return json({});
  }

  function safeJson(text) { try { return JSON.parse(text); } catch { return {}; } }

  async function fakeFetch(input, init) {
    const href = typeof input === 'string' ? input : input?.url || String(input);
    const url = new URL(href);
    state.requestCount += 1;
    if (state.offline) throw networkError(href);

    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
      await sleep(state.latencyMs);
      const params = new URLSearchParams(String(init?.body || ''));
      if (params.get('grant_type') === 'authorization_code') {
        const email = params.get('code');
        if (!mailboxes[email]) return json({ error: 'invalid_grant' }, 400);
        const refresh = `fake-refresh-${email}`;
        const access = `fake-access-${email}`;
        tokens.set(refresh, email); tokens.set(access, email);
        return json({ access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'Bearer', scope: grantedScopes() });
      }
      const refresh = params.get('refresh_token') || '';
      const email = refresh.replace('fake-refresh-', '');
      if (!mailboxes[email] || state.revokeAccounts.has(email)) {
        return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
      }
      const access = `fake-access-${email}`;
      tokens.set(access, email);
      return json({ access_token: access, expires_in: 3600, token_type: 'Bearer' });
    }
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/revoke') return json({});
    if (url.hostname === 'www.googleapis.com' && url.pathname === '/oauth2/v2/userinfo') {
      const email = emailForAuth(init);
      if (!email) return json({ error: 'unauthorized' }, 401);
      return json({ email, name: mailboxes[email].profile.name, verified_email: true });
    }
    if (url.hostname === 'www.googleapis.com' && url.pathname.startsWith('/calendar/v3/')) {
      await sleep(state.latencyMs);
      if (!emailForAuth(init)) return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401);
      return handleCalendar(url, init);
    }
    if (url.hostname === 'gmail.googleapis.com') {
      await sleep(state.latencyMs);
      return handleGmail(url, init);
    }
    if (url.hostname === 'ai.synthetic.example') {
      const body = safeJson(String(init?.body || '{}'));
      log('ai-requests.jsonl', { at: new Date().toISOString(), url: href, body });
      await sleep(state.aiLatencyMs);
      if (state.aiFail) return json({ error: { message: 'The model is overloaded. Please retry.' } }, 503);
      if (url.pathname.endsWith('/models')) {
        return json({ data: [{ id: 'synthetic-mail-model' }, { id: 'synthetic-mail-small' }, { id: 'synthetic-embedding' }] });
      }
      const content = aiReply(body, { mailboxes, now });
      return json({ id: 'chatcmpl-synthetic', object: 'chat.completion', model: body.model || 'synthetic-mail-model',
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 1200, completion_tokens: 220, total_tokens: 1420 } });
    }
    // Model list only (for the settings picker); OpenAI completions are not faked.
    if (url.hostname === 'api.openai.com' && url.pathname === '/v1/models') {
      await sleep(state.aiLatencyMs);
      if (state.aiFail) return json({ error: { message: 'The model is overloaded. Please retry.' } }, 503);
      return json({ data: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-4.1', 'gpt-audio', 'gpt-realtime-2.1', 'gpt-image-2']
        .map(id => ({ id, object: 'model' })) });
    }
    if (url.hostname === 'links.example') {
      log('unsubscribe-requests.jsonl', { at: new Date().toISOString(), url: href, method: init?.method || 'GET' });
      await sleep(state.latencyMs);
      return new Response('ok', { status: 200 });
    }
    state.blocked.push(href);
    log('blocked-requests.jsonl', { at: new Date().toISOString(), url: href });
    throw networkError(href);
  }

  /** Adds a brand-new inbound message so the next incremental sync delivers it. */
  function injectMail(email, spec) {
    const box = mailboxes[email];
    const account = email === WORK.email ? WORK : HOME;
    const made = materialize(account, [spec], Date.now(), `n${Date.now().toString(16)}`);
    for (const [id, thread] of made) {
      box.threads.set(id, thread);
      recordHistory(box, thread, 'messagesAdded');
    }
    return Array.from(made.keys());
  }

  return { fakeFetch, state, mailboxes, injectMail, MIN };
}

module.exports = { createBackend };
