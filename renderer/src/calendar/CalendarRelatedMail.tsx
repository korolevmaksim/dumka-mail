import { useMemo } from 'react';
import { Mail } from 'lucide-react';
import type { CalendarEvent, MailThread } from '../../../shared/types';

interface CalendarRelatedMailProps {
  event: CalendarEvent;
  threads: MailThread[];
  onOpen: (thread: MailThread) => void;
}

const STOP_WORDS = new Set(['about', 'and', 'for', 'from', 'meeting', 're', 'sync', 'the', 'with']);

function subjectTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/)
    .filter(token => token.length >= 4 && !STOP_WORDS.has(token)));
}

function participantEmails(thread: MailThread): string[] {
  return [thread.senderEmail, ...(thread.to || []).map(recipient => recipient.email), ...(thread.cc || []).map(recipient => recipient.email)]
    .map(email => email.toLowerCase());
}

export function CalendarRelatedMail({ event, threads, onOpen }: CalendarRelatedMailProps) {
  const sourceThread = threads.find(thread => thread.accountId === event.accountId && thread.id === event.sourceThreadId) || null;
  const suggestions = useMemo(() => {
    const attendeeEmails = new Set(event.attendees.map(attendee => attendee.email.toLowerCase()));
    const eventTokens = subjectTokens(event.summary);
    return threads
      .filter(thread => thread.accountId === event.accountId && thread.id !== sourceThread?.id)
      .map(thread => {
        const participantMatch = participantEmails(thread).some(email => attendeeEmails.has(email));
        const threadTokens = subjectTokens(thread.subject);
        const subjectMatch = [...eventTokens].some(token => threadTokens.has(token));
        const daysApart = Math.abs(Date.parse(thread.lastMessageAt) - Date.parse(event.startAt)) / 86_400_000;
        return { thread, score: (participantMatch ? 2 : 0) + (subjectMatch ? 2 : 0) + (daysApart <= 30 ? 1 : 0) };
      })
      .filter(candidate => candidate.score >= 3)
      .sort((left, right) => right.score - left.score || Date.parse(right.thread.lastMessageAt) - Date.parse(left.thread.lastMessageAt))
      .slice(0, 3)
      .map(candidate => candidate.thread);
  }, [event, sourceThread?.id, threads]);

  if (!sourceThread && suggestions.length === 0) return null;
  const linkClass = 'block w-full min-w-0 truncate rounded px-1.5 py-1 text-left text-[calc(12px*var(--font-scale))] hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';
  return (
    <section aria-labelledby={`calendar-related-${event.id}`}>
      <h3 id={`calendar-related-${event.id}`} className="mb-1 flex items-center gap-1.5 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
        <Mail className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
        Related mail
      </h3>
      {sourceThread && (
        <button type="button" onClick={() => onOpen(sourceThread)} title={sourceThread.subject} className={`${linkClass} font-medium text-[var(--accent-ink)]`}>
          {sourceThread.subject || '(no subject)'}
        </button>
      )}
      {suggestions.length > 0 && (
        <>
          <p className="mt-1 px-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Maybe related (same people or subject)</p>
          {suggestions.map(thread => (
            <button key={`${thread.accountId}:${thread.id}`} type="button" onClick={() => onOpen(thread)} title={thread.subject} className={`${linkClass} text-[var(--text-primary)]`}>
              {thread.subject || '(no subject)'}
            </button>
          ))}
        </>
      )}
    </section>
  );
}
