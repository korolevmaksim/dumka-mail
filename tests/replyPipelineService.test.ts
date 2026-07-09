import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Draft, MailMessage, MailThread, ReplyPipelineState } from '../shared/types';

const harness = vi.hoisted(() => ({
  current: null as ReplyPipelineState | null,
  draft: null as Draft | null,
  settings: {} as Record<string, unknown>,
  messages: [] as MailMessage[],
  savedDrafts: [] as Draft[],
  savedStates: [] as ReplyPipelineState[],
  saveError: null as Error | null,
  completeAI: vi.fn(),
  descriptor: vi.fn(),
}));

vi.mock('../main/database', () => ({
  DraftsRepo: {
    get: vi.fn((id: string) => harness.draft?.id === id ? harness.draft : null),
    save: vi.fn((draft: Draft) => { harness.draft = draft; harness.savedDrafts.push(draft); }),
  },
  MessagesRepo: { listForThread: vi.fn(() => harness.messages) },
  ReplyPipelineRepo: {
    get: vi.fn(() => harness.current),
    list: vi.fn(() => harness.current ? [harness.current] : []),
    findByDraftId: vi.fn((accountId: string, id: string) => (
      harness.current?.accountId === accountId && harness.current?.draftId === id ? harness.current : null
    )),
    save: vi.fn((state: ReplyPipelineState) => {
      if (harness.saveError) throw harness.saveError;
      harness.current = state;
      harness.savedStates.push(state);
    }),
  },
  SettingsRepo: { get: vi.fn(() => JSON.stringify(harness.settings)) },
  ThreadsRepo: { get: vi.fn(() => thread()) },
}));

vi.mock('../main/ai', () => ({
  completeAI: harness.completeAI,
  getAIProviderDescriptor: harness.descriptor,
}));

vi.mock('../shared/aiContext', () => ({ buildThreadContext: vi.fn(() => 'thread context') }));

import { ReplyPipelineService } from '../main/replyPipelineService';

function thread(): MailThread {
  return {
    id: 'thread-1',
    accountId: 'me@example.com',
    subject: 'Question',
    snippet: 'Can you review this?',
    lastMessageAt: '2026-07-09T09:00:00.000Z',
    senderNames: ['Ada'],
    senderEmail: 'ada@example.com',
    labelIds: ['INBOX', 'UNREAD'],
    hasAttachments: false,
    isUnread: true,
  };
}

function message(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    id: 'message-1',
    threadId: 'thread-1',
    accountId: 'me@example.com',
    senderName: 'Ada',
    senderEmail: 'ada@example.com',
    subject: 'Question',
    snippet: 'Can you review this?',
    receivedAt: '2026-07-09T09:00:00.000Z',
    labelIds: ['INBOX', 'UNREAD'],
    hasAttachments: false,
    isUnread: true,
    to: [{ name: '', email: 'me@example.com' }],
    cc: [],
    bcc: [],
    bodyPlain: 'Can you review this?',
    bodyHtml: null,
    attachments: [],
    ...overrides,
  };
}

function state(overrides: Partial<ReplyPipelineState> = {}): ReplyPipelineState {
  return {
    accountId: 'me@example.com',
    threadId: 'thread-1',
    sourceMessageId: 'message-1',
    sourceReceivedAt: '2026-07-09T09:00:00.000Z',
    sourceKind: 'inbound',
    status: 'needsReply',
    resumeStatus: null,
    draftId: null,
    draftOrigin: null,
    hasPlaceholders: false,
    waitingSince: null,
    dueAt: null,
    snoozedUntil: null,
    reason: 'Direct request needs a reply.',
    priority: 90,
    resolvedAt: null,
    createdAt: '2026-07-09T09:01:00.000Z',
    updatedAt: '2026-07-09T09:01:00.000Z',
    ...overrides,
  };
}

function existingDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: 'draft-1',
    accountId: 'me@example.com',
    threadId: 'thread-1',
    to: [{ name: 'Ada', email: 'ada@example.com' }],
    cc: [],
    bcc: [],
    subject: 'Re: Question',
    bodyPlain: 'My edited answer',
    bodyHtml: '<p>My edited answer</p>',
    attachments: [],
    updatedAt: '2026-07-09T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  harness.current = state();
  harness.draft = null;
  harness.messages = [message()];
  harness.savedDrafts.length = 0;
  harness.savedStates.length = 0;
  harness.saveError = null;
  harness.completeAI.mockReset();
  harness.descriptor.mockReset();
  harness.settings = {
    inbox: { followUpThresholdHours: 48 },
    ai: {
      provider: 'automatic',
      globalDefaultModel: '',
      automationModel: '',
      proactiveDraftsEnabled: false,
      suggestDrafts: true,
      allowMailBodyContext: true,
    },
  };
});

describe('ReplyPipelineService', () => {
  it('stores a normal deterministic draft when automation is not opted in', async () => {
    const result = await ReplyPipelineService.prepareDraft('me@example.com', 'thread-1');
    expect(harness.completeAI).not.toHaveBeenCalled();
    expect(harness.savedDrafts).toHaveLength(1);
    expect(result.state).toMatchObject({ status: 'draftReady', draftId: result.draft.id, draftOrigin: 'template' });
    expect(result.state.hasPlaceholders).toBe(true);
    expect(result.placeholders).toContain('[Add your reply here]');
  });

  it('uses the automation model only after opt-in and saves the generated body as a normal draft', async () => {
    harness.settings = {
      ...harness.settings,
      ai: {
        ...(harness.settings.ai as object),
        proactiveDraftsEnabled: true,
        automationModel: 'automation-model',
      },
    };
    harness.descriptor.mockResolvedValue({ preference: 'openAI', model: 'automation-model' });
    harness.completeAI.mockResolvedValue({ text: 'Thanks, I will review this today.' });

    const result = await ReplyPipelineService.prepareDraft('me@example.com', 'thread-1');
    expect(harness.completeAI).toHaveBeenCalledWith(expect.any(Object), 'automatic', 'automation-model');
    expect(result.state.draftOrigin).toBe('automation');
    expect(result.state.hasPlaceholders).toBe(false);
    expect(result.draft.bodyPlain).toContain('Thanks, I will review this today.');
  });

  it('falls back deterministically when the automation provider fails', async () => {
    harness.settings = {
      ...harness.settings,
      ai: { ...(harness.settings.ai as object), proactiveDraftsEnabled: true, automationModel: 'automation-model' },
    };
    harness.descriptor.mockRejectedValue(new Error('provider unavailable'));
    const result = await ReplyPipelineService.prepareDraft('me@example.com', 'thread-1');
    expect(result.state.draftOrigin).toBe('template');
    expect(result.placeholders).toContain('[Add your reply here]');
  });

  it('returns an existing linked draft without overwriting user edits or calling AI', async () => {
    harness.draft = existingDraft();
    harness.current = state({ status: 'draftReady', draftId: harness.draft.id, draftOrigin: 'automation', hasPlaceholders: true });
    const result = await ReplyPipelineService.prepareDraft('me@example.com', 'thread-1');
    expect(result.draft.bodyPlain).toBe('My edited answer');
    expect(result.state.hasPlaceholders).toBe(false);
    expect(harness.savedDrafts).toHaveLength(0);
    expect(harness.completeAI).not.toHaveBeenCalled();
  });

  it('persists placeholder state as an ordinary linked draft is edited and rechecked', () => {
    harness.current = state({ status: 'draftReady', draftId: 'draft-1', draftOrigin: 'template' });
    const flagged = ReplyPipelineService.refreshDraftPlaceholders(
      'me@example.com',
      'draft-1',
      'I can meet during [availability]. Use [meeting link].',
    );
    expect(flagged?.hasPlaceholders).toBe(true);

    const cleared = ReplyPipelineService.refreshDraftPlaceholders(
      'me@example.com',
      'draft-1',
      'I can meet Tuesday at 10:00. Use https://meet.example.com/abc.',
    );
    expect(cleared?.hasPlaceholders).toBe(false);
  });

  it('does not create an orphan draft for a non-draftable lifecycle state', async () => {
    harness.current = state({
      status: 'waitingOnThem',
      sourceKind: 'outbound',
      waitingSince: '2026-07-09T12:00:00.000Z',
      dueAt: '2026-07-11T12:00:00.000Z',
    });
    await expect(ReplyPipelineService.prepareDraft('me@example.com', 'thread-1')).rejects.toThrow(
      'Reply Pipeline item is already waitingOnThem.',
    );
    expect(harness.savedDrafts).toHaveLength(0);
  });

  it('does not reopen a linked draft after the lifecycle was suppressed', async () => {
    harness.draft = existingDraft();
    harness.current = state({
      status: 'suppressed',
      draftId: harness.draft.id,
      draftOrigin: 'template',
    });
    await expect(ReplyPipelineService.prepareDraft('me@example.com', 'thread-1')).rejects.toThrow(
      'Reply Pipeline item is already suppressed.',
    );
    expect(harness.savedDrafts).toHaveLength(0);
  });

  it('prepares a due follow-up from the newest outbound message, not the old inbound anchor', async () => {
    harness.current = state({
      sourceMessageId: 'old-inbound',
      sourceReceivedAt: '2026-07-09T09:00:00.000Z',
      sourceKind: 'outbound',
      status: 'due',
      waitingSince: '2026-07-09T10:00:00.000Z',
      dueAt: '2026-07-11T10:00:00.000Z',
    });
    harness.messages = [
      message({ id: 'old-inbound' }),
      message({
        id: 'sent-newest',
        senderName: 'Me',
        senderEmail: 'me@example.com',
        receivedAt: '2026-07-09T10:00:00.000Z',
        labelIds: ['SENT'],
        to: [{ name: 'Grace', email: 'grace@example.com' }],
        rfcMessageId: '<sent-newest@example.com>',
      }),
    ];

    const result = await ReplyPipelineService.prepareDraft('me@example.com', 'thread-1');
    expect(result.draft.to).toEqual([{ name: 'Grace', email: 'grace@example.com' }]);
    expect(result.draft.replyMessageId).toBe('<sent-newest@example.com>');
    expect(result.draft.bodyPlain).toContain('Following up on this.');
  });

  it('advances only a confirmed linked send to waitingOnThem', () => {
    harness.current = state({ status: 'draftReady', draftId: 'draft-1', draftOrigin: 'template' });
    const sent = ReplyPipelineService.markSentByDraft('me@example.com', 'draft-1', new Date('2026-07-09T12:00:00.000Z'));
    expect(sent).toMatchObject({
      status: 'waitingOnThem',
      waitingSince: '2026-07-09T12:00:00.000Z',
      dueAt: '2026-07-11T12:00:00.000Z',
    });
    expect(ReplyPipelineService.markSentByDraft('me@example.com', 'unrelated-draft')).toBeNull();
    expect(ReplyPipelineService.markSentByDraft('other@example.com', 'draft-1')).toBeNull();
  });

  it('keeps post-send lifecycle persistence best-effort', () => {
    harness.current = state({ status: 'draftReady', draftId: 'draft-1', draftOrigin: 'template' });
    harness.saveError = new Error('sqlite busy');
    const logger = { error: vi.fn() };
    expect(ReplyPipelineService.markSentByDraftBestEffort(
      'me@example.com',
      'draft-1',
      new Date('2026-07-09T12:00:00.000Z'),
      logger,
    )).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      '[Reply Pipeline] Failed to update lifecycle after confirmed send:',
      harness.saveError,
    );
  });

  it('resolves waiting work only for a newer inbound message', () => {
    harness.current = state({
      status: 'waitingOnThem',
      waitingSince: '2026-07-09T12:00:00.000Z',
      dueAt: '2026-07-11T12:00:00.000Z',
    });
    ReplyPipelineService.processNewMessages([message({ id: 'old', receivedAt: '2026-07-09T11:59:00.000Z' })]);
    expect(harness.current?.status).toBe('waitingOnThem');
    ReplyPipelineService.processNewMessages([message({ id: 'reply', receivedAt: '2026-07-09T12:01:00.000Z' })]);
    expect(harness.current?.status).toBe('resolved');
  });

  it('repairs lifecycle state from a newer synced outbound message after a missed post-send write', () => {
    harness.current = state({ status: 'draftReady', draftId: 'draft-1', draftOrigin: 'template' });
    ReplyPipelineService.processNewMessages([message({
      id: 'sent-message',
      senderName: 'Me',
      senderEmail: 'me@example.com',
      receivedAt: '2026-07-09T12:00:00.000Z',
      labelIds: ['SENT'],
    })]);
    expect(harness.current).toMatchObject({
      status: 'waitingOnThem',
      sourceKind: 'outbound',
      sourceMessageId: 'sent-message',
      sourceReceivedAt: '2026-07-09T12:00:00.000Z',
      draftId: null,
      waitingSince: '2026-07-09T12:00:00.000Z',
      dueAt: '2026-07-11T12:00:00.000Z',
    });
  });

  it('orders full-thread replay and canonicalizes only the closest pending send anchor', () => {
    harness.current = state({
      sourceMessageId: 'pending-send:draft-1',
      sourceReceivedAt: '2026-07-09T12:00:00.000Z',
      sourceKind: 'outbound',
      status: 'waitingOnThem',
      waitingSince: '2026-07-09T12:00:00.000Z',
      dueAt: '2026-07-11T12:00:00.000Z',
    });
    ReplyPipelineService.processNewMessages([
      message({
        id: 'sent-latest',
        senderEmail: 'me@example.com',
        labelIds: ['SENT'],
        receivedAt: '2026-07-09T12:00:00.000Z',
      }),
      message({ id: 'reply-between-sends', receivedAt: '2026-07-09T11:59:00.000Z' }),
      message({
        id: 'sent-older',
        senderEmail: 'me@example.com',
        labelIds: ['SENT'],
        receivedAt: '2026-07-09T11:58:00.000Z',
      }),
    ]);
    expect(harness.current).toMatchObject({
      status: 'waitingOnThem',
      sourceMessageId: 'sent-latest',
      sourceReceivedAt: '2026-07-09T12:00:00.000Z',
      waitingSince: '2026-07-09T12:00:00.000Z',
    });
  });

  it('starts a newer outbound cycle after an earlier inbound resolved the previous one', () => {
    harness.current = state({
      sourceMessageId: 'sent-previous',
      sourceReceivedAt: '2026-07-09T12:00:00.000Z',
      sourceKind: 'outbound',
      status: 'waitingOnThem',
      waitingSince: '2026-07-09T12:00:00.000Z',
      dueAt: '2026-07-11T12:00:00.000Z',
    });
    ReplyPipelineService.processNewMessages([
      message({
        id: 'sent-new-cycle',
        senderEmail: 'me@example.com',
        labelIds: ['SENT'],
        receivedAt: '2026-07-09T13:00:00.000Z',
      }),
      message({ id: 'reply-to-previous', receivedAt: '2026-07-09T12:30:00.000Z' }),
    ]);
    expect(harness.current).toMatchObject({
      status: 'waitingOnThem',
      sourceMessageId: 'sent-new-cycle',
      waitingSince: '2026-07-09T13:00:00.000Z',
      resolvedAt: null,
    });
  });
});
