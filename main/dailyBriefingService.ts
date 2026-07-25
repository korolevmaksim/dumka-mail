import { databaseWorkerClient } from './databaseWorkerClient';
import { buildDailyBriefing, normalizeDailyBriefingSettings } from '../shared/dailyBriefing';
import type {
  DailyBriefing,
  DailyBriefingBuildOptions,
  DailyBriefingSettings,
  MailMessage,
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

  // Thread selection, per-thread message reads and the security pass all happen
  // on the database worker. Building this inline used to read >100 MB of bodies
  // and header JSON on the Electron main event loop, which froze the UI for
  // seconds every time the briefing auto-refreshed after a sync.
  const { threads, latestMessageByThreadId, securityByThreadId } = await databaseWorkerClient.briefingThreadContext(
    accountId,
    {
      sinceMs,
      includeRead: settings.includeRead,
      semanticScoresByThreadId,
      maxThreads: Math.max(80, Math.min(240, settings.maxItems * 16)),
    },
  );

  // buildDailyBriefing reduces each thread's messages down to the newest one, so
  // a single-element list yields the same item as the full message list did.
  const messagesByThreadId: Record<string, MailMessage[]> = {};
  for (const [threadId, message] of Object.entries(latestMessageByThreadId)) {
    messagesByThreadId[threadId] = [message];
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
