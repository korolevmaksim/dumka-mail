import type { Account, CustomClassifierRule, TabCategory } from '../../../../../shared/types';

export const GLOBAL_CLASSIFICATION_SCOPE = 'global';

export function normalizeClassificationScope(scope?: string | null): string {
  const trimmed = scope?.trim();
  if (!trimmed || trimmed.toLowerCase() === GLOBAL_CLASSIFICATION_SCOPE) {
    return GLOBAL_CLASSIFICATION_SCOPE;
  }
  return trimmed.toLowerCase();
}

export function accountMatchesScope(account: Account, scope: string): boolean {
  return normalizeClassificationScope(account.email) === normalizeClassificationScope(scope);
}

export function accountLabel(accounts: Account[], scope: string): string {
  const normalizedScope = normalizeClassificationScope(scope);
  if (normalizedScope === GLOBAL_CLASSIFICATION_SCOPE) {
    return 'Global';
  }
  const account = accounts.find(item => accountMatchesScope(item, normalizedScope));
  return account?.displayName?.trim() || account?.email || scope;
}

export function accountDetail(accounts: Account[], scope: string): string {
  const normalizedScope = normalizeClassificationScope(scope);
  if (normalizedScope === GLOBAL_CLASSIFICATION_SCOPE) {
    return 'All accounts';
  }
  const account = accounts.find(item => accountMatchesScope(item, normalizedScope));
  if (!account) {
    return scope;
  }
  return account.displayName?.trim() ? account.email : '';
}

export function categoryScope(category: TabCategory): string {
  if (category.isSystem) {
    return GLOBAL_CLASSIFICATION_SCOPE;
  }
  return normalizeClassificationScope(category.accountId);
}

export function ruleScope(rule: CustomClassifierRule): string {
  return normalizeClassificationScope(rule.accountId);
}

export function categoryBelongsToScope(category: TabCategory, scope: string): boolean {
  return categoryScope(category) === normalizeClassificationScope(scope);
}

export function ruleBelongsToScope(rule: CustomClassifierRule, scope: string): boolean {
  return ruleScope(rule) === normalizeClassificationScope(scope);
}

export function routeTargetBelongsToScope(category: TabCategory, scope: string): boolean {
  const normalizedScope = normalizeClassificationScope(scope);
  const normalizedCategoryScope = categoryScope(category);
  if (normalizedScope === GLOBAL_CLASSIFICATION_SCOPE) {
    return normalizedCategoryScope === GLOBAL_CLASSIFICATION_SCOPE;
  }
  return normalizedCategoryScope === GLOBAL_CLASSIFICATION_SCOPE || normalizedCategoryScope === normalizedScope;
}

export function scopeDisplayLabel(
  scope: string,
  accounts: Account[],
  options: { compactGlobal?: boolean } = {},
): string {
  const normalizedScope = normalizeClassificationScope(scope);
  if (normalizedScope === GLOBAL_CLASSIFICATION_SCOPE) {
    return options.compactGlobal ? 'Global' : 'Global (All Accounts)';
  }
  return accountLabel(accounts, normalizedScope);
}

export function categoryRouteLabel(categoryId: string, categories: TabCategory[], accounts: Account[]): string {
  const category = categories.find(item => item.id === categoryId);
  if (!category) {
    return categoryId;
  }
  return `${category.displayName} · ${scopeDisplayLabel(categoryScope(category), accounts, { compactGlobal: true })}`;
}

export function reorderCategoriesWithinScope(
  categories: TabCategory[],
  draggedId: string,
  targetId: string,
  scope: string,
): TabCategory[] {
  const visibleIds = new Set(
    categories
      .filter(category => categoryBelongsToScope(category, scope))
      .map(category => category.id),
  );
  if (!visibleIds.has(draggedId) || !visibleIds.has(targetId) || draggedId === targetId) {
    return categories;
  }

  const scopedCategories = categories.filter(category => visibleIds.has(category.id));
  const draggedIndex = scopedCategories.findIndex(category => category.id === draggedId);
  const targetIndex = scopedCategories.findIndex(category => category.id === targetId);
  if (draggedIndex === -1 || targetIndex === -1) {
    return categories;
  }

  const reorderedScoped = [...scopedCategories];
  const [removed] = reorderedScoped.splice(draggedIndex, 1);
  if (!removed) {
    return categories;
  }
  reorderedScoped.splice(targetIndex, 0, removed);

  let scopedIndex = 0;
  return categories.map(category => {
    if (!visibleIds.has(category.id)) {
      return category;
    }
    const replacement = reorderedScoped[scopedIndex];
    if (!replacement) {
      return category;
    }
    scopedIndex += 1;
    return replacement;
  });
}
