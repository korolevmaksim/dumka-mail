import { describe, expect, it } from 'vitest';
import { getSearchIndicatorState } from '../renderer/src/components/layout/searchIndicator';

describe('search indicator state', () => {
  it('shows searching while local input is waiting to be committed', () => {
    expect(getSearchIndicatorState({
      draftQuery: 'contract',
      committedQuery: '',
      searchStatus: 'idle',
    })).toEqual({ kind: 'searching', label: 'Searching' });
  });

  it('shows background searching and completion states', () => {
    expect(getSearchIndicatorState({
      draftQuery: 'contract',
      committedQuery: 'contract',
      searchStatus: 'searching',
    })).toEqual({ kind: 'searching', label: 'Searching' });

    expect(getSearchIndicatorState({
      draftQuery: 'contract',
      committedQuery: 'contract',
      searchStatus: 'complete',
    })).toEqual({ kind: 'complete', label: 'Done' });
  });

  it('hides the indicator when no search work is pending or active', () => {
    expect(getSearchIndicatorState({
      draftQuery: '',
      committedQuery: '',
      searchStatus: 'idle',
    })).toEqual({ kind: 'none', label: '' });
  });
});
