export const SEARCH_INPUT_COMMIT_DELAY_MS = 250;

export interface SearchCommitController {
  schedule: (value: string) => void;
  flush: (value?: string) => void;
  cancel: () => void;
}

export function createSearchCommitController(
  commit: (value: string) => void,
  delayMs = SEARCH_INPUT_COMMIT_DELAY_MS,
): SearchCommitController {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let pendingValue: string | null = null;

  const clearTimer = () => {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const commitPending = () => {
    clearTimer();
    if (pendingValue === null) return;
    const value = pendingValue;
    pendingValue = null;
    commit(value);
  };

  return {
    schedule(value: string) {
      pendingValue = value;
      clearTimer();
      timeoutId = globalThis.setTimeout(commitPending, Math.max(1, delayMs));
    },
    flush(value?: string) {
      if (value !== undefined) {
        pendingValue = value;
      }
      commitPending();
    },
    cancel() {
      clearTimer();
      pendingValue = null;
    },
  };
}
