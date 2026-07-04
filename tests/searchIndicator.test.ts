import { describe, expect, it } from 'vitest';
import { getSearchIndicatorState } from '../renderer/src/components/layout/searchIndicator';
import type { MailSearchState } from '../renderer/src/stores/mailSearchStatus';

const state = (partial: Partial<MailSearchState>): MailSearchState => ({
  phase: 'complete',
  semantic: 'off',
  coverage: null,
  ...partial,
});

const base = { draftQuery: 'contract', committedQuery: 'contract' };

describe('search indicator state', () => {
  it('shows searching while input is uncommitted or phase is searching', () => {
    expect(getSearchIndicatorState({ draftQuery: 'c', committedQuery: '', searchState: state({ phase: 'idle' }) }))
      .toEqual({ kind: 'searching', label: 'Searching' });
    expect(getSearchIndicatorState({ ...base, searchState: state({ phase: 'searching' }) }))
      .toEqual({ kind: 'searching', label: 'Searching' });
  });

  it('shows plain Done when semantic is off', () => {
    expect(getSearchIndicatorState({ ...base, searchState: state({ semantic: 'off' }) }))
      .toEqual({ kind: 'complete', label: 'Done' });
  });

  it('shows AI pending while semantic results are on the way', () => {
    expect(getSearchIndicatorState({ ...base, searchState: state({ semantic: 'pending' }) }))
      .toEqual({ kind: 'searching', label: 'Done · AI…' });
  });

  it('shows AI applied with full coverage', () => {
    expect(getSearchIndicatorState({
      ...base,
      searchState: state({ semantic: 'applied', coverage: { scanned: 300, totalIndexed: 300 } }),
    })).toEqual({ kind: 'complete', label: 'Done · AI ✓' });
  });

  it('shows honest partial coverage with compact counts', () => {
    expect(getSearchIndicatorState({
      ...base,
      searchState: state({ semantic: 'applied', coverage: { scanned: 12000, totalIndexed: 45000 } }),
    })).toEqual({ kind: 'complete', label: 'Done · AI searched 12k of 45k' });
  });

  it('shows AI unavailable with the error in title', () => {
    expect(getSearchIndicatorState({
      ...base,
      searchState: state({ semantic: 'error', errorMessage: 'HTTP 500' }),
    })).toEqual({ kind: 'error', label: 'Done · AI unavailable', title: 'HTTP 500' });
  });

  it('hides the indicator when idle with no queries', () => {
    expect(getSearchIndicatorState({ draftQuery: '', committedQuery: '', searchState: state({ phase: 'idle' }) }))
      .toEqual({ kind: 'none', label: '' });
  });
});
