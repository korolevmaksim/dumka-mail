import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { EmailAddressSuggestion, Recipient } from '../../../../shared/types';
import { filterEmailSuggestions, isValidEmail } from '../../../../shared/compose';

interface RecipientFieldProps {
  label: string;
  recipients: Recipient[];
  variant?: 'compose' | 'form';
  placeholder?: string;
  autoFocus?: boolean;
  suggestions?: EmailAddressSuggestion[];
  excludedEmails?: string[];
  onChange: (recipients: Recipient[]) => void;
}

function recipientKey(email: string): string {
  return email.trim().toLowerCase();
}

function parseRecipientInput(input: string): Recipient[] {
  return input
    .split(/[,\s;]+/)
    .map(value => value.trim())
    .filter(Boolean)
    .map(email => ({ name: '', email }));
}

function mergeRecipients(existing: Recipient[], additions: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  const merged: Recipient[] = [];
  for (const recipient of [...existing, ...additions]) {
    const email = recipient.email.trim();
    if (!email) continue;
    const key = recipientKey(email);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ name: recipient.name.trim(), email });
  }
  return merged;
}

export function RecipientField({
  label,
  recipients,
  variant = 'compose',
  placeholder,
  autoFocus,
  suggestions = [],
  excludedEmails = [],
  onChange,
}: RecipientFieldProps) {
  const [inputValue, setInputValue] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const filteredSuggestions = useMemo(
    () => filterEmailSuggestions(suggestions, inputValue, {
      existingRecipients: recipients,
      excludedEmails,
      limit: 8,
    }),
    [excludedEmails, inputValue, recipients, suggestions],
  );
  const visibleSuggestions = suggestionsOpen ? filteredSuggestions : [];
  const isFormField = variant === 'form';

  useEffect(() => {
    setHighlightedIndex(0);
  }, [inputValue, suggestions]);

  useEffect(() => {
    if (highlightedIndex >= visibleSuggestions.length) {
      setHighlightedIndex(Math.max(0, visibleSuggestions.length - 1));
    }
  }, [highlightedIndex, visibleSuggestions.length]);

  const commitInput = () => {
    const additions = parseRecipientInput(inputValue);
    if (additions.length === 0) return;
    onChange(mergeRecipients(recipients, additions));
    setInputValue('');
    setSuggestionsOpen(false);
  };

  const commitSuggestion = (suggestion: EmailAddressSuggestion) => {
    const additions = suggestion.kind === 'group' && suggestion.members?.length
      ? suggestion.members
      : [{ name: suggestion.name, email: suggestion.email }];
    onChange(mergeRecipients(recipients, additions));
    setInputValue('');
    setSuggestionsOpen(false);
  };

  return (
    <div className={isFormField
      ? 'rounded-md border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(12px*var(--font-scale))] focus-within:border-[var(--accent)]'
      : 'flex items-start gap-3 border-b border-[var(--border)] px-4 py-2.5 text-[calc(12px*var(--font-scale))]'}>
      <span className={isFormField
        ? 'mb-1 block text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-tertiary)]'
        : 'w-12 shrink-0 pt-1 text-[var(--text-secondary)] font-medium select-none'}>{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-1.5 min-h-[28px]">
        {recipients.map((recipient) => {
          const valid = isValidEmail(recipient.email.trim());
          return (
            <span
              key={recipient.email}
              title={valid ? recipient.email : `Invalid address: ${recipient.email}`}
              className={`inline-flex max-w-[220px] items-center gap-1 rounded-md border px-2 py-1 text-[calc(11px*var(--font-scale))] ${
                valid
                  ? 'border-[var(--border)] bg-[var(--raised-surface)] text-[var(--text-primary)]'
                  : 'border-[var(--danger)]/50 bg-[var(--danger)]/10 text-[var(--danger)]'
              }`}
            >
              <span className="truncate">{isFormField && recipient.name ? recipient.name : recipient.email}</span>
              <button
                type="button"
                onClick={() => onChange(recipients.filter(item => item.email !== recipient.email))}
                className="rounded p-0.5 text-current opacity-60 hover:bg-[var(--hover-row)] hover:opacity-100"
                title={`Remove ${recipient.email}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <div className="relative min-w-[220px] flex-1">
          <input
            autoFocus={autoFocus}
            value={inputValue}
            placeholder={recipients.length === 0 ? placeholder : ''}
            onFocus={() => setSuggestionsOpen(true)}
            onBlur={() => {
              commitInput();
              setSuggestionsOpen(false);
            }}
            onChange={(event) => {
              setInputValue(event.currentTarget.value);
              setSuggestionsOpen(true);
            }}
            onKeyDown={(event) => {
              if (visibleSuggestions.length > 0 && event.key === 'ArrowDown') {
                event.preventDefault();
                setHighlightedIndex(index => Math.min(index + 1, visibleSuggestions.length - 1));
                return;
              }
              if (visibleSuggestions.length > 0 && event.key === 'ArrowUp') {
                event.preventDefault();
                setHighlightedIndex(index => Math.max(index - 1, 0));
                return;
              }
              if (event.key === 'Escape' && visibleSuggestions.length > 0) {
                event.preventDefault();
                setSuggestionsOpen(false);
                return;
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                const highlighted = visibleSuggestions[highlightedIndex];
                if (highlighted) {
                  event.preventDefault();
                  commitSuggestion(highlighted);
                  return;
                }
              }
              if (event.key === 'Enter' || event.key === ',' || event.key === ';' || event.key === 'Tab') {
                const hasValue = inputValue.trim().length > 0;
                if (hasValue) {
                  event.preventDefault();
                  commitInput();
                }
              } else if (event.key === 'Backspace' && inputValue === '' && recipients.length > 0) {
                onChange(recipients.slice(0, -1));
              }
            }}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={visibleSuggestions.length > 0}
            className="w-full bg-transparent py-1 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
          {visibleSuggestions.length > 0 && (
            <div
              role="listbox"
              className={`dm-overlay left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-auto rounded-md border border-[var(--strong-border)] bg-[var(--panel-bg)] py-1 shadow-xl ${isFormField ? '' : 'absolute'}`}
            >
              {visibleSuggestions.map((suggestion, index) => {
                const isHighlighted = index === highlightedIndex;
                const primaryLabel = suggestion.name || suggestion.email;
                const isGroup = suggestion.kind === 'group';
                const subtitle = isGroup
                  ? suggestion.subtitle || `${suggestion.members?.length || suggestion.sourceCount} contacts`
                  : suggestion.name
                    ? suggestion.email
                    : suggestion.subtitle;
                return (
                  <button
                    key={isGroup ? `group:${suggestion.groupId || suggestion.name}` : suggestion.email}
                    type="button"
                    role="option"
                    aria-selected={isHighlighted}
                    title={isGroup ? `Add ${primaryLabel}` : suggestion.name ? `${suggestion.name} <${suggestion.email}>` : suggestion.email}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      commitSuggestion(suggestion);
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[calc(12px*var(--font-scale))] ${
                      isHighlighted ? 'bg-[var(--hover-row)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[var(--text-primary)]">{primaryLabel}</span>
                      {subtitle && (
                        <span className="block truncate text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">{subtitle}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">
                      {isGroup ? 'Group' : suggestion.kind === 'contact' ? 'Contact' : isFormField ? 'Mail' : suggestion.sourceCount}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
