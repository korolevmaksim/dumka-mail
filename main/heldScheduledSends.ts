// Scheduled messages held because their time was missed
// (`shared/scheduledSend.ts`): the durable side.
//
// A hold is one transaction: the draft loses its send time, the action is
// saved as failed with the reason, and a notice for the person is recorded.
// All three or none, so a held message can never be left without its notice,
// whatever happens to the process in between. Notices stay stored (as JSON in
// the settings table) until a window acknowledges that it has shown them.
import { ActionLogRepo, DraftsRepo, SettingsRepo, getDatabase } from './database';
import { runWriteTransaction } from './sqliteWriteGuard';
import { HELD_SCHEDULED_SENDS_MAX, normalizeHeldScheduledSends, type HeldScheduledSend } from '../shared/scheduledSend';
import type { MailActionLog } from '../shared/types';

export const HELD_SCHEDULED_SENDS_KEY = 'heldScheduledSends';

export interface HeldSendInfo {
  /** The time the person chose. */
  sendAt: string;
  draft: unknown;
}

export function readHeldScheduledSends(): HeldScheduledSend[] {
  try {
    return normalizeHeldScheduledSends(JSON.parse(SettingsRepo.get(HELD_SCHEDULED_SENDS_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function heldNoticeFor(action: MailActionLog, held: HeldSendInfo, now: Date = new Date()): HeldScheduledSend | null {
  if (!action.draftId) return null;
  const draft = (held.draft && typeof held.draft === 'object' ? held.draft : {}) as { subject?: unknown };
  return {
    actionId: action.id,
    accountId: action.accountId,
    draftId: action.draftId,
    subject: typeof draft.subject === 'string' ? draft.subject : '',
    sendAt: held.sendAt,
    heldAt: now.toISOString(),
  };
}

/** Stores the hold. `action` is already marked failed with the reason. Throws when it could not be stored (nothing is written then). */
export function storeScheduledSendHold(action: MailActionLog, held: HeldSendInfo, now: Date = new Date()): void {
  const notice = heldNoticeFor(action, held, now);
  runWriteTransaction(getDatabase(), () => {
    const draft = action.draftId ? DraftsRepo.get(action.draftId) : null;
    if (draft) DraftsRepo.save({ ...draft, sendAt: null, updatedAt: now.toISOString() });
    ActionLogRepo.save(action);
    if (notice) {
      const next = [...readHeldScheduledSends().filter(item => item.actionId !== notice.actionId), notice].slice(-HELD_SCHEDULED_SENDS_MAX);
      SettingsRepo.set(HELD_SCHEDULED_SENDS_KEY, JSON.stringify(next));
    }
  });
}

/** A window has shown these notices: forget them. Anything that is not a plausible id is ignored. */
export function acknowledgeHeldScheduledSends(actionIds: unknown): void {
  const shown = new Set(
    (Array.isArray(actionIds) ? actionIds : [])
      .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200)
      .slice(0, HELD_SCHEDULED_SENDS_MAX),
  );
  if (shown.size === 0) return;
  runWriteTransaction(getDatabase(), () => {
    const remaining = readHeldScheduledSends().filter(item => !shown.has(item.actionId));
    SettingsRepo.set(HELD_SCHEDULED_SENDS_KEY, JSON.stringify(remaining));
  });
}
