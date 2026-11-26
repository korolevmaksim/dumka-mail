// Brings the search index in line with the "search the text of messages"
// setting, in the background.
//
// Turning the setting on or off means rewriting the search row of every
// message. That used to be one statement on the main thread: the window froze
// until it was through (minutes on a large cache) and nothing else could write
// to the database meanwhile. Now the database worker does it in short steps,
// the progress is stored with each step, and an update that was interrupted
// by quitting continues at the next start.
//
// What has to be done is recorded in the database, in the same write that
// stores the setting (`SearchRepo.saveAppSettingsStartingBodyIndexUpdate`).
// This class only keeps one loop running while such a record exists.
import type { SearchIndexStatus } from '../shared/types';

export interface SearchBodyIndexJobDeps {
  /** True while an update is recorded and not finished. */
  pending(): boolean;
  /** One committed step on the database worker. `done` means it found no update left. */
  runChunk(): Promise<{ done: boolean }>;
  publish(status: SearchIndexStatus): void;
  warn(message: string, error: unknown): void;
  sleep?(ms: number): Promise<void>;
  /** Calls `run` later, after a step or a look at the record failed. */
  retryLater?(run: () => void): void;
}

/** Lets the worker serve what the window asks for between two steps. */
const STEP_PAUSE_MS = 25;
const RETRY_MS = 60_000;

export class SearchBodyIndexJob {
  private running = false;
  /** An update is recorded and not finished, also while it waits to try again. */
  private unfinished = false;

  constructor(private readonly deps: SearchBodyIndexJobDeps) {}

  status(): SearchIndexStatus {
    return { updating: this.unfinished };
  }

  /**
   * Runs the recorded update, if there is one and none is running. Call it at
   * startup and whenever an update was recorded; a running loop picks a new
   * record up with its next step.
   */
  resume(): void {
    if (this.running) return;
    let pending: boolean;
    try {
      pending = this.deps.pending();
    } catch (error) {
      this.deps.warn('Could not check for an unfinished search index update; it is checked again later.', error);
      this.later(() => this.resume());
      return;
    }
    if (!pending) {
      // A step can finish the update and lose its answer on the way back
      // (the worker timed out or was restarted). The next look finds nothing
      // left; without this the window would be told "updating" for good.
      if (this.unfinished) {
        this.unfinished = false;
        this.deps.publish(this.status());
      }
      return;
    }
    this.running = true;
    if (!this.unfinished) {
      this.unfinished = true;
      this.deps.publish(this.status());
    }
    void this.run();
  }

  private later(run: () => void): void {
    if (this.deps.retryLater) this.deps.retryLater(run);
    else setTimeout(run, RETRY_MS).unref();
  }

  private async run(): Promise<void> {
    const sleep = this.deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    try {
      for (;;) {
        const { done } = await this.deps.runChunk();
        if (!done) {
          await sleep(STEP_PAUSE_MS);
          continue;
        }
        // The setting can change while the last step is on its way back: that
        // record was written after the step saw none. Without this look it
        // would wait for the next start of the app.
        if (!this.deps.pending()) break;
      }
    } catch (error) {
      this.running = false;
      this.deps.warn('The search index update paused; it continues later.', error);
      this.later(() => this.resume());
      return;
    }
    this.running = false;
    this.unfinished = false;
    this.deps.publish(this.status());
  }
}
