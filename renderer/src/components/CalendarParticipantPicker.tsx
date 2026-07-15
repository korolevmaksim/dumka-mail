import { useEffect, useState } from 'react';
import type { EmailAddressSuggestion, Recipient } from '../../../shared/types';
import { RecipientField } from './compose/RecipientField';

interface CalendarParticipantPickerProps {
  accountId: string;
  recipients: Recipient[];
  onChange: (recipients: Recipient[]) => void;
}

export function CalendarParticipantPicker({ accountId, recipients, onChange }: CalendarParticipantPickerProps) {
  const [suggestions, setSuggestions] = useState<EmailAddressSuggestion[]>([]);

  useEffect(() => {
    if (!accountId) {
      setSuggestions([]);
      return;
    }
    let active = true;
    void window.electronAPI.listEmailSuggestions(accountId, 250)
      .then(items => { if (active) setSuggestions(items); })
      .catch(error => {
        console.error('Calendar participant suggestions failed:', error);
        if (active) setSuggestions([]);
      });
    return () => { active = false; };
  }, [accountId]);

  return (
    <div>
      <RecipientField
        variant="form"
        label="Participants"
        recipients={recipients}
        suggestions={suggestions}
        excludedEmails={accountId ? [accountId] : []}
        placeholder="Search contacts or enter an email"
        onChange={onChange}
      />
      <p className="mt-1 px-0.5 text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">
        Search contacts, groups, and people from your mail history.
      </p>
    </div>
  );
}
