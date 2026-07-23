import type {
  GoogleAuthIssue,
  GoogleAuthIssueReason,
  GoogleAuthStateChange,
} from '../shared/types';

interface GoogleOAuthErrorPayload {
  error?: unknown;
  error_description?: unknown;
}

type GoogleAuthStateListener = (change: GoogleAuthStateChange) => void;

function normalizeAccountId(accountId: string): string {
  return accountId.trim().toLowerCase();
}

function parseOAuthErrorPayload(body: string): GoogleOAuthErrorPayload {
  try {
    const parsed = JSON.parse(body) as GoogleOAuthErrorPayload;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    const params = new URLSearchParams(body);
    return {
      error: params.get('error'),
      error_description: params.get('error_description'),
    };
  }
}

export function googleReauthorizationReasonForTokenResponse(
  status: number,
  body: string,
): GoogleAuthIssueReason | null {
  const payload = parseOAuthErrorPayload(body);
  const providerCode = typeof payload.error === 'string' ? payload.error.trim().toLowerCase() : '';
  const description = typeof payload.error_description === 'string'
    ? payload.error_description.trim().toLowerCase()
    : '';

  if (
    providerCode === 'invalid_grant'
    || providerCode === 'invalid_token'
    || providerCode === 'unauthorized_client'
  ) {
    return 'credentials_rejected';
  }
  if (providerCode === 'access_denied') {
    return 'permissions_changed';
  }
  if (
    (status === 400 || status === 401)
    && /\b(?:refresh )?token\b/.test(description)
    && /\b(?:expired|revoked|invalid|rejected)\b/.test(description)
  ) {
    return 'credentials_rejected';
  }
  return null;
}

export function googleReauthorizationReasonForApiResponse(
  status: number,
  body: string,
): GoogleAuthIssueReason | null {
  if (status === 401) return 'credentials_rejected';
  if (status !== 403) return null;

  const normalized = body.toLowerCase();
  if (
    normalized.includes('insufficient authentication scopes')
    || normalized.includes('insufficientpermissions')
    || /"reason"\s*:\s*"autherror"/.test(normalized)
    || /"status"\s*:\s*"unauthenticated"/.test(normalized)
  ) {
    return 'permissions_changed';
  }
  return null;
}

export class GoogleReauthorizationRequiredError extends Error {
  readonly code = 'GOOGLE_REAUTHORIZATION_REQUIRED';

  constructor(
    readonly accountId: string,
    readonly reason: GoogleAuthIssueReason,
  ) {
    super(`Google authorization must be renewed for ${accountId}.`);
    this.name = 'GoogleReauthorizationRequiredError';
  }
}

export function isGoogleReauthorizationRequiredError(
  error: unknown,
): error is GoogleReauthorizationRequiredError {
  return error instanceof GoogleReauthorizationRequiredError;
}

export class GoogleAuthState {
  private readonly issues = new Map<string, GoogleAuthIssue>();
  private readonly listeners = new Set<GoogleAuthStateListener>();

  list(): GoogleAuthIssue[] {
    return Array.from(this.issues.values()).sort((a, b) => a.accountId.localeCompare(b.accountId));
  }

  get(accountId: string): GoogleAuthIssue | null {
    return this.issues.get(normalizeAccountId(accountId)) || null;
  }

  requiresReauthorization(accountId: string): boolean {
    return this.issues.has(normalizeAccountId(accountId));
  }

  mark(
    accountId: string,
    reason: GoogleAuthIssueReason,
    detectedAt = new Date().toISOString(),
  ): GoogleAuthIssue {
    const normalizedAccountId = normalizeAccountId(accountId);
    const existing = this.issues.get(normalizedAccountId);
    if (existing?.reason === reason) return existing;

    const issue: GoogleAuthIssue = {
      accountId: normalizedAccountId,
      reason,
      detectedAt,
    };
    this.issues.set(normalizedAccountId, issue);
    this.publish({ accountId: normalizedAccountId, issue });
    return issue;
  }

  clear(accountId: string): void {
    const normalizedAccountId = normalizeAccountId(accountId);
    if (!this.issues.delete(normalizedAccountId)) return;
    this.publish({ accountId: normalizedAccountId, issue: null });
  }

  subscribe(listener: GoogleAuthStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(change: GoogleAuthStateChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

export const googleAuthState = new GoogleAuthState();
