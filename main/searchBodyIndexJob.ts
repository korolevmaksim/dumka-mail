// Brings the search index in line with the "search the text of messages"
// setting, in the background.
//
// Turning the setting on or off means rewriting the search row of every
// message. That used to be one statement on the main thread: the window froze
// until it was through (minutes on a large cache) and nothing else could write
// to the database meanwhile. Now the database worker does it in short steps,
// the progress is stored with each step, and an update that was interrupted
// by quitting continues at the next start.
import type { SearchIndexStatus } from '../shared/types';

export interface SearchBodyIndexJobDeps {
  /** Records that every search row has to be brought in line with `enabled`. */
  start(enabled: boolean): void;
  /** True while such an update is recorded and not finished. */
  pending(): boolean;
  /** One committed step on the database worker. */
  runChunk(): Promise<{ done: boolean }>;
  publish(status: SearchIndexStatus): void;
  warn(message: string, error: unknown): void;
  sleep?(ms: number): Promise<void>;
  /** Calls `run` later, after a step or the recording of an update failed. */
  retryLater?(run: () => void): void;
}

/** Lets the worker serve what the window asks for between two steps. */
const STEP_PAUSE_MS = 25;
const RETRY_MS = 60_000;

export class SearchBodyIndexJob {
  private running = false;
  /** An update is recorded and not finished, also while it waits to try again. */
  private unfinished = false;
  private latestRequest = 0;

  constructor(private readonly deps: SearchBodyIndexJobDeps) {}

  status(): SearchIndexStatus {
    return { updating: this.unfinished };
  }

  /** The setting changed: start over towards `enabled`. A running update picks the new target up with its next step. */
  request(enabled: boolean): void {
    const request = ++this.latestRequest;
    try {
      this.deps.start(enabled);
    } catch (error) {
      // The setting itself is saved. Without a record the index would stay as
      // it was until the setting is changed again, so recording is tried again,
      // unless a newer choice has replaced this one by then.
      this.deps.warn('Could not record the search index update; it is tried again later.', error);
      this.later(() => {
        if (request === this.latestRequest) this.request(enabled);
      });
      return;
    }
    this.resume();
  }

  private later(run: () => void): void {
    if (this.deps.retryLater) this.deps.retryLater(run);
    else setTimeout(run, RETRY_MS).unref();
  }

  /** Continues an update that is recorded, if none is running. Safe to call at any time. */
  resume(): void {
    if (this.running) return;
    try {
      if (!this.deps.pending()) return;
    } catch (error) {
      this.deps.warn('Could not check for an unfinished search index update.', error);
      return;
    }
    this.running = true;
    if (!this.unfinished) {
      this.unfinished = true;
      this.deps.publish(this.status());
    }
    void this.run();
  }

  private async run(): Promise<void> {
    const sleep = this.deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    let failed = false;
    try {
      for (;;) {
        const { done } = await this.deps.runChunk();
        if (done) break;
        await sleep(STEP_PAUSE_MS);
      }
    } catch (error) {
      failed = true;
      this.deps.warn('The search index update paused; it continues later.', error);
    }
    this.running = false;
    if (!failed) {
      this.unfinished = false;
      this.deps.publish(this.status());
      return;
    }
    this.later(() => this.resume());
  }
}
