import { useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { CORRECTION_LABELS, canSuggestSenderRule } from '../../../../shared/reviewCorrections';
import type { ReviewCorrection } from '../../../../shared/productivity';
import { emitToast } from '../../lib/toastBus';

export function ReviewPreferences() {
  const store = useAppStore();
  const [preview, setPreview] = useState<ReviewCorrection | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try { await task(); setPreview(null); }
    catch (error) { emitToast({ type: 'error', message: error instanceof Error ? error.message : 'Could not update preferences.' }); }
    finally { setBusy(false); }
  };
  const affected = preview ? store.threads.filter(thread => thread.accountId.toLowerCase() === preview.accountId.toLowerCase()
    && thread.senderEmail.toLowerCase() === preview.senderEmail) : [];
  return <details className="dm-productivity border-t border-[var(--border)] py-3">
    <summary className="cursor-pointer font-medium">AI preferences · {store.reviewCorrections.length} saved corrections</summary>
    <p className="my-3 text-[var(--text-secondary)]">Corrections apply to the cited message. Sender rules apply only after you review and enable them. Undo restores eligible suggestions still in the current plan.</p>
    {!store.reviewCorrections.length && <p>No corrections yet. Use Correct on an AI suggestion.</p>}
    {store.reviewCorrections.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] py-2">
      <div className="min-w-0 flex-1"><div>{CORRECTION_LABELS[item.reason]}{item.scope === 'sender' ? ' · Sender rule enabled' : ''}</div>
        <p className="truncate text-[var(--text-secondary)]">{item.senderEmail || item.subject} · {item.accountId}</p></div>
      {canSuggestSenderRule(item, store.reviewCorrections) && <button disabled={busy} className="dm-productivity-button" onClick={() => setPreview(item)}>Preview sender rule</button>}
      <button disabled={busy} className="dm-productivity-button" onClick={() => void run(() => store.deleteProductivity(item))}>Undo</button>
    </div>)}
    {preview && <section aria-label="Sender rule preview" className="mt-3 border-t border-[var(--border)] pt-3">
      <p className="font-medium">{CORRECTION_LABELS[preview.reason]}: {preview.senderEmail}</p>
      <p className="my-2">{preview.reason === 'noReply' ? 'Hide future draft-reply suggestions' : 'Hide future archive suggestions'} for this sender in {preview.accountId}. This does not modify or send mail.</p>
      <p>{affected.length} cached threads currently have this latest sender. Matching suggestions in other threads will also be filtered.</p>
      <ul className="my-2 max-h-36 overflow-y-auto">{affected.map(thread => <li key={thread.id} className="py-1">{thread.subject || '(No subject)'}</li>)}</ul>
      <div className="flex gap-2"><button disabled={busy} className="dm-productivity-button" onClick={() => void run(() => store.saveProductivity({ ...preview, scope: 'sender' }))}>Enable sender rule</button>
        <button disabled={busy} className="dm-productivity-button" onClick={() => setPreview(null)}>Cancel</button></div>
    </section>}
  </details>;
}
