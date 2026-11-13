// What the reply dock at the bottom of the reader shows. Pure so the state
// table can be tested without React.
import type { AgentDraftState, ModelStatus } from '../stores/useAgentPrep';
import type { Decision } from '../../../shared/types';

export type ReplyDockMode =
  /** No messages yet: nothing to reply to. */
  | 'hidden'
  /** The inline editor for this thread is open. */
  | 'editing'
  /** This thread's reply is popped out into the floating composer. */
  | 'floating'
  /** A saved draft exists: one line, `R` to continue. */
  | 'saved'
  /** The agent's draft is shown, not focused; Send sends it as shown. */
  | 'prepared'
  /** The agent is preparing a draft. */
  | 'preparing'
  /** The model failed: `Draft unavailable` + Retry, empty editor for manual writing. */
  | 'unavailable'
  /** Plain reply strip (no agent involvement). */
  | 'idle';

export interface ReplyDockInput {
  hasMessages: boolean;
  inlineDraftActive: boolean;
  floatingDraftActive: boolean;
  savedDraft: boolean;
  modelStatus: ModelStatus;
  decision: Decision | null;
  agentDraft: AgentDraftState;
  /**
   * The account has drafts prepared ahead of time (background sorting and
   * "Prepare reply drafts in advance" both on). Off by default: a draft is
   * then written only when the user asks for one.
   */
  draftsInAdvance: boolean;
}

/**
 * Whether the agent prepares a draft for this thread without being asked:
 * only with drafts in advance on, and only for threads that need a reply.
 */
export function draftPreparedInAdvance(modelStatus: ModelStatus, decision: Decision | null, draftsInAdvance: boolean): boolean {
  if (!draftsInAdvance || modelStatus === 'none') return false;
  if (decision === 'reply') return true;
  // With the model unreachable the inbox falls back to rule sections (People).
  return modelStatus === 'unreachable' && decision === 'people';
}

export function resolveReplyDockMode(input: ReplyDockInput): ReplyDockMode {
  if (!input.hasMessages) return 'hidden';
  if (input.inlineDraftActive) return 'editing';
  if (input.floatingDraftActive) return 'floating';
  if (input.savedDraft) return 'saved';
  if (input.modelStatus === 'none') return 'idle';
  // A draft exists, is being written or failed because the user asked for it
  // (`Draft a reply`) or because it was prepared in advance.
  const { status, bodyPlain } = input.agentDraft;
  if (status === 'ready' && bodyPlain.trim()) return 'prepared';
  if (status === 'error') return 'unavailable';
  if (status === 'loading') return 'preparing';
  // A draft that should have been prepared in advance, but the model is down.
  if (input.modelStatus === 'unreachable' && draftPreparedInAdvance(input.modelStatus, input.decision, input.draftsInAdvance)) return 'unavailable';
  return 'idle';
}

/**
 * While the user edits, a draft from the agent that arrives later is only
 * offered (`Use the draft`), never written into the editor.
 */
export function shouldOfferPreparedDraft(input: {
  mode: ReplyDockMode;
  modelStatus: ModelStatus;
  agentDraft: AgentDraftState;
  draftCameFromAgent: boolean;
}): boolean {
  if (input.mode !== 'editing') return false;
  if (input.draftCameFromAgent) return false;
  if (input.modelStatus === 'none') return false;
  return input.agentDraft.status === 'ready' && input.agentDraft.bodyPlain.trim().length > 0;
}

/**
 * Whether `Draft a reply` is offered: a model is set up and the account lets
 * mail text reach it. The request is made only when the user presses it.
 */
export function canDraftOnRequest(modelStatus: ModelStatus, modelMayReadMail: boolean): boolean {
  return modelStatus !== 'none' && modelMayReadMail;
}

/**
 * A set of ids that keeps only the most recently added `limit` entries, so
 * module-level bookkeeping (drafts that started as the agent's text) cannot
 * grow for the life of the app.
 */
export interface BoundedIdSet {
  add(id: string): void;
  has(id: string): boolean;
  delete(id: string): void;
  readonly size: number;
}

export function createBoundedIdSet(limit: number): BoundedIdSet {
  const max = Math.max(1, Math.floor(limit));
  const ids = new Set<string>();
  return {
    add(id) {
      // Re-adding refreshes recency (Set keeps insertion order).
      ids.delete(id);
      ids.add(id);
      while (ids.size > max) {
        const oldest = ids.values().next().value;
        if (oldest === undefined) break;
        ids.delete(oldest);
      }
    },
    has: id => ids.has(id),
    delete: id => { ids.delete(id); },
    get size() { return ids.size; },
  };
}

/** How many agent-started drafts the dock remembers (only the open one matters). */
export const AGENT_DRAFT_ID_LIMIT = 50;
