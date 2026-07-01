import { describe, expect, it } from 'vitest';
import type { Account, CustomClassifierRule, TabCategory } from '../shared/types';
import {
  GLOBAL_CLASSIFICATION_SCOPE,
  accountDetail,
  accountLabel,
  categoryBelongsToScope,
  categoryRouteLabel,
  reorderCategoriesWithinScope,
  routeTargetBelongsToScope,
  ruleBelongsToScope,
} from '../renderer/src/components/settings/tabs/classificationScope';

function account(partial: Partial<Account>): Account {
  return {
    id: partial.email || 'me@example.com',
    email: partial.email || 'me@example.com',
    displayName: partial.displayName || '',
    colorHex: partial.colorHex || '#3b82f6',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...partial,
  };
}

function category(partial: Partial<TabCategory>): TabCategory {
  return {
    id: partial.id || 'important',
    displayName: partial.displayName || 'Important',
    isSystem: partial.isSystem ?? false,
    active: partial.active ?? true,
    accountId: partial.accountId,
    colorHex: partial.colorHex,
  };
}

function rule(partial: Partial<CustomClassifierRule>): CustomClassifierRule {
  return {
    id: partial.id || 'rule-1',
    field: partial.field || 'from',
    condition: partial.condition || 'contains',
    value: partial.value || 'example.com',
    targetCategory: partial.targetCategory || 'important',
    active: partial.active ?? true,
    accountId: partial.accountId,
  };
}

describe('classification settings scope helpers', () => {
  const accounts = [
    account({ email: 'work@example.com', displayName: 'Work' }),
    account({ email: 'personal@example.com', displayName: '' }),
  ];

  const categories = [
    category({ id: 'important', displayName: 'Important', isSystem: true }),
    category({ id: 'other', displayName: 'Other', isSystem: true }),
    category({ id: 'global-apple', displayName: 'Apple', accountId: GLOBAL_CLASSIFICATION_SCOPE }),
    category({ id: 'work-apple', displayName: 'Apple', accountId: 'work@example.com' }),
    category({ id: 'personal-apple', displayName: 'Apple', accountId: 'personal@example.com' }),
  ];

  it('labels account scopes without losing the underlying email', () => {
    expect(accountLabel(accounts, 'global')).toBe('Global');
    expect(accountLabel(accounts, 'work@example.com')).toBe('Work');
    expect(accountDetail(accounts, 'work@example.com')).toBe('work@example.com');
    expect(accountLabel(accounts, 'personal@example.com')).toBe('personal@example.com');
    expect(accountDetail(accounts, 'personal@example.com')).toBe('');
  });

  it('shows only categories and rules owned by the selected settings scope', () => {
    expect(categories.filter(item => categoryBelongsToScope(item, 'global')).map(item => item.id)).toEqual([
      'important',
      'other',
      'global-apple',
    ]);
    expect(categories.filter(item => categoryBelongsToScope(item, 'work@example.com')).map(item => item.id)).toEqual([
      'work-apple',
    ]);

    const rules = [
      rule({ id: 'global-rule' }),
      rule({ id: 'also-global', accountId: 'global' }),
      rule({ id: 'work-rule', accountId: 'work@example.com' }),
      rule({ id: 'personal-rule', accountId: 'personal@example.com' }),
    ];
    expect(rules.filter(item => ruleBelongsToScope(item, 'global')).map(item => item.id)).toEqual([
      'global-rule',
      'also-global',
    ]);
    expect(rules.filter(item => ruleBelongsToScope(item, 'work@example.com')).map(item => item.id)).toEqual([
      'work-rule',
    ]);
  });

  it('keeps global/system categories available as route targets for an account rule', () => {
    expect(categories.filter(item => routeTargetBelongsToScope(item, 'work@example.com')).map(item => item.id)).toEqual([
      'important',
      'other',
      'global-apple',
      'work-apple',
    ]);
    expect(categoryRouteLabel('global-apple', categories, accounts)).toBe('Apple · Global');
    expect(categoryRouteLabel('work-apple', categories, accounts)).toBe('Apple · Work');
  });

  it('reorders only the categories visible in the selected scope', () => {
    const reordered = reorderCategoriesWithinScope(categories, 'work-apple', 'global-apple', 'work@example.com');
    expect(reordered).toBe(categories);

    const next = reorderCategoriesWithinScope(categories, 'work-apple', 'work-later', 'work@example.com');
    expect(next).toBe(categories);

    const withSecondWorkCategory = [
      ...categories,
      category({ id: 'work-github', displayName: 'GitHub', accountId: 'work@example.com' }),
    ];
    const scopedReordered = reorderCategoriesWithinScope(
      withSecondWorkCategory,
      'work-github',
      'work-apple',
      'work@example.com',
    );
    expect(scopedReordered.map(item => item.id)).toEqual([
      'important',
      'other',
      'global-apple',
      'work-github',
      'personal-apple',
      'work-apple',
    ]);
  });
});
