import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Account } from '../../../shared/types';
import type { AttentionSnooze, Commitment, ProductivityRecord, ReviewCorrection, SavedMailSearch } from '../../../shared/productivity';

export function useProductivityState(accounts: Account[], activeAccount: Account | null) {
  const accountKey = JSON.stringify((activeAccount?.id === 'unified'
    ? [...accounts.map(account => account.email.toLowerCase()), 'unified']
    : activeAccount ? [activeAccount.email.toLowerCase()] : []).sort());
  const [snapshot, setSnapshot] = useState<{ key: string; records: ProductivityRecord[] }>({ key: '', records: [] });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const currentScope = useRef(accountKey);
  currentScope.current = accountKey;

  const refreshProductivity = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const records = await window.electronAPI.listProductivity(JSON.parse(accountKey) as string[]);
      if (request === generation.current && currentScope.current === accountKey) setSnapshot({ key: accountKey, records });
    } catch (cause) {
      if (request === generation.current && currentScope.current === accountKey) setError(cause instanceof Error ? cause.message : 'Could not load saved workspace items.');
    } finally {
      if (request === generation.current && currentScope.current === accountKey) setLoading(false);
    }
  }, [accountKey]);

  useEffect(() => { void refreshProductivity(); }, [refreshProductivity]);

  const saveProductivity = useCallback(async (record: ProductivityRecord) => {
    if (snapshot.key !== accountKey) throw new Error('Wait for saved workspace items to load.');
    const allowed = JSON.parse(accountKey) as string[];
    if (!allowed.includes(record.accountId.toLowerCase())) throw new Error('Switch to the source account before saving this item.');
    const saved = await window.electronAPI.saveProductivity(record);
    // An in-flight read must never replace an acknowledged write with old data.
    if (currentScope.current === accountKey) {
      ++generation.current;
      setLoading(false);
      setSnapshot(prev => ({ key: accountKey, records: [...(prev.key === accountKey ? prev.records : [])
        .filter(item => item.accountId !== saved.accountId || item.id !== saved.id), saved] }));
    }
    return saved;
  }, [accountKey, snapshot.key]);

  const deleteProductivity = useCallback(async (record: ProductivityRecord) => {
    if (!(JSON.parse(accountKey) as string[]).includes(record.accountId.toLowerCase())) throw new Error('Switch to the source account before changing this item.');
    await window.electronAPI.deleteProductivity(record.accountId, record.id, record.revision);
    if (currentScope.current === accountKey) {
      ++generation.current;
      setLoading(false);
      setSnapshot(prev => ({ ...prev, records: prev.records.filter(item => item.accountId !== record.accountId || item.id !== record.id) }));
    }
  }, [accountKey]);

  const records = useMemo(() => snapshot.key === accountKey ? snapshot.records : [], [snapshot, accountKey]);
  const collections = useMemo(() => ({
    attentionSnoozes: records.filter((item): item is AttentionSnooze => item.kind === 'snooze'),
    commitments: records.filter((item): item is Commitment => item.kind === 'commitment'),
    reviewCorrections: records.filter((item): item is ReviewCorrection => item.kind === 'correction'),
    savedMailSearches: records.filter((item): item is SavedMailSearch => item.kind === 'search'),
  }), [records]);
  return {
    ...collections,
    productivityLoaded: snapshot.key === accountKey,
    productivityLoading: loading,
    productivityError: error,
    refreshProductivity, saveProductivity, deleteProductivity,
  };
}

export type ProductivityState = ReturnType<typeof useProductivityState>;
