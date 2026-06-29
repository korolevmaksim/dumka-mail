import { X } from 'lucide-react';
import type { Recipient } from '../../../../shared/types';
import { isValidEmail } from '../../../../shared/compose';

interface RecipientFieldProps {
  label: string;
  recipients: Recipient[];
  placeholder?: string;
  autoFocus?: boolean;
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
  placeholder,
  autoFocus,
  onChange,
}: RecipientFieldProps) {
  const commitInput = (input: HTMLInputElement) => {
    const additions = parseRecipientInput(input.value);
    if (additions.length === 0) return;
    onChange(mergeRecipients(recipients, additions));
    input.value = '';
  };

  return (
    <div className="flex items-start gap-3 border-b border-[var(--border)] px-4 py-2.5 text-[calc(12px*var(--font-scale))]">
      <span className="w-12 shrink-0 pt-1 text-[var(--text-secondary)] font-medium select-none">{label}</span>
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
              <span className="truncate">{recipient.email}</span>
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
        <input
          autoFocus={autoFocus}
          placeholder={recipients.length === 0 ? placeholder : ''}
          onBlur={(event) => commitInput(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',' || event.key === ';' || event.key === 'Tab') {
              const hasValue = event.currentTarget.value.trim().length > 0;
              if (hasValue) {
                event.preventDefault();
                commitInput(event.currentTarget);
              }
            } else if (event.key === 'Backspace' && event.currentTarget.value === '' && recipients.length > 0) {
              onChange(recipients.slice(0, -1));
            }
          }}
          className="min-w-[220px] flex-1 bg-transparent py-1 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
      </div>
    </div>
  );
}
