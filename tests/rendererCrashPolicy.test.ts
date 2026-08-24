import { describe, expect, it } from 'vitest';
import { shouldReloadAfterRendererCrash } from '../main/rendererCrashPolicy';

describe('shouldReloadAfterRendererCrash', () => {
  it('reloads a crashed renderer while under the cap', () => {
    expect(shouldReloadAfterRendererCrash({
      reason: 'crashed',
      reloadCountInWindow: 0,
      windowClosing: false,
    })).toBe(true);
    expect(shouldReloadAfterRendererCrash({
      reason: 'oom',
      reloadCountInWindow: 2,
      windowClosing: false,
    })).toBe(true);
  });

  it('stops reloading after the cap so a post-load crash cannot loop forever', () => {
    expect(shouldReloadAfterRendererCrash({
      reason: 'crashed',
      reloadCountInWindow: 3,
      windowClosing: false,
    })).toBe(false);
  });

  it('ignores a clean renderer exit and a window that is already closing', () => {
    expect(shouldReloadAfterRendererCrash({
      reason: 'clean-exit',
      reloadCountInWindow: 0,
      windowClosing: false,
    })).toBe(false);
    expect(shouldReloadAfterRendererCrash({
      reason: 'crashed',
      reloadCountInWindow: 0,
      windowClosing: true,
    })).toBe(false);
  });
});
