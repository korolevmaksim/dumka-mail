import { useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import type { Commitment, CommitmentEvidence } from '../../../../shared/productivity';
import type { CommitmentSuggestion } from '../../../../shared/commitments';
import { linkCommitmentEvidence } from '../../../../shared/commitments';

export function CommitmentEditor({ initial, suggestion, onClose }: { initial?: Commitment; suggestion?: CommitmentSuggestion; onClose: () => void }) {
  const store = useAppStore();
  const [accountId, setAccountId] = useState(initial?.accountId || suggestion?.accountId || (store.activeAccount?.id !== 'unified' ? store.activeAccount?.email : store.accounts[0]?.email) || '');
  const [title, setTitle] = useState(initial?.title || suggestion?.title || '');
  const [direction, setDirection] = useState<Commitment['direction']>(initial?.direction || suggestion?.direction || 'mine');
  const [owner, setOwner] = useState(initial?.owner || suggestion?.owner || accountId);
  const [dueDate, setDueDate] = useState(initial?.dueDate || suggestion?.dueDate || '');
  const [evidence, setEvidence] = useState<CommitmentEvidence[]>(initial?.evidence || (suggestion ? [suggestion.evidence] : []));
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceMessages, setSourceMessages] = useState<CommitmentEvidence[]>([]);
  const [mergeId, setMergeId] = useState('');
  const threads = store.threads.filter(thread => thread.accountId.toLowerCase() === accountId.toLowerCase()
    && `${thread.subject} ${thread.senderEmail}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 30);
  const loadSource = async (threadId: string) => {
    if (!threadId || busy) return;
    setBusy(true); setError(null);
    try {
      const payload = await window.electronAPI.getThreadReaderPayload(accountId, threadId);
      setSourceMessages(payload.messages.map(message => ({ threadId, messageId: message.id, subject: message.subject,
        sender: message.senderEmail, quote: (message.bodyPlain || message.snippet).slice(0, 4000), receivedAt: message.receivedAt })).filter(source => source.quote));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load source mail.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const target = store.commitments.find(item => item.id === mergeId && item.accountId === accountId);
      if (target && suggestion) await store.saveProductivity(linkCommitmentEvidence(target, accountId, suggestion.evidence));
      else await store.saveProductivity({ kind: 'commitment', id: initial?.id || crypto.randomUUID(), revision: initial?.revision || 0,
        accountId, title, direction, owner, dueDate: dueDate || null, status: initial?.status || 'confirmed', evidence, updatedAt: new Date().toISOString() });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save commitment.'); }
    finally { setBusy(false); }
  };
  return <form className="dm-productivity border-y border-[var(--border)] py-4" onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => event.stopPropagation()}>
    <h3 className="mb-3 font-semibold">{initial ? 'Edit commitment' : 'Confirm a commitment'}</h3>
    {suggestion && <p className="mb-3 text-[var(--text-secondary)]">Suggested from source mail. Check the owner and date before confirming.</p>}
    <fieldset disabled={busy} className="flex flex-col gap-3">
      <label>Account<select className="dm-productivity-input ml-2" value={accountId} disabled={Boolean(initial || suggestion)} onChange={event => { setAccountId(event.target.value); setOwner(event.target.value); setEvidence([]); setSourceMessages([]); }}>
        {store.accounts.filter(account => account.id !== 'unified').map(account => <option key={account.id} value={account.email}>{account.email}</option>)}
      </select></label>
      {suggestion && <label>Add to an existing commitment instead<select className="dm-productivity-input mt-1 w-full" value={mergeId} onChange={event => setMergeId(event.target.value)}>
        <option value="">Create a new commitment</option>{store.commitments.filter(item => item.accountId === accountId && item.status === 'confirmed').map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>}
      {!mergeId && <>
        <label>What needs to happen?<input required maxLength={500} className="dm-productivity-input mt-1 w-full" value={title} onChange={event => setTitle(event.target.value)} /></label>
        <div className="flex flex-wrap items-end gap-3">
          <label>Responsibility<select className="dm-productivity-input mt-1 block" value={direction} onChange={event => { const mine = event.target.value === 'mine'; setDirection(mine ? 'mine' : 'waiting'); if (mine) setOwner(accountId); }}><option value="mine">I owe</option><option value="waiting">Waiting on someone</option></select></label>
          <label className="min-w-40 flex-1">Owner<input required maxLength={320} className="dm-productivity-input mt-1 w-full" value={owner} onChange={event => setOwner(event.target.value)} /></label>
          <label>Due date<input type="date" className="dm-productivity-input mt-1 block" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
        </div>
      </>}
      <div aria-label="Linked source mail">{evidence.map(source => <div key={source.messageId} className="border-t border-[var(--border)] py-2">
        <div className="font-medium">{source.subject} · {source.sender}</div><blockquote className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap text-[var(--text-secondary)]">{source.quote}</blockquote>
        {evidence.length > 1 && <button type="button" className="dm-productivity-button mt-1" onClick={() => setEvidence(items => items.filter(item => item.messageId !== source.messageId))}>Unlink source</button>}
      </div>)}</div>
      {!mergeId && <details open={!evidence.length}><summary className="cursor-pointer">Link source mail</summary>
        <input className="dm-productivity-input my-2 w-full" aria-label="Find source mail" placeholder="Search cached subject or sender" value={filter} onChange={event => setFilter(event.target.value)} />
        <select className="dm-productivity-input w-full" aria-label="Choose source thread" value="" onChange={event => void loadSource(event.target.value)}>
          <option value="">Choose a thread ({threads.length} shown)</option>{threads.map(thread => <option key={thread.id} value={thread.id}>{thread.subject || '(No subject)'} · {thread.senderEmail}</option>)}
        </select>
        {sourceMessages.map(source => <button type="button" key={source.messageId} disabled={evidence.some(item => item.messageId === source.messageId)} className="my-2 block w-full border-t border-[var(--border)] py-2 text-left disabled:opacity-50" onClick={() => setEvidence(items => [...items, source])}>
          <span className="font-medium">Link message · {source.sender} · {new Date(source.receivedAt).toLocaleDateString()}</span><span className="mt-1 line-clamp-2 block text-[var(--text-secondary)]">{source.quote}</span>
        </button>)}
      </details>}
      {error && <p role="alert" className="text-[var(--danger)]">{error}</p>}
      <div className="flex gap-2"><button className="dm-productivity-button font-semibold" disabled={!evidence.length || !accountId}>{busy ? 'Saving…' : mergeId ? 'Link to commitment' : 'Save commitment'}</button><button type="button" className="dm-productivity-button" onClick={onClose}>Cancel</button></div>
    </fieldset>
  </form>;
}
