import { forwardRef } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { Search, X } from 'lucide-react';
import { parseSearchQuery } from '../../../../shared/search';

export const SearchCockpitBar = forwardRef<HTMLInputElement, {}>(({}, ref) => {
  const store = useAppStore();

  const parsedSearch = parseSearchQuery(store.searchQuery);
  const showSearchIntelligence = store.searchQuery.trim().length > 0;
  
  const appendOperator = (op: string) => {
    const current = store.searchQuery.trim();
    const rebuilt = current ? `${current} ${op}` : op;
    store.setSearchQuery(rebuilt);
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
    
    store.setSearchQuery(rebuiltParts.join(' '));
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
            value={store.searchQuery}
            onChange={(e) => {
              store.setSearchQuery(e.target.value);
              if (e.target.value) {
                store.setSettingsOpen(false);
              }
            }}
            className="flex-1 bg-transparent border-0 outline-none text-[calc(12px*var(--font-scale))] py-1.5 text-[var(--text-primary)] placeholder-[var(--text-tertiary)]"
          />
          {store.searchQuery && (
            <button onClick={() => store.setSearchQuery('')} className="cursor-pointer">
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
