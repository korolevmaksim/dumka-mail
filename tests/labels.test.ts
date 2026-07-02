import { describe, expect, it } from 'vitest';
import {
  buildLabelTree,
  composeNestedLabelName,
  flattenLabelTree,
  isDescendantLabel,
  labelDefinitionsForAccount,
  labelMatchesSearchQuery,
  labelDisplayName,
  labelLeafName,
  labelParentName,
  labelPresenceInThreads,
  pillColorHex,
  primaryRowLabel,
  threadMatchesLabelSearchQuery,
  threadRowLabelIds,
} from '../shared/labels';
import type { MailLabelDefinition, MailThread } from '../shared/types';

function label(id: string, name: string): MailLabelDefinition {
  return {
    id,
    accountId: 'me@example.com',
    name,
    type: 'user',
  };
}

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

describe('label helpers', () => {
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

  it('formats custom row labels and uses the leaf segment for nested labels', () => {
    expect(labelDisplayName('Work_Projects')).toBe('work projects');
    expect(labelDisplayName('Newsletter')).toBe('newsletter');
    expect(labelDisplayName('Clients/Acme_Inc')).toBe('acme inc');
  });

  it('returns stable pill colors for meaningful Gmail labels', () => {
    expect(pillColorHex('CATEGORY_PROMOTIONS')).toBe('#DB8059');
    expect(pillColorHex('CATEGORY_UPDATES')).toBe('#BD8C2E');
    expect(pillColorHex('IMPORTANT')).toBe('#AD63CC');
    expect(pillColorHex('Work')).toBe('#668FEA');
  });

  it('keeps only display-worthy row labels and preserves priority', () => {
    expect(threadRowLabelIds(['INBOX', 'UNREAD', 'SENT'])).toEqual([]);
    expect(threadRowLabelIds([
      'CATEGORY_PRIMARY',
      'CATEGORY_SOCIAL',
      'CATEGORY_PROMOTIONS',
      'IMPORTANT',
    ])).toEqual([
      'IMPORTANT',
      'CATEGORY_PROMOTIONS',
      'CATEGORY_SOCIAL',
      'CATEGORY_PRIMARY',
    ]);
    expect(threadRowLabelIds(['CATEGORY_UPDATES', 'category_updates'])).toEqual(['CATEGORY_UPDATES']);
  });

  it('returns the highest-priority display label for a thread row', () => {
    expect(primaryRowLabel({
      ...baseThread,
      labelIds: ['INBOX', 'CATEGORY_PRIMARY', 'CATEGORY_PROMOTIONS'],
    })).toEqual({
      id: 'CATEGORY_PROMOTIONS',
      name: 'marketing',
      color: '#DB8059',
    });
    expect(primaryRowLabel({ ...baseThread, labelIds: ['INBOX', 'UNREAD'] })).toBeNull();
    expect(primaryRowLabel({ ...baseThread, labelIds: ['INBOX', 'Clients/Acme_Inc'] })).toEqual({
      id: 'Clients/Acme_Inc',
      name: 'acme inc',
      color: '#668FEA',
    });
  });

  it('matches search label queries against Gmail system label ids and visible names', () => {
    expect(labelMatchesSearchQuery('CATEGORY_FORUMS', 'FORUMS')).toBe(true);
    expect(labelMatchesSearchQuery('CATEGORY_FORUMS', 'forums')).toBe(true);
    expect(labelMatchesSearchQuery('CATEGORY_PROMOTIONS', 'promotions')).toBe(true);
    expect(labelMatchesSearchQuery('CATEGORY_PROMOTIONS', 'marketing')).toBe(true);
    expect(labelMatchesSearchQuery('CATEGORY_UPDATES', 'forums')).toBe(false);
  });

  it('matches custom Gmail labels by definition name when threads only store label ids', () => {
    const labels = [
      label('Label_123', 'Jira'),
      label('Label_456', 'Clients/Acme_Inc'),
    ];

    expect(threadMatchesLabelSearchQuery({ accountId: 'me@example.com', labelIds: ['Label_123'] }, 'JIRA', labels)).toBe(true);
    expect(threadMatchesLabelSearchQuery({ accountId: 'me@example.com', labelIds: ['Label_456'] }, 'acme inc', labels)).toBe(true);
    expect(threadMatchesLabelSearchQuery({ accountId: 'me@example.com', labelIds: ['Label_456'] }, 'Clients/Acme Inc', labels)).toBe(true);
    expect(threadMatchesLabelSearchQuery({ accountId: 'me@example.com', labelIds: ['Label_123'] }, 'GitHub', labels)).toBe(false);
    expect(threadMatchesLabelSearchQuery({ accountId: 'other@example.com', labelIds: ['Label_123'] }, 'JIRA', labels)).toBe(false);
  });

  it('filters cached label definitions by account before building account-scoped UIs', () => {
    const labels = [
      label('Label_123', 'Clients'),
      { ...label('Label_123', 'Personal'), accountId: 'other@example.com' },
      { ...label('Label_456', 'News'), accountId: 'Other@Example.com' },
    ];

    expect(labelDefinitionsForAccount(labels, 'ME@EXAMPLE.COM').map(item => item.name)).toEqual(['Clients']);
    expect(labelDefinitionsForAccount(labels, 'other@example.com').map(item => item.name)).toEqual(['Personal', 'News']);
    expect(labelDefinitionsForAccount(labels, null)).toEqual([]);
  });

  it('composes Gmail nested label names while normalizing separators', () => {
    expect(composeNestedLabelName('Clients', 'Acme')).toBe('Clients/Acme');
    expect(composeNestedLabelName('/Clients/', '/Acme/')).toBe('Clients/Acme');
    expect(composeNestedLabelName('', 'Clients/Acme')).toBe('Clients/Acme');
  });

  it('extracts parent and leaf names', () => {
    expect(labelParentName('Clients/Acme/Invoices')).toBe('Clients/Acme');
    expect(labelLeafName('Clients/Acme/Invoices')).toBe('Invoices');
    expect(labelParentName('Clients')).toBe('');
  });

  it('recognizes descendants without treating siblings as descendants', () => {
    expect(isDescendantLabel('Clients/Acme/Invoices', 'Clients/Acme')).toBe(true);
    expect(isDescendantLabel('Clients/Other', 'Clients/Acme')).toBe(false);
  });

  it('summarizes label presence across selected threads', () => {
    const threads = [
      { ...baseThread, id: 't1', labelIds: ['INBOX', 'Clients'] },
      { ...baseThread, id: 't2', labelIds: ['INBOX', 'Clients', 'Waiting'] },
      { ...baseThread, id: 't3', labelIds: ['INBOX'] },
    ];

    expect(labelPresenceInThreads('Clients', threads.slice(0, 2))).toBe('all');
    expect(labelPresenceInThreads('Waiting', threads)).toBe('some');
    expect(labelPresenceInThreads('Done', threads)).toBe('none');
    expect(labelPresenceInThreads('Clients', [])).toBe('none');
  });

  it('builds a tree with virtual parent folders when Gmail only returns leaf labels', () => {
    const tree = buildLabelTree([
      label('l1', 'Clients/Acme'),
      label('l2', 'Clients/Beta'),
      label('l3', 'Projects'),
    ]);
    const flattened = flattenLabelTree(tree);

    expect(flattened.map(node => node.fullName)).toEqual([
      'Clients',
      'Clients/Acme',
      'Clients/Beta',
      'Projects',
    ]);
    expect(flattened[0].label).toBeUndefined();
    expect(flattened[1].label?.id).toBe('l1');
  });
});
