// Agent preparation rules (main/agentPrepCore.ts) with injected fakes: no
// database, no worker, no provider and no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentPrepService, type AgentPrepDeps, type TextCompletionRequest } from '../main/agentPrepCore';
import { ModelRequestError } from '../main/modelErrors';
import type { TextPrompt } from '../shared/agentPrompts';
import type { AIProviderDescriptor, MailMessage, MailThread, ThreadDecisionRecord } from '../shared/types';

const ACCOUNT = 'alex.morgan@northwind.example';
const BASE_TIME = Date.parse('2026-10-10T12:00:00.000Z');

function personThread(index: number): MailThread {
  const id = `t${String(index).padStart(2, '0')}`;
  return {
    id,
    accountId: ACCOUNT,
    subject: `Question ${index}`,
    snippet: 'Could you look at this?',
    lastMessageAt: new Date(BASE_TIME - index * 60_000).toISOString(),
    senderNames: [`Person ${index}`],
    senderEmail: `person${index}@lumenlabs.example`,
    to: [],
    cc: [],
    labelIds: ['INBOX', 'CATEGORY_PERSONAL'],
    hasAttachments: false,
    isUnread: true,
    signals: {
      hasCalendarInvite: false,
      inviteNeedsAnswer: false,
      hasListUnsubscribe: false,
      hasOneClickUnsubscribe: false,
      listId: null,
      isBulk: false,
      isAutoSubmitted: false,
      fromUser: false,
      lastMessageId: `${id}-m1`,
    },
  };
}

function messageFor(thread: MailThread, index = 1): MailMessage {
  return {
    id: `${thread.id}-m${index}`,
    threadId: thread.id,
    accountId: ACCOUNT,
    senderName: thread.senderNames[0],
    senderEmail: thread.senderEmail,
    subject: thread.subject,
    snippet: thread.snippet,
    receivedAt: new Date(Date.parse(thread.lastMessageAt) - (2 - index) * 1000).toISOString(),
    labelIds: thread.labelIds,
    hasAttachments: false,
    isUnread: true,
    to: [],
    cc: [],
    bcc: [],
    bodyPlain: 'Secret body text of the message.',
    bodyHtml: null,
    attachments: [],
    headers: [],
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function abortError(): Error {
  return Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });
}

type Completion = (prompt: TextPrompt, options: TextCompletionRequest) => Promise<{ text: string; model: string; provider: string }>;

interface Harness {
  deps: AgentPrepDeps;
  completions: { prompt: TextPrompt; options: TextCompletionRequest }[];
  upserts: ThreadDecisionRecord[][];
  published: { channel: string; payload: unknown }[];
  setCompletion(next: Completion): void;
  setMayReadMail(value: boolean): void;
  decisions: ThreadDecisionRecord[];
}

function harness(threads: MailThread[] = Array.from({ length: 30 }, (_, index) => personThread(index))): Harness {
  let mayRead = true;
  let completion: Completion = async () => ({ text: '{"items":[]}', model: 'test-model', provider: 'openAI' });
  const completions: Harness['completions'] = [];
  const upserts: ThreadDecisionRecord[][] = [];
  const published: Harness['published'] = [];
  const decisions: ThreadDecisionRecord[] = [];
  let idCounter = 0;
  const byId = new Map(threads.map(thread => [thread.id, thread]));
  const deps: AgentPrepDeps = {
    readSettings: () => ({ ai: { provider: 'openAI' }, accountOverrides: { [ACCOUNT]: { modelMayReadMail: mayRead } } }),
    listAccounts: () => [{ email: ACCOUNT, displayName: 'Alex Morgan' }],
    inboxSnapshot: async (_accountId, limit) => ({ threads: threads.slice(0, limit), decisions: [...decisions] }),
    listMessagesForThread: async (_accountId, threadId) => {
      const thread = byId.get(threadId);
      return thread ? [messageFor(thread, 0), messageFor(thread, 1)] : [];
    },
    getThread: (_accountId, threadId) => byId.get(threadId) || null,
    upsertDecisions: records => {
      upserts.push(records);
      decisions.push(...records);
    },
    getAgentDraftForMessage: () => null,
    saveAgentDraft: () => undefined,
    hasAgentDraftForMessage: () => false,
    userDraftThreadIds: () => new Set(),
    getSummary: () => null,
    saveSummary: () => undefined,
    metadataContext: async (_accountId, threadId) => `METADATA ONLY for ${threadId}`,
    buildChatPrompt: request => ({ system: 'chat', user: `${request.context}\n${request.userInstruction}` }),
    resolveTextProvider: async () => ({ preference: 'openAI', model: 'test-model', status: 'Configured' } as unknown as AIProviderDescriptor),
    completeText: (prompt, options) => {
      completions.push({ prompt, options });
      return completion(prompt, options);
    },
    publish: (channel, payload) => { published.push({ channel, payload }); },
    logWarning: () => undefined,
    newId: () => `id-${++idCounter}`,
    now: () => new Date(BASE_TIME),
  };
  return {
    deps,
    completions,
    upserts,
    published,
    decisions,
    setCompletion: next => { completion = next; },
    setMayReadMail: value => { mayRead = value; },
  };
}

/** A valid decision answer for every thread id in the prompt. */
function answerAll(decision = 'read'): Completion {
  return async prompt => {
    const ids = Array.from(new Set(prompt.user.match(/t\d\d(?=")/g) || []));
    return {
      text: JSON.stringify({ items: ids.map(threadId => ({ threadId, decision, reason: 'Fine', laterAt: null })) }),
      model: 'test-model',
      provider: 'openAI',
    };
  };
}

function threadIdsIn(prompt: TextPrompt): string[] {
  return Array.from(new Set(prompt.user.match(/t\d\d(?=")/g) || [])).sort();
}

const services: ReturnType<typeof createAgentPrepService>[] = [];
function service(h: Harness) {
  const created = createAgentPrepService(h.deps);
  services.push(created);
  return created;
}

afterEach(() => {
  for (const created of services.splice(0)) created.dispose();
});

describe('agent prep: gates', () => {
  it('requests nothing when the account does not let the model read mail', async () => {
    const h = harness();
    h.setMayReadMail(false);
    const prep = service(h);
    expect(await prep.runAccountNow(ACCOUNT)).toBe(0);
    expect(await prep.requestThreadSummary(ACCOUNT, 't00', 'req-1')).toEqual({ status: 'skipped' });
    expect(await prep.requestAgentDraft(ACCOUNT, 't00', 'req-2')).toEqual({ status: 'skipped' });
    expect(h.completions).toHaveLength(0);
  });

  it('strips mail text from the chat context on the main side', async () => {
    const h = harness();
    h.setCompletion(async () => ({ text: 'Answer', model: 'test-model', provider: 'openAI' }));
    const prep = service(h);
    const request = { action: 'chat', context: 'Body: Secret body text', conversationHistory: [], userInstruction: 'What is this?' };

    h.setMayReadMail(false);
    await prep.streamChat('chat-1', { accountId: ACCOUNT, threadId: 't03' }, request, 'openAI');
    expect(h.completions[0].prompt.user).toContain('METADATA ONLY for t03');
    expect(h.completions[0].prompt.user).not.toContain('Secret body text');

    h.setMayReadMail(true);
    await prep.streamChat('chat-2', { accountId: ACCOUNT, threadId: 't03' }, request, 'openAI');
    expect(h.completions[1].prompt.user).toContain('Secret body text');
  });
});

describe('agent prep: one pass per account', () => {
  it('runs a single pass at a time and folds a concurrent trigger into it', async () => {
    const h = harness();
    const gate = deferred<void>();
    const answer = answerAll();
    h.setCompletion(async (prompt, options) => {
      await gate.promise;
      return answer(prompt, options);
    });
    const prep = service(h);
    const first = prep.runAccountNow(ACCOUNT, 'sync');
    await vi.waitFor(() => expect(h.completions).toHaveLength(1));
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(0);
    expect(h.completions).toHaveLength(1);
    gate.resolve();
    expect(await first).toBeGreaterThan(0);
    // Every request of that pass ran one after the other, never two at once.
    expect(h.upserts.length).toBeGreaterThan(0);
  });

  it('cancelAccount aborts the pass in flight and forgets nothing it did not finish', async () => {
    const h = harness();
    h.setCompletion((_prompt, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
    }));
    const prep = service(h);
    const pass = prep.runAccountNow(ACCOUNT, 'sync');
    await vi.waitFor(() => expect(h.completions).toHaveLength(1));
    prep.cancelAccount(ACCOUNT.toUpperCase());
    expect(h.completions[0].options.signal?.aborted).toBe(true);
    await pass;
    expect(h.upserts).toHaveLength(0);
    expect(prep.getModelStatus()).not.toBe('unreachable');

    // The cancelled batch was not remembered: the next pass asks for it again.
    h.setCompletion(answerAll());
    await prep.runAccountNow(ACCOUNT, 'sync');
    expect(threadIdsIn(h.completions[1].prompt)).toEqual(threadIdsIn(h.completions[0].prompt));
  });
});

describe('agent prep: failed decision batches', () => {
  it('remembers a twice-unusable batch and proceeds with the next one', async () => {
    const h = harness();
    h.setCompletion(async () => ({ text: 'Sorry, I cannot help with that.', model: 'test-model', provider: 'openAI' }));
    const prep = service(h);
    const requests = await prep.runAccountNow(ACCOUNT, 'sync');
    // Three batches (12 + 12 + 6 threads), two attempts each.
    expect(requests).toBe(6);
    const batches = [0, 2, 4].map(index => threadIdsIn(h.completions[index].prompt));
    expect(batches.map(batch => batch.length)).toEqual([12, 12, 6]);
    expect(new Set(batches.flat()).size).toBe(30);
    expect(threadIdsIn(h.completions[1].prompt)).toEqual(batches[0]);
    // An unusable answer is not "unreachable".
    expect(prep.getModelStatus()).not.toBe('unreachable');
    // All remembered for the session: nothing is asked again.
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(0);
  });

  it('stores the next batch when only the first one fails', async () => {
    const h = harness();
    let calls = 0;
    const answer = answerAll();
    h.setCompletion(async (prompt, options) => {
      calls += 1;
      if (calls <= 2) throw new ModelRequestError('empty', 'openAI', 'Empty response.');
      return answer(prompt, options);
    });
    const prep = service(h);
    await prep.runAccountNow(ACCOUNT, 'sync');
    expect(h.upserts.flat().map(record => record.threadId).sort()).toEqual(
      [...threadIdsIn(h.completions[2].prompt), ...threadIdsIn(h.completions[3].prompt)].sort(),
    );
    expect(h.upserts.flat()).toHaveLength(18);
    expect(prep.getModelStatus()).toBe('ok');
  });

  it.each([
    ['network', new ModelRequestError('network', 'openAI', 'fetch failed')],
    ['timeout', new ModelRequestError('timeout', 'openAI', 'timed out')],
    ['HTTP 503', new ModelRequestError('http', 'openAI', 'HTTP 503', 503)],
  ])('marks the model unreachable on a %s failure and keeps the batch for later', async (_label, error) => {
    const h = harness();
    h.setCompletion(async () => { throw error; });
    const prep = service(h);
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(1);
    expect(prep.getModelStatus()).toBe('unreachable');
    expect(h.published).toContainEqual({ channel: 'api:modelStatusChanged', payload: 'unreachable' });

    // Not remembered: a manual retry asks for the same threads.
    h.setCompletion(answerAll());
    await prep.runAccountNow(ACCOUNT, 'manual');
    expect(threadIdsIn(h.completions[1].prompt)).toEqual(threadIdsIn(h.completions[0].prompt));
    expect(prep.getModelStatus()).toBe('ok');
  });

  it('does not report invalid or empty answers as unreachable', async () => {
    for (const error of [new ModelRequestError('invalid', 'openAI', 'bad'), new ModelRequestError('empty', 'openAI', 'empty')]) {
      const h = harness();
      h.setCompletion(async () => { throw error; });
      const prep = service(h);
      await prep.runAccountNow(ACCOUNT, 'sync');
      expect(prep.getModelStatus()).not.toBe('unreachable');
      expect(h.published.some(event => event.payload === 'unreachable')).toBe(false);
    }
  });
});

describe('agent prep: shared requests', () => {
  it('keeps a joined summary running when one caller cancels', async () => {
    const h = harness([personThread(0)]);
    const gate = deferred<void>();
    h.setCompletion(async (_prompt, options) => {
      options.onDelta?.('- First');
      await gate.promise;
      if (options.signal?.aborted) throw abortError();
      return { text: '- First point\n- Second point', model: 'test-model', provider: 'openAI' };
    });
    // Long enough to summarise.
    h.deps.listMessagesForThread = async () => Array.from({ length: 6 }, (_, index) => messageFor(personThread(0), index));
    const prep = service(h);

    const first = prep.requestThreadSummary(ACCOUNT, 't00', 'req-a');
    await vi.waitFor(() => expect(h.completions).toHaveLength(1));
    const second = prep.requestThreadSummary(ACCOUNT, 't00', 'req-b');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.completions).toHaveLength(1);
    // The late joiner gets the text streamed so far.
    expect(h.published).toContainEqual({ channel: 'api:aiStream', payload: { requestId: 'req-b', delta: '- First', done: false } });

    prep.cancelRequest('req-a');
    expect(await first).toEqual({ status: 'cancelled' });
    expect(h.completions[0].options.signal?.aborted).toBe(false);

    gate.resolve();
    expect(await second).toMatchObject({ status: 'ready', bullets: ['First point', 'Second point'] });
  });

  it('aborts the shared request once every caller has cancelled', async () => {
    const h = harness([personThread(0)]);
    h.setCompletion((_prompt, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
    }));
    const prep = service(h);
    const first = prep.requestAgentDraft(ACCOUNT, 't00', 'req-a');
    await vi.waitFor(() => expect(h.completions).toHaveLength(1));
    const second = prep.requestAgentDraft(ACCOUNT, 't00', 'req-b');
    await new Promise(resolve => setTimeout(resolve, 0));
    prep.cancelRequest('req-a');
    expect(h.completions[0].options.signal?.aborted).toBe(false);
    prep.cancelRequest('req-b');
    expect(h.completions[0].options.signal?.aborted).toBe(true);
    expect(await first).toEqual({ status: 'cancelled' });
    expect(await second).toEqual({ status: 'cancelled' });
  });

  it('does not remember a cancelled background draft as attempted', async () => {
    const thread = personThread(0);
    const h = harness([thread]);
    // The thread already has a model `reply` decision, so the pass goes straight to drafts.
    h.decisions.push({
      accountId: ACCOUNT, threadId: thread.id, lastMessageId: thread.signals!.lastMessageId, decision: 'reply',
      reason: 'Asks a question', source: 'model', laterAt: null, model: 'test-model', createdAt: new Date(BASE_TIME).toISOString(),
    });
    h.setCompletion((_prompt, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
    }));
    const prep = service(h);
    const pass = prep.runAccountNow(ACCOUNT, 'sync');
    await vi.waitFor(() => expect(h.completions).toHaveLength(1));
    expect(h.completions[0].prompt.system).toMatch(/reply/i);
    prep.cancelAccount(ACCOUNT);
    await pass;

    h.setCompletion(async () => ({ text: 'Thanks, the 24th works for me.', model: 'test-model', provider: 'openAI' }));
    await prep.runAccountNow(ACCOUNT, 'sync');
    expect(h.completions).toHaveLength(2);
    expect(h.published.some(event => event.channel === 'api:agentDraftReady')).toBe(true);
  });

  it('starts a fresh request when a caller arrives after everyone left an aborted one', async () => {
    const h = harness([personThread(0)]);
    const settle = deferred<void>();
    let call = 0;
    h.setCompletion(async (_prompt, options) => {
      call += 1;
      if (call === 1) {
        // The aborted request settles late, so it is still registered when B arrives.
        await new Promise<void>(resolve => options.signal?.addEventListener('abort', () => resolve(), { once: true }));
        await settle.promise;
        throw abortError();
      }
      return { text: 'Thanks, the 24th works for me.', model: 'test-model', provider: 'openAI' };
    });
    const prep = service(h);
    const first = prep.requestAgentDraft(ACCOUNT, 't00', 'req-a');
    await vi.waitFor(() => expect(h.completions).toHaveLength(1));
    prep.cancelRequest('req-a');
    expect(await first).toEqual({ status: 'cancelled' });

    const second = prep.requestAgentDraft(ACCOUNT, 't00', 'req-b');
    await vi.waitFor(() => expect(h.completions).toHaveLength(2));
    expect(await second).toMatchObject({ status: 'ready', bodyPlain: 'Thanks, the 24th works for me.' });
    settle.resolve();
  });
});

describe('agent prep: reconnect', () => {
  it('forgets what a removed account attempted, so a reconnect prepares again', async () => {
    const h = harness();
    h.setCompletion(async () => ({ text: 'not json', model: 'test-model', provider: 'openAI' }));
    const prep = service(h);
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(6);
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(0);

    prep.cancelAccount(ACCOUNT);
    h.setCompletion(answerAll());
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(3);
    expect(h.upserts.flat()).toHaveLength(30);
  });
});
