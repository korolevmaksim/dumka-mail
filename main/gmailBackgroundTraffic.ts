import { isRateLimitError, parseRetryAfterMs } from './remoteRetry';

// Full threads cost 120 units against a 6,000 unit/user/minute quota. Reserve
// most of that budget for foreground sync, reading and the user's mail actions.
export const BACKFILL_REQUEST_INTERVAL_MS = 3_000;
const INTERACTIVE_QUIET_MS = 5_000;
const QUOTA_BACKOFF_MAX_MS = 15 * 60_000;

interface AccountTraffic {
  activeInteractive: number;
  nextRequestAt: number;
  interactiveUntil: number;
  blockedUntil: number;
  quotaFailures: number;
  lastQuotaFailureAt: number;
}

export class GmailBackgroundTraffic {
  private readonly accounts = new Map<string, AccountTraffic>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
    private readonly random: () => number = Math.random,
  ) {}

  private account(email: string): AccountTraffic {
    const key = email.trim().toLowerCase();
    let state = this.accounts.get(key);
    if (!state) {
      state = { activeInteractive: 0, nextRequestAt: 0, interactiveUntil: 0, blockedUntil: 0, quotaFailures: 0, lastQuotaFailureAt: 0 };
      this.accounts.set(key, state);
    }
    return state;
  }

  /** Called before mutations, including retries, so backfill yields immediately. */
  noteInteractive(email: string): void {
    this.account(email).interactiveUntil = this.now() + INTERACTIVE_QUIET_MS;
    this.assertAvailable(email);
  }

  async runInteractive<T>(email: string, operation: () => Promise<T>): Promise<T> {
    this.noteInteractive(email);
    const state = this.account(email);
    state.activeInteractive += 1;
    try {
      return await operation();
    } finally {
      state.activeInteractive -= 1;
      state.interactiveUntil = this.now() + INTERACTIVE_QUIET_MS;
    }
  }

  private assertAvailable(email: string): void {
    const remaining = this.account(email).blockedUntil - this.now();
    if (remaining <= 0) return;
    throw Object.assign(new Error('Gmail quota is temporarily exhausted. The action will retry after the cooldown.'), {
      status: 429,
      retryAfter: String(Math.ceil(remaining / 1000)),
    });
  }

  noteFailure(email: string, error: unknown): void {
    if (!isRateLimitError(error)) return;
    const state = this.account(email);
    const now = this.now();
    // Concurrent failures in the same cooldown do not exponentially extend it.
    if (state.blockedUntil > now) return;
    if (now - state.lastQuotaFailureAt > 30 * 60_000) state.quotaFailures = 0;
    state.quotaFailures += 1;
    state.lastQuotaFailureAt = now;
    const retryAfter = error && typeof error === 'object' && 'retryAfter' in error && typeof error.retryAfter === 'string'
      ? parseRetryAfterMs(error.retryAfter, new Date(now)) : null;
    const delay = Math.min(60_000 * 2 ** Math.min(state.quotaFailures - 1, 4), QUOTA_BACKOFF_MAX_MS);
    state.blockedUntil = now + Math.max(retryAfter ?? 0, delay) + Math.floor(this.random() * 1000);
  }

  /** One paced request per account; waking waiters recheck activity and quota. */
  async waitForSlot(email: string): Promise<void> {
    for (;;) {
      this.assertAvailable(email);
      const state = this.account(email);
      if (state.activeInteractive > 0) {
        await this.sleep(250);
        continue;
      }
      const wait = Math.max(state.nextRequestAt, state.interactiveUntil) - this.now();
      if (wait <= 0) {
        state.nextRequestAt = this.now() + BACKFILL_REQUEST_INTERVAL_MS;
        return;
      }
      await this.sleep(wait);
    }
  }
}

export const gmailBackgroundTraffic = new GmailBackgroundTraffic();
