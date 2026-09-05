import { useState } from 'react';
import type { AgentPlanItem } from '../../../shared/types';
import type { CorrectionReason } from '../../../shared/productivity';
import { CORRECTION_LABELS } from '../../../shared/reviewCorrections';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';

export function ReviewCorrectionControl({ item }: { item: AgentPlanItem }) {
  const store = useAppStore();
  const [busy, setBusy] = useState(false);
  const correct = async (reason: CorrectionReason) => {
    if (!item.citation.messageId || busy) return;
    setBusy(true);
    try {
      await store.saveProductivity({ kind: 'correction', id: crypto.randomUUID(), accountId: item.accountId,
        revision: 0, updatedAt: new Date().toISOString(), reason, scope: 'source',
        threadId: item.threadId, messageId: item.citation.messageId,
        senderEmail: item.citation.senderEmail || '', action: item.action, subject: item.subject });
      emitToast({ type: 'success', message: 'Correction saved. Manage or undo it in Today → AI preferences.' });
    } catch (error) { emitToast({ type: 'error', message: error instanceof Error ? error.message : 'Could not save correction.' }); }
    finally { setBusy(false); }
  };
  return <select aria-label={`Correct suggestion for ${item.subject}`} className="dm-productivity-input max-w-48"
    value="" disabled={busy || !store.productivityLoaded} onChange={event => {
      const reason = event.target.value;
      if (reason === 'dismiss') store.rejectAgentPlanItem(item.id);
      else if (reason === 'noReply' || reason === 'alreadyDone' || reason === 'importantSender') void correct(reason);
    }}>
    <option value="">Correct…</option>
    <option value="dismiss">Dismiss this suggestion</option>
    {item.citation.messageId && <option value="alreadyDone">{CORRECTION_LABELS.alreadyDone}</option>}
    {item.citation.messageId && item.action === 'draftReply' && <option value="noReply">{CORRECTION_LABELS.noReply}</option>}
    {item.citation.messageId && item.action === 'archive' && <option value="importantSender">{CORRECTION_LABELS.importantSender}</option>}
  </select>;
}
