import { describe, expect, it } from 'vitest';
import {
  classifyGoogleSignInFailure,
  decodeGoogleSignInError,
  encodeGoogleSignInError,
  googleSignInErrorCopy,
  GMAIL_REQUIRED_SCOPE,
  hasAllScopes,
  integrationScopesGranted,
  isGmailScopeMissing,
  parseGrantedScopes,
} from '../shared/googleSignInErrors';
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_CONTACTS_SCOPES, GOOGLE_OAUTH_SCOPES } from '../main/gmailOAuth';

describe('Google sign-in errors', () => {
  it('survives the IPC wrapper text and keeps the expected client path', () => {
    const encoded = encodeGoogleSignInError({ code: 'GOOGLE_OAUTH_CLIENT_MISSING', expectedPath: '/Users/test/.config/dumka-mail/google-oauth-client.json' });
    const ipcError = new Error(`Error invoking remote method 'api:onboardAccount': Error: ${encoded}`);
    expect(decodeGoogleSignInError(ipcError)).toEqual({
      code: 'GOOGLE_OAUTH_CLIENT_MISSING',
      expectedPath: '/Users/test/.config/dumka-mail/google-oauth-client.json',
    });
  });

  it('does not decode arbitrary or malformed errors', () => {
    expect(decodeGoogleSignInError(new Error('Token exchange failed: {}'))).toBeNull();
    expect(decodeGoogleSignInError(new Error('[[dumka-google-signin:{"code":"NOPE"}]]'))).toBeNull();
    expect(decodeGoogleSignInError(new Error('[[dumka-google-signin:{not json]]'))).toBeNull();
    expect(decodeGoogleSignInError(undefined)).toBeNull();
  });

  it('classifies typed and untyped failures', () => {
    expect(classifyGoogleSignInFailure(Object.assign(new Error('missing'), { code: 'GOOGLE_OAUTH_CLIENT_MISSING', expectedPath: '/p' })))
      .toEqual({ code: 'GOOGLE_OAUTH_CLIENT_MISSING', expectedPath: '/p' });
    expect(classifyGoogleSignInFailure(new Error('Consent failed: access_denied')).code).toBe('GOOGLE_OAUTH_CANCELLED');
    expect(classifyGoogleSignInFailure(new Error('OAuth flow timed out after 5 minutes.')).code).toBe('GOOGLE_OAUTH_TIMEOUT');
    expect(classifyGoogleSignInFailure(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' })).code).toBe('GOOGLE_OAUTH_NETWORK');
    expect(classifyGoogleSignInFailure(new TypeError('fetch failed')).code).toBe('GOOGLE_OAUTH_NETWORK');
    expect(classifyGoogleSignInFailure(new Error('Token exchange failed: {"error":"invalid_grant"}')).code).toBe('GOOGLE_OAUTH_FAILED');
  });

  it('explains a missing client file without blaming the Google account and without raw text', () => {
    const copy = googleSignInErrorCopy({ code: 'GOOGLE_OAUTH_CLIENT_MISSING', expectedPath: '/p' });
    expect(copy.title).toBe('Sign-in could not start');
    expect(copy.body).toMatch(/no Google sign-in configuration/);
    expect(copy.body).toMatch(/Nothing is wrong with your Google account/);
    for (const code of ['GOOGLE_OAUTH_CANCELLED', 'GOOGLE_OAUTH_TIMEOUT', 'GOOGLE_OAUTH_NETWORK', 'GOOGLE_OAUTH_FAILED'] as const) {
      expect(googleSignInErrorCopy({ code }).body).not.toMatch(/Error invoking|HTTP \d{3}/);
    }
  });
});

describe('granted OAuth scopes', () => {
  it('parses the token response scope field', () => {
    expect(parseGrantedScopes('a  b\nb c')).toEqual(['a', 'b', 'c']);
    expect(parseGrantedScopes(undefined)).toEqual([]);
  });

  it('enables calendar only when every calendar scope was granted', () => {
    const all = [...GOOGLE_OAUTH_SCOPES, ...GOOGLE_CALENDAR_SCOPES];
    expect(hasAllScopes(all, GOOGLE_CALENDAR_SCOPES)).toBe(true);
    expect(hasAllScopes([...GOOGLE_OAUTH_SCOPES, GOOGLE_CALENDAR_SCOPES[0]], GOOGLE_CALENDAR_SCOPES)).toBe(false);
    expect(hasAllScopes([], GOOGLE_CALENDAR_SCOPES)).toBe(false);
  });

  it('requires the Gmail scope whenever Google reports the granted scopes', () => {
    expect(GOOGLE_OAUTH_SCOPES).toContain(GMAIL_REQUIRED_SCOPE);
    expect(isGmailScopeMissing([...GOOGLE_OAUTH_SCOPES, ...GOOGLE_CALENDAR_SCOPES])).toBe(false);
    // Granular consent: calendar ticked, mail unticked.
    const calendarOnly = ['https://www.googleapis.com/auth/userinfo.email', 'openid', ...GOOGLE_CALENDAR_SCOPES];
    expect(isGmailScopeMissing(calendarOnly)).toBe(true);
    expect(isGmailScopeMissing(['https://www.googleapis.com/auth/gmail.readonly'])).toBe(true);
    // Google did not list scopes: not treated as missing.
    expect(isGmailScopeMissing([])).toBe(false);
    expect(isGmailScopeMissing(undefined)).toBe(false);
  });

  it('enables an explicitly requested integration only when its scopes are granted or unreported', () => {
    expect(integrationScopesGranted([...GOOGLE_OAUTH_SCOPES, ...GOOGLE_CONTACTS_SCOPES], GOOGLE_CONTACTS_SCOPES)).toBe(true);
    expect(integrationScopesGranted([...GOOGLE_OAUTH_SCOPES], GOOGLE_CONTACTS_SCOPES)).toBe(false);
    expect(integrationScopesGranted([], GOOGLE_CONTACTS_SCOPES)).toBe(true);
  });

  it('explains a missing Gmail permission', () => {
    const encoded = encodeGoogleSignInError({ code: 'GOOGLE_OAUTH_GMAIL_SCOPE_NOT_GRANTED' });
    expect(decodeGoogleSignInError(new Error(`Error invoking remote method 'api:onboardAccount': Error: ${encoded}`)))
      .toEqual({ code: 'GOOGLE_OAUTH_GMAIL_SCOPE_NOT_GRANTED' });
    const copy = googleSignInErrorCopy({ code: 'GOOGLE_OAUTH_GMAIL_SCOPE_NOT_GRANTED' });
    expect(copy.title).toBe('Mail access was not granted');
    expect(copy.body).toMatch(/Sign in again and keep the Gmail permission ticked/);
  });
});
