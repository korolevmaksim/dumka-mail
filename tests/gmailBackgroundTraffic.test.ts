import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailBackgroundTraffic } from '../main/gmailBackgroundTraffic';

const quota = (reason = 'rateLimitExceeded') => Object.assign(
  new Error(`HTTP 403 — {"error":{"errors":[{"reason":"${reason}"}]}}`), { status: 403 },
);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T14:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('Gmail background traffic', () => {
  it('spaces concurrent background waiters and keeps accounts independent', async () => {
    const traffic = new GmailBackgroundTraffic();
    const starts: number[] = [];
    const start = Date.now();
    await traffic.waitForSlot('me@example.com');
    const a = traffic.waitForSlot('me@example.com').then(() => starts.push(Date.now() - start));
    const b = traffic.waitForSlot('ME@example.com').then(() => starts.push(Date.now() - start));
    await traffic.waitForSlot('other@example.com');
    await vi.advanceTimersByTimeAsync(2999);
    expect(starts).toEqual([]);
    await vi.advanceTimersByTimeAsync(3001);
    await Promise.all([a, b]);
    expect(starts).toEqual([3000, 6000]);
  });

  it('rechecks foreground activity while a background request is waiting', async () => {
    const traffic = new GmailBackgroundTraffic();
    await traffic.waitForSlot('me@example.com');
    const ready = vi.fn();
    const waiting = traffic.waitForSlot('me@example.com').then(ready);
    await vi.advanceTimersByTimeAsync(1000);
    traffic.noteInteractive('me@example.com');
    await vi.advanceTimersByTimeAsync(4999);
    expect(ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(ready).toHaveBeenCalledOnce();
  });

  it('keeps backfill out while a slow mutation is active, then releases it after failure', async () => {
    const traffic = new GmailBackgroundTraffic();
    let fail: (error: Error) => void = () => { throw new Error('Mutation has not started'); };
    const mutation = expect(traffic.runInteractive('me@example.com', () => new Promise<void>((_resolve, reject) => {
      fail = reject;
    }))).rejects.toThrow('offline');
    const ready = vi.fn();
    const waiting = traffic.waitForSlot('me@example.com').then(ready);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ready).not.toHaveBeenCalled();
    fail(new Error('offline'));
    await mutation;
    await vi.advanceTimersByTimeAsync(4999);
    expect(ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(ready).toHaveBeenCalledOnce();
  });

  it('blocks requests for a shared cooldown, then backs off further on another quota failure', async () => {
    const traffic = new GmailBackgroundTraffic(Date.now, undefined, () => 0);
    traffic.noteFailure('me@example.com', quota());
    traffic.noteFailure('me@example.com', quota());
    expect(() => traffic.noteInteractive('me@example.com')).toThrow('quota');
    await expect(traffic.waitForSlot('me@example.com')).rejects.toMatchObject({ status: 429, retryAfter: '60' });
    await traffic.waitForSlot('other@example.com');
    await vi.advanceTimersByTimeAsync(60_000);
    await traffic.waitForSlot('me@example.com');
    traffic.noteFailure('me@example.com', quota('userRateLimitExceeded'));
    await expect(traffic.waitForSlot('me@example.com')).rejects.toMatchObject({ retryAfter: '120' });
  });

  it('honours longer Retry-After and does not throttle ordinary permission errors', async () => {
    const traffic = new GmailBackgroundTraffic(Date.now, undefined, () => 0);
    traffic.noteFailure('me@example.com', quota('insufficientPermissions'));
    await traffic.waitForSlot('me@example.com');
    traffic.noteFailure('me@example.com', Object.assign(quota(), { retryAfter: '180' }));
    await expect(traffic.waitForSlot('me@example.com')).rejects.toMatchObject({ retryAfter: '180' });
  });

  it('stops an already waiting background request when a foreground request discovers a quota', async () => {
    const traffic = new GmailBackgroundTraffic(Date.now, undefined, () => 0);
    await traffic.waitForSlot('me@example.com');
    const waiting = expect(traffic.waitForSlot('me@example.com')).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(1000);
    traffic.noteFailure('me@example.com', quota());
    await vi.advanceTimersByTimeAsync(2000);
    await waiting;
  });
});
