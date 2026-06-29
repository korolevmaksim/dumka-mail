import { describe, expect, it } from 'vitest';
import { filterSearchableOptions } from '../shared/searchableOptions';

describe('filterSearchableOptions', () => {
  it('filters long model lists by case-insensitive substring', () => {
    const options = [
      'gemini-2.0-flash',
      'gemini-3.5-flash',
      'claude-sonnet-4-6',
      'openai/gpt-5',
    ];

    expect(filterSearchableOptions(options, 'FLASH')).toEqual([
      'gemini-2.0-flash',
      'gemini-3.5-flash',
    ]);
    expect(filterSearchableOptions(options, 'sonnet')).toEqual(['claude-sonnet-4-6']);
    expect(filterSearchableOptions(options, '  ')).toEqual(options);
  });
});
