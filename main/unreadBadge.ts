// The unread number on the app icon (Dock on macOS). Computed in the main
// process so it stays current while the window is closed: after a sync, a
// local change, a due reminder or a settings change, `schedule()` asks for a
// refresh; refreshes are debounced and never overlap.
//
// What is counted is in `shared/unreadBadge.ts`. The reads go through the
// database worker (bounded per account), never the main event loop.
import { accountBadgeCount, unreadBadgeEnabled, UNREAD_BADGE_SCAN_LIMIT, type BadgeSettingsSource } from '../shared/unreadBadge';
import type { MailThread } from '../shared/types';

export interface UnreadBadgeDeps {
  listAccountIds(): string[];
  readSettings(): BadgeSettingsSource;
  unreadInboxThreads(accountId: string, limit: number, nowIso: string): Promise<MailThread[]>;
  /** Shows `count` on the app icon; 0 clears it. */
  setBadge(count: number): void;
  logError(message: string, error: unknown): void;
  now?: () => Date;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const UNREAD_BADGE_DEBOUNCE_MS = 400;

export function createUnreadBadgeService(deps: UnreadBadgeDeps) {
  const delayMs = deps.delayMs ?? UNREAD_BADGE_DEBOUNCE_MS;
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || (handle => clearTimeout(handle as NodeJS.Timeout));
  let timer: unknown = null;
  let running = false;
  let again = false;
  let shown: number | null = null;

  function show(count: number) {
    if (shown === count) return;
    shown = count;
    try {
      deps.setBadge(count);
    } catch (error) {
      shown = null;
      deps.logError('Could not update the unread badge.', error);
    }
  }

  async function count(): Promise<number> {
    const settings = deps.readSettings();
    if (!unreadBadgeEnabled(settings)) return 0;
    const nowIso = (deps.now ? deps.now() : new Date()).toISOString();
    let total = 0;
    for (const accountId of deps.listAccountIds()) {
      const threads = await deps.unreadInboxThreads(accountId, UNREAD_BADGE_SCAN_LIMIT, nowIso);
      total += accountBadgeCount(accountId, threads, settings);
    }
    return total;
  }

  async function refresh(): Promise<void> {
    if (running) {
      // A change arrived while counting: count once more afterwards.
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        show(await count());
      } while (again);
    } catch (error) {
      deps.logError('Could not count unread mail for the badge.', error);
    } finally {
      running = false;
    }
  }

  return {
    /** Asks for a refresh soon; calls in quick succession collapse into one. */
    schedule() {
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        void refresh();
      }, delayMs);
    },
    refresh,
    /** The number last shown (test seam). */
    shownCount: () => shown,
    dispose() {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}

export type UnreadBadgeService = ReturnType<typeof createUnreadBadgeService>;
