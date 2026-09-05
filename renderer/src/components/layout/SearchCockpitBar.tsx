import { SearchFiltersPanel } from './SearchFiltersPanel';
import { serializeSearchQuery } from '../../../../shared/searchFilters';
import { forwardRef, type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { SlidersHorizontal, AlertTriangle, Check, LoaderCircle, Search, Sparkles, X } from 'lucide-react';
import { parseSearchQuery } from '../../../../shared/search';
import { createSearchCommitController, type SearchCommitController } from './searchCommitController';
import { getSearchIndicatorState } from './searchIndicator';
import { isIncompleteBackfillProgress } from '../../../../shared/syncStatusAffordance';

export const SearchCockpitBar = forwardRef<HTMLInputElement, {}>(({}, ref) => {
  const store = useAppStore();
  const { searchQuery, searchStatus, setSearchQuery, settingsOpen, setSettingsOpen, cleanupOpen, setCleanupOpen, setWorkspaceView } = store;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftQuery, setDraftQuery] = useState(searchQuery);
  const [showNavigationActivity, setShowNavigationActivity] = useState(false);
  const committedQueryRef = useRef(searchQuery);
  const commitRef = useRef<(value: string) => void>(() => undefined);
  const controllerRef = useRef<SearchCommitController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createSearchCommitController((value) => commitRef.current(value));
  }
  const commitController = controllerRef.current;

  committedQueryRef.current = searchQuery;
  commitRef.current = (value: string) => {
    if (value !== committedQueryRef.current) {
      setSearchQuery(value);
    }
  };

  useEffect(() => {
    commitController.cancel();
    setDraftQuery(searchQuery);
  }, [commitController, searchQuery]);

  useEffect(() => () => {
    commitController.cancel();
  }, [commitController]);

  useEffect(() => {
    if (store.navigationActivity.phase === 'idle') {
      setShowNavigationActivity(false);
      return;
    }
    const timer = globalThis.setTimeout(() => setShowNavigationActivity(true), 120);
    return () => globalThis.clearTimeout(timer);
  }, [store.navigationActivity.phase, store.navigationActivity.scopeKey]);

  const commitSearchImmediately = useCallback((value: string) => {
    commitController.cancel();
    setDraftQuery(value);
    commitRef.current(value);
    if (value.trim()) { setSettingsOpen(false); setCleanupOpen(false); setWorkspaceView('mail'); }
  }, [commitController, setSettingsOpen, setCleanupOpen, setWorkspaceView]);

  const scheduleSearchCommit = useCallback((value: string) => {
    setDraftQuery(value);
    commitController.schedule(value);
  }, [commitController]);

  const askMailbox = useCallback(() => {
    const query = draftQuery.trim();
    if (!query || store.aiPanelLoading) return;
    commitController.flush(draftQuery);
    store.setAiPanelOpen(true);
    void store.sendAIMessage(`Find mail matching: ${query}`);
  }, [commitController, draftQuery, store]);

  const parsedSearch = parseSearchQuery(draftQuery);
  const showSearchIntelligence = draftQuery.trim().length > 0;
  const searchIndicator = getSearchIndicatorState({
    draftQuery,
    committedQuery: searchQuery,
    searchState: searchStatus,
  });
  
  const removeSearchField = (key: string, termVal?: string) => {
    const next = { ...parsedSearch };
    if (key === 'textTerms') next.textTerms = next.textTerms.filter(term => term !== termVal);
    else delete next[key as keyof Omit<typeof next, 'textTerms'>];
    commitSearchImmediately(serializeSearchQuery(next));
  };

  return (
    <div
      className="dm-search-chrome dm-toolbar panel-surface flex flex-col border-b border-[var(--border)] bg-[var(--panel-bg)] select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
    >
      <div className="flex items-center justify-between h-[var(--top-chrome-h)] min-h-[40px] px-4 gap-4 w-full">
        <div 
          className="dm-search-field dm-control flex items-center flex-1 gap-2 bg-[var(--app-bg)] rounded-lg px-2 border border-[var(--border)] max-w-[600px] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--accent)] focus-within:outline-offset-1"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <button type="button" aria-label="Search filters and saved searches" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)} className="rounded p-1 hover:bg-[var(--hover-row)]"><SlidersHorizontal className="h-4 w-4" /></button>
          <Search className="w-4 h-4 text-[var(--text-tertiary)]" />
          <input
            ref={ref}
            type="text"
            placeholder="Search mail"
            value={draftQuery}
            onChange={(e) => {
              const nextQuery = e.target.value;
              scheduleSearchCommit(nextQuery);
              if (nextQuery && settingsOpen) {
                setSettingsOpen(false);
              }
              if (nextQuery && cleanupOpen) {
                setCleanupOpen(false);
              }
              if (nextQuery) {
                setWorkspaceView('mail');
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitController.flush(draftQuery);
              } else if (e.key === 'Escape' && draftQuery) {
                e.preventDefault();
                e.stopPropagation();
                commitSearchImmediately('');
              }
            }}
            onBlur={() => {
              commitController.flush(draftQuery);
            }}
            className="min-w-0 flex-1 bg-transparent border-0 outline-none text-[calc(12px*var(--font-scale))] py-1.5 text-[var(--text-primary)] placeholder-[var(--text-tertiary)]"
          />
          {searchIndicator.kind !== 'none' && (
            <span
              aria-live="polite"
              title={searchIndicator.title ?? searchIndicator.label}
              className="flex shrink-0 items-center gap-1 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]"
            >
              {searchIndicator.kind === 'searching' ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : searchIndicator.kind === 'error' ? (
                <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)]" />
              ) : (
                <Check className="h-3.5 w-3.5 text-[var(--success)]" />
              )}
              <span>{searchIndicator.label}</span>
            </span>
          )}
          {draftQuery.trim() && (
            <button
              type="button"
              onClick={askMailbox}
              disabled={store.aiPanelLoading}
              title="Ask AI assistant to search the local mailbox"
              className="flex shrink-0 items-center gap-1 rounded border border-[var(--ai-accent)]/30 bg-[var(--ai-accent)]/10 px-1.5 py-0.5 text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:border-[var(--ai-accent)]/60 hover:bg-[var(--ai-accent)]/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="h-3 w-3 text-[var(--ai-accent)]" />
              <span>Ask</span>
            </button>
          )}
          {draftQuery && (
            <button aria-label="Clear search" onClick={() => commitSearchImmediately('')} className="cursor-pointer">
              <X className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            </button>
          )}
        </div>

        {/* Status & Sync text */}
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          {showNavigationActivity && store.navigationActivity.phase !== 'idle' && (
            <span
              aria-live="polite"
              className="dm-status-chip flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--raised-surface)] px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]"
            >
              <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-[var(--accent)] motion-reduce:animate-none" />
              {store.navigationActivity.label}
            </span>
          )}
          {store.syncStatusText && (
            <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)] font-normal tracking-wide">
              {store.syncStatusText}
              {isIncompleteBackfillProgress(store.backfillProgress)
                ? ` · ${store.backfillProgress}`
                : ''}
            </span>
          )}
        </div>
      </div>

      {filtersOpen && <div style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}><SearchFiltersPanel key={store.activeAccount?.id} query={draftQuery} onChange={commitSearchImmediately} /></div>}
      {/* Active query chips */}
      {showSearchIntelligence && (
        <div 
          className="flex flex-wrap items-center gap-2 px-4 pb-2 -mt-1 text-[calc(10px*var(--font-scale))] border-t border-[var(--border)]/30 pt-2"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
        >
          <span className="text-[var(--text-secondary)] font-semibold shrink-0">Filters:</span>
          
          {/* Render active query chips */}
          {parsedSearch.from && (
            <span className="flex items-center gap-1 bg-[var(--accent)]/15 text-[var(--accent)] px-2 py-0.5 rounded-full border border-[var(--accent)]/20">
              From: {parsedSearch.from}
              <button type="button" aria-label="Remove sender filter" onClick={() => removeSearchField('from')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.domain && (
            <span className="flex items-center gap-1 bg-[var(--accent)]/15 text-[var(--accent)] px-2 py-0.5 rounded-full border border-[var(--accent)]/20">
              Domain: {parsedSearch.domain}
              <button type="button" aria-label="Remove domain filter" onClick={() => removeSearchField('domain')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.hasAttachment !== undefined && (
            <span className="flex items-center gap-1 bg-[var(--info)]/15 text-[var(--info)] px-2 py-0.5 rounded-full border border-[var(--info)]/20">
              {parsedSearch.hasAttachment ? 'Has Attachments' : 'No Attachments'}
              <button type="button" aria-label="Remove attachment filter" onClick={() => removeSearchField('hasAttachment')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.isUnread !== undefined && (
            <span className="flex items-center gap-1 bg-[var(--success)]/15 text-[var(--success)] px-2 py-0.5 rounded-full border border-[var(--success)]/20">
              {parsedSearch.isUnread ? 'Unread' : 'Read'}
              <button type="button" aria-label="Remove read status filter" onClick={() => removeSearchField('isUnread')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.label && (
            <span className="flex items-center gap-1 bg-[var(--ai-accent)]/15 text-[var(--ai-accent)] px-2 py-0.5 rounded-full border border-[var(--ai-accent)]/20">
              Label: {parsedSearch.label}
              <button type="button" aria-label="Remove label filter" onClick={() => removeSearchField('label')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.inSplit && (
            <span className="flex items-center gap-1 bg-[var(--warning)]/15 text-[var(--warning)] px-2 py-0.5 rounded-full border border-[var(--warning)]/20">
              Split: {parsedSearch.inSplit}
              <button type="button" aria-label="Remove split filter" onClick={() => removeSearchField('inSplit')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.after && (
            <span className="flex items-center gap-1 bg-[var(--text-tertiary)]/15 text-[var(--text-secondary)] px-2 py-0.5 rounded-full border border-[var(--border)]">
              After: {parsedSearch.after}
              <button type="button" aria-label="Remove start date filter" onClick={() => removeSearchField('after')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.before && (
            <span className="flex items-center gap-1 bg-[var(--text-tertiary)]/15 text-[var(--text-secondary)] px-2 py-0.5 rounded-full border border-[var(--border)]">
              Before: {parsedSearch.before}
              <button type="button" aria-label="Remove end date filter" onClick={() => removeSearchField('before')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.textTerms.map((term: string, i: number) => (
            <span key={i} className="flex items-center gap-1 bg-[var(--border)] text-[var(--text-secondary)] px-2 py-0.5 rounded-full border border-[var(--border)]">
              "{term}"
              <button type="button" aria-label={`Remove search term ${term}`} onClick={() => removeSearchField('textTerms', term)} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          ))}


        </div>
      )}
    </div>
  );
});

SearchCockpitBar.displayName = 'SearchCockpitBar';
