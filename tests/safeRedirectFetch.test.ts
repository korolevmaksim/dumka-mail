import { describe, expect, it, vi } from 'vitest';
import { fetchWithSafeRedirects, UnsafeRedirectError } from '../main/safeRedirectFetch';
import { isSafePublicHttpUrl } from '../shared/mailSecurity';
import { escapeHtml, oauthCallbackPage } from '../main/gmailOAuth';

function redirect(status: number, location: string): Response {
  return new Response(null, { status, headers: { location } });
}

const init: RequestInit = {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'List-Unsubscribe=One-Click',
};

describe('fetchWithSafeRedirects (unsubscribe)', () => {
  it('checks every hop with the same public-address rule', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(redirect(302, 'http://127.0.0.1:8080/admin'));
    await expect(fetchWithSafeRedirects('https://links.example/u/1', init, { isAllowedUrl: isSafePublicHttpUrl, fetchImpl }))
      .rejects.toBeInstanceOf(UnsafeRedirectError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('rejects a private first URL without a request', async () => {
    const fetchImpl = vi.fn();
    await expect(fetchWithSafeRedirects('http://192.168.1.10/u', init, { isAllowedUrl: isSafePublicHttpUrl, fetchImpl }))
      .rejects.toThrow(/non-public/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('follows public hops, keeping POST on 307/308 and switching to GET otherwise', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(redirect(307, '/next'))
      .mockResolvedValueOnce(redirect(303, 'https://done.example/thanks'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await fetchWithSafeRedirects('https://links.example/u/1', init, { isAllowedUrl: isSafePublicHttpUrl, fetchImpl });
    expect(res.status).toBe(200);
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([
      'https://links.example/u/1', 'https://links.example/next', 'https://done.example/thanks',
    ]);
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'POST', body: 'List-Unsubscribe=One-Click' });
    expect(fetchImpl.mock.calls[2][1].method).toBe('GET');
    expect(fetchImpl.mock.calls[2][1].body).toBeUndefined();
  });

  it('stops after the hop limit', async () => {
    const fetchImpl = vi.fn(async () => redirect(302, 'https://loop.example/again'));
    await expect(fetchWithSafeRedirects('https://loop.example/start', init, { isAllowedUrl: isSafePublicHttpUrl, fetchImpl, maxRedirects: 2 }))
      .rejects.toThrow(/Too many redirects/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('isSafePublicHttpUrl special IPv6 and localhost forms', () => {
  it.each([
    'http://[::]/u',
    'http://[::1]/u',
    'http://[::7f00:1]/u',
    'http://[::127.0.0.1]/u',
    'http://[64:ff9b::7f00:1]/u',
    'http://[64:ff9b::10.0.0.1]/u',
    'http://[::ffff:127.0.0.1]/u',
    'http://[::ffff:a9fe:a9fe]/u',
    'http://[fd00::1]/u',
    'http://[fe80::1%25en0]/u',
    'http://[ff02::1]/u',
    'http://foo.localhost/u',
    'http://a.b.localhost./u',
    'http://localhost/u',
  ])('rejects %s', url => {
    expect(isSafePublicHttpUrl(url)).toBe(false);
  });

  it.each([
    'https://[2001:4860:4860::8888]/u',
    'https://[64:ff9b::808:808]/u',
    'https://[::ffff:8.8.8.8]/u',
    'https://localhost.example/u',
  ])('accepts %s', url => {
    expect(isSafePublicHttpUrl(url)).toBe(true);
  });

  it('rejects a redirect hop to an IPv6-embedded loopback', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(redirect(302, 'http://[64:ff9b::7f00:1]/admin'));
    await expect(fetchWithSafeRedirects('https://links.example/u/1', init, { isAllowedUrl: isSafePublicHttpUrl, fetchImpl }))
      .rejects.toBeInstanceOf(UnsafeRedirectError);
  });

  it('cancels the body of each redirect response', async () => {
    const cancelled: number[] = [];
    const withBody = (status: number, location: string, index: number) => new Response(new ReadableStream({
      cancel() { cancelled.push(index); },
    }), { status, headers: { location } });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(withBody(302, 'https://links.example/b', 1))
      .mockResolvedValueOnce(withBody(301, 'https://links.example/c', 2))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    await fetchWithSafeRedirects('https://links.example/a', init, { isAllowedUrl: isSafePublicHttpUrl, fetchImpl });
    expect(cancelled).toEqual([1, 2]);
  });
});

describe('OAuth loopback page', () => {
  it('escapes everything it writes', () => {
    expect(escapeHtml('<script>alert("x")</script>&\'')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;');
    const page = oauthCallbackPage('Sign-in did not complete.', '<img src=x onerror=alert(1)>');
    expect(page).not.toContain('<img');
    expect(page).toContain('&lt;img');
  });
});
