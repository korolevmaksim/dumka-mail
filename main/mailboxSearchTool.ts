import { AccountsRepo, SearchRepo, ThreadsRepo } from './database';
import { AgenticService } from './agentic';
import { buildFtsMatchQuery, parseSearchQuery, searchTextQuery } from '../shared/search';
import {
  MAILBOX_SEARCH_PRIVACY_NOTE,
  mergeMailboxSearchSources,
  normalizeMailboxSearchLimit,
  type MailboxSearchSourceCandidate,
} from '../shared/mailboxSearchTool';
import type { MailboxSearchToolResult, SemanticSearchResult } from '../shared/types';
import type { RankedSourceList } from '../shared/searchRanking';

interface MailboxSearchToolArgs {
  query?: string;
  accountId?: string | null;
  limit?: number;
}

function normalizeAccountScope(accountId: string | null | undefined): string[] {
  const accounts = AccountsRepo.list().map(account => account.email);
  const requested = (accountId || '').trim().toLowerCase();
  if (!requested || requested === 'all' || requested === 'unified') return accounts;
  return accounts.filter(account => account.trim().toLowerCase() === requested);
}

function semanticCandidate(accountId: string, result: SemanticSearchResult): MailboxSearchSourceCandidate {
  const thread = ThreadsRepo.get(accountId, result.threadId);
  return {
    accountId,
    threadId: result.threadId,
    messageId: result.messageId,
    subject: result.subject || thread?.subject || '(No subject)',
    sender: result.sender || thread?.senderNames?.[0] || thread?.senderEmail || 'Unknown sender',
    senderEmail: thread?.senderEmail || null,
    receivedAt: result.receivedAt || null,
    lastMessageAt: thread?.lastMessageAt || result.receivedAt || null,
    snippet: result.snippet || thread?.snippet || '',
    sourceKind: 'semantic',
    whyMatched: 'Matched by semantic search over the local cached mailbox index.',
    score: result.score,
  };
}

export async function executeMailboxSearchTool(args: MailboxSearchToolArgs): Promise<MailboxSearchToolResult> {
  const query = (args.query || '').replace(/\s+/g, ' ').trim();
  const limit = normalizeMailboxSearchLimit(args.limit);
  const accountIds = normalizeAccountScope(args.accountId);
  const warnings: string[] = [];

  if (!query) {
    return {
      query,
      accountId: args.accountId || null,
      privacyNote: MAILBOX_SEARCH_PRIVACY_NOTE,
      sources: [],
      warnings: ['Search query was empty.'],
    };
  }

  if (accountIds.length === 0) {
    return {
      query,
      accountId: args.accountId || null,
      privacyNote: MAILBOX_SEARCH_PRIVACY_NOTE,
      sources: [],
      warnings: ['No matching local account was found for the requested account scope.'],
    };
  }

  const parsed = parseSearchQuery(query);
  const textQuery = searchTextQuery(parsed) || query;
  const ftsQuery = buildFtsMatchQuery(parsed.textTerms.length > 0 ? parsed.textTerms : [textQuery]);
  const candidates: MailboxSearchSourceCandidate[] = [];
  const rankedLists: RankedSourceList[] = [];
  const perAccountLimit = Math.max(limit * 3, 20);

  for (const accountId of accountIds) {
    if (ftsQuery) {
      try {
        const ftsResults = SearchRepo.searchDetailed(accountId, ftsQuery, perAccountLimit) as MailboxSearchSourceCandidate[];
        if (ftsResults.length > 0) {
          candidates.push(...ftsResults);
          rankedLists.push({
            accountId,
            source: 'fts',
            entries: ftsResults.map(result => ({
              threadId: result.threadId,
              messageId: result.messageId || '',
            })),
          });
        }
      } catch (error) {
        warnings.push(`Full-text search failed for ${accountId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    try {
      const semantic = await AgenticService.searchSemantic(accountId, textQuery, perAccountLimit);
      if (semantic.status === 'ok' && semantic.results.length > 0) {
        candidates.push(...semantic.results.map(result => semanticCandidate(accountId, result)));
        rankedLists.push({
          accountId,
          source: 'semantic',
          entries: semantic.results.map(result => ({
            threadId: result.threadId,
            messageId: result.messageId,
            score: result.score,
          })),
        });
      } else if (semantic.status === 'error') {
        warnings.push(`Semantic search failed for ${accountId}: ${semantic.errorMessage || 'Unknown error'}`);
      }
    } catch (error) {
      warnings.push(`Semantic search failed for ${accountId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    query,
    accountId: args.accountId || null,
    privacyNote: MAILBOX_SEARCH_PRIVACY_NOTE,
    sources: mergeMailboxSearchSources(candidates, rankedLists, limit),
    warnings,
  };
}
