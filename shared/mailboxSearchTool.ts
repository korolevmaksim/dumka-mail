import type { MailboxSearchSource, MailboxSearchSourceKind } from './types';
import type { RankedSourceList } from './searchRanking';
import { fuseSearchMatches } from './searchRanking';

export const MAILBOX_SEARCH_TOOL_NAME = 'searchMailbox';
export const MAILBOX_SEARCH_PRIVACY_NOTE = 'Searched the local Dumka Mail cache. The AI provider only receives these bounded snippets/results, not the full mailbox by default.';
export const MAILBOX_SEARCH_DEFAULT_LIMIT = 8;
export const MAILBOX_SEARCH_MAX_LIMIT = 12;
export const MAILBOX_SEARCH_SNIPPET_MAX_CHARS = 320;

export interface MailboxSearchSourceCandidate extends MailboxSearchSource {
  sourceKind: Exclude<MailboxSearchSourceKind, 'hybrid'>;
}

export function normalizeMailboxSearchLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return MAILBOX_SEARCH_DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAILBOX_SEARCH_MAX_LIMIT, Math.floor(limit)));
}

export function boundedMailboxSnippet(value: string | null | undefined, maxChars = MAILBOX_SEARCH_SNIPPET_MAX_CHARS): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function sourceDateValue(source: MailboxSearchSource): number {
  const value = source.receivedAt || source.lastMessageAt || '';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sourceKindLabel(kind: MailboxSearchSourceKind): string {
  if (kind === 'hybrid') return 'full-text and semantic search';
  if (kind === 'semantic') return 'semantic search';
  return 'full-text search';
}

export function mergeMailboxSearchSources(
  candidates: MailboxSearchSourceCandidate[],
  rankedLists: RankedSourceList[],
  limit: number,
): MailboxSearchSource[] {
  const fusion = fuseSearchMatches(rankedLists);
  const ftsThreadIds = new Set<string>();
  const semanticThreadIds = new Set<string>();
  for (const list of rankedLists) {
    for (const entry of list.entries) {
      (list.source === 'fts' ? ftsThreadIds : semanticThreadIds).add(`${list.accountId}:${entry.threadId}`);
    }
  }

  const byThread = new Map<string, MailboxSearchSource>();
  for (const candidate of candidates) {
    const key = `${candidate.accountId}:${candidate.threadId}`;
    const hasFts = ftsThreadIds.has(key);
    const hasSemantic = semanticThreadIds.has(key);
    const sourceKind: MailboxSearchSourceKind = hasFts && hasSemantic ? 'hybrid' : candidate.sourceKind;
    const score = fusion.scoreByThreadId.get(candidate.threadId) ?? candidate.score;
    const next: MailboxSearchSource = {
      ...candidate,
      snippet: boundedMailboxSnippet(candidate.snippet),
      sourceKind,
      score,
      whyMatched: candidate.whyMatched || `Matched by ${sourceKindLabel(sourceKind)} in the local cache.`,
    };
    const current = byThread.get(key);
    if (!current) {
      byThread.set(key, next);
      continue;
    }
    const currentScore = current.score ?? 0;
    const nextScore = next.score ?? 0;
    if (
      next.sourceKind === 'hybrid' && current.sourceKind !== 'hybrid' ||
      nextScore > currentScore ||
      (nextScore === currentScore && sourceDateValue(next) > sourceDateValue(current))
    ) {
      byThread.set(key, next);
    }
  }

  return [...byThread.values()]
    .sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return sourceDateValue(b) - sourceDateValue(a);
    })
    .slice(0, normalizeMailboxSearchLimit(limit));
}
