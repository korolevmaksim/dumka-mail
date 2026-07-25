// Mail analysis units of work that read bulk message bodies.
//
// These used to run inline on the Electron main event loop, where a single call
// could read hundreds of megabytes of `body_html` / `headers_json` and freeze
// the UI for seconds. Everything here is written so that one call = one whole
// unit of work whose *result* is small, which lets `databaseWorker` execute it
// on the worker thread without shipping mailbox-sized payloads across the
// thread boundary.
//
// Keep this module importable from the database worker: it may only depend on
// `./database`, `./repositories` types and `../shared/*`. No Electron, no
// network, no `./ai`.
import {
  MailEmbeddingsRepo,
  MessagesRepo,
  MessageSecurityRepo,
  ThreadsRepo,
  type MailEmbeddingRow,
} from './database';
import { htmlToText } from '../shared/aiContext';
import { latestMessage } from '../shared/dailyBriefing';
import { MAIL_SECURITY_ANALYSIS_VERSION, analyzeMessageSecurity } from '../shared/mailSecurity';
import { normalizeEmbeddingText, stableTextHash } from '../shared/semantic';
import type { MailMessage, MailThread, MessageSecurityInsight } from '../shared/types';

// === Thread security analysis ===

/**
 * Security pass used by the agentic thread reader. Sender history is fetched
 * once per distinct sender (rather than once per message) and each message then
 * sees the 8 messages that preceded it, which is what `styleShiftWarning`
 * compares against.
 */
export function analyzeThreadMessages(accountId: string, messages: MailMessage[]): void {
  const bySender = new Map<string, MailMessage[]>();
  for (const message of messages) {
    const key = message.senderEmail.trim().toLowerCase();
    const group = bySender.get(key) || [];
    group.push(message);
    bySender.set(key, group);
  }

  const historyBySender = new Map<string, MailMessage[]>();
  for (const [key, group] of bySender) {
    const latest = group.reduce((candidate, message) => (
      message.receivedAt > candidate.receivedAt ? message : candidate
    ));
    historyBySender.set(
      key,
      MessagesRepo.listRecentBySender(
        accountId,
        latest.senderEmail,
        latest.receivedAt,
        Math.min(1000, group.length + 24),
      ),
    );
  }

  const insights = messages.map(message => {
    const history = historyBySender.get(message.senderEmail.trim().toLowerCase()) || [];
    const previous = history.filter(candidate => candidate.receivedAt < message.receivedAt).slice(-8);
    return analyzeMessageSecurity(message, previous);
  });
  MessageSecurityRepo.saveMany(insights);
}

/**
 * How a caller wants a thread's security insights produced. Each mode maps to
 * one of the three behaviours `AgenticService` had before this work moved off
 * the main thread, so no caller's output changes:
 *
 * - `readOnly` — return the cached rows, never analyze. This is what
 *   `getThreadInsights` did when its caller supplied metadata-only messages
 *   (`mapMessageMetadataRow` nulls the bodies), making its `hasFullMessageBodies`
 *   guard false.
 * - `refresh` — analyze only when the cached rows are missing or came from an
 *   older analyzer version. The guarded path for full-body reads.
 * - `force` — analyze unconditionally, as the 120s background agent pass did.
 */
export type ThreadSecurityMode = 'readOnly' | 'refresh' | 'force';

export function threadSecurityInsights(
  accountId: string,
  threadId: string,
  mode: ThreadSecurityMode = 'refresh',
  /**
   * Message count the caller already knows, so `refresh` can settle the
   * freshness guard without re-reading the thread. `api:getThreadReaderPayload`
   * has just loaded the thread when it asks, and re-reading every `body_html`
   * only to decide "nothing to do" doubled the I/O of opening a thread.
   */
  knownMessageCount?: number,
): MessageSecurityInsight[] {
  if (mode === 'readOnly') return MessageSecurityRepo.listForThread(accountId, threadId);

  if (mode === 'force') {
    const threadMessages = MessagesRepo.listForThread(accountId, threadId);
    analyzeThreadMessages(accountId, threadMessages);
    return MessageSecurityRepo.listForThread(accountId, threadId);
  }

  const securityInsights = MessageSecurityRepo.listForThread(accountId, threadId);
  const analyzerIsCurrent = securityInsights.every(
    insight => insight.analysisVersion === MAIL_SECURITY_ANALYSIS_VERSION,
  );

  // Cheap exit: the caller's count settles `securityInsights.length !== count`
  // without touching the messages table at all. This is the common case.
  if (knownMessageCount !== undefined && securityInsights.length === knownMessageCount && analyzerIsCurrent) {
    return securityInsights;
  }

  const threadMessages = MessagesRepo.listForThread(accountId, threadId);
  const hasFullMessageBodies = threadMessages.some(message => message.bodyHtml !== null || message.bodyPlain !== null);
  const needsSecurityRefresh = securityInsights.length !== threadMessages.length || !analyzerIsCurrent;

  if (!hasFullMessageBodies || !needsSecurityRefresh) return securityInsights;

  analyzeThreadMessages(accountId, threadMessages);
  return MessageSecurityRepo.listForThread(accountId, threadId);
}

// === Embedding candidates ===

/**
 * The subset of a message the embedding pipeline still needs once the text has
 * been built. Bodies and headers stay in the worker so a reindex page costs a
 * few hundred kilobytes across the thread boundary instead of tens of megabytes.
 */
export interface EmbeddingCandidateMessage {
  id: string;
  accountId: string;
  threadId: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  snippet: string;
  receivedAt: string;
}

export interface EmbeddingCandidate {
  message: EmbeddingCandidateMessage;
  text: string;
  textHash: string;
}

export type EmbeddingCandidateSource =
  | { kind: 'recent'; limit: number; maxCandidates: number }
  | { kind: 'page'; limit: number; offset: number };

export interface EmbeddingCandidateBatch {
  candidates: EmbeddingCandidate[];
  /** Rows the source query returned, before candidate filtering. Callers page on this. */
  scannedMessages: number;
}

function toEmbeddingCandidateMessage(message: MailMessage): EmbeddingCandidateMessage {
  return {
    id: message.id,
    accountId: message.accountId,
    threadId: message.threadId,
    subject: message.subject,
    senderName: message.senderName,
    senderEmail: message.senderEmail,
    snippet: message.snippet,
    receivedAt: message.receivedAt,
  };
}

export function buildEmbeddingText(message: MailMessage): string {
  const body = (message.bodyPlain || (message.bodyHtml ? htmlToText(message.bodyHtml) : '') || message.snippet || '').trim();
  return normalizeEmbeddingText([
    `Subject: ${message.subject}`,
    `From: ${message.senderName || message.senderEmail} <${message.senderEmail}>`,
    `Received: ${message.receivedAt}`,
    `Snippet: ${message.snippet}`,
    body,
  ].filter(Boolean).join('\n'));
}

function buildEmbeddingCandidates(messages: MailMessage[]): EmbeddingCandidate[] {
  return messages
    .map(message => ({ message: toEmbeddingCandidateMessage(message), text: buildEmbeddingText(message) }))
    .filter(item => item.text.length >= 20)
    .map(item => ({ ...item, textHash: stableTextHash(item.text) }));
}

/**
 * Reads a page of messages, turns them into embedding candidates and drops the
 * ones already indexed under `model` — all without the bodies leaving this
 * thread.
 */
export function collectPendingEmbeddingCandidates(
  accountId: string,
  model: string,
  source: EmbeddingCandidateSource,
): EmbeddingCandidateBatch {
  const messages = source.kind === 'recent'
    ? MessagesRepo.listRecent(accountId, source.limit)
    : MessagesRepo.listForEmbeddingPage(accountId, source.limit, source.offset);
  const scannedMessages = messages.length;

  let candidates = buildEmbeddingCandidates(messages);
  if (source.kind === 'recent') {
    candidates = candidates.slice(0, source.maxCandidates);
  }

  if (candidates.length === 0) return { candidates: [], scannedMessages };

  const indexedHashes = MailEmbeddingsRepo.indexedHashesForMessageIds(
    accountId,
    model,
    candidates.map(item => item.message.id),
  );

  return {
    candidates: candidates.filter(item => indexedHashes[item.message.id] !== item.textHash),
    scannedMessages,
  };
}

export function saveEmbeddingVectors(rows: MailEmbeddingRow[]): void {
  MailEmbeddingsRepo.saveMany(rows);
}

// === Daily briefing context ===

export interface BriefingThreadSelection {
  sinceMs: number;
  includeRead: boolean;
  semanticScoresByThreadId: Record<string, number>;
  maxThreads: number;
}

export interface BriefingThreadContext {
  threads: MailThread[];
  /**
   * Only the newest message per thread: `buildDailyBriefing` reduces each
   * thread's messages with `latestMessage()`, so a single-element list produces
   * the identical item while keeping whole-thread bodies out of the payload.
   */
  latestMessageByThreadId: Record<string, MailMessage>;
  securityByThreadId: Record<string, MessageSecurityInsight[]>;
}

export type BriefingThreadBatch = Omit<BriefingThreadContext, 'threads'>;

function hasThreadLabel(thread: MailThread, label: string): boolean {
  const target = label.toUpperCase();
  return thread.labelIds.some(item => String(item).toUpperCase() === target);
}

export function isBriefingCandidateThread(
  thread: MailThread,
  sinceMs: number,
  includeRead: boolean,
  semanticScore: number,
): boolean {
  if (!hasThreadLabel(thread, 'INBOX')) return false;
  if (hasThreadLabel(thread, 'SPAM') || hasThreadLabel(thread, 'TRASH')) return false;
  const lastMs = Date.parse(thread.lastMessageAt);
  const isRecent = Number.isFinite(lastMs) && lastMs >= sinceMs;
  if (isRecent || thread.isUnread || semanticScore >= 0.32) return true;
  return includeRead;
}

/**
 * Briefing security pass. Unlike `analyzeThreadMessages` this looks up history
 * per message rather than per sender; kept as-is so briefing insights stay
 * byte-identical to the previous inline implementation.
 */
function analyzeBriefingThreadMessages(accountId: string, messages: MailMessage[]): void {
  const insights = messages.map(message => {
    const previous = MessagesRepo.listRecentBySender(accountId, message.senderEmail, message.receivedAt, 8);
    return analyzeMessageSecurity(message, previous);
  });
  MessageSecurityRepo.saveMany(insights);
}

/** Thread selection only — cheap, and it decides the work for the batches below. */
export function selectBriefingThreads(accountId: string, selection: BriefingThreadSelection): MailThread[] {
  return ThreadsRepo.list(accountId)
    .filter(thread => isBriefingCandidateThread(
      thread,
      selection.sinceMs,
      selection.includeRead,
      selection.semanticScoresByThreadId[thread.id] || 0,
    ))
    .slice(0, selection.maxThreads);
}

/**
 * Per-thread briefing context for one bounded batch of threads.
 *
 * Deliberately batched rather than "all selected threads in one call": a worker
 * message handler runs to completion, so doing all ~240 threads at once would
 * head-of-line-block every other database request (thread open, mailbox list,
 * sync writes) for the whole multi-second read. The client walks batches and
 * yields between them, matching how `saveMessages` / `saveThreads` already
 * behave.
 */
export function collectBriefingThreadBatch(accountId: string, threadIds: string[]): BriefingThreadBatch {
  const latestMessageByThreadId: Record<string, MailMessage> = {};
  const securityByThreadId: Record<string, MessageSecurityInsight[]> = {};

  for (const threadId of threadIds) {
    const messages = MessagesRepo.listForThread(accountId, threadId);
    const newest = latestMessage(messages);
    if (newest) latestMessageByThreadId[threadId] = newest;
    if (messages.length > 0) {
      analyzeBriefingThreadMessages(accountId, messages);
    }
    securityByThreadId[threadId] = MessageSecurityRepo.listForThread(accountId, threadId);
  }

  return { latestMessageByThreadId, securityByThreadId };
}
