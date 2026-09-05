import type { AgentPlanItem } from '../../../../shared/types';
import { useState } from 'react';
import type { AttentionItem } from '../../../../shared/todayAttention';
import { useAppStore } from '../../stores/AppStore';
import { emitToast } from '../../lib/toastBus';
import { ReviewCorrectionControl } from '../ReviewCorrectionControl';
import { CommitmentEditor } from './CommitmentEditor';


function describeReview(item: AgentPlanItem): string {
  switch (item.action) {
    case 'draftReply': return 'Creates a local draft for editing; nothing is sent.';
    case 'archive': return 'Removes this conversation from Inbox, then syncs to Gmail.';
    case 'markRead': return 'Marks this conversation as read in Gmail.';
    case 'setReminder': return item.payload?.reminderAt ? `Creates a local reminder for ${new Date(item.payload.reminderAt).toLocaleString()}.` : 'Creates a local reminder for tomorrow.';
    case 'applyLabel': return `Applies the Gmail label ${item.payload?.labelName || item.payload?.labelId || 'shown in the proposal'}.`;
    case 'unsubscribe': return `Sends an unsubscribe request to ${item.citation.senderEmail || item.sender}.`;
    case 'openThread': return 'Opens the source conversation.';
  }
}

export function AttentionRow({ row }: { row: AttentionItem }) {
  const store = useAppStore();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const { source } = row;
  const thread = store.threads.find(item => item.accountId === row.accountId && item.id === row.threadId);
  const run = async (task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await task(); }
    catch (error) { emitToast({ type: 'error', message: error instanceof Error ? error.message : 'Could not complete this action.' }); }
    finally { setBusy(false); }
  };
  const open = async () => {
    if (!thread) throw new Error('Source thread is no longer cached. Sync this account and try again.');
    await store.openThreadFromToday(thread);
  };
  const primary = async () => {
    if (source.kind === 'commitment') { setEditing(true); return; }
    if (source.kind === 'reply') {
      const result = await store.prepareReplyPipelineDraft(row.accountId, row.threadId);
      await store.loadDrafts(); await open();
      store.setActiveDraft(result.draft); store.setComposeLayout('inline');
      return;
    }
    if (source.kind === 'review') {
      if (source.item.action === 'openThread' || source.item.action === 'draftReply') store.beginTodayThreadNavigation();
      await store.applyAgentPlanItem(source.item);
      return;
    }
    await open();
  };
  const label = source.kind === 'commitment' ? 'Review commitment' : source.kind === 'reply'
    ? source.item.draftId ? 'Open draft' : 'Prepare draft' : source.kind === 'review' ? `Approve ${source.item.action.replace(/([A-Z])/g, ' $1').toLowerCase()}` : 'Open mail';
  const preview = source.kind === 'review' ? store.agentPlanActionPreview(source.item) : null;
  const blocked = preview && !['ready', 'focusOnly'].includes(preview.eligibility);
  const snooze = async () => {
    const existing = store.attentionSnoozes.find(item => item.accountId === row.accountId && item.threadId === row.threadId);
    await store.saveProductivity({ kind: 'snooze', id: existing?.id || crypto.randomUUID(), revision: existing?.revision || 0,
      updatedAt: new Date().toISOString(), accountId: row.accountId, threadId: row.threadId, until: new Date(Date.now() + 86400000).toISOString() });
  };
  return <article className="border-t border-[var(--border)] py-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-48 flex-1"><h3 className="font-semibold">{row.title}</h3><p className="mt-1 text-[var(--text-secondary)]">{row.reason}</p>
        <p className="mt-1 text-[var(--text-secondary)]">{row.dueDate ? `Due ${row.dueDate} · ` : ''}{row.accountId}</p></div>
      <button disabled={busy || Boolean(blocked) || !store.productivityLoaded} title={blocked ? preview?.eligibility : undefined} className="dm-productivity-button font-semibold" onClick={() => void run(primary)}>{busy ? 'Working…' : label}</button>
    </div>
    {source.kind === 'review' && <p className="mt-2 text-[var(--text-secondary)]">{describeReview(source.item)} Risk: {source.item.riskLevel}.{blocked ? ' Reconnect or restore the source before approving.' : ''}</p>}
    <details className="mt-2"><summary className="cursor-pointer text-[var(--text-secondary)]">Source and options</summary>
      <div className="mt-2 whitespace-pre-wrap text-[var(--text-secondary)]">{source.kind === 'commitment' ? source.item.evidence.map(item => `${item.subject}\n${item.quote}`).join('\n\n') : source.kind === 'review' ? source.item.citation.evidence || source.item.citation.snippet : source.kind === 'briefing' ? source.item.source.snippet : thread?.snippet}</div>
      <div className="mt-3 flex flex-wrap gap-2"><button disabled={busy} className="dm-productivity-button" onClick={() => void run(open)}>Open source</button>
        <button disabled={busy || !store.productivityLoaded} className="dm-productivity-button" onClick={() => void run(snooze)}>Snooze 1 day</button>
        {source.kind === 'review' && <ReviewCorrectionControl item={source.item} />}
        {source.kind === 'commitment' && <button disabled={busy} className="dm-productivity-button" onClick={() => void run(() => store.saveProductivity({ ...source.item, status: 'completed' }))}>Mark complete</button>}
      </div>
    </details>
    {editing && source.kind === 'commitment' && <CommitmentEditor initial={source.item} onClose={() => setEditing(false)} />}
  </article>;
}
