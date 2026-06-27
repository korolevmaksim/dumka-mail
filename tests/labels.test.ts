import { describe, it, expect } from 'vitest';
import {
  labelDisplayName,
  pillColorHex,
  threadRowLabelIds,
  primaryRowLabel,
} from '../shared/labels';
import { MailThread } from '../shared/types';

describe('labelDisplayName', () => {
  it('maps known Gmail category ids to friendly names', () => {
    expect(labelDisplayName('CATEGORY_PROMOTIONS')).toBe('marketing');
    expect(labelDisplayName('CATEGORY_UPDATES')).toBe('updates');
    expect(labelDisplayName('CATEGORY_SOCIAL')).toBe('social');
    expect(labelDisplayName('CATEGORY_FORUMS')).toBe('forums');
    expect(labelDisplayName('CATEGORY_PRIMARY')).toBe('primary');
    expect(labelDisplayName('IMPORTANT')).toBe('important');
    expect(labelDisplayName('SENT')).toBe('sent');
    expect(labelDisplayName('UNREAD')).toBe('unread');
  });

  it('is case-insensitive for known ids', () => {
    expect(labelDisplayName('category_promotions')).toBe('marketing');
    expect(labelDisplayName('important')).toBe('important');
  });

  it('strips the CATEGORY_ prefix for unknown category labels', () => {
    expect(labelDisplayName('CATEGORY_TRAVEL')).toBe('travel');
    expect(labelDisplayName('CATEGORY_PERSONAL_FINANCE')).toBe('personal finance');
  });

  it('lowercases and de-underscores custom labels without a CATEGORY_ prefix', () => {
    expect(labelDisplayName('Work_Projects')).toBe('work projects');
    expect(labelDisplayName('Newsletter')).toBe('newsletter');
  });
});

describe('pillColorHex', () => {
  it('returns distinct colors for promotion/update/important by substring', () => {
    expect(pillColorHex('CATEGORY_PROMOTIONS')).toBe('#DB8059');
    expect(pillColorHex('CATEGORY_UPDATES')).toBe('#BD8C2E');
    expect(pillColorHex('IMPORTANT')).toBe('#AD63CC');
  });

  it('matches case-insensitively', () => {
    expect(pillColorHex('category_promotions')).toBe('#DB8059');
    expect(pillColorHex('important')).toBe('#AD63CC');
  });

  it('falls back to the accent color for everything else', () => {
    expect(pillColorHex('CATEGORY_SOCIAL')).toBe('#668FEA');
    expect(pillColorHex('Work')).toBe('#668FEA');
  });
});

describe('threadRowLabelIds', () => {
  it('drops INBOX/UNREAD/SENT system noise', () => {
    expect(threadRowLabelIds(['INBOX', 'UNREAD', 'SENT'])).toEqual([]);
    expect(threadRowLabelIds(['INBOX', 'CATEGORY_PROMOTIONS', 'UNREAD'])).toEqual([
      'CATEGORY_PROMOTIONS',
    ]);
  });

  it('drops system labels case-insensitively', () => {
    expect(threadRowLabelIds(['inbox', 'unread', 'IMPORTANT'])).toEqual(['IMPORTANT']);
  });

  it('dedupes case-insensitively, keeping the first occurrence casing', () => {
    expect(threadRowLabelIds(['CATEGORY_UPDATES', 'category_updates'])).toEqual([
      'CATEGORY_UPDATES',
    ]);
  });

  it('orders by display priority (important > promotion > category > primary)', () => {
    const result = threadRowLabelIds([
      'CATEGORY_PRIMARY',
      'CATEGORY_SOCIAL',
      'CATEGORY_PROMOTIONS',
      'IMPORTANT',
    ]);
    expect(result).toEqual([
      'IMPORTANT',
      'CATEGORY_PROMOTIONS',
      'CATEGORY_SOCIAL',
      'CATEGORY_PRIMARY',
    ]);
  });

  it('preserves input order for equal-priority labels (stable)', () => {
    expect(threadRowLabelIds(['Zebra', 'Apple'])).toEqual(['Zebra', 'Apple']);
  });

  it('returns an empty array for an empty input', () => {
    expect(threadRowLabelIds([])).toEqual([]);
  });
});

describe('primaryRowLabel', () => {
  const baseThread: MailThread = {
    id: 't1',
    accountId: 'test@gmail.com',
    subject: 'Hello',
    snippet: 'snippet',
    lastMessageAt: new Date().toISOString(),
    senderNames: ['John Doe'],
    senderEmail: 'john@example.com',
    labelIds: [],
    hasAttachments: false,
    isUnread: true,
  };

  it('returns the highest-priority display label as a RowLabel', () => {
    const thread: MailThread = {
      ...baseThread,
      labelIds: ['INBOX', 'CATEGORY_PRIMARY', 'CATEGORY_PROMOTIONS'],
    };
    expect(primaryRowLabel(thread)).toEqual({
      id: 'CATEGORY_PROMOTIONS',
      name: 'marketing',
      color: '#DB8059',
    });
  });

  it('returns null when no display-worthy labels remain', () => {
    const thread: MailThread = { ...baseThread, labelIds: ['INBOX', 'UNREAD'] };
    expect(primaryRowLabel(thread)).toBeNull();
  });

  it('uses the accent color and de-prefixed name for custom labels', () => {
    const thread: MailThread = { ...baseThread, labelIds: ['INBOX', 'Work_Stuff'] };
    expect(primaryRowLabel(thread)).toEqual({
      id: 'Work_Stuff',
      name: 'work stuff',
      color: '#668FEA',
    });
  });
});
