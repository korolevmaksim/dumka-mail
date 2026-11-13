import { useState } from 'react';
import { MailMinus, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../stores/AppStore';
import { UnsubscribeConfirmSheet } from './UnsubscribeConfirmSheet';
import { unsubscribeTargetFromCandidate, type UnsubscribeTarget } from '../../../shared/unsubscribeConfirm';
import { emitToast } from '../lib/toastBus';
import type { MailSecurityWarning } from '../../../shared/types';
import { selectThreadSecurityWarnings } from './threadSecurityWarnings';

function severityClass(severity: MailSecurityWarning['severity']): string {
  if (severity === 'danger') return 'border-[var(--danger)]/35 bg-[var(--danger)]/10 text-[var(--danger-solid)]';
  if (severity === 'warning') return 'border-[var(--warning)]/35 bg-[var(--warning)]/10 text-[var(--warning-solid)]';
  return 'border-[var(--border)] bg-[var(--raised-surface)] text-[var(--text-secondary)]';
}

/** Safety warnings and the unsubscribe entry above the messages of the open thread. */
export function AgenticThreadPanel() {
  const store = useAppStore();
  const insights = store.threadAgentInsights;
  const unsubscribe = insights?.unsubscribeCandidate || null;
  const warnings = selectThreadSecurityWarnings(insights?.securityInsights || []);
  const hasThreatWarning = warnings.some(warning => warning.severity !== 'info');
  const [confirmTargets, setConfirmTargets] = useState<UnsubscribeTarget[] | null>(null);
  const [unsubscribing, setUnsubscribing] = useState(false);

  // A prepared draft appears only in the reply dock (ReplyDock), never here.
  if (!unsubscribe?.canOneClick && warnings.length === 0 && !confirmTargets) {
    return null;
  }

  // Never unsubscribe on a single click: open the confirmation sheet first.
  const unsubscribeThread = () => {
    const target = unsubscribeTargetFromCandidate(unsubscribe);
    if (!target) {
      emitToast({ type: 'warning', message: 'No usable unsubscribe method found for this sender.' });
      return;
    }
    setConfirmTargets([target]);
  };

  const confirmUnsubscribe = async (options: { archive: boolean }) => {
    if (!confirmTargets) return;
    setUnsubscribing(true);
    try {
      await store.unsubscribeSenders(confirmTargets, options);
    } finally {
      setUnsubscribing(false);
      setConfirmTargets(null);
    }
  };

  return (
    <div className="mb-4 flex flex-col gap-2 select-none">
      {(unsubscribe?.canOneClick || warnings.length > 0) && (
        <div className="dm-inset flex flex-col gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--raised-surface)] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
              {hasThreatWarning ? (
                <ShieldAlert className="h-4 w-4 text-[var(--warning-solid)]" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-[var(--accent-ink)]" />
              )}
              {hasThreatWarning ? 'Mail safety' : 'Mail privacy'}
            </div>
            {unsubscribe?.canOneClick && (
              <button
                type="button"
                onClick={unsubscribeThread}
                title="Unsubscribe (asks for confirmation)"
                className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--strong-border)]"
              >
                <MailMinus className="h-3.5 w-3.5 text-[var(--accent-ink)]" />
                Unsubscribe
              </button>
            )}
          </div>
          {warnings.length > 0 && (
            <div className="mt-1 grid gap-1.5">
              {warnings.map((warning, index) => (
                <div
                  key={`${warning.messageId}:${warning.kind}:${index}`}
                  className={`rounded border px-2 py-1.5 text-[calc(11px*var(--font-scale))] ${severityClass(warning.severity)}`}
                >
                  <span className="font-semibold">{warning.title}</span>
                  <span className="text-[var(--text-secondary)]"> · {warning.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {confirmTargets && (
        <UnsubscribeConfirmSheet
          targets={confirmTargets}
          busy={unsubscribing}
          onConfirm={options => void confirmUnsubscribe(options)}
          onCancel={() => setConfirmTargets(null)}
        />
      )}
    </div>
  );
}
