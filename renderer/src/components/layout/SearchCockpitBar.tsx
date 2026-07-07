import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { AlertTriangle, Check, LoaderCircle, Search, Sparkles, X } from 'lucide-react';
import { parseSearchQuery } from '../../../../shared/search';
import { createSearchCommitController, type SearchCommitController } from './searchCommitController';
import { getSearchIndicatorState } from './searchIndicator';

export const SearchCockpitBar = forwardRef<HTMLInputElement, {}>(({}, ref) => {
  const store = useAppStore();
  const { searchQuery, searchStatus, setSearchQuery, settingsOpen, setSettingsOpen, cleanupOpen, setCleanupOpen } = store;
  const [draftQuery, setDraftQuery] = useState(searchQuery);
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

  const commitSearchImmediately = useCallback((value: string) => {
    commitController.cancel();
    setDraftQuery(value);
    commitRef.current(value);
  }, [commitController]);

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
  
  const appendOperator = (op: string) => {
    const current = draftQuery.trim();
    const rebuilt = current ? `${current} ${op}` : op;
    commitSearchImmediately(rebuilt);
    if (ref && 'current' in ref && ref.current) {
      ref.current.focus();
    }
  };

  const removeSearchField = (key: string, termVal?: string) => {
    const rebuiltParts: string[] = [];
    if (key !== 'from' && parsedSearch.from) rebuiltParts.push(`from:${parsedSearch.from}`);
    if (key !== 'domain' && parsedSearch.domain) rebuiltParts.push(`domain:${parsedSearch.domain}`);
    if (key !== 'hasAttachment' && parsedSearch.hasAttachment !== undefined) {
      rebuiltParts.push(parsedSearch.hasAttachment ? 'has:attachment' : 'has:noattachment');
    }
    if (key !== 'isUnread' && parsedSearch.isUnread !== undefined) {
      rebuiltParts.push(parsedSearch.isUnread ? 'is:unread' : 'is:read');
    }
    if (key !== 'label' && parsedSearch.label) rebuiltParts.push(`label:${parsedSearch.label}`);
    if (key !== 'inSplit' && parsedSearch.inSplit) rebuiltParts.push(`in:${parsedSearch.inSplit}`);
    if (key !== 'after' && parsedSearch.after) rebuiltParts.push(`after:${parsedSearch.after}`);
    if (key !== 'before' && parsedSearch.before) rebuiltParts.push(`before:${parsedSearch.before}`);
    
    const terms = key === 'textTerms' && termVal 
      ? parsedSearch.textTerms.filter((t: string) => t !== termVal)
      : parsedSearch.textTerms;
    rebuiltParts.push(...terms);
    
    commitSearchImmediately(rebuiltParts.join(' '));
  };

  return (
    <div
      className="panel-surface flex flex-col border-b border-[var(--border)] bg-[var(--panel-bg)] select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      <div className="flex items-center justify-between h-[var(--top-chrome-h)] min-h-[40px] px-4 gap-4 w-full">
        <div 
          className="flex items-center flex-1 gap-2 bg-[var(--app-bg)] rounded-lg px-2 border border-[var(--border)] max-w-[600px] focus-within:outline focus-within:outline-2 focus-within:outline-[var(--accent)] focus-within:outline-offset-1"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <Search className="w-4 h-4 text-[var(--text-tertiary)]" />
          <input
            ref={ref}
            type="text"
            placeholder="Search mail: from: domain: has:attachment is:unread"
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
                <Check className="h-3.5 w-3.5 text-emerald-500" />
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
            <button onClick={() => commitSearchImmediately('')} className="cursor-pointer">
              <X className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
            </button>
          )}
        </div>

        {/* Status & Sync text */}
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {store.syncStatusText && (
            <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)] font-normal tracking-wide">
              {store.syncStatusText}
            </span>
          )}
        </div>
      </div>

      {/* Suggested operators & Active Query chips */}
      {showSearchIntelligence && (
        <div 
          className="flex flex-wrap items-center gap-2 px-4 pb-2 -mt-1 text-[calc(10px*var(--font-scale))] border-t border-[var(--border)]/30 pt-2"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <span className="text-[var(--text-secondary)] font-semibold shrink-0">Filters:</span>
          
          {/* Render active query chips */}
          {parsedSearch.from && (
            <span className="flex items-center gap-1 bg-[var(--accent)]/15 text-[var(--accent)] px-2 py-0.5 rounded-full border border-[var(--accent)]/20">
              From: {parsedSearch.from}
              <button type="button" onClick={() => removeSearchField('from')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.domain && (
            <span className="flex items-center gap-1 bg-[var(--accent)]/15 text-[var(--accent)] px-2 py-0.5 rounded-full border border-[var(--accent)]/20">
              Domain: {parsedSearch.domain}
              <button type="button" onClick={() => removeSearchField('domain')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.hasAttachment !== undefined && (
            <span className="flex items-center gap-1 bg-cyan-500/15 text-cyan-600 px-2 py-0.5 rounded-full border border-cyan-500/20">
              {parsedSearch.hasAttachment ? 'Has Attachments' : 'No Attachments'}
              <button type="button" onClick={() => removeSearchField('hasAttachment')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.isUnread !== undefined && (
            <span className="flex items-center gap-1 bg-emerald-500/15 text-emerald-600 px-2 py-0.5 rounded-full border border-emerald-500/20">
              {parsedSearch.isUnread ? 'Unread' : 'Read'}
              <button type="button" onClick={() => removeSearchField('isUnread')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.label && (
            <span className="flex items-center gap-1 bg-purple-500/15 text-purple-600 px-2 py-0.5 rounded-full border border-purple-500/20">
              Label: {parsedSearch.label}
              <button type="button" onClick={() => removeSearchField('label')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.inSplit && (
            <span className="flex items-center gap-1 bg-amber-500/15 text-amber-600 px-2 py-0.5 rounded-full border border-amber-500/20">
              Split: {parsedSearch.inSplit}
              <button type="button" onClick={() => removeSearchField('inSplit')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.after && (
            <span className="flex items-center gap-1 bg-neutral-500/15 text-neutral-600 px-2 py-0.5 rounded-full border border-neutral-500/20">
              After: {parsedSearch.after}
              <button type="button" onClick={() => removeSearchField('after')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.before && (
            <span className="flex items-center gap-1 bg-neutral-500/15 text-neutral-600 px-2 py-0.5 rounded-full border border-neutral-500/20">
              Before: {parsedSearch.before}
              <button type="button" onClick={() => removeSearchField('before')} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          )}
          {parsedSearch.textTerms.map((term: string, i: number) => (
            <span key={i} className="flex items-center gap-1 bg-[var(--border)] text-[var(--text-secondary)] px-2 py-0.5 rounded-full border border-[var(--border)]">
              "{term}"
              <button type="button" onClick={() => removeSearchField('textTerms', term)} className="hover:text-[var(--danger)] cursor-pointer"><X className="w-2.5 h-2.5" /></button>
            </span>
          ))}

          {/* Suggestions */}
          <div className="flex items-center gap-1.5 ml-auto border-l border-[var(--border)] pl-3">
            <span className="text-[var(--text-tertiary)]">Suggest:</span>
            <button type="button" onClick={() => appendOperator('from:')} className="px-1.5 py-0.5 bg-[var(--border)]/30 hover:bg-[var(--border)] rounded cursor-pointer">from:</button>
            <button type="button" onClick={() => appendOperator('domain:')} className="px-1.5 py-0.5 bg-[var(--border)]/30 hover:bg-[var(--border)] rounded cursor-pointer">domain:</button>
            <button type="button" onClick={() => appendOperator('has:attachment')} className="px-1.5 py-0.5 bg-[var(--border)]/30 hover:bg-[var(--border)] rounded cursor-pointer">has:attachment</button>
            <button type="button" onClick={() => appendOperator('is:unread')} className="px-1.5 py-0.5 bg-[var(--border)]/30 hover:bg-[var(--border)] rounded cursor-pointer">is:unread</button>
          </div>
        </div>
      )}
    </div>
  );
});

SearchCockpitBar.displayName = 'SearchCockpitBar';
