import { sortingConfig, sortingCacheKey, sortingCacheMatches, type SortingSettingsSource } from '../shared/sortingConfig';
import type { DecisionPromptItem, DecisionBatchParseResult } from '../shared/agentPrompts';
// Agent preparation logic (design-review/SPEC.md §1 model layer, §5), free of
// database, Electron and provider imports: every dependency is injected, so the
// rules below are unit-tested with fakes (tests/agentPrepService.test.ts).
// `main/agentPrepService.ts` wires the real repositories, the database worker
// and `completeText`.
//
//   - Model decisions for inbox threads, in batches of ≤ 12, ≤ 3 batches per
//     trigger, one pass in flight per account. A batch whose answer is unusable
//     twice is remembered for the session and the next batch proceeds.
//   - Prepared reply drafts for threads resolved to `reply`, ≤ 5 per pass,
//     one at a time, stored locally (nothing goes to Gmail).
//   - On-demand thread summaries and reply drafts (streamed). Callers asking
//     for the same thread share one request; one caller cancelling does not
//     cancel the others.
//   - The streaming "Ask Dumka" chat, with mail text removed on the main side
//     when the account does not allow the model to read mail.
//   - The model status ('none' | 'ok' | 'unreachable'): only transport / HTTP
//     failures make the model unreachable; an unusable answer does not.
//
// Nothing is requested for an account unless a provider is configured and
// `modelMayReadMail` resolves to true for it. Background work is opt-in on top
// of that: decisions run only while `backgroundSorting` resolves to true for
// the account, and drafts are prepared in advance only when
// `ai.proactiveDraftsEnabled` is on as well. With both off (the default) the
// model is used only when the user asks: a summary, a reply draft, the chat.
// Failures are logged with provider, status code and a truncated message
// only — never mail text or keys.
import { resolveAccountSetting, normalizeAccountId, type AccountSettingsSource } from '../shared/accountSettings';
import { resolveAIModelForPurpose, resolveBackgroundModelRoute, type AIModelPurpose } from '../shared/aiModelPurpose';
import { isAIProviderPreference } from '../shared/aiProviderPreference';
import { isConfigurableAIProvider } from '../shared/aiProviders';
import { indexDecisionRecords } from '../shared/inboxSections';
import {
  buildDecisionBatchPrompt,
  buildDecisionPromptItem,
  buildDraftPrompt,
  buildSummaryPrompt,
  cleanDraftBody,
  latestMessageOf,
  parseDecisionBatchResponse,
  parseSummaryBullets,
  prepAttemptKey,
  refineDecisionBatch,
  selectDecisionWorkList,
  selectDraftWorkList,
  shouldSummarizeThread,
  DECISION_BATCH_SIZE,
  DRAFT_BATCH_SIZE,
  type AgentDraftReadyEvent,
  type AgentDraftResult,
  type AIStreamEvent,
  type DecisionCandidate,
  type ModelStatus,
  type TextPrompt,
  type ThreadSummaryResult,
} from '../shared/agentPrompts';
import { describeModelError, isAbortError, isUnusableAnswerError, ModelRequestError } from './modelErrors';
import type {
  AIChatMessage,
  AIProviderDescriptor,
  AIProviderPreference,
  AgentDraftSuggestion,
  MailMessage,
  MailThread,
  ThreadDecisionRecord,
} from '../shared/types';

export type { ModelStatus } from '../shared/agentPrompts';

export const MAX_DECISION_BATCHES_PER_TRIGGER = 3;
export const INBOX_SCAN_LIMIT = 100;
const START_DELAY_MS = 15_000;
const TRIGGER_DEBOUNCE_MS = 1_500;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;
const ATTEMPT_MEMORY_LIMIT = 20_000;

export interface StoredAgentSettings {
  compose?: { afterSend?: unknown } | null;
  ai?: SortingSettingsSource & {
    allowMailBodyContext?: unknown;
    provider?: unknown;
    globalDefaultModel?: unknown;
    automationModel?: unknown;
    automationProvider?: unknown;
    backgroundSorting?: unknown;
    proactiveDraftsEnabled?: unknown;
    replyTone?: unknown;
    personalizationNotes?: unknown;
  } | null;
  accountDefaults?: AccountSettingsSource['accountDefaults'];
  accountOverrides?: AccountSettingsSource['accountOverrides'];
}

export interface TextCompletionRequest {
  preference: AIProviderPreference;
  overrideModel?: string;
  stream?: boolean;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface TextCompletion {
  text: string;
  model: string;
  provider: AIProviderPreference | string;
}

export interface ThreadSummaryRecordInput {
  accountId: string;
  threadId: string;
  lastMessageId: string;
  bullets: string[];
  model: string;
  createdAt: string;
}

/** A chat request as the IPC handler validated it. */
export interface AgentChatRequest {
  action: string;
  context: string;
  conversationHistory: AIChatMessage[];
  userInstruction: string;
}

export interface AgentPrepDeps {
  readSettings(): StoredAgentSettings;
  listAccounts(): { email: string; displayName?: string | null }[];
  /** Newest inbox threads (≤ limit) and their cached decisions; served by the database worker. */
  inboxSnapshot(accountId: string, limit: number): Promise<{ threads: MailThread[]; decisions: ThreadDecisionRecord[] }>;
  listMessagesForThread(accountId: string, threadId: string): Promise<MailMessage[]>;
  getThread(accountId: string, threadId: string): MailThread | null;
  upsertDecisions(records: ThreadDecisionRecord[]): void;
  getAgentDraftForMessage(accountId: string, messageId: string): Pick<AgentDraftSuggestion, 'status' | 'bodyPlain'> | null;
  saveAgentDraft(draft: AgentDraftSuggestion): void;
  hasAgentDraftForMessage(accountId: string, messageId: string): boolean;
  userDraftThreadIds(accountId: string): Set<string>;
  getSummary(accountId: string, threadId: string, lastMessageId: string): { bullets: string[] } | null;
  saveSummary(record: ThreadSummaryRecordInput): void;
  /** Subjects / senders / dates only, from the main process's own cache. */
  metadataContext(accountId: string, threadId: string | null): Promise<string>;
  buildChatPrompt(request: AgentChatRequest): TextPrompt;
  resolveTextProvider(preference: AIProviderPreference, overrideModel?: string): Promise<AIProviderDescriptor | null>;
  completeText(prompt: TextPrompt, options: TextCompletionRequest): Promise<TextCompletion>;
  completeDecisions?(items: readonly DecisionPromptItem[], now: Date, options: { model: string; minConfidence: number; signal: AbortSignal }): Promise<DecisionBatchParseResult & { model: string }>;
  publish(channel: string, payload: unknown): void;
  logWarning(scope: string, message: string, extra?: Record<string, unknown>): void;
  newId(): string;
  now(): Date;
}

interface PrepGate {
  settings: StoredAgentSettings;
  preference: AIProviderPreference;
  overrideModel: string | undefined;
  /** Background work on a provider chosen for it: its failures say nothing about the main model. */
  dedicated: boolean;
}

interface AccountRun {
  running: boolean;
  rerun: boolean;
  controller: AbortController;
}

export type TriggerReason = 'start' | 'sync' | 'config' | 'retry' | 'manual';

/** One provider request shared by every caller asking for the same thread result. */
interface SharedRequest<T> {
  accountId: string;
  controller: AbortController;
  participants: Map<string, (delta: string) => void>;
  text: string;
  promise: Promise<T>;
}

const CANCELLED = Symbol('cancelled');

function providerPreference(settings: StoredAgentSettings): AIProviderPreference {
  const value = settings.ai?.provider;
  return typeof value === 'string' && isAIProviderPreference(value) ? value : 'automatic';
}

function stringSetting(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function overrideModelFor(settings: StoredAgentSettings, purpose: AIModelPurpose): string | undefined {
  return resolveAIModelForPurpose(purpose, {
    interactiveModel: stringSetting(settings.ai?.globalDefaultModel),
    automationModel: stringSetting(settings.ai?.automationModel),
  });
}

/** The provider chosen for background work, or null when it follows the main provider. */
function automationProvider(settings: StoredAgentSettings): AIProviderPreference | null {
  const value = settings.ai?.automationProvider;
  return typeof value === 'string' && isConfigurableAIProvider(value) ? value : null;
}

/** Provider and model for a purpose; background work may run on a provider of its own. */
function modelRouteFor(settings: StoredAgentSettings, purpose: AIModelPurpose): { preference: AIProviderPreference; overrideModel: string | undefined; dedicated: boolean } {
  if (purpose === 'automation') {
    return resolveBackgroundModelRoute({
      provider: providerPreference(settings),
      automationProvider: settings.ai?.automationProvider,
      interactiveModel: stringSetting(settings.ai?.globalDefaultModel),
      automationModel: stringSetting(settings.ai?.automationModel),
    });
  }
  return { preference: providerPreference(settings), overrideModel: overrideModelFor(settings, purpose), dedicated: false };
}

export function modelMayReadMail(settings: AccountSettingsSource, accountId: string): boolean {
  return resolveAccountSetting(settings, accountId, 'modelMayReadMail').value === true;
}

/** Whether the model may sort this account's new mail without being asked. Off by default. */
export function backgroundSortingEnabled(settings: AccountSettingsSource, accountId: string): boolean {
  return resolveAccountSetting(settings, accountId, 'backgroundSorting').value === true;
}

/** Whether reply drafts are prepared ahead of time; needs background sorting as well. */
export function draftsInAdvanceEnabled(settings: StoredAgentSettings, accountId: string): boolean {
  return settings.ai?.proactiveDraftsEnabled === true && backgroundSortingEnabled(settings, accountId);
}

function threadKey(accountId: string, threadId: string): string {
  return `${normalizeAccountId(accountId)}\u0000${threadId}`;
}

export function createAgentPrepService(deps: AgentPrepDeps) {
  let modelStatus: ModelStatus = 'none';
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelayMs = RETRY_BASE_MS;
  /** Counts failures of the model itself (not of a dedicated background provider). */
  let modelFailures = 0;
  // A provider chosen for background work has its own back-off: when it is
  // down, the main model (chat, summaries, drafts on request) is not reported
  // as unreachable and the inbox keeps its sections.
  let backgroundPausedUntil = 0;
  let backgroundDelayMs = RETRY_BASE_MS;
  let settingsFingerprint = '';
  const accountRuns = new Map<string, AccountRun>();
  const triggerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const attemptedDecisions = new Set<string>();
  const attemptedDrafts = new Set<string>();
  const draftsInFlight = new Map<string, SharedRequest<AgentDraftResult>>();
  const summariesInFlight = new Map<string, SharedRequest<ThreadSummaryResult>>();
  /** requestId → the caller's own controller (cancelling it leaves any shared request). */
  const requests = new Map<string, { accountId: string | null; controller: AbortController }>();

  // --- Settings ----------------------------------------------------------------

  function fingerprint(settings: StoredAgentSettings): string {
    const accounts = deps.listAccounts().map(account => (
      `${account.email}:${modelMayReadMail(settings, account.email)}:${backgroundSortingEnabled(settings, account.email)}`
    ));
    return JSON.stringify([
      providerPreference(settings),
      stringSetting(settings.ai?.globalDefaultModel),
      stringSetting(settings.ai?.automationModel),
      automationProvider(settings),
      sortingConfig(settings.ai),
      settings.ai?.proactiveDraftsEnabled === true,
      accounts,
    ]);
  }

  // --- Model status --------------------------------------------------------------

  function publish(channel: string, payload: unknown) {
    try {
      deps.publish(channel, payload);
    } catch {
      // The window may be gone; state is re-read on demand.
    }
  }

  function clearRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function setModelStatus(next: ModelStatus) {
    if (modelStatus === next) return;
    modelStatus = next;
    if (next !== 'unreachable') clearRetry();
    publish('api:modelStatusChanged', next);
  }

  function scheduleRetry() {
    if (retryTimer) return;
    const delay = retryDelayMs;
    retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void runAllAccounts('retry');
    }, delay);
  }

  async function refreshModelStatus(): Promise<ModelStatus> {
    const settings = deps.readSettings();
    const descriptor = await deps.resolveTextProvider(providerPreference(settings), overrideModelFor(settings, 'interactive')).catch(() => null);
    if (!descriptor) setModelStatus('none');
    else if (modelStatus === 'none') setModelStatus('ok');
    return modelStatus;
  }

  function reportModelSuccess() {
    retryDelayMs = RETRY_BASE_MS;
    setModelStatus('ok');
  }

  /**
   * Transport / HTTP failures make the model unreachable (with backoff
   * retries). An answer that was empty or not valid is logged only: the model
   * was reached, and retrying the same request on a timer would not help.
   */
  function reportModelFailure(error: unknown, task: string) {
    if (isAbortError(error)) return;
    if (error instanceof ModelRequestError && error.kind === 'config') {
      void refreshModelStatus();
      return;
    }
    if (isUnusableAnswerError(error)) {
      deps.logWarning('Agent', 'Model answer was not usable.', { task, ...describeModelError(error) });
      return;
    }
    deps.logWarning('Agent', 'Model request failed.', { task, ...describeModelError(error) });
    modelFailures += 1;
    setModelStatus('unreachable');
    scheduleRetry();
  }

  function reportBackgroundSuccess() {
    backgroundPausedUntil = 0;
    backgroundDelayMs = RETRY_BASE_MS;
  }

  /** A failure of the dedicated background provider: logged and backed off, never shown as the model being down. */
  function reportBackgroundFailure(error: unknown, task: string) {
    if (isAbortError(error)) return;
    if (isUnusableAnswerError(error)) {
      deps.logWarning('Agent', 'Background model answer was not usable.', { task, ...describeModelError(error) });
      return;
    }
    deps.logWarning('Agent', 'Background model request failed.', { task, ...describeModelError(error) });
    backgroundPausedUntil = deps.now().getTime() + backgroundDelayMs;
    backgroundDelayMs = Math.min(backgroundDelayMs * 2, RETRY_MAX_MS);
  }

  function reportSuccessFor(gate: Pick<PrepGate, 'dedicated'>) {
    if (gate.dedicated) reportBackgroundSuccess();
    else reportModelSuccess();
  }

  function reportFailureFor(gate: Pick<PrepGate, 'dedicated'>, error: unknown, task: string) {
    if (gate.dedicated) reportBackgroundFailure(error, task);
    else reportModelFailure(error, task);
  }

  /** Whether background work should wait: its provider failed recently and nobody asked for a retry. */
  function backgroundPaused(gate: Pick<PrepGate, 'dedicated'>, reason: TriggerReason): boolean {
    if (reason === 'retry' || reason === 'manual') return false;
    return gate.dedicated ? deps.now().getTime() < backgroundPausedUntil : modelStatus === 'unreachable';
  }

  // --- Gate ------------------------------------------------------------------------

  function mayReadMail(accountId: string): boolean {
    return modelMayReadMail(deps.readSettings(), accountId);
  }

  /** Read from the current settings each time: a draft asked for by the person needs mail access; one prepared in advance also needs that setting to be on. */
  function draftStillAllowed(accountId: string, purpose: AIModelPurpose): boolean {
    const settings = deps.readSettings();
    if (!modelMayReadMail(settings, accountId)) return false;
    return purpose !== 'automation' || draftsInAdvanceEnabled(settings, accountId);
  }

  async function gateFor(accountId: string, purpose: AIModelPurpose): Promise<PrepGate | null> {
    const settings = deps.readSettings();
    if (!modelMayReadMail(settings, accountId)) return null;
    const { preference, overrideModel, dedicated } = modelRouteFor(settings, purpose);
    const descriptor = await deps.resolveTextProvider(preference, overrideModel).catch(() => null);
    if (!descriptor) {
      // A background provider without a key says nothing about the main one.
      if (!dedicated) setModelStatus('none');
      return null;
    }
    if (!dedicated && modelStatus === 'none') setModelStatus('ok');
    return { settings, preference, overrideModel, dedicated };
  }

  function remember(set: Set<string>, key: string) {
    if (set.size >= ATTEMPT_MEMORY_LIMIT) set.clear();
    set.add(key);
  }

  function accountExists(accountId: string): boolean {
    const key = normalizeAccountId(accountId);
    return deps.listAccounts().some(account => normalizeAccountId(account.email) === key);
  }

  // --- Shared requests -------------------------------------------------------------

  /**
   * Joins (or starts) the shared request under `key` as `participantId`.
   * Resolves with the shared result, or `CANCELLED` once this participant's
   * own signal aborts. The provider request is aborted only when the last
   * participant has left.
   */
  function joinShared<T>(
    registry: Map<string, SharedRequest<T>>,
    key: string,
    accountId: string,
    participantId: string,
    callerSignal: AbortSignal,
    onDelta: ((delta: string) => void) | undefined,
    start: (signal: AbortSignal, onDelta: (delta: string) => void) => Promise<T>,
  ): Promise<T | typeof CANCELLED> {
    if (callerSignal.aborted) return Promise.resolve(CANCELLED);
    let shared = registry.get(key);
    // Everyone left and the request was aborted; it stays registered until its
    // promise settles. A new caller starts a fresh request instead of joining it.
    if (shared?.controller.signal.aborted) shared = undefined;
    if (!shared) {
      const created: SharedRequest<T> = {
        accountId,
        controller: new AbortController(),
        participants: new Map(),
        text: '',
        promise: Promise.resolve(undefined as unknown as T),
      };
      created.promise = start(created.controller.signal, delta => {
        created.text += delta;
        for (const deliver of created.participants.values()) deliver(delta);
      }).finally(() => {
        if (registry.get(key) === created) registry.delete(key);
      });
      registry.set(key, created);
      shared = created;
    } else if (onDelta && shared.text) {
      // A late joiner first gets what the others have already seen.
      onDelta(shared.text);
    }
    const current = shared;
    current.participants.set(participantId, onDelta || (() => {}));

    return new Promise<T | typeof CANCELLED>((resolve, reject) => {
      const leave = () => {
        current.participants.delete(participantId);
        if (current.participants.size === 0) current.controller.abort();
        resolve(CANCELLED);
      };
      callerSignal.addEventListener('abort', leave, { once: true });
      current.promise.then(
        value => {
          callerSignal.removeEventListener('abort', leave);
          current.participants.delete(participantId);
          resolve(value);
        },
        error => {
          callerSignal.removeEventListener('abort', leave);
          current.participants.delete(participantId);
          reject(error);
        },
      );
    });
  }

  function registerRequest(requestId: string, accountId: string | null): AbortController {
    requests.get(requestId)?.controller.abort();
    const controller = new AbortController();
    requests.set(requestId, { accountId, controller });
    return controller;
  }

  function releaseRequest(requestId: string, controller: AbortController) {
    if (requests.get(requestId)?.controller === controller) requests.delete(requestId);
  }

  function streamEvent(event: AIStreamEvent) {
    publish('api:aiStream', event);
  }

  // --- Decisions -------------------------------------------------------------------

  async function latestMessagesFor(accountId: string, threadIds: string[], signal: AbortSignal): Promise<Map<string, MailMessage | null>> {
    const latest = new Map<string, MailMessage | null>();
    for (const threadId of threadIds) {
      if (signal.aborted) break;
      const messages = await deps.listMessagesForThread(accountId, threadId);
      latest.set(threadId, latestMessageOf(messages));
    }
    return latest;
  }

  function rememberDecisionCandidates(accountId: string, candidates: readonly DecisionCandidate[]) {
    for (const candidate of candidates) {
      remember(attemptedDecisions, prepAttemptKey(accountId, candidate.thread.id, candidate.lastMessageId));
    }
  }

  /** Returns the number of model requests made. */
  async function runDecisionBatches(accountId: string, run: AccountRun, reason: TriggerReason): Promise<number> {
    let requestsMade = 0;
    for (let batch = 0; batch < MAX_DECISION_BATCHES_PER_TRIGGER; batch += 1) {
      if (run.controller.signal.aborted) break;
      // Checked before every batch: turning the setting off stops the pass.
      if (!backgroundSortingEnabled(deps.readSettings(), accountId)) break;
      const config = sortingConfig(deps.readSettings().ai);
      const gate = config.engine === 'openAIDecisions'
        ? config.model && mayReadMail(accountId) && await deps.resolveTextProvider('openAI', config.model).catch(() => null)
          ? { settings: deps.readSettings(), preference: 'openAI' as const, overrideModel: config.model, dedicated: true } : null
        : await gateFor(accountId, 'automation');
      if (!gate) break;
      if (requestsMade === 0 && backgroundPaused(gate, reason)) break;

      const snapshot = await deps.inboxSnapshot(accountId, INBOX_SCAN_LIMIT);
      if (run.controller.signal.aborted) break;
      const candidates = selectDecisionWorkList(snapshot.threads, indexDecisionRecords(snapshot.decisions.filter(record => record.source !== 'model' || sortingCacheMatches(record.model, config))), { accountEmail: accountId }, {
        limit: DECISION_BATCH_SIZE,
        skip: attemptedDecisions,
      });
      if (candidates.length === 0) break;

      const latest = await latestMessagesFor(accountId, candidates.map(candidate => candidate.thread.id), run.controller.signal);
      if (run.controller.signal.aborted) break;
      const now = deps.now();
      const items = candidates.map(candidate => buildDecisionPromptItem(candidate, latest.get(candidate.thread.id) || null));
      const prompt = buildDecisionBatchPrompt(items, now);
      const allowed = new Set(candidates.map(candidate => candidate.thread.id));
      // The reads above are asynchronous: check again right before mail text is sent.
      if (!mayReadMail(accountId) || !backgroundSortingEnabled(deps.readSettings(), accountId)) break;

      let parsed: ReturnType<typeof parseDecisionBatchResponse> | null = null;
      let model = '';
      let lastUnusable: unknown = null;
      try {
        // An unusable answer gets one more try.
        for (let attempt = 1; attempt <= 2 && !parsed?.valid; attempt += 1) {
          requestsMade += 1;
          try {
            if (config.engine === 'openAIDecisions') {
              if (!deps.completeDecisions) throw new ModelRequestError('config', 'openAI', 'OpenAI Decisions is unavailable.');
              parsed = await deps.completeDecisions(items, now, { model: config.model, minConfidence: config.minConfidence, signal: run.controller.signal });
              model = sortingCacheKey(config);
              continue;
            }
            const result = await deps.completeText(prompt, {
              preference: gate.preference,
              overrideModel: gate.overrideModel,
              stream: false,
              signal: run.controller.signal,
            });
            model = result.model;
            parsed = parseDecisionBatchResponse(result.text, allowed, now);
            if (!parsed.valid) lastUnusable = new ModelRequestError('invalid', String(result.provider), 'Decision batch answer was not valid JSON.');
          } catch (error) {
            if (!isUnusableAnswerError(error)) throw error;
            lastUnusable = error;
          }
        }
      } catch (error) {
        // Transport / HTTP failure or cancel: nothing is remembered, the batch is retried later.
        reportFailureFor(gate, error, 'decisions');
        break;
      }

      if (!parsed?.valid) {
        // Twice unusable: skip these threads for this session and move on, so
        // one bad batch neither repeats forever nor starves older threads.
        rememberDecisionCandidates(accountId, candidates);
        reportFailureFor(gate, lastUnusable || new ModelRequestError('invalid', gate.preference, 'Decision batch answer was not usable twice.'), 'decisions');
        continue;
      }

      if (!mayReadMail(accountId) || !backgroundSortingEnabled(deps.readSettings(), accountId)
        || JSON.stringify(config) !== JSON.stringify(sortingConfig(deps.readSettings().ai))) break;
      const records = refineDecisionBatch(candidates, parsed.items, model, now);
      if (config.engine === 'openAIDecisions') {
        const classified = new Set(records.map(record => record.threadId));
        // Cache reviewed-but-uncertain threads too, without changing their rule
        // category. A new message, engine, model or threshold invalidates this.
        for (const candidate of candidates) {
          if (classified.has(candidate.thread.id)) continue;
          records.push({ accountId, threadId: candidate.thread.id, lastMessageId: candidate.lastMessageId,
            decision: candidate.rule.decision, reason: candidate.rule.reason, source: 'model', laterAt: null,
            model, createdAt: now.toISOString() });
        }
      }
      rememberDecisionCandidates(accountId, candidates);
      if (records.length > 0 && accountExists(accountId) && !run.controller.signal.aborted) {
        deps.upsertDecisions(records);
        publish('api:threadDecisionsChanged', { accountId });
      }
      reportSuccessFor(gate);
    }
    return requestsMade;
  }

  // --- Drafts ----------------------------------------------------------------------

  function replyTone(settings: StoredAgentSettings): string {
    return stringSetting(settings.ai?.replyTone) || 'direct';
  }

  async function generateDraft(
    accountId: string,
    threadId: string,
    purpose: AIModelPurpose,
    signal: AbortSignal,
    onDelta: (delta: string) => void,
    stream: boolean,
  ): Promise<AgentDraftResult> {
    const gate = await gateFor(accountId, purpose);
    if (!gate) return { status: 'skipped' };
    const messages = await deps.listMessagesForThread(accountId, threadId);
    const latest = latestMessageOf(messages);
    const thread = deps.getThread(accountId, threadId);
    if (!latest || !thread) return { status: 'skipped' };

    const existing = deps.getAgentDraftForMessage(accountId, latest.id);
    if (existing?.status === 'ready') return { status: 'ready', bodyPlain: existing.bodyPlain, lastMessageId: latest.id };

    // The reads above are asynchronous: the person may have turned this off
    // meanwhile. Checked again right before mail text leaves the machine.
    if (signal.aborted) return { status: 'cancelled' };
    // Reported as cancelled, not skipped: the thread is tried again once the setting is back on.
    if (!draftStillAllowed(accountId, purpose)) return { status: 'cancelled' };

    const account = deps.listAccounts().find(item => normalizeAccountId(item.email) === normalizeAccountId(accountId));
    const prompt = buildDraftPrompt({
      thread,
      messages,
      accountName: account?.displayName || accountId,
      accountEmail: accountId,
      tone: replyTone(gate.settings),
      personalizationNotes: stringSetting(gate.settings.ai?.personalizationNotes),
    });
    const result = await deps.completeText(prompt, {
      preference: gate.preference,
      overrideModel: gate.overrideModel,
      stream,
      onDelta: stream ? onDelta : undefined,
      signal,
    });
    const bodyPlain = cleanDraftBody(result.text);
    if (bodyPlain.length < 8) throw new ModelRequestError('empty', String(result.provider), 'Draft answer was empty.');
    if (signal.aborted || !accountExists(accountId)) return { status: 'cancelled' };
    // Turned off while the model was writing: the answer is not kept.
    if (!draftStillAllowed(accountId, purpose)) return { status: 'cancelled' };
    // A request for the other purpose may have finished first (they are not shared): keep one draft per message.
    const finishedMeanwhile = deps.getAgentDraftForMessage(accountId, latest.id);
    if (finishedMeanwhile) {
      reportSuccessFor(gate);
      // Ready: hand that one over. Already used by the person: nothing more to prepare.
      return finishedMeanwhile.status === 'ready'
        ? { status: 'ready', bodyPlain: finishedMeanwhile.bodyPlain, lastMessageId: latest.id }
        : { status: 'skipped' };
    }

    const now = deps.now().toISOString();
    deps.saveAgentDraft({
      id: deps.newId(),
      accountId,
      threadId,
      messageId: latest.id,
      subject: thread.subject,
      bodyPlain,
      status: 'ready',
      confidence: 0.78,
      reason: 'Prepared by the agent.',
      model: result.model,
      createdAt: now,
      updatedAt: now,
    });
    reportSuccessFor(gate);
    const event: AgentDraftReadyEvent = { accountId, threadId, lastMessageId: latest.id, bodyPlain };
    publish('api:agentDraftReady', event);
    return { status: 'ready', bodyPlain, lastMessageId: latest.id };
  }

  /** Shared-request key for a draft: background and on-request drafts never join each other. */
  function draftKey(accountId: string, threadId: string, purpose: AIModelPurpose): string {
    return `${threadKey(accountId, threadId)}\u0000${purpose}`;
  }

  /**
   * One draft request per thread and purpose at a time; a second caller with
   * the same purpose joins the first. A draft the person asks for and one
   * prepared in the background stay separate requests: they may use different
   * providers, a failure of one must not be reported against the other's
   * model, and turning background drafts off cancels only those.
   * Resolves `CANCELLED` when this caller's signal aborts, whatever the others do.
   */
  function draftShared(
    accountId: string,
    threadId: string,
    participantId: string,
    purpose: AIModelPurpose,
    signal: AbortSignal,
    onDelta?: (delta: string) => void,
  ): Promise<AgentDraftResult | typeof CANCELLED> {
    return joinShared(draftsInFlight, draftKey(accountId, threadId, purpose), accountId, participantId, signal, onDelta,
      (sharedSignal, sharedDelta) => generateDraft(accountId, threadId, purpose, sharedSignal, sharedDelta, Boolean(onDelta)));
  }

  async function runDraftPass(accountId: string, run: AccountRun, reason: TriggerReason): Promise<number> {
    if (!draftsInAdvanceEnabled(deps.readSettings(), accountId)) return 0;
    const gate = await gateFor(accountId, 'automation');
    if (!gate) return 0;
    if (backgroundPaused(gate, reason)) return 0;
    const snapshot = await deps.inboxSnapshot(accountId, INBOX_SCAN_LIMIT);
    if (run.controller.signal.aborted) return 0;
    const userDraftThreads = deps.userDraftThreadIds(accountId);
    const work = selectDraftWorkList(snapshot.threads, indexDecisionRecords(snapshot.decisions), { accountEmail: accountId }, {
      limit: DRAFT_BATCH_SIZE,
      hasPreparedDraft: (_threadId, lastMessageId) => deps.hasAgentDraftForMessage(accountId, lastMessageId),
      hasUserDraft: threadId => userDraftThreads.has(threadId),
      skip: attemptedDrafts,
    });
    let requestsMade = 0;
    for (const candidate of work) {
      if (run.controller.signal.aborted || (requestsMade > 0 && backgroundPaused(gate, 'sync'))) break;
      if (!draftsInAdvanceEnabled(deps.readSettings(), accountId)) break;
      requestsMade += 1;
      const attemptKey = prepAttemptKey(accountId, candidate.thread.id, candidate.lastMessageId);
      try {
        const result = await draftShared(accountId, candidate.thread.id, `background:${deps.newId()}`, 'automation', run.controller.signal);
        // A cancelled draft was not attempted: it is prepared on a later pass.
        if (result === CANCELLED || result.status === 'cancelled') break;
        remember(attemptedDrafts, attemptKey);
      } catch (error) {
        if (isUnusableAnswerError(error)) {
          // The model answered with nothing usable: do not ask again this session.
          remember(attemptedDrafts, attemptKey);
          reportFailureFor(gate, error, 'draft');
          continue;
        }
        reportFailureFor(gate, error, 'draft');
        break;
      }
    }
    return requestsMade;
  }

  // --- Runs ------------------------------------------------------------------------

  async function runAccount(accountId: string, reason: TriggerReason): Promise<number> {
    const key = normalizeAccountId(accountId);
    let run = accountRuns.get(key);
    if (!run) {
      run = { running: false, rerun: false, controller: new AbortController() };
      accountRuns.set(key, run);
    }
    if (run.running) {
      run.rerun = true;
      return 0;
    }
    run.running = true;
    let requestsMade = 0;
    try {
      // At most one follow-up pass for triggers that arrived meanwhile.
      for (let pass = 0; pass < 2; pass += 1) {
        run.rerun = false;
        requestsMade += await runDecisionBatches(accountId, run, reason);
        if (run.controller.signal.aborted) break;
        requestsMade += await runDraftPass(accountId, run, reason);
        if (!run.rerun || run.controller.signal.aborted) break;
      }
    } catch (error) {
      // Local failures (database worker, repository) are not model failures.
      deps.logWarning('Agent', 'Background preparation pass was skipped.', { accountId, error: describeModelError(error).error });
    } finally {
      run.running = false;
    }
    return requestsMade;
  }

  async function runAllAccounts(reason: TriggerReason): Promise<void> {
    const failuresBefore = modelFailures;
    for (const account of deps.listAccounts()) {
      await runAccount(account.email, reason);
    }
    // A retry during which the model was not seen failing cannot prove it is
    // still down: nothing was pending, or the work went to a dedicated
    // background provider, whose answers say nothing about this model. A
    // successful request to the model itself has already set 'ok'.
    if ((reason === 'retry' || reason === 'manual') && modelFailures === failuresBefore && modelStatus === 'unreachable') {
      await refreshModelStatus();
      if (modelStatus === 'unreachable') setModelStatus('ok');
    }
  }

  function trigger(accountId: string, reason: TriggerReason) {
    const key = normalizeAccountId(accountId);
    const existing = triggerTimers.get(key);
    if (existing) clearTimeout(existing);
    triggerTimers.set(key, setTimeout(() => {
      triggerTimers.delete(key);
      void runAccount(accountId, reason);
    }, TRIGGER_DEBOUNCE_MS));
  }

  /** Runs `start` for a streamed, cancellable caller and maps the outcome to stream events. */
  async function streamedCall<T extends { status: string }>(
    requestId: string,
    accountId: string,
    task: string,
    run: (signal: AbortSignal, onDelta: (delta: string) => void) => Promise<T | typeof CANCELLED>,
    // Whose failure this is: the main model's, unless the request ran on the background provider.
    reportFailure: (error: unknown, task: string) => void = reportModelFailure,
  ): Promise<T | { status: 'cancelled' } | { status: 'error' }> {
    const controller = registerRequest(requestId, accountId);
    const onDelta = (delta: string) => {
      if (!controller.signal.aborted) streamEvent({ requestId, delta, done: false });
    };
    try {
      const result = await run(controller.signal, onDelta);
      if (result === CANCELLED || controller.signal.aborted || result.status === 'cancelled') {
        streamEvent({ requestId, delta: '', done: true, error: 'cancelled' });
        return { status: 'cancelled' };
      }
      streamEvent({ requestId, delta: '', done: true });
      return result;
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        streamEvent({ requestId, delta: '', done: true, error: 'cancelled' });
        return { status: 'cancelled' };
      }
      reportFailure(error, task);
      streamEvent({ requestId, delta: '', done: true, error: 'unreachable' });
      return { status: 'error' };
    } finally {
      releaseRequest(requestId, controller);
    }
  }

  // --- Public API --------------------------------------------------------------------

  return {
    start() {
      settingsFingerprint = fingerprint(deps.readSettings());
      void refreshModelStatus();
      setTimeout(() => {
        void runAllAccounts('start');
      }, START_DELAY_MS);
    },

    getModelStatus(): ModelStatus {
      return modelStatus;
    },

    /** Whether the account lets message text reach the model. */
    mayReadMail,

    /** A mailbox sync for this account persisted a delta. */
    onMailboxSynced(accountId: string) {
      trigger(accountId, 'sync');
    },

    /** AI configuration or app settings changed; acts only when relevant fields did. */
    onConfigChanged(force = false) {
      const settings = deps.readSettings();
      const next = fingerprint(settings);
      if (!force && next === settingsFingerprint) return;
      settingsFingerprint = next;
      attemptedDecisions.clear();
      for (const run of accountRuns.values()) run.controller.abort();
      accountRuns.clear();
      // A new background setup starts without the old provider's back-off.
      reportBackgroundSuccess();
      // Background sorting turned off: stop the pass in flight, so nothing it
      // already asked for is applied. Requests the user made are not touched.
      for (const account of deps.listAccounts()) {
        const key = normalizeAccountId(account.email);
        // Drafts in advance turned off (or mail access withdrawn): cancel the
        // background drafts being written. Only background callers share them.
        const mailAccess = modelMayReadMail(settings, account.email);
        if (!draftsInAdvanceEnabled(settings, account.email) || !mailAccess) {
          const suffix = `\u0000${'automation' satisfies AIModelPurpose}`;
          for (const [draftRequestKey, request] of draftsInFlight) {
            if (normalizeAccountId(request.accountId) !== key) continue;
            // Without mail access every draft stops; otherwise only the ones nobody asked for.
            if (!mailAccess || draftRequestKey.endsWith(suffix)) request.controller.abort();
          }
        }
        // Mail access withdrawn: summaries being written carry mail text too.
        if (!mailAccess) {
          for (const request of summariesInFlight.values()) {
            if (normalizeAccountId(request.accountId) === key) request.controller.abort();
          }
        }
        if (backgroundSortingEnabled(settings, account.email) && modelMayReadMail(settings, account.email)) continue;
        accountRuns.get(key)?.controller.abort();
        accountRuns.delete(key);
        const timer = triggerTimers.get(key);
        if (timer) clearTimeout(timer);
        triggerTimers.delete(key);
      }
      void refreshModelStatus().then(status => {
        // Background work may have its own provider even when the main one is not set up.
        if (status === 'none' && !automationProvider(deps.readSettings()) && sortingConfig(deps.readSettings().ai).engine !== 'openAIDecisions') return;
        for (const account of deps.listAccounts()) trigger(account.email, 'config');
      });
    },

    /** `Retry` after `Couldn't reach the model`. */
    async retry(): Promise<ModelStatus> {
      clearRetry();
      retryDelayMs = RETRY_BASE_MS;
      reportBackgroundSuccess();
      attemptedDecisions.clear();
      attemptedDrafts.clear();
      await refreshModelStatus();
      void runAllAccounts('manual');
      return modelStatus;
    },

    /** Runs one background pass now (no debounce). Resolves with the number of model requests made. */
    runAccountNow(accountId: string, reason: TriggerReason = 'manual'): Promise<number> {
      return runAccount(accountId, reason);
    },

    /** Stops all work for a removed account: its pass, pending trigger, shared and streamed requests. */
    cancelAccount(accountId: string) {
      const key = normalizeAccountId(accountId);
      const run = accountRuns.get(key);
      run?.controller.abort();
      accountRuns.delete(key);
      const timer = triggerTimers.get(key);
      if (timer) clearTimeout(timer);
      triggerTimers.delete(key);
      for (const [requestId, entry] of Array.from(requests)) {
        if (entry.accountId && normalizeAccountId(entry.accountId) === key) {
          entry.controller.abort();
          requests.delete(requestId);
        }
      }
      for (const registry of [draftsInFlight, summariesInFlight] as Map<string, SharedRequest<unknown>>[]) {
        for (const shared of registry.values()) {
          if (normalizeAccountId(shared.accountId) === key) shared.controller.abort();
        }
      }
      // A reconnected account starts fresh: nothing it tried before is skipped.
      const prefix = `${key}\u0000`;
      for (const attempted of [attemptedDecisions, attemptedDrafts]) {
        for (const entry of Array.from(attempted)) {
          if (entry.startsWith(prefix)) attempted.delete(entry);
        }
      }
    },

    /** Cancels one caller. A request shared with other callers keeps running for them. */
    cancelRequest(requestId: string) {
      requests.get(requestId)?.controller.abort();
      requests.delete(requestId);
    },

    async requestThreadSummary(accountId: string, threadId: string, requestId: string): Promise<ThreadSummaryResult> {
      const gate = await gateFor(accountId, 'interactive');
      if (!gate) return { status: 'skipped' };
      const messages = await deps.listMessagesForThread(accountId, threadId);
      const latest = latestMessageOf(messages);
      if (!latest || !shouldSummarizeThread(messages.length)) return { status: 'skipped' };
      const cached = deps.getSummary(accountId, threadId, latest.id);
      if (cached) return { status: 'ready', bullets: cached.bullets, lastMessageId: latest.id };
      const thread = deps.getThread(accountId, threadId);
      if (!thread) return { status: 'skipped' };

      const key = `${threadKey(accountId, threadId)}\u0000${latest.id}`;
      return streamedCall<ThreadSummaryResult>(requestId, accountId, 'summary', (signal, onDelta) => joinShared(
        summariesInFlight, key, accountId, requestId, signal, onDelta,
        async (sharedSignal, sharedDelta): Promise<ThreadSummaryResult> => {
          // The reads above are asynchronous: mail access may have been withdrawn meanwhile.
          if (sharedSignal.aborted || !mayReadMail(accountId)) return { status: 'cancelled' };
          const result = await deps.completeText(buildSummaryPrompt({ thread, messages }), {
            preference: gate.preference,
            overrideModel: gate.overrideModel,
            stream: true,
            signal: sharedSignal,
            onDelta: sharedDelta,
          });
          const bullets = parseSummaryBullets(result.text);
          if (bullets.length === 0) throw new ModelRequestError('invalid', String(result.provider), 'Summary answer had no bullet points.');
          // Withdrawn while the model was writing: the answer is not kept.
          if (sharedSignal.aborted || !mayReadMail(accountId)) return { status: 'cancelled' };
          if (accountExists(accountId)) {
            deps.saveSummary({ accountId, threadId, lastMessageId: latest.id, bullets, model: result.model, createdAt: deps.now().toISOString() });
          }
          reportModelSuccess();
          return { status: 'ready', bullets, lastMessageId: latest.id };
        },
      ));
    },

    /**
     * A reply draft for the open conversation. `interactive`: the person pressed
     * `Draft a reply`. `automation`: the reader asks for the draft prepared in
     * advance, so it runs on the background route, joins a background request
     * already in flight for the thread, and needs drafts in advance to be on.
     */
    async requestAgentDraft(accountId: string, threadId: string, requestId: string, purpose: AIModelPurpose = 'interactive'): Promise<AgentDraftResult> {
      if (purpose === 'automation') {
        const settings = deps.readSettings();
        if (!draftsInAdvanceEnabled(settings, accountId)) return { status: 'skipped' };
        const { dedicated } = modelRouteFor(settings, 'automation');
        return streamedCall<AgentDraftResult>(requestId, accountId, 'draft', (signal, onDelta) =>
          draftShared(accountId, threadId, requestId, 'automation', signal, onDelta),
        (error, task) => reportFailureFor({ dedicated }, error, task));
      }
      return streamedCall<AgentDraftResult>(requestId, accountId, 'draft', (signal, onDelta) =>
        draftShared(accountId, threadId, requestId, 'interactive', signal, onDelta));
    },

    /**
     * Streaming chat without tools. When the account does not allow the model
     * to read mail, the renderer's context is replaced with subjects and
     * senders built here. Throws on failure (the renderer shows `Couldn't reach the model.`).
     */
    async streamChat(
      requestId: string,
      scope: { accountId: string; threadId: string | null },
      request: AgentChatRequest,
      preference: AIProviderPreference,
      overrideModel?: string,
    ): Promise<{ text: string; cancelled?: boolean }> {
      const controller = registerRequest(requestId, scope.accountId);
      try {
        const context = mayReadMail(scope.accountId)
          ? request.context
          : await deps.metadataContext(scope.accountId, scope.threadId);
        if (controller.signal.aborted) {
          streamEvent({ requestId, delta: '', done: true, error: 'cancelled' });
          return { text: '', cancelled: true };
        }
        const result = await deps.completeText(deps.buildChatPrompt({ ...request, context }), {
          preference,
          overrideModel,
          stream: true,
          signal: controller.signal,
          onDelta: delta => {
            if (!controller.signal.aborted) streamEvent({ requestId, delta, done: false });
          },
        });
        if (controller.signal.aborted) {
          streamEvent({ requestId, delta: '', done: true, error: 'cancelled' });
          return { text: '', cancelled: true };
        }
        reportModelSuccess();
        streamEvent({ requestId, delta: '', done: true });
        return { text: result.text };
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          streamEvent({ requestId, delta: '', done: true, error: 'cancelled' });
          return { text: '', cancelled: true };
        }
        reportModelFailure(error, 'chat');
        streamEvent({ requestId, delta: '', done: true, error: 'unreachable' });
        throw new Error("Couldn't reach the model.");
      } finally {
        releaseRequest(requestId, controller);
      }
    },

    /** Test seam: stops timers. */
    dispose() {
      clearRetry();
      for (const timer of triggerTimers.values()) clearTimeout(timer);
      triggerTimers.clear();
    },
  };
}

export type AgentPrepServiceApi = ReturnType<typeof createAgentPrepService>;
