import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MailMessage, MailThread } from '../shared/types';

// The older background pass (`AgenticService.runBackgroundPass`) prepares
// reply drafts too. Turning the permission off must stop it at every step:
// before mail text is sent, while the model is writing, and before the answer
// is stored.

const ACCOUNT = 'alex.morgan@northwind.example';

const thread = {
  id: 't01',
  accountId: ACCOUNT,
  subject: 'Can we move the pilot to the 24th?',
  snippet: 'Can you confirm by tomorrow?',
  senderNames: ['Priya Raman'],
  senderEmail: 'priya.raman@lumenlabs.example',
  labelIds: ['INBOX', 'UNREAD'],
  lastMessageAt: '2026-11-13T09:00:00.000Z',
} as unknown as MailThread;

const message = {
  id: 'm01',
  threadId: 't01',
  accountId: ACCOUNT,
  senderName: 'Priya Raman',
  senderEmail: 'priya.raman@lumenlabs.example',
  subject: thread.subject,
  snippet: thread.snippet,
  receivedAt: '2026-11-13T09:00:00.000Z',
  labelIds: ['INBOX', 'UNREAD'],
  hasAttachments: false,
  isUnread: true,
  to: [{ name: 'Alex Morgan', email: ACCOUNT }],
  cc: [],
  bcc: [],
  bodyPlain: 'Alex, can we move the pilot to the 24th? Please confirm by tomorrow.',
  bodyHtml: null,
  attachments: [],
  headers: [],
} as unknown as MailMessage;

const mocks = vi.hoisted(() => ({
  settings: { value: '{}' },
  save: vi.fn(),
  completeAI: vi.fn(),
  getAIProviderDescriptor: vi.fn(),
}));

vi.mock('../main/database', () => ({
  SettingsRepo: { get: vi.fn(() => mocks.settings.value) },
  AccountsRepo: { list: vi.fn(() => [{ email: ACCOUNT, displayName: 'Alex Morgan' }]) },
  ThreadsRepo: { get: vi.fn(() => thread), list: vi.fn(() => []), updateLabels: vi.fn() },
  AgentDraftsRepo: { getForMessage: vi.fn(() => null), getReadyForThread: vi.fn(() => null), save: mocks.save, setStatus: vi.fn() },
  DraftsRepo: { list: vi.fn(() => []) },
  MessagesRepo: { countForEmbedding: vi.fn(() => 0), listForEmbedding: vi.fn(() => []) },
  MailEmbeddingsRepo: { indexedHashes: vi.fn(() => new Set()), modelStats: vi.fn(() => []) },
  MessageSecurityRepo: { saveMany: vi.fn(), listForThread: vi.fn(() => []) },
}));
vi.mock('../main/ai', () => ({
  completeAI: mocks.completeAI,
  createEmbeddings: vi.fn(),
  getAIProviderDescriptor: mocks.getAIProviderDescriptor,
}));
vi.mock('../main/gmail', () => ({ GmailSyncService: { sendDraft: vi.fn(), modifyLabels: vi.fn() } }));
vi.mock('../main/databaseWorkerClient', () => ({
  databaseWorkerClient: {
    agentPrepInbox: vi.fn(async () => ({ threads: [thread], decisions: [] })),
    listMessagesForThread: vi.fn(async () => [message]),
    threadSecurityInsights: vi.fn(async () => []),
  },
}));

import { AgenticService } from '../main/agentic';

function setSettings(options: { draftsInAdvance: boolean; backgroundSorting?: boolean; mayReadMail?: boolean }) {
  mocks.settings.value = JSON.stringify({
    ai: {
      provider: 'openAI',
      allowMailBodyContext: true,
      suggestDrafts: true,
      proactiveDraftsEnabled: options.draftsInAdvance,
      backgroundSorting: options.backgroundSorting ?? true,
    },
    accountOverrides: { [ACCOUNT]: { modelMayReadMail: options.mayReadMail ?? true } },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

const descriptor = { preference: 'openAI', model: 'chosen-model', displayName: 'OpenAI', status: 'Configured' };

describe('older background pass: reply drafts in advance', () => {
  beforeEach(() => {
    mocks.save.mockReset();
    mocks.completeAI.mockReset();
    mocks.getAIProviderDescriptor.mockReset();
    mocks.getAIProviderDescriptor.mockResolvedValue(descriptor);
    mocks.completeAI.mockResolvedValue({ text: 'Thanks, the 24th works for me.' });
    setSettings({ draftsInAdvance: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prepares a draft when everything is allowed', async () => {
    await AgenticService.runBackgroundPass();
    expect(mocks.completeAI).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['background sorting', { draftsInAdvance: true, backgroundSorting: false }],
    ['drafts in advance', { draftsInAdvance: false }],
    ['mail access', { draftsInAdvance: true, mayReadMail: false }],
  ])('sends nothing when %s is turned off while the provider is being looked up', async (_label, next) => {
    const lookup = deferred<typeof descriptor>();
    mocks.getAIProviderDescriptor.mockReturnValue(lookup.promise);
    const pass = AgenticService.runBackgroundPass();
    await vi.waitFor(() => expect(mocks.getAIProviderDescriptor).toHaveBeenCalledTimes(1));
    setSettings(next);
    lookup.resolve(descriptor);
    await pass;
    expect(mocks.completeAI).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('cancels the request and keeps nothing when it is turned off while the model is writing', async () => {
    let signal: AbortSignal | undefined;
    const answer = deferred<{ text: string }>();
    mocks.completeAI.mockImplementation((_request, _preference, _model, options: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return answer.promise;
    });
    const pass = AgenticService.runBackgroundPass();
    await vi.waitFor(() => expect(mocks.completeAI).toHaveBeenCalledTimes(1));
    expect(signal?.aborted).toBe(false);

    setSettings({ draftsInAdvance: true, backgroundSorting: false });
    AgenticService.cancelDisallowedBackgroundDrafts();
    expect(signal?.aborted).toBe(true);

    // Even if the provider answers after the cancel, the draft is not stored.
    answer.resolve({ text: 'Thanks, the 24th works for me.' });
    await pass;
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('leaves a request alone while it is still allowed', async () => {
    let signal: AbortSignal | undefined;
    const answer = deferred<{ text: string }>();
    mocks.completeAI.mockImplementation((_request, _preference, _model, options: { signal?: AbortSignal }) => {
      signal = options?.signal;
      return answer.promise;
    });
    const pass = AgenticService.runBackgroundPass();
    await vi.waitFor(() => expect(mocks.completeAI).toHaveBeenCalledTimes(1));
    AgenticService.cancelDisallowedBackgroundDrafts();
    expect(signal?.aborted).toBe(false);
    answer.resolve({ text: 'Thanks, the 24th works for me.' });
    await pass;
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
});
