import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Account,
  DailyBriefing,
  FollowUpRadarResult,
  ReplyPipelineCandidate,
  ReplyPipelineDraftResult,
  ReplyPipelineState,
} from '../../../shared/types';

interface UseReplyPipelineStateProps {
  accounts: Account[];
  activeAccount: Account | null;
  dailyBriefing: DailyBriefing | null;
  followUpRadar: FollowUpRadarResult | null;
}

function chooseNewestCandidates(candidates: ReplyPipelineCandidate[]): ReplyPipelineCandidate[] {
  const byThread = new Map<string, ReplyPipelineCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.accountId}:${candidate.threadId}`;
    const current = byThread.get(key);
    if (!current || Date.parse(candidate.sourceReceivedAt) > Date.parse(current.sourceReceivedAt)) {
      byThread.set(key, candidate);
    }
  }
  return [...byThread.values()];
}

function buildCandidates(
  dailyBriefing: DailyBriefing | null,
  followUpRadar: FollowUpRadarResult | null,
): ReplyPipelineCandidate[] {
  const inbound: ReplyPipelineCandidate[] = (dailyBriefing?.items || [])
    .filter(item => item.category === 'needsReply' || item.category === 'waitingOnMe')
    .map(item => ({
      accountId: item.accountId,
      threadId: item.threadId,
      sourceMessageId: item.source.messageId,
      sourceReceivedAt: item.source.receivedAt,
      sourceKind: 'inbound',
      status: 'needsReply',
      reason: item.reason,
      priority: item.priority,
    }));
  const outbound: ReplyPipelineCandidate[] = (followUpRadar?.items || []).map(item => ({
    accountId: item.accountId,
    threadId: item.threadId,
    sourceMessageId: item.sentMessageId,
    sourceReceivedAt: item.lastSentAt,
    sourceKind: 'outbound',
    status: 'due',
    reason: item.reason,
    priority: item.priority,
  }));
  return chooseNewestCandidates([...inbound, ...outbound]);
}

export function useReplyPipelineState({
  accounts,
  activeAccount,
  dailyBriefing,
  followUpRadar,
}: UseReplyPipelineStateProps) {
  const [replyPipelineSnapshot, setReplyPipelineSnapshot] = useState<{ scopeKey: string; items: ReplyPipelineState[] }>({ scopeKey: '', items: [] });
  const [replyPipelineLoading, setReplyPipelineLoading] = useState(false);
  const [replyPipelineError, setReplyPipelineError] = useState<string | null>(null);

  const accountIds = useMemo(() => {
    if (!activeAccount) return [];
    return activeAccount.id === 'unified'
      ? accounts.map(account => account.email).filter(Boolean)
      : [activeAccount.email];
  }, [accounts, activeAccount]);
  const candidates = useMemo(() => {
    const allowedAccounts = new Set(accountIds.map(id => id.toLowerCase()));
    return buildCandidates(dailyBriefing, followUpRadar)
      .filter(candidate => allowedAccounts.has(candidate.accountId.toLowerCase()));
  }, [accountIds, dailyBriefing, followUpRadar]);
  const accountKey = accountIds.join('\u0000');
  const candidateKey = JSON.stringify(candidates);
  const scopeKeyRef = useRef(accountKey);
  const requestGenerationRef = useRef(0);
  scopeKeyRef.current = accountKey;
  const replyPipelineItems = replyPipelineSnapshot.scopeKey === accountKey
    ? replyPipelineSnapshot.items
    : [];

  const loadReplyPipeline = useCallback(async () => {
    if (accountIds.length === 0) {
      setReplyPipelineSnapshot({ scopeKey: accountKey, items: [] });
      setReplyPipelineError(null);
      return;
    }
    const requestGeneration = ++requestGenerationRef.current;
    const requestedScope = accountKey;
    setReplyPipelineLoading(true);
    setReplyPipelineError(null);
    try {
      const items = await window.electronAPI.listReplyPipeline(accountIds);
      if (scopeKeyRef.current === requestedScope && requestGenerationRef.current === requestGeneration) {
        setReplyPipelineSnapshot({ scopeKey: requestedScope, items });
      }
    } catch (error) {
      console.error('Reply Pipeline load failed:', error);
      if (scopeKeyRef.current === requestedScope && requestGenerationRef.current === requestGeneration) {
        setReplyPipelineError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (scopeKeyRef.current === requestedScope && requestGenerationRef.current === requestGeneration) {
        setReplyPipelineLoading(false);
      }
    }
  }, [accountKey]);

  useEffect(() => {
    let cancelled = false;
    if (accountIds.length === 0) {
      requestGenerationRef.current += 1;
      setReplyPipelineSnapshot({ scopeKey: accountKey, items: [] });
      setReplyPipelineLoading(false);
      setReplyPipelineError(null);
      return;
    }
    const requestGeneration = ++requestGenerationRef.current;
    const requestedScope = accountKey;
    const reconcile = async () => {
      setReplyPipelineLoading(true);
      setReplyPipelineError(null);
      try {
        if (candidates.length > 0) {
          await window.electronAPI.reconcileReplyPipeline(candidates);
        }
        const items = await window.electronAPI.listReplyPipeline(accountIds);
        if (!cancelled && scopeKeyRef.current === requestedScope && requestGenerationRef.current === requestGeneration) {
          setReplyPipelineSnapshot({ scopeKey: requestedScope, items });
        }
      } catch (error) {
        console.error('Reply Pipeline reconciliation failed:', error);
        if (!cancelled && scopeKeyRef.current === requestedScope && requestGenerationRef.current === requestGeneration) {
          setReplyPipelineError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled && scopeKeyRef.current === requestedScope && requestGenerationRef.current === requestGeneration) {
          setReplyPipelineLoading(false);
        }
      }
    };
    void reconcile();
    return () => { cancelled = true; };
  }, [accountKey, candidateKey]);

  useEffect(() => window.electronAPI.onReplyPipelineUpdated(({ accountId }) => {
    if (accountIds.some(id => id.toLowerCase() === accountId.toLowerCase())) {
      void loadReplyPipeline();
    }
  }), [accountKey, loadReplyPipeline]);

  useEffect(() => {
    if (accountIds.length === 0) return;
    const timer = globalThis.setInterval(() => {
      void loadReplyPipeline();
    }, 60_000);
    return () => globalThis.clearInterval(timer);
  }, [accountKey, loadReplyPipeline]);

  const prepareReplyPipelineDraft = useCallback(async (
    accountId: string,
    threadId: string,
  ): Promise<ReplyPipelineDraftResult> => {
    const result = await window.electronAPI.prepareReplyPipelineDraft(accountId, threadId);
    await loadReplyPipeline();
    return result;
  }, [loadReplyPipeline]);

  const snoozeReplyPipelineItem = useCallback(async (item: ReplyPipelineState, snoozedUntil: string) => {
    await window.electronAPI.snoozeReplyPipelineItem(item.accountId, item.threadId, snoozedUntil);
    await loadReplyPipeline();
  }, [loadReplyPipeline]);

  const suppressReplyPipelineItem = useCallback(async (item: ReplyPipelineState) => {
    await window.electronAPI.suppressReplyPipelineItem(item.accountId, item.threadId);
    await loadReplyPipeline();
  }, [loadReplyPipeline]);

  const resolveReplyPipelineItem = useCallback(async (item: ReplyPipelineState) => {
    await window.electronAPI.resolveReplyPipelineItem(item.accountId, item.threadId);
    await loadReplyPipeline();
  }, [loadReplyPipeline]);

  return {
    replyPipelineItems,
    replyPipelineLoading,
    replyPipelineError,
    loadReplyPipeline,
    prepareReplyPipelineDraft,
    snoozeReplyPipelineItem,
    suppressReplyPipelineItem,
    resolveReplyPipelineItem,
  };
}
