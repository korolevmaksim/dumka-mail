import { useMemo } from 'react';
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
  return (
    <section className="dm-inset mt-3 rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-2.5" aria-label="Related mail">
      <h3 className="text-[calc(9px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Related mail</h3>
      {sourceThread && <button type="button" onClick={() => onOpen(sourceThread)} className="mt-2 block w-full truncate text-left text-[calc(10px*var(--font-scale))] font-semibold text-[var(--accent)]">Source · {sourceThread.subject}</button>}
      {suggestions.length > 0 && <div className="mt-2 text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">Suggested from participants or subject — not linked</div>}
      {suggestions.map(thread => <button key={`${thread.accountId}:${thread.id}`} type="button" onClick={() => onOpen(thread)} className="mt-1 block w-full truncate rounded px-1 py-1 text-left text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] hover:bg-[var(--hover-row)]">{thread.subject}</button>)}
    </section>
  );
}
