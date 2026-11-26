import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../main/keychain', () => ({ getRefreshToken: vi.fn(async () => 'fixture-refresh') }));
vi.mock('../main/gmailOAuth', () => ({
  loadGoogleConfig: () => ({ installed: { client_id: 'fixture-client', token_uri: 'https://oauth.example/token' } }),
  startOAuthFlow: vi.fn(),
  base64urlSafe: (value: Buffer) => value.toString('base64url'),
}));

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const quotaBody = { error: { code: 403, errors: [{ reason: 'rateLimitExceeded' }] } };

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T14:00:00Z')); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Gmail quota transport and backfill', () => {
  it('preserves quota classification even when the reason is beyond the bounded error summary', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: 'fixture-access' }))
      .mockResolvedValueOnce(json({ error: { code: 403, message: 'x'.repeat(1500), errors: [{ reason: 'rateLimitExceeded' }] } }, 403));
    vi.stubGlobal('fetch', fetchMock);
    const { GmailSyncService } = await import('../main/gmail');
    const { isRetryableRemoteError, scheduledAtForRetry } = await import('../main/actionReconciler');
    const error = await GmailSyncService.modifyLabels('me@example.com', 't1', [], ['INBOX']).catch((error: unknown) => error);
    expect(isRetryableRemoteError(error)).toBe(true);
    expect(scheduledAtForRetry(error)).toBe('2026-11-13T14:01:00.000Z');
    await expect(GmailSyncService.modifyLabels('me@example.com', 't2', [], ['INBOX'])).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([403, 503])('rejects an incomplete page on HTTP %s instead of returning its next cursor', async status => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ access_token: 'fixture-access' }))
      .mockResolvedValueOnce(json({ threads: [{ id: 't1' }, { id: 't2' }, { id: 't3' }], nextPageToken: 'next' }))
      .mockResolvedValueOnce(json({ id: 't1', messages: [] }))
      .mockResolvedValueOnce(json(status === 403 ? quotaBody : { error: { message: 'Unavailable' } }, status));
    vi.stubGlobal('fetch', fetchMock);
    const { GmailSyncService } = await import('../main/gmail');
    const pending = expect(GmailSyncService.syncBackfillPage('me@example.com', 'original')).rejects.toMatchObject({ status });
    await vi.advanceTimersByTimeAsync(6000);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1][0]).toContain('maxResults=20');
    expect(fetchMock.mock.calls[1][0]).toContain('pageToken=original');
  });

  it('lets a mutation finish while backfill is sleeping and delays the next background read', async () => {
    const calls: Array<{ url: string; at: number }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push({ url, at: Date.now() });
      if (url.includes('/token')) return json({ access_token: 'fixture-access' });
      if (url.includes('maxResults=')) return json({ threads: [{ id: 't1' }], nextPageToken: 'next' });
      return json({ id: 't1', messages: [] });
    }));
    const { GmailSyncService } = await import('../main/gmail');
    const page = GmailSyncService.syncBackfillPage('me@example.com');
    await vi.advanceTimersByTimeAsync(1000);
    await GmailSyncService.modifyLabels('me@example.com', 'manual', [], ['INBOX']);
    const mutation = calls.find(call => call.url.endsWith('/manual/modify'));
    expect(mutation?.at).toBe(Date.parse('2026-11-13T14:00:01Z'));
    await vi.advanceTimersByTimeAsync(4999);
    expect(calls.some(call => call.url.endsWith('/threads/t1'))).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(page).resolves.toMatchObject({ nextPageToken: 'next' });
    expect(calls.find(call => call.url.endsWith('/threads/t1'))?.at).toBe(Date.parse('2026-11-13T14:00:06Z'));
  });

  it('waits while the mailbox sync is catching up and then continues with a fresh access token', async () => {
    const calls: string[] = [];
    let tokens = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: { headers?: Record<string, string> }) => {
      calls.push(url.includes('/token') ? 'token' : `${url.split('/v1/users/me/')[1].split('?')[0]} ${options?.headers?.Authorization}`);
      if (url.includes('/token')) return json({ access_token: `access-${++tokens}` });
      if (url.includes('maxResults=')) return json({ threads: [{ id: 't1' }] });
      return json({ id: 't1', messages: [] });
    }));
    const { GmailSyncService } = await import('../main/gmail');
    const { gmailBackgroundTraffic } = await import('../main/gmailBackgroundTraffic');
    const page = GmailSyncService.syncBackfillPage('me@example.com');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['token', 'threads Bearer access-1']);

    // The sync reads ten conversations a minute for 25 minutes.
    for (let minute = 0; minute < 25; minute += 1) {
      for (let read = 0; read < 10; read += 1) gmailBackgroundTraffic.takeSyncThreadRead('me@example.com');
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(page).resolves.toMatchObject({ threads: [] });
    expect(calls.slice(2)).toEqual(['token', 'threads/t1 Bearer access-2']);
  });

  it('skips a deleted thread but finishes the page', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ access_token: 'fixture-access' }))
      .mockResolvedValueOnce(json({ threads: [{ id: 'gone' }], nextPageToken: 'next' }))
      .mockResolvedValueOnce(json({ error: { message: 'Not found' } }, 404)));
    const { GmailSyncService } = await import('../main/gmail');
    const pending = GmailSyncService.syncBackfillPage('me@example.com');
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toEqual({ threads: [], messages: [], nextPageToken: 'next' });
  });
});

it.each([[200, true], [404, false]] as const)('checks the requested thread without fetching message bodies (%i)', async (status, exists) => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(json({ access_token: 'fixture-access' }))
    .mockResolvedValueOnce(json({}, status));
  vi.stubGlobal('fetch', fetchMock);
  const { GmailSyncService } = await import('../main/gmail');
  await expect(GmailSyncService.threadExists('me@example.com', 'test-id')).resolves.toBe(exists);
  expect(fetchMock.mock.calls[1][0]).toBe('https://gmail.googleapis.com/gmail/v1/users/me/threads/test-id?format=minimal&fields=id');
  expect(fetchMock.mock.calls[1][1].method).toBe('GET');
});
