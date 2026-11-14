// When the renderer may start a new reply-draft request for a conversation.

export interface DraftRequestEntry {
  /** Set while a request is in flight. */
  requestId: string | null;
  /** The last request for this conversation was declined (`skipped`), not failed. */
  skipped: boolean;
}

/**
 * One request per conversation at a time, and a finished one is not repeated.
 * The exception: a draft in advance that was declined (the setting is off, or
 * the background provider is not set up) must not block the person's own
 * `Draft a reply`, which goes to the main model.
 */
export function mayStartDraftRequest(existing: DraftRequestEntry | undefined, inAdvance: boolean): boolean {
  if (!existing) return true;
  return existing.skipped && !existing.requestId && !inAdvance;
}
