import { MessagesRepo, MessageSecurityRepo, ThreadsRepo } from './database';
import { buildDailyBriefing, normalizeDailyBriefingSettings } from '../shared/dailyBriefing';
import { analyzeMessageSecurity } from '../shared/mailSecurity';
import type {
  DailyBriefing,
  DailyBriefingBuildOptions,
  DailyBriefingSettings,
  MailMessage,
  MailThread,
  SemanticSearchResult,
} from '../shared/types';

export interface DailyBriefingRuntimeSettings {
  semanticSearchEnabled: boolean;
  dailyBriefing: DailyBriefingSettings;
}

export type DailyBriefingSemanticSearch = (
  accountId: string,
  query: string,
  limit?: number
) => Promise<SemanticSearchResult[]>;

export interface BuildDailyBriefingForAccountInput {
  accountId: string;
  options?: DailyBriefingBuildOptions;
  runtimeSettings: DailyBriefingRuntimeSettings;
  searchSemantic: DailyBriefingSemanticSearch;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function analyzeThreadMessages(accountId: string, messages: MailMessage[]): void {
  const insights = messages.map(message => {
    const previous = MessagesRepo.listRecentBySender(accountId, message.senderEmail, message.receivedAt, 8);
    return analyzeMessageSecurity(message, previous);
  });
  MessageSecurityRepo.saveMany(insights);
}

async function semanticScoresForDailyBriefing(
  accountId: string,
  enabled: boolean,
  searchSemantic: DailyBriefingSemanticSearch,
  warnings: string[]
): Promise<Record<string, number>> {
  if (!enabled) return {};
  const queries = [
    'email that needs my reply decision approval review or action',
    'email where someone is waiting for me following up or asking a question',
    'security risk phishing suspicious link tracking pixel noisy newsletter automation',
  ];
  const scores: Record<string, number> = {};

  for (const query of queries) {
    try {
      const results = await searchSemantic(accountId, query, 40);
      for (const result of results) {
        scores[result.threadId] = Math.max(scores[result.threadId] || 0, result.score);
      }
    } catch (err) {
      warnings.push(`Semantic briefing search skipped: ${toErrorMessage(err)}`);
      break;
    }
  }

  return scores;
}

function hasThreadLabel(thread: MailThread, label: string): boolean {
  const target = label.toUpperCase();
  return thread.labelIds.some(item => String(item).toUpperCase() === target);
}

function isBriefingCandidateThread(thread: MailThread, sinceMs: number, includeRead: boolean, semanticScore: number): boolean {
  if (!hasThreadLabel(thread, 'INBOX')) return false;
  if (hasThreadLabel(thread, 'SPAM') || hasThreadLabel(thread, 'TRASH')) return false;
  const lastMs = Date.parse(thread.lastMessageAt);
  const isRecent = Number.isFinite(lastMs) && lastMs >= sinceMs;
  if (isRecent || thread.isUnread || semanticScore >= 0.32) return true;
  return includeRead;
}

export async function buildDailyBriefingForAccount({
  accountId,
  options = {},
  runtimeSettings,
  searchSemantic,
}: BuildDailyBriefingForAccountInput): Promise<DailyBriefing> {
  const settings = normalizeDailyBriefingSettings({ ...runtimeSettings.dailyBriefing, ...options });
  const now = options.nowIso ? new Date(options.nowIso) : new Date();
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const warnings: string[] = [];
  const semanticEnabled = runtimeSettings.semanticSearchEnabled && settings.useSemanticSearch;
  if (settings.useSemanticSearch && !runtimeSettings.semanticSearchEnabled) {
    warnings.push('Semantic search is disabled; briefing used local cache signals only.');
  }

  const semanticScoresByThreadId = await semanticScoresForDailyBriefing(accountId, semanticEnabled, searchSemantic, warnings);
  const sinceMs = safeNow.getTime() - settings.lookbackHours * 3600000;
  const threads = ThreadsRepo.list(accountId)
    .filter(thread => isBriefingCandidateThread(thread, sinceMs, settings.includeRead, semanticScoresByThreadId[thread.id] || 0))
    .slice(0, Math.max(80, Math.min(240, settings.maxItems * 16)));

  const messagesByThreadId: Record<string, MailMessage[]> = {};
  const securityByThreadId: Record<string, ReturnType<typeof MessageSecurityRepo.listForThread>> = {};

  for (const thread of threads) {
    const messages = MessagesRepo.listForThread(accountId, thread.id);
    messagesByThreadId[thread.id] = messages;
    if (messages.length > 0) {
      analyzeThreadMessages(accountId, messages);
    }
    securityByThreadId[thread.id] = MessageSecurityRepo.listForThread(accountId, thread.id);
  }

  return buildDailyBriefing({
    accountId,
    threads,
    messagesByThreadId,
    securityByThreadId,
    semanticScoresByThreadId,
    settings,
    semanticSearchEnabled: semanticEnabled,
    bodyContextIncluded: false,
    now: safeNow,
    warnings,
  });
}
