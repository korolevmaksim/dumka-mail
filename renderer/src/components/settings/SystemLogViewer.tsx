import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Copy,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  SYSTEM_LOG_LEVELS,
  type SystemLogEntry,
  type SystemLogLevel,
  type SystemLogOrder,
  type SystemLogStats,
} from '../../../../shared/systemLogs';

const LEVEL_LABELS: Record<SystemLogLevel, string> = {
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
};

const LEVEL_COLORS: Record<SystemLogLevel, string> = {
  info: 'var(--info)',
  warning: 'var(--warning)',
  error: 'var(--danger)',
};

function timeLabel(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    : '';
}

function matchesFilters(entry: SystemLogEntry, levels: SystemLogLevel[], source: string, search: string): boolean {
  if (!levels.includes(entry.level)) return false;
  if (source && entry.source !== source) return false;
  const needle = search.trim().toLocaleLowerCase();
  if (!needle) return true;
  return `${entry.source} ${entry.message}`.toLocaleLowerCase().includes(needle);
}

export function SystemLogViewer({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<SystemLogEntry[]>([]);
  const [levels, setLevels] = useState<SystemLogLevel[]>([...SYSTEM_LOG_LEVELS]);
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<SystemLogOrder>('desc');
  const [stats, setStats] = useState<SystemLogStats | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [paused, setPaused] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadLatest = useCallback(async (resetScroll = true) => {
    setLoading(true);
    try {
      const [page, nextStats] = await Promise.all([
        window.electronAPI.listSystemLogs({
          levels,
          source,
          search: debouncedSearch,
          limit: 300,
          order: sortOrder,
        }),
        window.electronAPI.getSystemLogStats(),
      ]);
      setEntries(page.entries);
      setHasMore(page.hasMore);
      setStats(nextStats);
      setUnseen(0);
      if (resetScroll) {
        window.requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = sortOrder === 'desc' ? 0 : scrollRef.current.scrollHeight;
          }
        });
      }
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, levels, source, sortOrder]);

  useEffect(() => {
    void loadLatest(true);
  }, [loadLatest]);

  useEffect(() => window.electronAPI.onSystemLogEntry(entry => {
    setStats(previous => {
      if (!previous) return previous;
      return {
        ...previous,
        total: previous.total + 1,
        [entry.level]: previous[entry.level] + 1,
        newestAt: entry.occurredAt,
        oldestAt: previous.oldestAt || entry.occurredAt,
        sources: previous.sources.includes(entry.source)
          ? previous.sources
          : [...previous.sources, entry.source].sort((a, b) => a.localeCompare(b)),
      };
    });
    if (paused) {
      setUnseen(count => count + 1);
      return;
    }
    if (!matchesFilters(entry, levels, source, debouncedSearch)) return;

    if (sortOrder === 'desc') {
      setEntries(previous => [entry, ...previous.slice(0, 999)]);
      window.requestAnimationFrame(() => {
        if (scrollRef.current && scrollRef.current.scrollTop < 60) {
          scrollRef.current.scrollTop = 0;
        }
      });
    } else {
      setEntries(previous => [...previous.slice(-999), entry]);
      window.requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }), [debouncedSearch, levels, paused, source, sortOrder]);

  const loadOlder = useCallback(async () => {
    const lastId = entries.length > 0 ? entries[entries.length - 1].id : undefined;
    if (!lastId || loadingOlder || !hasMore) return;
    setLoadingOlder(true);
    try {
      const page = await window.electronAPI.listSystemLogs({
        levels,
        source,
        search: debouncedSearch,
        beforeId: lastId,
        limit: 300,
        order: sortOrder,
      });
      setEntries(previous => [...previous, ...page.entries]);
      setHasMore(page.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  }, [debouncedSearch, entries, hasMore, levels, loadingOlder, source, sortOrder]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    setShowScrollTop(sortOrder === 'desc' && scrollRef.current.scrollTop > 200);
  };

  const scrollToTop = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const copyLogEntry = (entry: SystemLogEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const detailsStr = entry.details ? `\nDetails: ${JSON.stringify(entry.details, null, 2)}` : '';
    const text = `[${entry.occurredAt}] [${entry.level.toUpperCase()}] [${entry.source}] ${entry.message}${detailsStr}`;
    void navigator.clipboard.writeText(text);
    setCopiedId(entry.id);
    window.setTimeout(() => setCopiedId(null), 1500);
  };

  const groupedEntries = useMemo(() => {
    let previousDay = '';
    return entries.map(entry => {
      const day = dayLabel(entry.occurredAt);
      const showDay = day !== previousDay;
      previousDay = day;
      return { entry, day, showDay };
    });
  }, [entries]);

  const toggleLevel = (level: SystemLogLevel) => {
    setLevels(previous => previous.includes(level)
      ? previous.filter(candidate => candidate !== level)
      : SYSTEM_LOG_LEVELS.filter(candidate => candidate === level || previous.includes(candidate)));
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 select-text">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close log viewer"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-[calc(15px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Application Log</h2>
            <p className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
              {paused ? `Paused${unseen ? ` · ${unseen} new` : ''}` : 'Live updates enabled'}
              {stats ? ` · ${stats.total.toLocaleString()} total logged` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSortOrder(current => (current === 'desc' ? 'asc' : 'desc'))}
            title={sortOrder === 'desc' ? 'Showing newest events first. Click to view oldest first.' : 'Showing oldest events first. Click to view newest first.'}
            className="inline-flex h-7 items-center gap-1.5 rounded border border-[var(--border)] px-2.5 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)] hover:border-[var(--strong-border)] cursor-pointer"
          >
            <ArrowUpDown className="h-3.5 w-3.5 text-[var(--accent-ink)]" />
            <span>{sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (paused) void loadLatest(true);
              setPaused(value => !value);
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded border border-[var(--border)] px-2.5 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)] hover:border-[var(--strong-border)] cursor-pointer"
          >
            {paused ? <CirclePlay className="h-3.5 w-3.5 text-[var(--success)]" /> : <CirclePause className="h-3.5 w-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            onClick={() => void loadLatest(true)}
            aria-label="Refresh logs"
            title="Refresh logs"
            className="flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setClearConfirm(true)}
            aria-label="Clear logs"
            title="Clear logs"
            className="flex h-7 w-7 items-center justify-center rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--danger)] hover:text-[var(--danger)] cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {clearConfirm && (
        <div role="alert" className="flex items-center justify-between gap-4 rounded bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2">
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-primary)]">Clear all retained application logs? This cannot be undone.</span>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => setClearConfirm(false)} className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer">Cancel</button>
            <button
              type="button"
              onClick={() => {
                void window.electronAPI.clearSystemLogs().then(() => loadLatest(true));
                setClearConfirm(false);
              }}
              className="rounded bg-[var(--danger-solid)] px-2.5 py-1 text-[calc(10px*var(--font-scale))] font-semibold text-white cursor-pointer"
            >
              Clear Logs
            </button>
          </div>
        </div>
      )}

      <div className="dm-toolbar flex flex-wrap items-center gap-2 border-y border-[var(--border)] py-2">
        <div className="flex items-center gap-1">
          {SYSTEM_LOG_LEVELS.map(level => {
            const active = levels.includes(level);
            const count = stats?.[level] ?? 0;
            return (
              <button
                key={level}
                type="button"
                aria-pressed={active}
                onClick={() => toggleLevel(level)}
                className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-[calc(10px*var(--font-scale))] font-medium cursor-pointer ${active ? 'bg-[var(--selected-row)] text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--hover-row)]'}`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LEVEL_COLORS[level], opacity: active ? 1 : 0.45 }} />
                {LEVEL_LABELS[level]}
                <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search messages or sources"
            aria-label="Search application logs"
            className="dm-control h-7 w-full rounded border border-[var(--border)] bg-[var(--app-bg)] pl-7 pr-7 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search input"
              className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <select
          value={source}
          onChange={event => setSource(event.target.value)}
          aria-label="Filter by source"
          className="dm-control h-7 max-w-[180px] rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
        >
          <option value="">All sources</option>
          {(stats?.sources || []).map(candidate => <option key={candidate} value={candidate}>{candidate}</option>)}
        </select>
      </div>

      <div className="dm-panel relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--app-bg)]">
        <div className="grid shrink-0 grid-cols-[88px_72px_130px_minmax(0,1fr)_48px] border-b border-[var(--border)] bg-[var(--rail-bg)] px-2 py-1.5 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">
          <span>Time</span><span>Level</span><span>Source</span><span>Message</span><span className="text-right pr-1">Actions</span>
        </div>
        <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto">
          {!loading && groupedEntries.length === 0 && (
            <div className="flex h-48 flex-col items-center justify-center text-center">
              <Search className="mb-2 h-5 w-5 text-[var(--text-tertiary)]" />
              <div className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">No matching events</div>
              <div className="mt-1 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Adjust the level, source, or search filters.</div>
            </div>
          )}

          {groupedEntries.map(({ entry, day, showDay }) => {
            const expanded = expandedId === entry.id;
            const isCopied = copiedId === entry.id;
            const hasDetails = Boolean(entry.details && Object.keys(entry.details).length > 0);
            return (
              <div key={entry.id}>
                {showDay && <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-medium text-[var(--text-secondary)]">{day}</div>}
                <div
                  onClick={() => hasDetails && setExpandedId(expanded ? null : entry.id)}
                  className={`group grid w-full grid-cols-[88px_72px_130px_minmax(0,1fr)_48px] items-start border-b border-[var(--border)]/60 px-2 py-1.5 text-left ${hasDetails ? 'hover:bg-[var(--hover-row)] cursor-pointer' : 'hover:bg-[var(--hover-row)]/50 cursor-default'}`}
                >
                  <span className="font-mono text-[calc(9px*var(--font-scale))] tabular-nums text-[var(--text-tertiary)]">{timeLabel(entry.occurredAt)}</span>
                  <span className="inline-flex items-center gap-1.5 text-[calc(9px*var(--font-scale))] font-semibold" style={{ color: LEVEL_COLORS[entry.level] }}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />{LEVEL_LABELS[entry.level]}
                  </span>
                  <span className="truncate pr-3 text-[calc(9px*var(--font-scale))] font-medium text-[var(--text-secondary)]" title={entry.source}>{entry.source}</span>
                  <span className="flex min-w-0 items-start gap-1.5 text-[calc(10px*var(--font-scale))] leading-relaxed text-[var(--text-primary)]">
                    {hasDetails ? (expanded ? <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-[var(--text-tertiary)]" /> : <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />) : <span className="w-3 shrink-0" />}
                    <span className="break-words">{entry.message}</span>
                  </span>
                  <div className="flex justify-end pr-1">
                    <button
                      type="button"
                      onClick={e => copyLogEntry(entry, e)}
                      title="Copy log entry"
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--selected-row)] hover:text-[var(--text-primary)] transition-opacity cursor-pointer"
                    >
                      {isCopied ? <Check className="h-3 w-3 text-[var(--success)]" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
                {expanded && entry.details && (
                  <dl className="grid grid-cols-[160px_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-[var(--border)] bg-[var(--rail-bg)] px-5 py-2.5 font-mono text-[calc(9px*var(--font-scale))]">
                    {Object.entries(entry.details).map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="truncate text-[var(--text-tertiary)]">{key}</dt>
                        <dd className="break-all text-[var(--text-secondary)]">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            );
          })}

          {hasMore && (
            <div className="flex justify-center border-b border-[var(--border)] py-2">
              <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="text-[calc(10px*var(--font-scale))] font-medium text-[var(--accent-ink)] disabled:opacity-50 cursor-pointer">
                {loadingOlder ? 'Loading older events…' : 'Load older events'}
              </button>
            </div>
          )}
        </div>

        {showScrollTop && (
          <button
            type="button"
            onClick={scrollToTop}
            className="absolute bottom-4 right-4 flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent-solid)] px-3 text-[calc(10px*var(--font-scale))] font-semibold text-white shadow-md hover:opacity-90 transition-opacity cursor-pointer z-20"
          >
            Jump to newest
          </button>
        )}
      </div>
    </div>
  );
}
