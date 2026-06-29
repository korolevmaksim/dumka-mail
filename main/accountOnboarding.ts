import type { Account } from '../shared/types';

interface OAuthAccountProfile {
  email?: string | null;
  displayName?: string;
  avatarUrl?: string;
}

const ACCOUNT_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#ef4444',
  '#0ea5e9',
  '#84cc16',
  '#ec4899'
] as const;

export function normalizeOAuthEmail(email: string | null | undefined): string {
  const normalized = email?.trim().toLowerCase() || '';
  if (!normalized) {
    throw new Error('Google OAuth profile did not include an email address.');
  }
  return normalized;
}

function accountColorForEmail(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i += 1) {
    hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  }
  return ACCOUNT_COLORS[hash % ACCOUNT_COLORS.length];
}

export function buildOnboardedAccount(
  profile: OAuthAccountProfile,
  existingAccount: Account | null,
  now = new Date()
): Account {
  const email = normalizeOAuthEmail(profile.email);
  const displayName = profile.displayName?.trim() || existingAccount?.displayName || email.split('@')[0] || email;
  const avatarUrl = profile.avatarUrl?.trim() || existingAccount?.avatarUrl;

  return {
    id: email,
    email,
    displayName,
    colorHex: existingAccount?.colorHex || accountColorForEmail(email),
    createdAt: existingAccount?.createdAt || now.toISOString(),
    avatarUrl
  };
}
