import { MailboxRead } from './mailboxRead';
import { MISSING_GMAIL_THREAD_MESSAGE } from '../shared/mailActionErrors';

export class MissingGmailThreadError extends Error {
  constructor() { super(MISSING_GMAIL_THREAD_MESSAGE); }
}

interface MissingThreadDeps {
  exists(accountId: string, threadId: string): Promise<boolean>;
  removeCached(accountId: string, threadId: string): Promise<void>;
  loggedCandidates(accountId: string): Promise<string[]>;
  warnCleanupFailure(accountId: string, error: unknown): void;
  retryLater?(run: () => void): void;
}

/** Gmail can return 404 for a missing label as well as a missing conversation. */
export class MissingGmailThreads {
  private readonly checks = new Map<string, Promise<boolean>>();
  private readonly remaining = new Map<string, string[]>();
  private readonly repairing = new Set<string>();

  private readonly reads = new Map<string, Set<MailboxRead>>();
  private readonly removing = new Map<string, Set<string>>();

  constructor(private readonly deps: MissingThreadDeps) {}

  async duringRead<T>(accountId: string, operation: (read: MailboxRead) => Promise<T>): Promise<T> {
    const read = new MailboxRead(new Set(this.removing.get(accountId)));
    const active = this.reads.get(accountId) ?? new Set<MailboxRead>();
    this.reads.set(accountId, active);
    active.add(read);
    try {
      return await operation(read);
    } finally {
      active.delete(read);
      if (!active.size) this.reads.delete(accountId);
    }
  }

  private async removeConfirmed(accountId: string, threadId: string): Promise<void> {
    const ids = this.removing.get(accountId) ?? new Set<string>();
    if (ids.has(threadId)) return;
    ids.add(threadId);
    this.removing.set(accountId, ids);
    for (const read of this.reads.get(accountId) ?? []) read.excluded.add(threadId);

    const attempt = async () => {
      try {
        await this.deps.removeCached(accountId, threadId);
        ids.delete(threadId);
        if (!ids.size) this.removing.delete(accountId);
      } catch (error) {
        this.deps.warnCleanupFailure(accountId, error);
        const retry = () => { void attempt(); };
        if (this.deps.retryLater) this.deps.retryLater(retry);
        else setTimeout(retry, 30_000).unref();
      }
    };
    await attempt();
  }

  private verify(accountId: string, threadId: string): Promise<boolean> {
    const key = JSON.stringify([accountId, threadId]);
    const pending = this.checks.get(key);
    if (pending) return pending;
    const check = this.deps.exists(accountId, threadId).then(async exists => {
      if (exists) return false;
      await this.removeConfirmed(accountId, threadId);
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
