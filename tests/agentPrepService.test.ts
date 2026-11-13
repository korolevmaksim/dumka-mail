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
  /** Replaces the stored `ai` settings on top of `{ provider: 'openAI' }`. */
  setAI(next: Record<string, unknown>): void;
  resolved: { preference: string; overrideModel?: string }[];
  decisions: ThreadDecisionRecord[];
}

/** Background sorting and drafts in advance switched on: what most tests below exercise. */
const BACKGROUND_ON = { backgroundSorting: true, proactiveDraftsEnabled: true };

function harness(threads: MailThread[] = Array.from({ length: 30 }, (_, index) => personThread(index))): Harness {
  let mayRead = true;
  let ai: Record<string, unknown> = BACKGROUND_ON;
  const resolved: Harness['resolved'] = [];
  let completion: Completion = async () => ({ text: '{"items":[]}', model: 'test-model', provider: 'openAI' });
  const completions: Harness['completions'] = [];
  const upserts: ThreadDecisionRecord[][] = [];
  const published: Harness['published'] = [];
  const decisions: ThreadDecisionRecord[] = [];
  let idCounter = 0;
  const byId = new Map(threads.map(thread => [thread.id, thread]));
  const deps: AgentPrepDeps = {
    readSettings: () => ({ ai: { provider: 'openAI', ...ai }, accountOverrides: { [ACCOUNT]: { modelMayReadMail: mayRead } } }),
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
    resolveTextProvider: async (preference, overrideModel) => {
      resolved.push({ preference, overrideModel });
      return { preference, model: overrideModel || 'test-model', status: 'Configured' } as unknown as AIProviderDescriptor;
    },
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
    setAI: next => { ai = next; },
    resolved,
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

  it('does no background work until background sorting is turned on', async () => {
    const h = harness();
    h.setAI({});
    h.setCompletion(answerAll());
    const prep = service(h);
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(0);
    expect(await prep.runAccountNow(ACCOUNT, 'manual')).toBe(0);
    expect(h.completions).toHaveLength(0);
    expect(h.upserts).toHaveLength(0);

    // What the user asks for still works.
    h.setCompletion(async () => ({ text: 'Thanks, the 24th works for me.', model: 'test-model', provider: 'openAI' }));
    expect(await prep.requestAgentDraft(ACCOUNT, 't00', 'req-1')).toMatchObject({ status: 'ready' });
    expect(h.completions).toHaveLength(1);

    h.setAI({ backgroundSorting: true });
    h.setCompletion(answerAll());
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBeGreaterThan(0);
  });

  it('an account can keep background sorting off while the app default is on', async () => {
    const h = harness();
    h.deps.readSettings = () => ({
      ai: { provider: 'openAI', backgroundSorting: true },
      accountOverrides: { [ACCOUNT]: { modelMayReadMail: true, backgroundSorting: false } },
    });
    h.setCompletion(answerAll());
    expect(await service(h).runAccountNow(ACCOUNT, 'sync')).toBe(0);
    expect(h.completions).toHaveLength(0);
  });

  it('sorts in the background without preparing drafts unless drafts in advance are on', async () => {
    const thread = personThread(0);
    const h = harness([thread]);
    h.decisions.push({
      accountId: ACCOUNT, threadId: thread.id, lastMessageId: thread.signals!.lastMessageId, decision: 'reply',
      reason: 'Asks a question', source: 'model', laterAt: null, model: 'test-model', createdAt: new Date(BASE_TIME).toISOString(),
    });
    h.setAI({ backgroundSorting: true });
    h.setCompletion(async () => ({ text: 'Thanks, the 24th works for me.', model: 'test-model', provider: 'openAI' }));
    const prep = service(h);
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(0);
    expect(h.published.some(event => event.channel === 'api:agentDraftReady')).toBe(false);

    // Drafts in advance alone are not enough either: they need background sorting.
    h.setAI({ proactiveDraftsEnabled: true });
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(0);

    h.setAI(BACKGROUND_ON);
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(1);
    expect(h.published.some(event => event.channel === 'api:agentDraftReady')).toBe(true);
  });

  it('discards an in-flight answer and stops the pass when background sorting is turned off', async () => {
    const h = harness();
    h.setCompletion(async (prompt, options) => {
      h.setAI({});
      return answerAll()(prompt, options);
    });
    expect(await service(h).runAccountNow(ACCOUNT, 'sync')).toBe(1);
    expect(h.upserts).toHaveLength(0);
  });

  it('runs background work on its own provider and model, and chat on the main one', async () => {
    const h = harness();
    h.setAI({ ...BACKGROUND_ON, globalDefaultModel: 'main-model', automationProvider: 'gemini', automationModel: 'small-model' });
    h.setCompletion(answerAll());
    const prep = service(h);
    await prep.runAccountNow(ACCOUNT, 'sync');
    expect(h.completions[0].options).toMatchObject({ preference: 'gemini', overrideModel: 'small-model' });

    h.setCompletion(async () => ({ text: 'Thanks, the 24th works for me.', model: 'main-model', provider: 'openAI' }));
    await prep.requestAgentDraft(ACCOUNT, 't29', 'req-1');
    expect(h.completions[h.completions.length - 1].options).toMatchObject({ preference: 'openAI', overrideModel: 'main-model' });
  });

  it('never borrows the main model id for a different background provider', async () => {
    const h = harness();
    h.setAI({ ...BACKGROUND_ON, globalDefaultModel: 'main-model', automationProvider: 'deepSeek', automationModel: '  ' });
    h.setCompletion(answerAll());
    await service(h).runAccountNow(ACCOUNT, 'sync');
    expect(h.completions[0].options.preference).toBe('deepSeek');
    expect(h.completions[0].options.overrideModel).toBeUndefined();
  });

  it('a background provider that is not set up leaves the main model status alone', async () => {
    const h = harness();
    h.setAI({ ...BACKGROUND_ON, automationProvider: 'gemini' });
    const resolve = h.deps.resolveTextProvider;
    h.deps.resolveTextProvider = async (preference, overrideModel) => (preference === 'gemini' ? null : resolve(preference, overrideModel));
    const prep = service(h);
    await prep.requestThreadSummary(ACCOUNT, 't00', 'req-1');
    expect(prep.getModelStatus()).toBe('ok');
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(0);
    expect(prep.getModelStatus()).toBe('ok');
  });

  it('a failing background provider backs off without reporting the main model as unreachable', async () => {
    const h = harness();
    h.setAI({ ...BACKGROUND_ON, automationProvider: 'openAICompatible', automationModel: 'local-small' });
    h.setCompletion(async (_prompt, options) => {
      if (options.preference === 'openAICompatible') throw new ModelRequestError('network', 'openAICompatible', 'connect ECONNREFUSED');
      return { text: 'Thanks, the 24th works for me.', model: 'main-model', provider: 'openAI' };
    });
    const prep = service(h);
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(1);
    expect(prep.getModelStatus()).not.toBe('unreachable');
    expect(h.published.some(event => event.payload === 'unreachable')).toBe(false);
    // Backed off: the next sync does not hammer the dead server…
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBe(0);
    // …a manual retry does try again, and what the user asks for still works.
    expect(await prep.runAccountNow(ACCOUNT, 'manual')).toBe(1);
    expect(await prep.requestAgentDraft(ACCOUNT, 't00', 'req-1')).toMatchObject({ status: 'ready' });
  });

  it('a working background provider does not make a missing main model look set up', async () => {
    const h = harness();
    h.setAI({ ...BACKGROUND_ON, automationProvider: 'gemini', automationModel: 'small-model' });
    const resolve = h.deps.resolveTextProvider;
    h.deps.resolveTextProvider = async (preference, overrideModel) => (preference === 'gemini' ? resolve(preference, overrideModel) : null);
    h.setCompletion(answerAll());
    const prep = service(h);
    expect(await prep.runAccountNow(ACCOUNT, 'sync')).toBeGreaterThan(0);
    expect(prep.getModelStatus()).toBe('none');
  });

  it('turning background sorting off stops the pass in flight and applies nothing from it', async () => {
    const h = harness();
    const gate = deferred<void>();
    h.setCompletion(async (prompt, options) => {
      await Promise.race([
        gate.promise,
        new Promise((_resolve, reject) => options.signal?.addEventListener('abort', () => reject(abortError()), { once: true })),
      ]);
      return answerAll()(prompt, options);
    });
    const prep = service(h);
    const pass = prep.runAccountNow(ACCOUNT, 'sync');
    await vi.waitFor(() => expect(h.completions).toHaveLength(1));
    h.setAI({});
    prep.onConfigChanged();
    gate.resolve();
    await pass;
    expect(h.upserts).toHaveLength(0);
    expect(h.completions).toHaveLength(1);
    expect(prep.getModelStatus()).not.toBe('unreachable');
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

  it('a retry clears "unreachable" when the pending work goes to a dedicated background provider', async () => {
    const h = harness();
    h.setAI({ ...BACKGROUND_ON, automationProvider: 'openAICompatible', automationModel: 'local-small' });
    const sortAll = answerAll();
    let mainDown = true;
    h.setCompletion(async (prompt, options) => {
      if (options.preference === 'openAICompatible') return sortAll(prompt, options);
      if (mainDown) throw new ModelRequestError('http', 'openAI', 'HTTP 503', 503);
      return { text: 'Thanks, the 24th works for me.', model: 'main-model', provider: 'openAI' };
    });
    const prep = service(h);
    // The model the person asks fails once: it is shown as not answering.
    await prep.requestAgentDraft(ACCOUNT, 't00', 'req-1');
    expect(prep.getModelStatus()).toBe('unreachable');

    // Retry: the pending sorting is done by the background provider and succeeds.
    // Nothing showed the main model failing again, so the status must not stay stuck.
    mainDown = false;
    await prep.retry();
    await vi.waitFor(() => expect(prep.getModelStatus()).toBe('ok'));
    expect(h.upserts.flat().length).toBeGreaterThan(0);
  });

  it('a retry keeps "unreachable" when the model itself fails again', async () => {
    const h = harness();
    h.setCompletion(async () => { throw new ModelRequestError('http', 'openAI', 'HTTP 503', 503); });
    const prep = service(h);
    await prep.runAccountNow(ACCOUNT, 'sync');
    expect(prep.getModelStatus()).toBe('unreachable');
    await prep.retry();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(prep.getModelStatus()).toBe('unreachable');
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

  /** One thread that already has a model `reply` decision, so a pass goes straight to drafts. */
  function draftReadyHarness() {
    const thread = personThread(0);
    const h = harness([thread]);
    h.decisions.push({
      accountId: ACCOUNT, threadId: thread.id, lastMessageId: thread.signals!.lastMessageId, decision: 'reply',
      reason: 'Asks a question', source: 'model', laterAt: null, model: 'test-model', createdAt: new Date(BASE_TIME).toISOString(),
    });
    return { h, thread };
  }

  it('sends no mail to the model when drafts in advance are turned off while the thread is being read', async () => {
    const { h, thread } = draftReadyHarness();
    const read = deferred<void>();
    const listMessages = h.deps.listMessagesForThread;
    h.deps.listMessagesForThread = async (accountId, threadId) => {
      await read.promise;
      return listMessages(accountId, threadId);
    };
    const prep = service(h);
    const pass = prep.runAccountNow(ACCOUNT, 'sync');
    await new Promise(resolve => setTimeout(resolve, 10));
    // Sorting stays on; only drafts in advance are switched off.
    h.setAI({ backgroundSorting: true, proactiveDraftsEnabled: false });
    prep.onConfigChanged();
    read.resolve();
    await pass;
    expect(h.completions).toHaveLength(0);

    // Not remembered as attempted: turning it back on prepares the draft.
    h.setAI(BACKGROUND_ON);
    h.setCompletion(async () => ({ text: 'Thanks, the 24th works for me.', model: 'test-model', provider: 'openAI' }));
    await prep.runAccountNow(ACCOUNT, 'sync');
    expect(h.completions).toHaveLength(1);
    expect(threadIdsIn(h.completions[0].prompt)).toEqual([]);
    expect(h.published.some(event => event.channel === 'api:agentDraftReady' && (event.payload as { threadId: string }).threadId === thread.id)).toBe(true);
  });

  it('cancels a background draft being written when drafts in advance are turned off, and keeps nothing from it', async () => {
    const { h } = draftReadyHarness();
    const saved: unknown[] = [];
    h.deps.saveAgentDraft = draft => { saved.push(draft); };
    let aborted = false;
    h.setCompletion((_prompt, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => { aborted = true; reject(abortError()); }, { once: true });
    }));
    const prep = service(h);
    const pass = prep.runAccountNow(ACCOUNT, 'sync');
    await vi.waitFor(() => expect(h.completions).toHaveLength(1));
    h.setAI({ backgroundSorting: true, proactiveDraftsEnabled: false });
    prep.onConfigChanged();
    await pass;
    expect(aborted).toBe(true);
    expect(saved).toHaveLength(0);
    expect(prep.getModelStatus()).not.toBe('unreachable');
  });

  it('a draft the person asks for does not join a background draft on another provider', async () => {
    const { h, thread } = draftReadyHarness();
    h.setAI({ ...BACKGROUND_ON, automationProvider: 'openAICompatible', automationModel: 'local-small' });
    const background = deferred<{ text: string; model: string; provider: string }>();
    h.setCompletion(async (_prompt, options) => {
      if (options.preference === 'openAICompatible') return background.promise;
      return { text: 'Thanks, the 24th works for me.', model: 'main-model', provider: 'openAI' };
    });
    const prep = service(h);
    const pass = prep.runAccountNow(ACCOUNT, 'sync');
    await vi.waitFor(() => expect(h.completions).toHaveLength(1));
    expect(h.completions[0].options.preference).toBe('openAICompatible');

    // The person presses Draft a reply while the background one is still running.
    const asked = await prep.requestAgentDraft(ACCOUNT, thread.id, 'req-1');
    expect(asked).toMatchObject({ status: 'ready' });
    expect(h.completions).toHaveLength(2);
    expect(h.completions[1].options.preference).toBe('openAI');

    // The background provider then fails: that is not the main model failing.
    background.reject(new ModelRequestError('network', 'openAICompatible', 'connect ECONNREFUSED'));
    await pass;
    expect(prep.getModelStatus()).not.toBe('unreachable');
    expect(h.published.some(event => event.payload === 'unreachable')).toBe(false);
  });

  it('sends no thread text for a summary when mail access is withdrawn while the thread is being read', async () => {
    const h = harness([personThread(0)]);
    const read = deferred<void>();
    h.deps.listMessagesForThread = async () => {
      await read.promise;
      return Array.from({ length: 6 }, (_, index) => messageFor(personThread(0), index));
    };
    const prep = service(h);
    const summary = prep.requestThreadSummary(ACCOUNT, 't00', 'req-1');
    await new Promise(resolve => setTimeout(resolve, 10));
    h.setMayReadMail(false);
    prep.onConfigChanged();
    read.resolve();
    expect(await summary).toMatchObject({ status: 'cancelled' });
    expect(h.completions).toHaveLength(0);
  });

  it('cancels a summary being written when mail access is withdrawn, and stores nothing', async () => {
    const h = harness([personThread(0)]);
    h.deps.listMessagesForThread = async () => Array.from({ length: 6 }, (_, index) => messageFor(personThread(0), index));
    const stored: unknown[] = [];
    h.deps.saveSummary = summary => { stored.push(summary); };
    let aborted = false;
    h.setCompletion((_prompt, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => { aborted = true; reject(abortError()); }, { once: true });
    }));
    const prep = service(h);
    const summary = prep.requestThreadSummary(ACCOUNT, 't00', 'req-1');
    await vi.waitFor(() => expect(h.completions).toHaveLength(1));
    h.setMayReadMail(false);
    prep.onConfigChanged();
    expect(await summary).toMatchObject({ status: 'cancelled' });
    expect(aborted).toBe(true);
    expect(stored).toHaveLength(0);
    expect(prep.getModelStatus()).not.toBe('unreachable');
  });

  it('a draft picked up in advance by the reader runs on the background route, not the main model', async () => {
    const { h, thread } = draftReadyHarness();
    h.setAI({ ...BACKGROUND_ON, globalDefaultModel: 'main-model', automationProvider: 'openAICompatible', automationModel: 'local-small' });
    h.setCompletion(async () => ({ text: 'Thanks, the 24th works for me.', model: 'local-small', provider: 'openAICompatible' }));
    const prep = service(h);
    expect(await prep.requestAgentDraft(ACCOUNT, thread.id, 'req-1', 'automation')).toMatchObject({ status: 'ready' });
    expect(h.completions).toHaveLength(1);
    expect(h.completions[0].options).toMatchObject({ preference: 'openAICompatible', overrideModel: 'local-small' });
  });

  it('a failed draft in advance on the background provider does not mark the main model unreachable', async () => {
    const { h, thread } = draftReadyHarness();
    h.setAI({ ...BACKGROUND_ON, automationProvider: 'openAICompatible', automationModel: 'local-small' });
    h.setCompletion(async () => { throw new ModelRequestError('network', 'openAICompatible', 'connect ECONNREFUSED'); });
    const prep = service(h);
    expect(await prep.requestAgentDraft(ACCOUNT, thread.id, 'req-1', 'automation')).toMatchObject({ status: 'error' });
    expect(prep.getModelStatus()).not.toBe('unreachable');
    expect(h.published.some(event => event.payload === 'unreachable')).toBe(false);
  });

  it('does not prepare a draft in advance for the reader when drafts in advance are off', async () => {
    const { h, thread } = draftReadyHarness();
    h.setAI({ backgroundSorting: true, proactiveDraftsEnabled: false });
    const prep = service(h);
    expect(await prep.requestAgentDraft(ACCOUNT, thread.id, 'req-1', 'automation')).toMatchObject({ status: 'skipped' });
    expect(h.completions).toHaveLength(0);
    // Asked for by the person: still written, on the main model.
    h.setCompletion(async () => ({ text: 'Thanks, the 24th works for me.', model: 'test-model', provider: 'openAI' }));
    expect(await prep.requestAgentDraft(ACCOUNT, thread.id, 'req-2')).toMatchObject({ status: 'ready' });
    expect(h.completions[0].options.preference).toBe('openAI');
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

describe('agent prep: OpenAI Decisions sorting', () => {
  const settings = { backgroundSorting: true, proactiveDraftsEnabled: false,
    sortingEngine: 'openAIDecisions', decisionsModel: 'selected-decision-model', decisionsMinConfidence: 0.8 };

  it('routes sorting to Decisions while leaving the text model unused', async () => {
    const h = harness([personThread(0)]);
    h.setAI({ ...settings, provider: 'anthropic' });
    h.deps.completeDecisions = vi.fn<NonNullable<AgentPrepDeps['completeDecisions']>>(async (items, _now, options) => ({ valid: true, model: options.model,
      items: items.map(item => ({ threadId: item.threadId, decision: 'reply', reason: 'Needs a reply', laterAt: null })) }));
    await service(h).runAccountNow(ACCOUNT);
    expect(h.deps.completeDecisions).toHaveBeenCalledOnce();
    expect(h.completions).toHaveLength(0);
    expect(h.resolved).toContainEqual({ preference: 'openAI', overrideModel: settings.decisionsModel });
    expect(h.upserts[0][0]).toMatchObject({ decision: 'reply', model: `openAIDecisions:0.8:${settings.decisionsModel}` });
  });

  it('does nothing without an explicitly selected Decisions model', async () => {
    const h = harness([personThread(0)]);
    h.setAI({ ...settings, decisionsModel: '' });
    h.deps.completeDecisions = vi.fn<NonNullable<AgentPrepDeps['completeDecisions']>>();
    expect(await service(h).runAccountNow(ACCOUNT)).toBe(0);
    expect(h.deps.completeDecisions).not.toHaveBeenCalled();
    expect(h.completions).toHaveLength(0);
  });

  it('caches uncertain results under the local category without charging again after restart', async () => {
    const h = harness([personThread(0)]);
    h.setAI(settings);
    h.deps.completeDecisions = vi.fn<NonNullable<AgentPrepDeps['completeDecisions']>>(async () => ({ valid: true, items: [], model: settings.decisionsModel }));
    await service(h).runAccountNow(ACCOUNT);
    expect(h.upserts[0][0].decision).toBe('people');
    await service(h).runAccountNow(ACCOUNT);
    expect(h.deps.completeDecisions).toHaveBeenCalledOnce();
    // A changed model invalidates the previous model's cache.
    h.setAI({ ...settings, decisionsModel: 'another-selected-model' });
    await service(h).runAccountNow(ACCOUNT);
    expect(h.deps.completeDecisions).toHaveBeenCalledTimes(2);
  });

  it('keeps user corrections out of the model work list', async () => {
    const thread = personThread(0);
    const h = harness([thread]); h.setAI(settings);
    h.decisions.push({ accountId: ACCOUNT, threadId: thread.id, lastMessageId: `${thread.id}-m1`,
      decision: 'read', reason: 'Already handled', source: 'user', model: null, laterAt: null, createdAt: new Date(BASE_TIME).toISOString() });
    h.deps.completeDecisions = vi.fn<NonNullable<AgentPrepDeps['completeDecisions']>>();
    await service(h).runAccountNow(ACCOUNT);
    expect(h.deps.completeDecisions).not.toHaveBeenCalled();
  });

  it('discards answers when permission is withdrawn or the selected model changes mid-request', async () => {
    for (const withdraw of [true, false]) {
      const h = harness([personThread(0)]); h.setAI(settings);
      h.deps.completeDecisions = vi.fn<NonNullable<AgentPrepDeps['completeDecisions']>>(async () => {
        if (withdraw) h.setMayReadMail(false);
        else h.setAI({ ...settings, decisionsModel: 'another-selected-model' });
        return { valid: true, model: settings.decisionsModel,
          items: [{ threadId: 't00', decision: 'reply', reason: 'Needs a reply', laterAt: null }] };
      });
      await service(h).runAccountNow(ACCOUNT);
      expect(h.upserts).toHaveLength(0);
    }
  });

  it('cancels an in-flight Decisions request on a configuration change', async () => {
    const h = harness([personThread(0)]); h.setAI(settings);
    const started = deferred<AbortSignal>();
    h.deps.completeDecisions = vi.fn<NonNullable<AgentPrepDeps['completeDecisions']>>((_items, _now, options) => new Promise<Awaited<ReturnType<NonNullable<AgentPrepDeps['completeDecisions']>>>>((_resolve, reject) => {
      started.resolve(options.signal);
      options.signal.addEventListener('abort', () => reject(abortError()));
    }));
    const prep = service(h);
    const pending = prep.runAccountNow(ACCOUNT);
    const signal = await started.promise;
    h.setAI({ ...settings, decisionsModel: 'another-selected-model' });
    prep.onConfigChanged();
    expect(signal.aborted).toBe(true);
    await pending;
    expect(h.upserts).toHaveLength(0);
  });
});
