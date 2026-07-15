import type { MailCategoryRuleField } from './types';

interface RuleValueSource {
  field: MailCategoryRuleField;
  value: string;
  values?: string[];
}

const MULTI_VALUE_FIELDS = new Set<MailCategoryRuleField>(['from', 'to', 'cc']);

export function supportsMultipleRuleValues(field: MailCategoryRuleField): boolean {
  return MULTI_VALUE_FIELDS.has(field);
}

export function parseRuleValueInput(value: string): string[] {
  return value.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean);
}

function legacyRuleValues(field: MailCategoryRuleField, value: string): string[] {
  if (!supportsMultipleRuleValues(field)) return [value];
  return parseRuleValueInput(value);
}

export function normalizeRuleValues(
  field: MailCategoryRuleField,
  value: string,
  values?: string[],
): string[] {
  const explicitValues = Array.isArray(values)
    ? values.filter(item => typeof item === 'string' && item.trim().length > 0)
    : [];
  const source = explicitValues.length > 0 ? explicitValues : legacyRuleValues(field, value);
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of source) {
    const item = rawValue.trim();
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }

  return normalized;
}

export function ruleValues(rule: RuleValueSource): string[] {
  return normalizeRuleValues(rule.field, rule.value, rule.values);
}

export function canonicalRuleValueFields(
  field: MailCategoryRuleField,
  values: string[],
): { value: string; values?: string[] } {
  const normalized = normalizeRuleValues(field, '', values);
  return {
    value: normalized[0] || '',
    values: supportsMultipleRuleValues(field) ? normalized : undefined,
  };
}
