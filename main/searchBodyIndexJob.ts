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
// This class keeps one loop of steps running while such a record exists, and
// knows whether an update is unfinished. A step itself reports whether a
// record was left, so the loop needs no reads of its own to go on.
import type { SearchIndexStatus } from '../shared/types';

export interface SearchBodyIndexJobDeps {
  /** One committed step on the database worker. `done` means it found no update left. */
  runChunk(): Promise<{ done: boolean }>;
  /** True while an update is recorded and not finished. Asked only when a step failed before anything was known. */
  pending(): boolean;
  publish(status: SearchIndexStatus): void;
  warn(message: string, error: unknown): void;
  sleep?(ms: number): Promise<void>;
  /** Calls `run` later, after a step failed. */
  retryLater?(run: () => void): void;
}

/** Lets the worker serve what the window asks for between two steps. */
const STEP_PAUSE_MS = 25;
const RETRY_MS = 60_000;

export class SearchBodyIndexJob {
  private running = false;
  /** An update is known to be recorded and not finished, also while it waits to try again. */
  private unfinished = false;
  /** Counts the updates recorded while this process runs. */
  private recordings = 0;

  constructor(private readonly deps: SearchBodyIndexJobDeps) {}

  status(): SearchIndexStatus {
    return { updating: this.unfinished };
  }

  /** An update was just recorded with the settings: it is unfinished from this moment, whatever happens next. */
  recorded(): void {
    this.recordings += 1;
    this.markUnfinished();
    this.ensureLoop();
  }

  /** At startup: continues an update that was interrupted by quitting, if there is one. */
  resume(): void {
    this.ensureLoop();
  }

  private markUnfinished(): void {
    if (this.unfinished) return;
    this.unfinished = true;
    this.deps.publish(this.status());
  }

  private ensureLoop(): void {
    if (this.running) return;
    this.running = true;
    void this.run();
  }

  private async run(): Promise<void> {
    const sleep = this.deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    try {
      for (;;) {
        const recordingsBefore = this.recordings;
        const { done } = await this.deps.runChunk();
        if (!done) {
          this.markUnfinished();
          await sleep(STEP_PAUSE_MS);
          continue;
        }
        // The setting can change while the last step is on its way back: that
        // record was written after the step saw none, and without another
        // step it would wait for the next start of the app.
        if (this.recordings === recordingsBefore) break;
      }
    } catch (error) {
      this.running = false;
      this.deps.warn('The search index update paused; it continues later.', error);
      // A step that failed before anything was known (the first one after a
      // start) says nothing about an interrupted update. The record does.
      if (!this.unfinished) {
        try {
          if (this.deps.pending()) this.markUnfinished();
        } catch (readError) {
          this.deps.warn('Could not check for an unfinished search index update.', readError);
        }
      }
      const retry = () => this.ensureLoop();
      if (this.deps.retryLater) this.deps.retryLater(retry);
      else setTimeout(retry, RETRY_MS).unref();
      return;
    }
    this.running = false;
    if (this.unfinished) {
      this.unfinished = false;
      this.deps.publish(this.status());
    }
  }
}
