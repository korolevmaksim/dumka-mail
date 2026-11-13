// Seam between the reader UI and the agent pipeline.
//
// Reader components call `useAgentPrep()` and render whatever state it returns.
// The exported names and types below are the contract and must stay stable.
//
// Implementation: a module-level store (one per renderer) fed by the main
// process (`main/agentPrepService.ts`): `api:modelStatusChanged`,
// `api:aiStream` deltas for in-flight requests, and `api:agentDraftReady` for
// drafts prepared in the background. States are keyed by
// (account, thread, last message id), so a new message makes a fresh request.
// The main process decides whether a request may leave at all (provider
// configured, account allows mail text); a refused request reads as `idle`.
import { useMemo, useSyncExternalStore } from 'react';
import { parseSummaryBullets, type AIStreamEvent, type ModelStatus as PipelineModelStatus } from '../../../shared/agentPrompts';
import type { MailThread } from '../../../shared/types';

export type ModelStatus = PipelineModelStatus;

export interface ThreadSummaryState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** 2–4 short bullet points; empty unless status is 'ready' (or partially filled while streaming). */
  bullets: string[];
}

export interface AgentDraftState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Plain-text reply body prepared by the agent; '' unless status is 'ready' (or partial while streaming). */
  bodyPlain: string;
}

export interface AgentPrepApi {
  /** 'none': no provider configured; 'unreachable': the last request failed; 'ok': usable. */
  modelStatus: ModelStatus;
  /** Re-runs the pending preparation after a failure. */
  retryModel: () => void;
  getThreadSummary: (thread: MailThread | null | undefined) => ThreadSummaryState;
  /** Idempotent; safe to call on every open of a long thread. */
  requestThreadSummary: (thread: MailThread) => void;
  getAgentDraft: (thread: MailThread | null | undefined) => AgentDraftState;
  /** Idempotent; asks for a reply draft for this thread if none is cached. */
  requestAgentDraft: (thread: MailThread) => void;
  /** Cancels an in-flight summary/draft request for this thread, if any. */
  cancelFor: (thread: MailThread) => void;
  /** Forgets a failed draft for this thread, so its error stops showing. */
  dismissDraftError: (thread: Pick<MailThread, 'accountId' | 'id'>) => void;
}

const IDLE_SUMMARY: ThreadSummaryState = { status: 'idle', bullets: [] };
const IDLE_DRAFT: AgentDraftState = { status: 'idle', bodyPlain: '' };

interface Entry<S> {
  state: S;
  /** Set while a request is in flight. */
  requestId: string | null;
  /** Streamed text so far. */
  text: string;
  /** The main process declined (no provider / mail text not allowed / too short). */
  skipped: boolean;
}

type Kind = 'summary' | 'draft';

const summaries = new Map<string, Entry<ThreadSummaryState>>();
const drafts = new Map<string, Entry<AgentDraftState>>();
const requestKeys = new Map<string, { kind: Kind; key: string }>();
const listeners = new Set<() => void>();
let modelStatus: ModelStatus = 'none';
let version = 0;
let initialized = false;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function api(): Window['electronAPI'] | null {
  return typeof window !== 'undefined' && window.electronAPI ? window.electronAPI : null;
}

function threadPrefix(accountId: string, threadId: string): string {
  return `${accountId}\u0000${threadId}\u0000`;
}

function threadKey(thread: Pick<MailThread, 'accountId' | 'id' | 'signals'>): string {
  return `${threadPrefix(thread.accountId, thread.id)}${thread.signals?.lastMessageId || ''}`;
}

function setModelStatus(next: ModelStatus) {
  if (next === modelStatus) return;
  modelStatus = next;
  // A refusal may no longer hold (provider added, setting changed): allow asking again.
  for (const map of [summaries, drafts] as Map<string, Entry<unknown>>[]) {
    for (const [key, entry] of map) if (entry.skipped) map.delete(key);
  }
  emit();
}

function handleStream(event: AIStreamEvent) {
  const target = requestKeys.get(event.requestId);
  if (!target) return;
  if (event.done) requestKeys.delete(event.requestId);
  if (!event.delta) return;
  if (target.kind === 'summary') {
    const entry = summaries.get(target.key);
    if (!entry || entry.requestId !== event.requestId) return;
    entry.text += event.delta;
    entry.state = { status: 'loading', bullets: parseSummaryBullets(entry.text) };
  } else {
    const entry = drafts.get(target.key);
    if (!entry || entry.requestId !== event.requestId) return;
    entry.text += event.delta;
    entry.state = { status: 'loading', bodyPlain: entry.text.trimStart() };
  }
  emit();
}

function ensureInitialized() {
  if (initialized) return;
  const electronAPI = api();
  if (!electronAPI?.getModelStatus) return;
  initialized = true;
  electronAPI.getModelStatus().then(setModelStatus).catch(error => console.warn('Could not read the model status:', error));
  electronAPI.onModelStatusChanged(setModelStatus);
  electronAPI.onAIStream(handleStream);
  electronAPI.onAgentDraftReady(event => {
    const key = `${threadPrefix(event.accountId, event.threadId)}${event.lastMessageId}`;
    const entry = drafts.get(key);
    // Never replace an in-flight or finished on-demand draft.
    if (entry && (entry.requestId || entry.state.status === 'ready')) return;
    drafts.set(key, { state: { status: 'ready', bodyPlain: event.bodyPlain }, requestId: null, text: '', skipped: false });
    emit();
  });
}

function subscribe(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion(): number {
  return version;
}

function getModelStatusSnapshot(): ModelStatus {
  return modelStatus;
}

function newRequestId(): string {
  return crypto.randomUUID();
}

function settle<S>(map: Map<string, Entry<S>>, key: string, requestId: string, apply: (entry: Entry<S>) => boolean) {
  const entry = map.get(key);
  if (!entry || entry.requestId !== requestId) return;
  requestKeys.delete(requestId);
  entry.requestId = null;
  if (!apply(entry)) map.delete(key);
  emit();
}

function requestThreadSummary(thread: MailThread) {
  ensureInitialized();
  const electronAPI = api();
  if (!electronAPI || modelStatus === 'none') return;
  const key = threadKey(thread);
  if (summaries.has(key)) return;
  const requestId = newRequestId();
  summaries.set(key, { state: { status: 'loading', bullets: [] }, requestId, text: '', skipped: false });
  requestKeys.set(requestId, { kind: 'summary', key });
  emit();
  electronAPI.requestThreadSummary(thread.accountId, thread.id, requestId)
    .then(result => settle(summaries, key, requestId, entry => {
      if (result.status === 'ready') entry.state = { status: 'ready', bullets: result.bullets };
      else if (result.status === 'skipped') {
        entry.state = IDLE_SUMMARY;
        entry.skipped = true;
      } else if (result.status === 'error') entry.state = { status: 'error', bullets: [] };
      else return false;
      return true;
    }))
    .catch(() => settle(summaries, key, requestId, entry => {
      entry.state = { status: 'error', bullets: [] };
      return true;
    }));
}

function requestAgentDraft(thread: MailThread) {
  ensureInitialized();
  const electronAPI = api();
  if (!electronAPI || modelStatus === 'none') return;
  const key = threadKey(thread);
  if (drafts.has(key)) return;
  const requestId = newRequestId();
  drafts.set(key, { state: { status: 'loading', bodyPlain: '' }, requestId, text: '', skipped: false });
  requestKeys.set(requestId, { kind: 'draft', key });
  emit();
  electronAPI.requestAgentDraft(thread.accountId, thread.id, requestId)
    .then(result => settle(drafts, key, requestId, entry => {
      if (result.status === 'ready') entry.state = { status: 'ready', bodyPlain: result.bodyPlain };
      else if (result.status === 'skipped') {
        entry.state = IDLE_DRAFT;
        entry.skipped = true;
      } else if (result.status === 'error') entry.state = { status: 'error', bodyPlain: '' };
      else return false;
      return true;
    }))
    .catch(() => settle(drafts, key, requestId, entry => {
      entry.state = { status: 'error', bodyPlain: '' };
      return true;
    }));
}

function cancelFor(thread: MailThread) {
  const electronAPI = api();
  const prefix = threadPrefix(thread.accountId, thread.id);
  let changed = false;
  for (const map of [summaries, drafts] as Map<string, Entry<unknown>>[]) {
    for (const [key, entry] of map) {
      if (!key.startsWith(prefix) || !entry.requestId) continue;
      void electronAPI?.cancelAI(entry.requestId).catch(() => undefined);
      requestKeys.delete(entry.requestId);
      map.delete(key);
      changed = true;
    }
  }
  if (changed) emit();
}

function dismissDraftError(thread: Pick<MailThread, 'accountId' | 'id'>) {
  const prefix = threadPrefix(thread.accountId, thread.id);
  let changed = false;
  for (const [key, entry] of drafts) {
    if (!key.startsWith(prefix) || entry.state.status !== 'error') continue;
    drafts.delete(key);
    changed = true;
  }
  if (changed) emit();
}

/** Also exported on its own: a caller that only retries need not subscribe to every draft and summary change. */
export function retryModel() {
  for (const map of [summaries, drafts] as Map<string, Entry<{ status: string }>>[]) {
    for (const [key, entry] of map) if (entry.state.status === 'error') map.delete(key);
  }
  emit();
  api()?.retryAgentPrep().then(setModelStatus).catch(error => console.warn('Retry of agent preparation failed:', error));
}

function getThreadSummary(thread: MailThread | null | undefined): ThreadSummaryState {
  if (!thread || modelStatus === 'none') return IDLE_SUMMARY;
  return summaries.get(threadKey(thread))?.state || IDLE_SUMMARY;
}

function getAgentDraft(thread: MailThread | null | undefined): AgentDraftState {
  if (!thread || modelStatus === 'none') return IDLE_DRAFT;
  return drafts.get(threadKey(thread))?.state || IDLE_DRAFT;
}

/** The model status alone, for consumers that do not need summaries or drafts. */
export function useModelStatus(): ModelStatus {
  return useSyncExternalStore(subscribe, getModelStatusSnapshot, getModelStatusSnapshot);
}

export function useAgentPrep(): AgentPrepApi {
  const snapshot = useSyncExternalStore(subscribe, getVersion, getVersion);
  return useMemo<AgentPrepApi>(() => ({
    modelStatus,
    retryModel,
    getThreadSummary,
    requestThreadSummary,
    getAgentDraft,
    requestAgentDraft,
    cancelFor,
    dismissDraftError,
  // `snapshot` changes whenever any state does; the getters read the store.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [snapshot]);
}
