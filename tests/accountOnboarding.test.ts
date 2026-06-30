import { describe, expect, it } from 'vitest';
import { buildOnboardedAccount } from '../main/accountOnboarding';
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_CONTACTS_SCOPES, GOOGLE_OAUTH_SCOPES } from '../main/gmailOAuth';
import { Account } from '../shared/types';

describe('OAuth account onboarding', () => {
  it('requests the Google email scope needed to identify the onboarded account', () => {
    expect(GOOGLE_OAUTH_SCOPES).toContain('https://www.googleapis.com/auth/userinfo.email');
  });

  it('keeps Calendar and Contacts scopes separate for incremental authorization', () => {
    expect(GOOGLE_OAUTH_SCOPES).not.toContain('https://www.googleapis.com/auth/calendar.events');
    expect(GOOGLE_OAUTH_SCOPES).not.toContain('https://www.googleapis.com/auth/contacts.readonly');
    expect(GOOGLE_CALENDAR_SCOPES).toEqual(['https://www.googleapis.com/auth/calendar.events']);
    expect(GOOGLE_CONTACTS_SCOPES).toEqual(['https://www.googleapis.com/auth/contacts.readonly']);
  });

  it('rejects OAuth profiles that do not include an email address', () => {
    expect(() => buildOnboardedAccount({
      email: undefined,
      displayName: 'Missing Email',
      avatarUrl: 'https://example.com/avatar.png'
    }, null, new Date('2026-06-29T10:00:00.000Z'))).toThrow(/email/i);
  });

  it('normalizes the OAuth email and preserves existing local account fields on reconnect', () => {
    const existing: Account = {
      id: 'alex@example.com',
      email: 'alex@example.com',
      displayName: 'Alex',
      colorHex: '#3b82f6',
      createdAt: '2026-06-01T09:00:00.000Z',
      avatarUrl: 'https://example.com/old.png'
    };

    const account = buildOnboardedAccount({
      email: ' Alex@Example.COM ',
      displayName: 'Alex Example',
      avatarUrl: 'https://example.com/new.png'
    }, existing, new Date('2026-06-29T10:00:00.000Z'));

    expect(account).toEqual({
      id: 'alex@example.com',
      email: 'alex@example.com',
      displayName: 'Alex Example',
      colorHex: '#3b82f6',
      createdAt: '2026-06-01T09:00:00.000Z',
      avatarUrl: 'https://example.com/new.png'
    });
  });
});
