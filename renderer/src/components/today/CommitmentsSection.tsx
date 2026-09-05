import { useMemo, useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { suggestCommitments, type CommitmentSuggestion } from '../../../../shared/commitments';
import type { Commitment } from '../../../../shared/productivity';
import { CommitmentEditor } from './CommitmentEditor';
import { emitToast } from '../../lib/toastBus';

export function CommitmentsSection() {
  const store = useAppStore();
  const [editor, setEditor] = useState<{ initial?: Commitment; suggestion?: CommitmentSuggestion } | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const suggestions = useMemo(() => suggestCommitments(store.dailyBriefing, store.openedThreadMessages, store.commitments)
    .filter(item => store.activeAccount?.id === 'unified' ? store.accounts.some(account => account.email === item.accountId) : item.accountId === store.activeAccount?.email),
    [store.dailyBriefing, store.openedThreadMessages, store.commitments, store.activeAccount, store.accounts]);
  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await task(); }
    catch (error) { emitToast({ type: 'error', message: error instanceof Error ? error.message : 'Could not update commitment.' }); }
    finally { setBusy(false); }
  };
  return <section className="dm-productivity border-t border-[var(--border)] py-4" aria-label="Commitments">
    <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Commitments</h2><button disabled={!store.productivityLoaded || !store.accounts.length} className="dm-productivity-button" onClick={() => setEditor({})}>Track a commitment</button></div>
    <p className="my-2 text-[var(--text-secondary)]">Track a promised outcome across conversations. Only you mark it complete.</p>
    {editor && <CommitmentEditor key={editor.initial?.id || editor.suggestion?.evidence.messageId || 'new'} {...editor} onClose={() => setEditor(null)} />}
    {store.productivityLoaded && suggestions.length > 0 && <details className="my-3"><summary className="cursor-pointer">Review {suggestions.length} possible {suggestions.length === 1 ? 'commitment' : 'commitments'}</summary>
      <p className="my-2 text-[var(--text-secondary)]">Detected explicit promises in briefing snippets and the currently loaded conversation. This is not a complete scan of your mail.</p>
      {suggestions.map(suggestion => <div key={`${suggestion.accountId}:${suggestion.evidence.messageId}`} className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] py-3">
        <div className="min-w-0 flex-1"><p>{suggestion.title}</p><p className="text-[var(--text-secondary)]">{suggestion.owner} · {suggestion.dueDate || 'Date needs review'}</p></div>
        <button disabled={busy} className="dm-productivity-button" onClick={() => setEditor({ suggestion })}>Review</button>
        <button disabled={busy} className="dm-productivity-button" onClick={() => void run(() => store.saveProductivity({ ...suggestion, evidence: [suggestion.evidence], kind: 'commitment', id: crypto.randomUUID(), revision: 0, status: 'dismissed', updatedAt: new Date().toISOString() }))}>Not a commitment</button>
      </div>)}
    </details>}
    <details className="my-3"><summary className="cursor-pointer">Manage all commitments · {store.commitments.filter(item => item.status === 'confirmed').length}</summary>
    <div className="grid gap-4 lg:grid-cols-2">{(['mine', 'waiting'] as const).map(direction => {
      const items = store.commitments.filter(item => item.status === 'confirmed' && item.direction === direction);
      return <div key={direction}><h3 className="my-2 font-medium">{direction === 'mine' ? 'I owe' : 'Waiting on others'} · {items.length}</h3>
        {!items.length && <p className="text-[var(--text-secondary)]">No confirmed commitments.</p>}
        {items.map(item => <div key={item.id} className="border-t border-[var(--border)] py-3"><p className="font-medium">{item.title}</p><p className="my-1 text-[var(--text-secondary)]">{item.owner} · {item.dueDate || 'No deadline'} · {item.evidence.length} source messages</p>
          <div className="flex gap-2"><button disabled={busy} className="dm-productivity-button" onClick={() => setEditor({ initial: item })}>Edit / sources</button><button disabled={busy} className="dm-productivity-button" onClick={() => void run(() => store.saveProductivity({ ...item, status: 'completed' }))}>Mark complete</button></div>
        </div>)}
      </div>;
    })}</div></details>
    <button className="dm-productivity-button mt-3" aria-expanded={showCompleted} onClick={() => setShowCompleted(value => !value)}>Completed / dismissed</button>
    {showCompleted && store.commitments.filter(item => item.status !== 'confirmed').map(item => <div key={item.id} className="flex items-center justify-between gap-3 py-2"><span>{item.title} · {item.status}</span><button disabled={busy} className="dm-productivity-button" onClick={() => void run(() => store.saveProductivity({ ...item, status: 'confirmed' }))}>Restore</button></div>)}
  </section>;
}
