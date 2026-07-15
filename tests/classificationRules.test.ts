import { describe, expect, it } from 'vitest';
import {
  canonicalRuleValueFields,
  normalizeRuleValues,
  parseRuleValueInput,
  ruleValues,
  supportsMultipleRuleValues,
} from '../shared/classificationRules';

describe('classification rule values', () => {
  it('normalizes explicit multi-values and removes case-insensitive duplicates', () => {
    expect(normalizeRuleValues('from', 'legacy@example.com', [
      ' Alice@Example.com ',
      'alice@example.com',
      'bob@example.com',
      '',
    ])).toEqual(['Alice@Example.com', 'bob@example.com']);
  });

  it('splits legacy comma, semicolon, and newline lists for address fields', () => {
    expect(normalizeRuleValues(
      'from',
      'alice@example.com, bob@example.com; carol@example.com\nops@example.com',
    )).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
      'ops@example.com',
    ]);
  });

  it('parses pasted combobox input without splitting display-name spaces', () => {
    expect(parseRuleValueInput('John Doe; jane@example.com, ops@example.com')).toEqual([
      'John Doe',
      'jane@example.com',
      'ops@example.com',
    ]);
  });

  it('preserves commas in fields that remain single-value', () => {
    expect(normalizeRuleValues('subject', 'invoice, overdue')).toEqual(['invoice, overdue']);
    expect(normalizeRuleValues('senderDomain', 'github.com, gitlab.com')).toEqual(['github.com, gitlab.com']);
  });

  it('creates a canonical legacy value plus the complete multi-value set', () => {
    expect(canonicalRuleValueFields('to', [' alias@example.com ', 'team@example.com'])).toEqual({
      value: 'alias@example.com',
      values: ['alias@example.com', 'team@example.com'],
    });
    expect(canonicalRuleValueFields('senderDomain', [' github.com '])).toEqual({
      value: 'github.com',
      values: undefined,
    });
  });

  it('reads legacy and explicit rule shapes through one helper', () => {
    expect(ruleValues({ field: 'cc', value: 'first@example.com, second@example.com' })).toEqual([
      'first@example.com',
      'second@example.com',
    ]);
    expect(supportsMultipleRuleValues('from')).toBe(true);
    expect(supportsMultipleRuleValues('subject')).toBe(false);
  });
});
