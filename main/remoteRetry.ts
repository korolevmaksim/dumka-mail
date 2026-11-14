/** Only explicit quota reasons make a Google 403 retryable; permission failures stay permanent. */
export function isRateLimitError(error: unknown): boolean {
  const status = httpStatus(error);
  if (status === 429) return true;
  if (status !== 403) return false;
  if (error && typeof error === 'object' && 'rateLimited' in error && error.rateLimited === true) return true;
  return /"reason"\s*:\s*"(?:rateLimitExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED)"/i.test(errorMessage(error));
}

function errorMessage(error: unknown): string {
  return String(error && typeof error === 'object' && 'message' in error ? error.message : error);
}

function httpStatus(error: unknown): number {
  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : NaN;
  return Number.isFinite(status) ? status : Number(errorMessage(error).match(/HTTP\s+(\d{3})/i)?.[1]);
}

export function isTransientHttpError(error: unknown): boolean {
  if (!error) return false;
  const name = typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (['AbortError', 'TimeoutError', 'RequestTimeoutError'].includes(name)) return true;
  const status = httpStatus(error);
  return isRateLimitError(error) || status === 408 || status === 425 || (status >= 500 && status <= 599);
}

export function parseRetryAfterMs(retryAfter: string | null | undefined, now = new Date()): number | null {
  if (!retryAfter?.trim()) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 15 * 60 * 1000);
  const date = Date.parse(retryAfter);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, Math.min(date - now.getTime(), 15 * 60 * 1000));
}

export function scheduledAtForRetry(error: unknown, now = new Date()): string | null {
  const retryAfter = error && typeof error === 'object' && 'retryAfter' in error && typeof error.retryAfter === 'string'
    ? error.retryAfter : null;
  const ms = parseRetryAfterMs(retryAfter, now) ?? (isRateLimitError(error) ? 60_000 : null);
  return ms == null ? null : new Date(now.getTime() + ms).toISOString();
}
