import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_CHAT_REQUEST_TIMEOUT_MS,
  AIRequestTimeoutError,
  withAIRequestTimeout,
} from '../shared/aiRequest';

describe('AI request timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles with the request result before the deadline', async () => {
    await expect(withAIRequestTimeout(Promise.resolve('ready'))).resolves.toBe('ready');
  });

  it('fails after the 90 second UI deadline', async () => {
    vi.useFakeTimers();
    const neverSettles = new Promise<string>(() => {});
    const result = withAIRequestTimeout(neverSettles);
    const assertion = expect(result).rejects.toBeInstanceOf(AIRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(AI_CHAT_REQUEST_TIMEOUT_MS);
    await assertion;
  });
});
