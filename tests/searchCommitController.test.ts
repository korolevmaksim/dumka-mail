import { describe, expect, it, vi } from 'vitest';
import { createSearchCommitController, SEARCH_INPUT_COMMIT_DELAY_MS } from '../renderer/src/components/layout/searchCommitController';

describe('search commit controller', () => {
  it('debounces rapid search input changes into one store commit', async () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const controller = createSearchCommitController(commit);

    controller.schedule('c');
    controller.schedule('co');
    controller.schedule('contract');

    await vi.advanceTimersByTimeAsync(SEARCH_INPUT_COMMIT_DELAY_MS - 1);

    expect(commit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('contract');
    vi.useRealTimers();
  });

  it('can flush or cancel a pending search commit', async () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const controller = createSearchCommitController(commit);

    controller.schedule('invoice');
    controller.flush();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('invoice');

    controller.schedule('ignored');
    controller.cancel();
    await vi.advanceTimersByTimeAsync(SEARCH_INPUT_COMMIT_DELAY_MS);

    expect(commit).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
