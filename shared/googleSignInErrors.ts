// Typed Google sign-in failures that survive the Electron IPC boundary.
//
// `ipcMain.handle` rejections reach the renderer as a plain Error whose message
// is "Error invoking remote method '<channel>': Error: <message>"; custom
// properties are dropped. The main process therefore encodes the typed error
// into the message between markers, and the renderer decodes it. Raw exception
// text never reaches the UI: it goes to the system log in the main process.

export type GoogleSignInErrorCode =
  | 'GOOGLE_OAUTH_CLIENT_MISSING'
  | 'GOOGLE_OAUTH_CLIENT_INVALID'
  | 'GOOGLE_OAUTH_CANCELLED'
  | 'GOOGLE_OAUTH_TIMEOUT'
  | 'GOOGLE_OAUTH_NETWORK'
  | 'GOOGLE_OAUTH_NO_REFRESH_TOKEN'
  | 'GOOGLE_OAUTH_WRONG_ACCOUNT'
  | 'GOOGLE_OAUTH_GMAIL_SCOPE_NOT_GRANTED'
  | 'GOOGLE_OAUTH_FAILED';

export interface GoogleSignInError {
  code: GoogleSignInErrorCode;
  /** Where the OAuth client file is expected (client missing / invalid). */
  expectedPath?: string;
}

const CODES: ReadonlySet<string> = new Set<GoogleSignInErrorCode>([
  'GOOGLE_OAUTH_CLIENT_MISSING',
  'GOOGLE_OAUTH_CLIENT_INVALID',
  'GOOGLE_OAUTH_CANCELLED',
  'GOOGLE_OAUTH_TIMEOUT',
  'GOOGLE_OAUTH_NETWORK',
  'GOOGLE_OAUTH_NO_REFRESH_TOKEN',
  'GOOGLE_OAUTH_WRONG_ACCOUNT',
  'GOOGLE_OAUTH_GMAIL_SCOPE_NOT_GRANTED',
  'GOOGLE_OAUTH_FAILED',
]);

const START = '[[dumka-google-signin:';
const END = ']]';

export function encodeGoogleSignInError(error: GoogleSignInError): string {
  const payload: GoogleSignInError = { code: error.code };
  if (error.expectedPath) payload.expectedPath = error.expectedPath;
  return `${START}${JSON.stringify(payload)}${END}`;
}

export function decodeGoogleSignInError(error: unknown): GoogleSignInError | null {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';
  const start = message.indexOf(START);
  if (start === -1) return null;
  const end = message.indexOf(END, start + START.length);
  if (end === -1) return null;
  try {
    const parsed: unknown = JSON.parse(message.slice(start + START.length, end));
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.code !== 'string' || !CODES.has(record.code)) return null;
    return {
      code: record.code as GoogleSignInErrorCode,
      ...(typeof record.expectedPath === 'string' && record.expectedPath ? { expectedPath: record.expectedPath } : {}),
    };
  } catch {
    return null;
  }
}

export interface GoogleSignInErrorCopy {
  title: string;
  body: string;
}

export function googleSignInErrorCopy(error: GoogleSignInError): GoogleSignInErrorCopy {
  switch (error.code) {
    case 'GOOGLE_OAUTH_CLIENT_MISSING':
      return {
        title: 'Sign-in could not start',
        body: 'This build of Dumka Mail has no Google sign-in configuration (an OAuth client file). Nothing is wrong with your Google account. Add the client file and try again.',
      };
    case 'GOOGLE_OAUTH_CLIENT_INVALID':
      return {
        title: 'Sign-in could not start',
        body: 'The Google sign-in configuration file could not be read. Nothing is wrong with your Google account. Replace the client file and try again.',
      };
    case 'GOOGLE_OAUTH_CANCELLED':
      return {
        title: 'Sign-in was cancelled',
        body: 'Google did not grant access. Try again and allow Dumka Mail to read and send your mail.',
      };
    case 'GOOGLE_OAUTH_TIMEOUT':
      return {
        title: 'Sign-in timed out',
        body: 'The browser sign-in was not finished within 5 minutes. Try again.',
      };
    case 'GOOGLE_OAUTH_NETWORK':
      return {
        title: 'Google could not be reached',
        body: 'Check your internet connection and try again.',
      };
    case 'GOOGLE_OAUTH_NO_REFRESH_TOKEN':
      return {
        title: 'Google did not allow offline access',
        body: 'Remove Dumka Mail from your Google Account’s third-party access, then sign in again.',
      };
    case 'GOOGLE_OAUTH_WRONG_ACCOUNT':
      return {
        title: 'A different Google account was chosen',
        body: 'Sign in with the account you are reconnecting.',
      };
    case 'GOOGLE_OAUTH_GMAIL_SCOPE_NOT_GRANTED':
      return {
        title: 'Mail access was not granted',
        body: 'Google signed you in without permission to read and send your mail. Sign in again and keep the Gmail permission ticked.',
      };
    case 'GOOGLE_OAUTH_FAILED':
    default:
      return {
        title: 'Sign-in failed',
        body: 'Google sign-in did not complete. Try again; details are in Settings → Logging.',
      };
  }
}

/** One-line message for toasts (sign-in started outside the first-run panel). */
export function googleSignInErrorToast(error: GoogleSignInError): string {
  const copy = googleSignInErrorCopy(error);
  return `${copy.title}. ${copy.body}`;
}

/**
 * Main-process classification of a raw sign-in failure. `code` on the error
 * object wins (typed errors thrown by gmailOAuth); otherwise the message is
 * matched against the known failure shapes.
 */
export function classifyGoogleSignInFailure(error: unknown): GoogleSignInError {
  if (error && typeof error === 'object') {
    const record = error as { code?: unknown; expectedPath?: unknown };
    if (typeof record.code === 'string' && CODES.has(record.code)) {
      return {
        code: record.code as GoogleSignInErrorCode,
        ...(typeof record.expectedPath === 'string' && record.expectedPath ? { expectedPath: record.expectedPath } : {}),
      };
    }
  }
  const decoded = decodeGoogleSignInError(error);
  if (decoded) return decoded;

  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  const code = error && typeof error === 'object' ? String((error as { code?: unknown }).code ?? '').toUpperCase() : '';
  if (message.includes('consent failed') || message.includes('access_denied')) return { code: 'GOOGLE_OAUTH_CANCELLED' };
  if (message.includes('timed out')) return { code: 'GOOGLE_OAUTH_TIMEOUT' };
  if (message.includes('refresh token')) return { code: 'GOOGLE_OAUTH_NO_REFRESH_TOKEN' };
  if (
    message.includes('fetch failed')
    || message.includes('network')
    || message.includes('failed to fetch')
    || ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)
  ) {
    return { code: 'GOOGLE_OAUTH_NETWORK' };
  }
  return { code: 'GOOGLE_OAUTH_FAILED' };
}

// === Granted scopes ===

/** Splits the token response's space-delimited `scope` field. */
export function parseGrantedScopes(scope: unknown): string[] {
  if (typeof scope !== 'string') return [];
  return Array.from(new Set(scope.split(/\s+/).map(item => item.trim()).filter(Boolean)));
}

export function hasAllScopes(granted: readonly string[] | null | undefined, required: readonly string[]): boolean {
  if (!granted || granted.length === 0) return false;
  const set = new Set(granted);
  return required.every(scope => set.has(scope));
}

/** The scope Dumka Mail cannot work without (read, label and send mail). */
export const GMAIL_REQUIRED_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

/**
 * True when Google reported the granted scopes and mail access is not among
 * them (granular consent lets the user untick it). An empty list means Google
 * did not say, which older token responses do; that is not treated as missing.
 */
export function isGmailScopeMissing(granted: readonly string[] | null | undefined): boolean {
  if (!granted || granted.length === 0) return false;
  return !granted.includes(GMAIL_REQUIRED_SCOPE);
}

/**
 * Whether an optional integration's scopes were granted. Unlike calendar at
 * sign-in (which needs an explicit grant), an explicit integration consent
 * whose response did not list scopes keeps the old behaviour: enabled.
 */
export function integrationScopesGranted(granted: readonly string[] | null | undefined, required: readonly string[]): boolean {
  if (!granted || granted.length === 0) return true;
  return hasAllScopes(granted, required);
}
