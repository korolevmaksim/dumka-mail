// `fetch` with redirects followed by hand, so every hop is checked by the same
// URL policy as the first request (an unsubscribe link must not bounce the
// request to a private address). Small hop limit; no body is resent on a
// redirect that changes the method.

export interface SafeRedirectFetchOptions {
  /** True when the request may go to this URL (checked for the first URL and every hop). */
  isAllowedUrl: (url: string) => boolean;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
}

export class UnsafeRedirectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeRedirectError';
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function fetchWithSafeRedirects(url: string, init: RequestInit, options: SafeRedirectFetchOptions): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = Math.max(0, options.maxRedirects ?? 3);
  let current = url;
  let request: RequestInit = { ...init, redirect: 'manual' };
  for (let hop = 0; ; hop += 1) {
    if (!options.isAllowedUrl(current)) {
      throw new UnsafeRedirectError(hop === 0 ? 'URL rejected: non-public address.' : 'Redirect rejected: non-public address.');
    }
    const res = await fetchImpl(current, request);
    if (!REDIRECT_STATUSES.has(res.status)) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    // The redirect's own body is never read; release the connection before the next hop.
    await res.body?.cancel().catch(() => undefined);
    if (hop >= maxRedirects) throw new UnsafeRedirectError('Too many redirects.');
    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      throw new UnsafeRedirectError('Redirect rejected: invalid location.');
    }
    // 307 / 308 keep the method and body; the others continue as a GET without a body.
    if (res.status !== 307 && res.status !== 308) {
      const { body: _body, ...rest } = request;
      const headers = new Headers(rest.headers);
      headers.delete('content-type');
      request = { ...rest, method: 'GET', headers, redirect: 'manual' };
    }
    current = next;
  }
}
