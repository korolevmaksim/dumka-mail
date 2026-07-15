import { useEffect, useId, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { EmailAddressSuggestion, Recipient } from '../../../../../shared/types';
import { filterEmailSuggestions } from '../../../../../shared/compose';
import { normalizeRuleValues, parseRuleValueInput } from '../../../../../shared/classificationRules';

interface RuleValuesComboboxProps {
  values: string[];
  inputValue: string;
  suggestions: EmailAddressSuggestion[];
  suggestionsLoading: boolean;
  onChange: (values: string[]) => void;
  onInputChange: (value: string) => void;
}

function suggestionRecipients(values: string[]): Recipient[] {
  return values.map(email => ({ name: '', email }));
}

export function RuleValuesCombobox({
  values,
  inputValue,
  suggestions,
  suggestionsLoading,
  onChange,
  onInputChange,
}: RuleValuesComboboxProps) {
  const generatedId = useId().replace(/:/g, '');
  const inputId = `classification-values-${generatedId}`;
  const helpId = `${inputId}-help`;
  const listboxId = `${inputId}-listbox`;
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const addressSuggestions = useMemo(
    () => suggestions.filter(suggestion => suggestion.kind !== 'group'),
    [suggestions],
  );
  const filteredSuggestions = useMemo(
    () => filterEmailSuggestions(addressSuggestions, inputValue, {
      existingRecipients: suggestionRecipients(values),
      limit: 8,
    }),
    [addressSuggestions, inputValue, values],
  );
  const visibleSuggestions = suggestionsOpen ? filteredSuggestions : [];
  const activeOptionId = visibleSuggestions[highlightedIndex]
    ? `${listboxId}-option-${highlightedIndex}`
    : undefined;

  useEffect(() => {
    setHighlightedIndex(0);
  }, [inputValue, suggestions]);

  useEffect(() => {
    if (highlightedIndex >= visibleSuggestions.length) {
      setHighlightedIndex(Math.max(0, visibleSuggestions.length - 1));
    }
  }, [highlightedIndex, visibleSuggestions.length]);

  const addValues = (additions: string[]) => {
    onChange(normalizeRuleValues('from', '', [...values, ...additions]));
  };

  const commitInput = () => {
    const additions = parseRuleValueInput(inputValue);
    if (additions.length === 0) return;
    addValues(additions);
    onInputChange('');
    setSuggestionsOpen(false);
  };

  const commitSuggestion = (suggestion: EmailAddressSuggestion) => {
    addValues([suggestion.email]);
    onInputChange('');
    setSuggestionsOpen(false);
  };

  return (
    <div>
      <label htmlFor={inputId} className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
        Match Values:
      </label>
      <div className="mt-1 flex min-h-[34px] flex-wrap items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1 focus-within:border-[var(--accent)]">
        {values.map(value => (
          <span
            key={value.toLowerCase()}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--raised-surface)] px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)]"
          >
            <span className="truncate">{value}</span>
            <button
              type="button"
              onClick={() => onChange(values.filter(item => item !== value))}
              aria-label={`Remove ${value}`}
              className="rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={inputValue}
          placeholder={values.length === 0 ? 'Search people or type a value' : 'Add another value'}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visibleSuggestions.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-describedby={helpId}
          onFocus={() => setSuggestionsOpen(true)}
          onBlur={() => {
            commitInput();
            setSuggestionsOpen(false);
          }}
          onChange={event => {
            onInputChange(event.currentTarget.value);
            setSuggestionsOpen(true);
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' && filteredSuggestions.length > 0) {
              event.preventDefault();
              setSuggestionsOpen(true);
              setHighlightedIndex(index => suggestionsOpen
                ? Math.min(index + 1, filteredSuggestions.length - 1)
                : 0);
              return;
            }
            if (event.key === 'ArrowUp' && filteredSuggestions.length > 0) {
              event.preventDefault();
              setSuggestionsOpen(true);
              setHighlightedIndex(index => suggestionsOpen
                ? Math.max(index - 1, 0)
                : filteredSuggestions.length - 1);
              return;
            }
            if (event.key === 'Escape' && suggestionsOpen) {
              event.preventDefault();
              setSuggestionsOpen(false);
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const highlighted = visibleSuggestions[highlightedIndex];
              if (highlighted) commitSuggestion(highlighted);
              else commitInput();
              return;
            }
            if ((event.key === ',' || event.key === ';') && inputValue.trim()) {
              event.preventDefault();
              commitInput();
              return;
            }
            if (event.key === 'Backspace' && !inputValue && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          className="min-w-[190px] flex-1 bg-transparent py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
      </div>

      <div
        id={listboxId}
        role="listbox"
        aria-label="Email suggestions"
        hidden={visibleSuggestions.length === 0}
        className="dm-overlay mt-1 max-h-52 overflow-auto rounded-md border border-[var(--strong-border)] bg-[var(--panel-bg)] py-1 shadow-lg"
      >
        {visibleSuggestions.map((suggestion, index) => {
            const highlighted = index === highlightedIndex;
            return (
              <button
                id={`${listboxId}-option-${index}`}
                key={suggestion.email.toLowerCase()}
                type="button"
                role="option"
                aria-selected={highlighted}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={event => {
                  event.preventDefault();
                  commitSuggestion(suggestion);
                }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${
                  highlighted ? 'bg-[var(--hover-row)]' : ''
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">
                    {suggestion.name || suggestion.email}
                  </span>
                  {suggestion.name && (
                    <span className="block truncate text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">
                      {suggestion.email}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[calc(8px*var(--font-scale))] text-[var(--text-tertiary)]">
                  {suggestion.kind === 'contact' ? 'Contact' : 'Mail'}
                </span>
              </button>
            );
          })}
      </div>

      <p id={helpId} className="mt-1 text-[calc(8.5px*var(--font-scale))] text-[var(--text-tertiary)]">
        {suggestionsLoading
          ? 'Loading local contacts and mail history…'
          : 'Choose suggestions or type names, fragments, or addresses. Any value can match.'}
      </p>
    </div>
  );
}
