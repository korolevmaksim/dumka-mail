import { describe, expect, it } from 'vitest';
import { buildOnboardedAccount } from '../main/accountOnboarding';
import { GOOGLE_OAUTH_SCOPES } from '../main/gmailOAuth';
import { Account } from '../shared/types';

describe('OAuth account onboarding', () => {
  it('requests the Google email scope needed to identify the onboarded account', () => {
    expect(GOOGLE_OAUTH_SCOPES).toContain('https://www.googleapis.com/auth/userinfo.email');
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
      id: 'max@example.com',
      email: 'max@example.com',
      displayName: 'Max',
      colorHex: '#3b82f6',
      createdAt: '2026-06-01T09:00:00.000Z',
      avatarUrl: 'https://example.com/old.png'
    };

    const account = buildOnboardedAccount({
      email: ' Max@Example.COM ',
      displayName: 'Maksim Korolyov',
      avatarUrl: 'https://example.com/new.png'
    }, existing, new Date('2026-06-29T10:00:00.000Z'));

    expect(account).toEqual({
      id: 'max@example.com',
      email: 'max@example.com',
      displayName: 'Maksim Korolyov',
      colorHex: '#3b82f6',
      createdAt: '2026-06-01T09:00:00.000Z',
      avatarUrl: 'https://example.com/new.png'
    });
  });
});
