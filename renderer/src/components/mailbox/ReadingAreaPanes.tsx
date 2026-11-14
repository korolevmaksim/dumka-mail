import React, { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import {
  PREPARED_UNDO_SENTENCE,
  PREPARED_UNTOUCHED_SENTENCE,
  explainClearBatch,
  preparedLines,
  threadEntryKey,
} from '../../../../shared/inboxSections';
import { buildDoneSummary, doneSummaryLines, hasDoneSummaryActivity } from '../../../../shared/doneSummary';
import { Kbd, KeyHint } from './SectionRows';
import { boundSectionKeys, actionKeyHints, type ActionKeyHints } from '../../lib/actionKeyHints';

function useActionKeyHints(): ActionKeyHints {
  const store = useAppStore();
  return useMemo(() => actionKeyHints(store.settings.shortcuts), [store.settings.shortcuts]);
}

/** A hint line item; omitted when its key is not bound in this shortcut mode. */
function HintItem({ keys, children }: { keys: readonly string[]; children: React.ReactNode }) {
  if (keys.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, index) => <Kbd key={`${key}-${index}`}>{key}</Kbd>)} {children}
    </span>
  );
}

/** Today's totals for the active account (every account in Unified). */
function useTodaySummary() {
  const store = useAppStore();
  const account = store.activeAccount;
  const scopeEmail = !account ? '' : account.id === 'unified' ? null : account.email;
  return useMemo(
    () => buildDoneSummary(store.actionLog, scopeEmail === null ? {} : { accountIds: [scopeEmail] }),
    [store.actionLog, scopeEmail],
  );
}

const paneClass = 'dm-reading-pane flex-1 overflow-y-auto bg-[var(--panel-bg)] px-8 py-8';
const cardClass = 'dm-inset w-full max-w-[600px] overflow-hidden rounded-[var(--panel-radius)] border border-[var(--border)]';
const cardRowClass = 'flex min-h-[44px] items-center gap-3 border-b border-[var(--border)] px-4 py-2 last:border-b-0';
const countClass = 'w-7 shrink-0 text-[calc(15px*var(--font-scale))] font-semibold tabular-nums text-[var(--text-primary)]';
const bodyText = 'text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)]';
const buttonClass = 'inline-flex items-center gap-2 rounded-[var(--control-radius)] border border-[var(--strong-border)] bg-[var(--raised-surface)] px-3 py-1.5 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';
// Accent surface + primary text keeps AA contrast in every theme (the raw
// accent behind white text does not in Classic light).
const primaryButtonClass = 'inline-flex items-center gap-2 rounded-[var(--control-radius)] border border-[var(--accent)] bg-[var(--accent-surface)] px-3 py-1.5 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:bg-[var(--focus-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60';

/** No thread open, inbox not empty: what the sections hold and the key for each. */
export function PreparedPane() {
  const store = useAppStore();
  const summary = useTodaySummary();
  const lines = preparedLines(store.decisionSections);
  const untouched = !hasDoneSummaryActivity(summary);
  const hints = useActionKeyHints();
  const undoKey = hints.undo.keys[0];

  return (
    <section data-prepared-pane aria-labelledby="prepared-title" className={paneClass}>
      <div className="flex max-w-[600px] flex-col gap-4">
        <h2 id="prepared-title" className="flex items-center gap-2 text-[calc(18px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
          <Sparkles aria-hidden="true" className="h-4 w-4 text-[var(--ai-solid)]" />
          Prepared for you
        </h2>
        <ul className={cardClass} aria-label="Sections">
          {lines.map(line => (
            <li key={line.decision} data-prepared-line={line.decision} className={cardRowClass}>
              <span className={countClass}>{line.count}</span>
              <span className="min-w-0 flex-1 text-[calc(12px*var(--font-scale))] text-[var(--text-primary)]">{line.text}</span>
              <KeyHint keys={boundSectionKeys(line.keys, hints)} />
            </li>
          ))}
        </ul>
        <p className={bodyText}>
          {untouched ? `${PREPARED_UNTOUCHED_SENTENCE} ` : ''}
          {undoKey
            ? PREPARED_UNDO_SENTENCE.split('Z').map((part, index, parts) => (
              <span key={index}>
                {part}
                {index < parts.length - 1 ? <Kbd>{undoKey}</Kbd> : null}
              </span>
            ))
            // No undo key in this mode: the toast's Undo button still works.
            : PREPARED_UNDO_SENTENCE.replace(' with Z', '')}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">
          <HintItem keys={hints.move.keys}>move</HintItem>
          <HintItem keys={hints.archive.keys}>archive</HintItem>
          <HintItem keys={hints.later.keys}>later</HintItem>
          <HintItem keys={hints.archiveClearSection.keys}>archive Clear</HintItem>
          <HintItem keys={hints.moveToSection.keys}>move to another section</HintItem>
        </p>
      </div>
    </section>
  );
}

/** Clear group opened (first `⇧E`): what the second `⇧E` will do. */
export function ClearGroupPane() {
  const store = useAppStore();
  const count = store.clearBatchThreads.length;
  const clearEntries = store.decisionSections.find(section => section.decision === 'clear')?.entries;
  const first = clearEntries?.[0]?.thread;
  // Explains exactly the rows the button will archive, in list order.
  const explanation = useMemo(() => {
    const inBatch = new Set(store.clearBatchThreads.map(thread => threadEntryKey(thread)));
    return explainClearBatch((clearEntries || []).filter(entry => inBatch.has(threadEntryKey(entry.thread))));
  }, [clearEntries, store.clearBatchThreads]);
  const conversations = `${count} conversation${count === 1 ? '' : 's'}`;
  const hints = useActionKeyHints();

  return (
    <section data-clear-confirm-pane aria-labelledby="clear-confirm-title" className={paneClass}>
      <div className="flex max-w-[600px] flex-col gap-4">
        <h2 id="clear-confirm-title" className="text-[calc(18px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
          Archive {conversations}
        </h2>
        <p className={bodyText}>They leave the inbox and stay in All mail. Nothing is deleted and nothing is sent to these senders.</p>
        <ul className={cardClass}>
          <li className={cardRowClass}>
            <span className="min-w-0 flex-1 text-[calc(12px*var(--font-scale))] text-[var(--text-primary)]">
              <b className="font-semibold">Why these.</b> {explanation.summary}
            </span>
          </li>
          {explanation.reasons.length > 0 && (
            <li className={cardRowClass} data-clear-reasons>
              <ul className="flex min-w-0 flex-1 flex-col gap-1">
                {explanation.reasons.map(item => (
                  <li key={item.key} className="flex min-w-0 items-baseline gap-2 text-[calc(12px*var(--font-scale))]">
                    <span className="w-[132px] shrink-0 truncate font-semibold text-[var(--text-primary)]">{item.sender}</span>
                    <span className="min-w-0 flex-1 text-[var(--text-secondary)]">{item.reason}</span>
                  </li>
                ))}
                {explanation.more > 0 && (
                  <li className="text-[calc(12px*var(--font-scale))] text-[var(--text-tertiary)]">
                    and {explanation.more} more, each checked in the list
                  </li>
                )}
              </ul>
            </li>
          )}
          <li className={cardRowClass}>
            <span className={bodyText}>Kept out of this group: anything from a person, security notices, invitations.</span>
          </li>
          <li className={cardRowClass}>
            <span className={bodyText}>
              Uncheck a row to keep it.{' '}
              {hints.moveToSection.keys.length > 0
                ? <><Kbd>V</Kbd> moves it to another section. The move is remembered for that conversation only.</>
                : 'Move to another section (row menu) to remember the correction.'}
            </span>
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={primaryButtonClass}
            disabled={count === 0}
            aria-keyshortcuts={hints.archiveClearSection.aria}
            onClick={() => void store.runClearGroupAction()}
          >
            Archive {count} <KeyHint keys={hints.archiveClearSection.keys} />
          </button>
          {first && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                store.setWorkspaceView('mail');
                void store.openThread(first);
              }}
            >
              Open one by one
            </button>
          )}
          <button type="button" className={buttonClass} onClick={() => store.toggleSectionGroup('clear', false)}>
            Collapse
          </button>
        </div>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">
          {hints.undo.keys.length > 0
            ? <>One <Kbd>Z</Kbd> brings all {count} back.</>
            : <>One Undo brings all {count} back.</>}
        </p>
      </div>
    </section>
  );
}

/** Inbox empty after the first sync: today's work for the active account. */
export function DoneSummaryPane() {
  const store = useAppStore();
  const summary = useTodaySummary();
  const lines = doneSummaryLines(summary);
  const laterCount = store.mailboxCounts.later || 0;
  const waitingCount = store.mailboxCounts.waiting || 0;
  const openMailbox = (view: 'later' | 'waiting') => {
    store.setWorkspaceView('mail');
    store.setMailboxView(view);
  };

  return (
    <section data-done-summary aria-labelledby="done-summary-title" className={paneClass}>
      <div className="flex max-w-[600px] flex-col gap-4">
        <h2 id="done-summary-title" className="text-[calc(18px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
          {lines.length > 0 ? 'Done today' : 'Inbox is clear'}
        </h2>
        {lines.length > 0 ? (
          <ul className={cardClass} aria-label="Today">
            {lines.map(line => (
              <li key={line.id} data-done-line={line.id} className={cardRowClass}>
                <span className={countClass}>{line.count}</span>
                <span className="min-w-0 flex-1 text-[calc(12px*var(--font-scale))] text-[var(--text-primary)]">{line.text}</span>
                {line.id === 'unsubscribed' && <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">cannot be undone</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className={bodyText}>Nothing needs you right now.</p>
        )}
        {(laterCount > 0 || waitingCount > 0) && (
          <p className={bodyText}>
            {[
              laterCount > 0 ? `${laterCount} conversation${laterCount === 1 ? ' is' : 's are'} waiting in Later` : null,
              waitingCount > 0 ? `${waitingCount} sent conversation${waitingCount === 1 ? ' is' : 's are'} waiting for an answer` : null,
            ].filter(Boolean).join(' and ')}.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" data-open-mailbox="later" className={buttonClass} onClick={() => openMailbox('later')}>Open Later</button>
          <button type="button" data-open-mailbox="waiting" className={buttonClass} onClick={() => openMailbox('waiting')}>Open Waiting</button>
        </div>
      </div>
    </section>
  );
}

/** First sync still running and nothing has arrived yet. */
export function FetchingInboxPane() {
  return (
    <section data-fetching-pane aria-labelledby="fetching-title" className={paneClass}>
      <div className="flex max-w-[600px] flex-col gap-3">
        <h2 id="fetching-title" className="text-[calc(18px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Getting your inbox</h2>
        <p className={bodyText}>The first conversations appear as they arrive. You can open and answer them while the rest comes in. Nothing changes in Gmail until you act.</p>
      </div>
    </section>
  );
}
