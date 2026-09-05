import type { DailyBriefing, MailMessage } from './types';
import { validDateOnly, type Commitment, type CommitmentEvidence } from './productivity';

export interface CommitmentSuggestion {
  accountId: string;
  title: string;
  direction: Commitment['direction'];
  owner: string;
  dueDate: string | null;
  evidence: CommitmentEvidence;
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function suggestedDueDate(text: string, receivedAt: string): string | null {
  const explicit = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (explicit) return validDateOnly(explicit[1]) ? explicit[1] : null;
  const date = new Date(receivedAt);
  if (!Number.isFinite(date.getTime())) return null;
  if (/\btomorrow\b/i.test(text)) { date.setDate(date.getDate() + 1); return localDate(date); }
  if (/\btoday\b/i.test(text)) return localDate(date);
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const day = weekdays.findIndex(day => new RegExp(`\\b${day}\\b`, 'i').test(text));
  if (day < 0) return null;
  const offset = (day - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + offset + (/\bnext\b/i.test(text) && offset === 0 ? 7 : 0));
  return localDate(date);
}

export function suggestCommitments(briefing: DailyBriefing | null, messages: MailMessage[], existing: Commitment[]): CommitmentSuggestion[] {
  const sources = [
    ...(briefing?.items || []).map(item => ({ accountId: item.accountId, evidence: {
      threadId: item.threadId, messageId: item.source.messageId, subject: item.source.subject,
      sender: item.source.senderEmail, quote: item.source.snippet, receivedAt: item.source.receivedAt,
    } })),
    ...messages.slice(-100).map(message => ({ accountId: message.accountId, evidence: {
      threadId: message.threadId, messageId: message.id, subject: message.subject,
      sender: message.senderEmail, quote: (message.bodyPlain || message.snippet).slice(0, 4000), receivedAt: message.receivedAt,
    } })),
  ];
  const seen = new Set(existing.flatMap(item => item.evidence.map(source => `${item.accountId}:${source.messageId}`)));
  const result: CommitmentSuggestion[] = [];
  for (const { accountId, evidence } of sources) {
    const key = `${accountId}:${evidence.messageId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Suggestions are deliberately conservative and never become obligations without confirmation.
    const unquoted = evidence.quote.split(/\n(?:On .+wrote:|From:|--\s*$)/m)[0].split('\n').filter(line => !line.trimStart().startsWith('>')).join('\n');
    const sentence = unquoted.split(/[.!?\n]+/).find(line =>
      /\b(I will|I'll|we will|we'll|I promise to)\s+(send|share|deliver|prepare|review|confirm|provide|finish|check|update)\b/i.test(line));
    if (!sentence) continue;
    const mine = evidence.sender.toLowerCase() === accountId.toLowerCase();
    result.push({ accountId, title: sentence.trim().slice(0, 500), direction: mine ? 'mine' : 'waiting',
      owner: evidence.sender, dueDate: suggestedDueDate(sentence, evidence.receivedAt),
      evidence: { ...evidence, quote: sentence.trim().slice(0, 4000) },
    });
  }
  return result.slice(0, 20);
}

export function linkCommitmentEvidence(item: Commitment, accountId: string, evidence: CommitmentEvidence): Commitment {
  if (item.accountId.toLowerCase() !== accountId.toLowerCase()) throw new Error('Source mail must belong to the same account.');
  if (item.evidence.some(source => source.messageId === evidence.messageId)) return item;
  return { ...item, evidence: [...item.evidence, evidence] };
}
