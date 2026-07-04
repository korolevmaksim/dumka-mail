import type { MailSearchState } from '../../stores/mailSearchStatus';

export type SearchIndicatorKind = 'none' | 'searching' | 'complete' | 'error';

export interface SearchIndicatorInput {
  draftQuery: string;
  committedQuery: string;
  searchState: MailSearchState;
}

export interface SearchIndicatorState {
  kind: SearchIndicatorKind;
  label: string;
  title?: string;
}

function compactCount(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
}

export function getSearchIndicatorState({
  draftQuery,
  committedQuery,
  searchState,
}: SearchIndicatorInput): SearchIndicatorState {
  if (draftQuery !== committedQuery || searchState.phase === 'searching') {
    return { kind: 'searching', label: 'Searching' };
  }

  if (searchState.phase === 'complete') {
    switch (searchState.semantic) {
      case 'pending':
        return { kind: 'searching', label: 'Done · AI…' };
      case 'error':
        return { kind: 'error', label: 'Done · AI unavailable', title: searchState.errorMessage };
      case 'applied': {
        const coverage = searchState.coverage;
        if (coverage && coverage.scanned < coverage.totalIndexed) {
          return {
            kind: 'complete',
            label: `Done · AI searched ${compactCount(coverage.scanned)} of ${compactCount(coverage.totalIndexed)}`,
          };
        }
        return { kind: 'complete', label: 'Done · AI ✓' };
      }
      default:
        return { kind: 'complete', label: 'Done' };
    }
  }

  return { kind: 'none', label: '' };
}
