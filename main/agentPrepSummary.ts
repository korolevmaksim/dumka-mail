import { createHash } from 'crypto';
import { buildSummaryPrompt, latestMessageOf, parseSummaryBullets, shouldSummarizeThread,
  type TextPrompt, type ThreadSummaryResult } from '../shared/agentPrompts';
import { summarySettings, summarySettingsFingerprint, type SummarySettingsSource } from '../shared/summarySettings';
import type { AIProviderPreference, MailMessage, MailThread } from '../shared/types';
import { ModelRequestError } from './modelErrors';

export interface SummaryGate {
  settings: { ai?: SummarySettingsSource | null };
  preference: AIProviderPreference;
  overrideModel: string | undefined;
  resolvedModel: string;
  resolvedProvider: AIProviderPreference;
  dedicated: boolean;
}

interface SummaryHost {
  gate(): Promise<SummaryGate | null>;
  readSettings(): { ai?: SummarySettingsSource | null };
  mayReadMail(): boolean;
  accountExists(): boolean;
  messages(): Promise<MailMessage[]>;
  thread(): MailThread | null;
  cached(lastMessageId: string, cacheKey: string): { bullets: string[] } | null;
  complete(prompt: TextPrompt, options: { preference: AIProviderPreference; overrideModel?: string; stream: boolean;
    signal: AbortSignal; onDelta: (delta: string) => void }): Promise<{ text: string; model: string; provider: string }>;
  save(record: { accountId: string; threadId: string; lastMessageId: string; cacheKey: string;
    bullets: string[]; model: string; createdAt: string }): void;
  shared(key: string, gate: SummaryGate, start: (signal: AbortSignal, onDelta: (delta: string) => void) => Promise<ThreadSummaryResult>): Promise<ThreadSummaryResult>;
  success(gate: SummaryGate): void;
  now(): Date;
}

export async function prepareThreadSummary(accountId: string, threadId: string, host: SummaryHost): Promise<ThreadSummaryResult> {
  const gate = await host.gate();
  if (!gate) return { status: 'skipped' };
  const config = summarySettings(gate.settings.ai);
  const fingerprint = summarySettingsFingerprint(gate.settings.ai);
  const stillAllowed = () => host.mayReadMail() && fingerprint === summarySettingsFingerprint(host.readSettings().ai);
  const messages = await host.messages();
  if (!stillAllowed()) return { status: 'cancelled' };
  const latest = latestMessageOf(messages);
  if (!latest || !shouldSummarizeThread(messages.length)) return { status: 'skipped' };
  const cacheKey = createHash('sha256').update(JSON.stringify([fingerprint, gate.resolvedProvider, gate.resolvedModel])).digest('hex');
  const cached = host.cached(latest.id, cacheKey);
  if (cached) return { status: 'ready', bullets: cached.bullets, lastMessageId: latest.id };
  const thread = host.thread();
  if (!thread) return { status: 'skipped' };
  const key = `${accountId.toLowerCase()}\u0000${threadId}\u0000${latest.id}\u0000${cacheKey}`;
  return host.shared(key, gate, async (signal, onDelta) => {
    if (signal.aborted || !stillAllowed()) return { status: 'cancelled' };
    const result = await host.complete(buildSummaryPrompt({ thread, messages, settings: config }), {
      preference: gate.preference, overrideModel: gate.overrideModel, stream: true, signal, onDelta,
    });
    const bullets = parseSummaryBullets(result.text);
    if (!bullets.length) throw new ModelRequestError('invalid', result.provider, 'Summary answer had no bullet points.');
    if (signal.aborted || !stillAllowed()) return { status: 'cancelled' };
    if (host.accountExists()) host.save({ accountId, threadId, lastMessageId: latest.id, cacheKey,
      bullets, model: result.model, createdAt: host.now().toISOString() });
    host.success(gate);
    return { status: 'ready', bullets, lastMessageId: latest.id };
  });
}
