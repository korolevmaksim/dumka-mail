import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { filterSearchableOptions } from '../../../../shared/searchableOptions';

interface SearchableSelectProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
}

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = 'Search...',
  emptyLabel = 'No matches',
  className = '',
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectableOptions = useMemo(() => {
    if (!value || options.includes(value)) return options;
    return [value, ...options];
  }, [options, value]);

  const filteredOptions = useMemo(
    () => filterSearchableOptions(selectableOptions, query),
    [selectableOptions, query]
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const pick = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        className="dm-control w-full min-w-0 bg-[var(--panel-bg)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer focus:outline focus:outline-2 focus:outline-[var(--accent)] flex items-center gap-1"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex-1 truncate text-left">{value || placeholder}</span>
        <ChevronDown className="w-3 h-3 text-[var(--text-secondary)] shrink-0" />
      </button>

      {open && (
        <div className="dm-overlay absolute right-0 top-full z-50 mt-1 w-[260px] rounded-md border border-[var(--strong-border)] bg-[var(--panel-bg)] shadow-xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[var(--border)] bg-[var(--rail-bg)]">
            <Search className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setOpen(false);
                }
                if (event.key === 'Enter' && filteredOptions[0]) {
                  event.preventDefault();
                  pick(filteredOptions[0]);
                }
              }}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent border-0 outline-none text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] placeholder-[var(--text-tertiary)]"
            />
          </div>
          <div role="listbox" className="max-h-[220px] overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-2 py-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                {emptyLabel}
              </div>
            ) : (
              filteredOptions.map(option => (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={option === value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(option)}
                  className="w-full min-w-0 flex items-center gap-1.5 px-2 py-1.5 text-left text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)] cursor-pointer"
                >
                  <Check className={`w-3 h-3 shrink-0 ${option === value ? 'opacity-100 text-[var(--accent)]' : 'opacity-0'}`} />
                  <span className="truncate">{option}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
