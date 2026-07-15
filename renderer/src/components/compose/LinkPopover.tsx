import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'lucide-react';
import { normalizeLinkUrl } from '../../lib/linkUrl';

interface LinkPopoverProps {
  selectedText: string;
  onSubmit: (url: string) => void;
  onCancel: () => void;
  className?: string;
}

export function LinkPopover({ selectedText, onSubmit, onCancel, className = '' }: LinkPopoverProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const normalized = normalizeLinkUrl(url);
    if (!normalized) {
      setError('Enter an http, https, or mailto link.');
      return;
    }
    onSubmit(normalized);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className={`dm-overlay absolute bottom-full left-0 z-[70] mb-2 w-[320px] rounded-xl border border-[var(--strong-border)] bg-[var(--raised-surface)] p-3 shadow-2xl ${className}`}>
      <div className="mb-2 flex items-center gap-2 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
        <Link className="h-3.5 w-3.5 text-[var(--accent)]" />
        <span>{selectedText ? 'Link selected text' : 'Insert link'}</span>
      </div>
      <input
        ref={inputRef}
        type="url"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder="https://example.com"
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-2 text-[calc(12px*var(--font-scale))] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
      />
      {error && (
        <p className="mt-1.5 text-[calc(10px*var(--font-scale))] text-[var(--danger)]">{error}</p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-white hover:opacity-95"
        >
          Insert
        </button>
      </div>
    </div>
  );
}
