import { MISSING_GMAIL_THREAD_MESSAGE } from '../shared/mailActionErrors';

export class MissingGmailThreadError extends Error {
  constructor() { super(MISSING_GMAIL_THREAD_MESSAGE); }
}

interface MissingThreadDeps {
  exists(accountId: string, threadId: string): Promise<boolean>;
  removeCached(accountId: string, threadId: string): Promise<void>;
  loggedCandidates(accountId: string): Promise<string[]>;
}

/** Gmail can return 404 for a missing label as well as a missing conversation. */
export class MissingGmailThreads {
  private readonly checks = new Map<string, Promise<boolean>>();
  private readonly remaining = new Map<string, string[]>();
  private readonly repairing = new Set<string>();

  constructor(private readonly deps: MissingThreadDeps) {}

  private verify(accountId: string, threadId: string): Promise<boolean> {
    const key = JSON.stringify([accountId, threadId]);
    const pending = this.checks.get(key);
    if (pending) return pending;
    const check = this.deps.exists(accountId, threadId).then(async exists => {
      if (exists) return false;
      await this.deps.removeCached(accountId, threadId);
      return true;
    }).finally(() => this.checks.delete(key));
    this.checks.set(key, check);
    return check;
  }

  async mutate(accountId: string, threadId: string, operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      if (error instanceof Error && 'status' in error && error.status === 404
        && await this.verify(accountId, threadId)) throw new MissingGmailThreadError();
      throw error;
    }
  }

  /** Revisit old failed actions a few at a time after successful syncs. */
  async repairLoggedFailures(accountId: string): Promise<void> {
    if (this.repairing.has(accountId)) return;
    this.repairing.add(accountId);
    try {
      const ids = this.remaining.get(accountId) ?? await this.deps.loggedCandidates(accountId);
      this.remaining.set(accountId, ids);
      for (let count = 0; ids.length && count < 3; count++) {
        await this.verify(accountId, ids[ids.length - 1]);
        ids.pop();
      }
    } finally {
      this.repairing.delete(accountId);
    }
  }
}
