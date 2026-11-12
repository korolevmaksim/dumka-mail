import type { ComposeAfterSend } from './types';

/**
 * `default` is `⌘↩` (or the Send button); `alternate` is `⌘⇧↩`, which does the
 * opposite of the "After sending a reply" setting.
 */
export type SendIntent = 'default' | 'alternate';

export const DEFAULT_COMPOSE_AFTER_SEND: ComposeAfterSend = 'archive';

export function normalizeComposeAfterSend(value: unknown): ComposeAfterSend {
  return value === 'keep' || value === 'archive' ? value : DEFAULT_COMPOSE_AFTER_SEND;
}

export function resolveAfterSend(setting: unknown, intent: SendIntent = 'default'): ComposeAfterSend {
  const base = normalizeComposeAfterSend(setting);
  if (intent === 'default') return base;
  return base === 'archive' ? 'keep' : 'archive';
}

/**
 * A send archives its thread only for a reply (a draft attached to a thread)
 * whose thread is still in the inbox. A brand-new message never archives.
 */
export function shouldArchiveOnSend(input: {
  afterSend: ComposeAfterSend;
  threadId: string | null | undefined;
  threadLabelIds: readonly string[] | null | undefined;
}): boolean {
  if (input.afterSend !== 'archive') return false;
  if (!input.threadId) return false;
  if (!input.threadLabelIds) return false;
  return input.threadLabelIds.some(label => label.toUpperCase() === 'INBOX');
}

export interface SentThreadRef {
  accountId: string;
  threadId: string | null | undefined;
}

export interface OpenedThreadRef {
  accountId: string;
  id: string;
}

/**
 * When the undo window ends, the reader closes only if it still shows the very
 * thread that was sent (compared against the *current* opened thread, never a
 * value captured when the send started). An archived send already moved the
 * reader on, so it never closes anything.
 */
export function shouldCloseReaderAfterSend(input: {
  sent: SentThreadRef;
  opened: OpenedThreadRef | null | undefined;
  archived: boolean;
}): boolean {
  if (input.archived) return false;
  if (!input.sent.threadId || !input.opened) return false;
  return input.opened.id === input.sent.threadId && input.opened.accountId === input.sent.accountId;
}

export function sendButtonLabel(afterSend: ComposeAfterSend, isReply: boolean): string {
  return isReply && afterSend === 'archive' ? 'Send and archive' : 'Send';
}

/** "Send and archive" whose archive step failed: the thread stays in the inbox. */
export function archiveAfterSendFailedMessage(): string {
  return "The reply is being sent, but the conversation couldn't be archived. It stays in your inbox.";
}

/*
 * Undo-send lifecycle. One pending send ends in exactly one of two outcomes:
 * sent, or restored (the draft comes back). The 10 s timer, an early commit
 * (a newer send), Undo, a failed write and a failed delivery all feed one
 * small state machine, so whichever event arrives first decides and the
 * others become no-ops. Pure so the race table is unit-tested.
 */

export type PendingSendPhase =
  /** In the undo window (or still being written to disk). */
  | 'waiting'
  /** Undo was pressed; the parked action is being cancelled. */
  | 'cancelling'
  /** Delivery started (timer, early commit, or a cancel that came too late). */
  | 'sending'
  | 'sent'
  | 'restored';

export type PendingSendEvent =
  | 'timerFired'
  | 'commitNow'
  | 'cancelRequested'
  | 'cancelSucceeded'
  /** The parked action could not be cancelled: it may still go out, so delivery resumes. */
  | 'cancelFailed'
  /** Saving the scheduled draft or its parked action failed: nothing can send it. */
  | 'persistFailed'
  /** The send was accepted (sent now, or parked offline for sync). */
  | 'sendSucceeded'
  /** Delivery found the action already handled elsewhere (e.g. by the background worker). */
  | 'sendUnconfirmed'
  | 'sendFailed';

export type PendingSendRestoreCause = 'cancelled' | 'notSaved' | 'failed';

export interface PendingSendStep {
  phase: PendingSendPhase;
  /** `deliver`: start sending; `restore`: give the draft back; `notifySent`: positive evidence it was sent. */
  effect: 'none' | 'deliver' | 'restore' | 'notifySent';
  restoreCause?: PendingSendRestoreCause;
}

const stay = (phase: PendingSendPhase): PendingSendStep => ({ phase, effect: 'none' });
const restore = (restoreCause: PendingSendRestoreCause): PendingSendStep => ({ phase: 'restored', effect: 'restore', restoreCause });

export function stepPendingSend(phase: PendingSendPhase, event: PendingSendEvent): PendingSendStep {
  switch (phase) {
    case 'waiting':
      if (event === 'timerFired' || event === 'commitNow') return { phase: 'sending', effect: 'deliver' };
      if (event === 'cancelRequested') return stay('cancelling');
      if (event === 'persistFailed') return restore('notSaved');
      return stay(phase);
    case 'cancelling':
      // Undo was pressed first: the timer and early commits no longer decide.
      if (event === 'cancelSucceeded') return restore('cancelled');
      if (event === 'cancelFailed') return { phase: 'sending', effect: 'deliver' };
      if (event === 'persistFailed') return restore('notSaved');
      return stay(phase);
    case 'sending':
      // Too late to undo; delivery decides.
      if (event === 'sendSucceeded') return { phase: 'sent', effect: 'notifySent' };
      if (event === 'sendUnconfirmed') return stay('sent');
      if (event === 'sendFailed') return restore('failed');
      if (event === 'persistFailed') return restore('notSaved');
      return stay(phase);
    case 'sent':
    case 'restored':
      return stay(phase);
  }
}

/**
 * Where a draft goes back to when its send is undone or fails late. The
 * editor only when it is free: a draft the user has started since is never
 * replaced; the returned one is saved to Drafts instead.
 */
export type RestoredDraftPlacement = 'editor' | 'alreadyOpen' | 'drafts';

export function restoredDraftPlacement(input: {
  activeDraftId: string | null | undefined;
  draftId: string;
}): RestoredDraftPlacement {
  if (!input.activeDraftId) return 'editor';
  return input.activeDraftId === input.draftId ? 'alreadyOpen' : 'drafts';
}

/** Toast for a restored send; null when nothing needs saying (Undo put it back in the editor). */
export function restoredSendMessage(cause: PendingSendRestoreCause, placement: RestoredDraftPlacement): string | null {
  const where = placement === 'drafts' ? "It's saved in Drafts." : "It's back in the editor.";
  switch (cause) {
    case 'cancelled':
      return placement === 'drafts' ? `Send cancelled. ${where}` : null;
    case 'notSaved':
      return `Couldn't prepare the message for sending, so it wasn't sent. ${where}`;
    case 'failed':
      return `Message not sent. ${where}`;
  }
}

/**
 * Outcome of one delivery attempt. `delivered` turns true the moment the send
 * call resolves; bookkeeping after that (deleting the local draft, marking the
 * parked action completed) can fail without un-sending anything.
 */
export type DeliveryOutcome<T> =
  | { delivered: true; result: T; bookkeepingError: unknown }
  | { delivered: false; error: unknown };

/**
 * Runs `send`, then `record`. A failure in `send` is a failed delivery; a
 * failure in `record` is reported as `bookkeepingError` on a delivered send,
 * never as a failure — treating it as one would restore a draft that was
 * already sent and invite a second send.
 */
export async function deliverThenRecord<T>(
  send: () => Promise<T>,
  record: (result: T) => Promise<void> | void,
): Promise<DeliveryOutcome<T>> {
  let result: T;
  try {
    result = await send();
  } catch (error) {
    return { delivered: false, error };
  }
  try {
    await record(result);
    return { delivered: true, result, bookkeepingError: null };
  } catch (bookkeepingError) {
    return { delivered: true, result, bookkeepingError };
  }
}

/**
 * The lifecycle event for a delivery attempt. Once the message was handed
 * over, any later error is bookkeeping: the send succeeded.
 */
export function deliveryEvent(input: { delivered: boolean; accepted?: boolean }): 'sendSucceeded' | 'sendFailed' {
  if (input.delivered) return 'sendSucceeded';
  return input.accepted ? 'sendSucceeded' : 'sendFailed';
}
