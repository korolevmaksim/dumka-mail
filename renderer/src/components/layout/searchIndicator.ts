import type { MailSearchStatus } from '../../stores/mailSearchStatus';

export type SearchIndicatorKind = 'none' | 'searching' | 'complete';

export interface SearchIndicatorInput {
  draftQuery: string;
  committedQuery: string;
  searchStatus: MailSearchStatus;
}

export interface SearchIndicatorState {
  kind: SearchIndicatorKind;
  label: string;
}

export function getSearchIndicatorState({
  draftQuery,
  committedQuery,
  searchStatus,
}: SearchIndicatorInput): SearchIndicatorState {
  if (draftQuery !== committedQuery || searchStatus === 'searching') {
    return { kind: 'searching', label: 'Searching' };
  }

  if (searchStatus === 'complete') {
    return { kind: 'complete', label: 'Done' };
  }

  return { kind: 'none', label: '' };
}
