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
}

/** The agent prepares drafts only for threads that need a reply. */
export function agentDraftApplies(modelStatus: ModelStatus, decision: Decision | null): boolean {
  if (modelStatus === 'none') return false;
  if (decision === 'reply') return true;
  // With the model unreachable the inbox falls back to rule sections (People).
  return modelStatus === 'unreachable' && decision === 'people';
}

export function resolveReplyDockMode(input: ReplyDockInput): ReplyDockMode {
  if (!input.hasMessages) return 'hidden';
  if (input.inlineDraftActive) return 'editing';
  if (input.floatingDraftActive) return 'floating';
  if (input.savedDraft) return 'saved';
  if (!agentDraftApplies(input.modelStatus, input.decision)) return 'idle';
  const { status, bodyPlain } = input.agentDraft;
  if (status === 'ready' && bodyPlain.trim()) return 'prepared';
  if (status === 'error' || input.modelStatus === 'unreachable') return 'unavailable';
  if (status === 'loading') return 'preparing';
  return 'idle';
}

/**
 * While the user edits, a prepared draft that arrives later is only offered
 * (`Use prepared draft`), never written into the editor.
 */
export function shouldOfferPreparedDraft(input: {
  mode: ReplyDockMode;
  modelStatus: ModelStatus;
  decision: Decision | null;
  agentDraft: AgentDraftState;
  draftCameFromAgent: boolean;
}): boolean {
  if (input.mode !== 'editing') return false;
  if (input.draftCameFromAgent) return false;
  if (!agentDraftApplies(input.modelStatus, input.decision)) return false;
  return input.agentDraft.status === 'ready' && input.agentDraft.bodyPlain.trim().length > 0;
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
