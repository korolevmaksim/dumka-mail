import type { SemanticSearchCoverage } from '../../../shared/types';

export type MailSearchPhase = 'idle' | 'searching' | 'complete';
export type SemanticUiState = 'off' | 'pending' | 'applied' | 'error';

export interface MailSearchState {
  phase: MailSearchPhase;
  semantic: SemanticUiState;
  coverage: SemanticSearchCoverage | null;
  errorMessage?: string;
}

export const IDLE_SEARCH_STATE: MailSearchState = { phase: 'idle', semantic: 'off', coverage: null };
