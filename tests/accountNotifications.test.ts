import { describe, expect, it } from 'vitest';
import { decisionWarrantsNotification, shouldNotifyForAccount, type NotificationMessage } from '../shared/accountNotifications';
import { setAccountOverride, type AccountSettingsSource } from '../shared/accountSettings';

const ACCOUNT = 'alex.morgan@northwind.example';

function message(extra: Partial<NotificationMessage> = {}): NotificationMessage {
  return {
    id: 'm1',
    accountId: ACCOUNT,
    subject: 'Rollout plan for Thursday',
    senderEmail: 'priya@contoso.example',
    senderName: 'Priya Shah',
    labelIds: ['INBOX', 'UNREAD'],
    headers: [],
    attachments: [],
    ...extra,
  };
}

const newsletter = message({
  subject: 'This week in tooling',
  senderEmail: 'digest@devweekly.example',
  senderName: 'Dev Weekly',
  headers: [
    { name: 'List-Unsubscribe', value: '<https://devweekly.example/u/1>' },
    { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
    { name: 'Precedence', value: 'bulk' },
  ],
});

const securityNotice = message({
  subject: 'New sign-in to your account',
  senderEmail: 'no-reply@accounts.example',
  senderName: 'Accounts',
});

const internalAnnouncement = message({
  subject: 'Office closed on Friday',
  senderEmail: 'announcements@northwind.example',
  headers: [{ name: 'List-Id', value: '<all.northwind.example>' }],
});

function withMode(mode: 'people' | 'all' | 'none' | null): AccountSettingsSource {
  const settings: AccountSettingsSource = { accountDefaults: { notifications: 'people', agentAutonomy: 'prepare' }, accountOverrides: {} };
  return mode ? setAccountOverride(settings, ACCOUNT, 'notifications', mode) : settings;
}

describe('decisionWarrantsNotification', () => {
  it('people mode passes people, invitations and protected read only', () => {
    expect(decisionWarrantsNotification('people', { decision: 'people', protected: true })).toBe(true);
    expect(decisionWarrantsNotification('people', { decision: 'event', protected: true })).toBe(true);
    expect(decisionWarrantsNotification('people', { decision: 'read', protected: true })).toBe(true);
    expect(decisionWarrantsNotification('people', { decision: 'read', protected: false })).toBe(false);
    for (const decision of ['clear', 'unsubscribe', 'automated', 'later'] as const) {
      expect(decisionWarrantsNotification('people', { decision, protected: false })).toBe(false);
    }
  });

  it('all passes everything and none passes nothing', () => {
    expect(decisionWarrantsNotification('all', { decision: 'clear', protected: false })).toBe(true);
    expect(decisionWarrantsNotification('none', { decision: 'people', protected: true })).toBe(false);
  });
});

describe('shouldNotifyForAccount', () => {
  it('defaults to people only for an account without an override', () => {
    const settings = withMode(null);
    expect(shouldNotifyForAccount(message(), settings)).toBe(true);
    expect(shouldNotifyForAccount(securityNotice, settings)).toBe(true);
    expect(shouldNotifyForAccount(newsletter, settings)).toBe(false);
    expect(shouldNotifyForAccount(internalAnnouncement, settings)).toBe(false);
  });

  it('treats old settings without the new keys as people only', () => {
    expect(shouldNotifyForAccount(message(), {})).toBe(true);
    expect(shouldNotifyForAccount(newsletter, {})).toBe(false);
  });

  it('all leaves filtering to the global settings', () => {
    expect(shouldNotifyForAccount(newsletter, withMode('all'))).toBe(true);
  });

  it('none silences the account entirely', () => {
    expect(shouldNotifyForAccount(message(), withMode('none'))).toBe(false);
    expect(shouldNotifyForAccount(securityNotice, withMode('none'))).toBe(false);
  });

  it('matches the account case-insensitively and leaves other accounts on the default', () => {
    const settings = withMode('none');
    expect(shouldNotifyForAccount(message({ accountId: 'Alex.Morgan@Northwind.example' }), settings)).toBe(false);
    expect(shouldNotifyForAccount(message({ accountId: 'alex@morgan-family.example' }), settings)).toBe(true);
  });
});
