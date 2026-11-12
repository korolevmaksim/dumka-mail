// Sender rules in the main process (design-review/SPEC.md §7).
//
// - Learning: `api:modifyLabels` reports archives and restores here; a
//   confirmation is counted when the archived thread's deterministic decision
//   is `clear` / `unsubscribe` and it is not protected; a restore within the
//   window counts a bring-back. Counting is idempotent per action id, so the
//   offline replay path can never double count.
// - Applying: after a sync persisted a thread with new inbound mail, an
//   enabled rule archives it through the same optimistic path as `E`
//   (local SQLite first, action log, Gmail, offline queueing, rollback).
// - Notifications: threads a rule will archive raise no desktop notification.
//
// Rules are settings and stay renderer-owned (the renderer saves the whole
// settings blob); this module only reads them. Bring-backs are published to
// the renderer, which updates the rule counters and auto-disables a rule.
import crypto from 'crypto';
import { ActionLogRepo, SettingsRepo, ThreadsRepo } from './database';
import { SenderRulesRepo } from './senderRulesRepository';
import { isRetryableRemoteError } from './actionReconciler';
import { getSenderRules, normalizeAccountId, normalizeAccountOverrides, resolveAccountSetting, type AccountSettingsSource } from '../shared/accountSettings';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import {
  isSenderRuleActionPayload,
  isSenderRuleEligible,
  matchSenderRule,
  senderRuleActionPayload,
  senderRuleIdFromPayload,
} from '../shared/senderRules';
import type { MailActionLog, MailMessage, MailThread, SenderRule, SenderRulesChangedEvent } from '../shared/types';

export interface SenderRulesServiceDeps {
  runRemoteArchive(accountId: string, threadId: string): Promise<void>;
  publish(event: SenderRulesChangedEvent): void;
  logError(message: string, error: unknown, extra?: Record<string, unknown>): void;
  now?: () => Date;
}

let deps: SenderRulesServiceDeps | null = null;

/** Newest inbound arrival per `account:thread`, recorded when messages are stored for the first time. */
const pendingArrivals = new Map<string, string>();

function key(accountId: string, threadId: string): string {
  return `${normalizeAccountId(accountId)}:${threadId}`;
}

function now(): Date {
  return deps?.now ? deps.now() : new Date();
}

function readSettings(): AccountSettingsSource {
  try {
    const parsed = JSON.parse(SettingsRepo.get('appSettings') || '{}');
    return {
      accountDefaults: parsed?.accountDefaults ?? null,
      accountOverrides: normalizeAccountOverrides(parsed?.accountOverrides),
    };
  } catch {
    return {};
  }
}

function hasUserCorrection(accountId: string, threadId: string): boolean {
  try {
    return SenderRulesRepo.hasUserCorrection(accountId, threadId);
  } catch {
    return false;
  }
}

function storedBringBacks(accountId: string, rule: SenderRule): number {
  try {
    return SenderRulesRepo.countBringBacksSince(accountId, rule.senderEmail, rule.createdAt);
  } catch {
    return 0;
  }
}

const MAX_PENDING_ARRIVALS = 2000;

function rememberArrival(threadKey: string, receivedAt: string) {
  const previous = pendingArrivals.get(threadKey);
  if (previous && Date.parse(receivedAt) <= Date.parse(previous)) return;
  pendingArrivals.delete(threadKey);
  pendingArrivals.set(threadKey, receivedAt);
  // Arrivals stored outside a sync pass are never consumed; keep the map bounded.
  while (pendingArrivals.size > MAX_PENDING_ARRIVALS) {
    const oldest = pendingArrivals.keys().next().value;
    if (oldest === undefined) break;
    pendingArrivals.delete(oldest);
  }
}

function senderNameOf(thread: Pick<MailThread, 'senderNames' | 'senderEmail'>): string {
  return thread.senderNames.find(name => name.trim())?.trim() || '';
}

function safePublish(event: SenderRulesChangedEvent) {
  try {
    deps?.publish(event);
  } catch {
    // The renderer may be gone (quit); counters are already stored.
  }
}

export const SenderRulesService = {
  configure(next: SenderRulesServiceDeps) {
    deps = next;
  },

  // --- Learning ---------------------------------------------------------------

  /** The thread as stored before an archive is applied (it still carries INBOX). */
  readThreadBeforeArchive(accountId: string, threadId: string): MailThread | null {
    try {
      return ThreadsRepo.get(accountId, threadId);
    } catch {
      return null;
    }
  },

  /**
   * Called by `api:modifyLabels` once an archive was accepted (applied, or
   * parked for offline replay). `before` is the thread read before the local
   * write. Counts one confirmation when it qualifies. Never throws: learning
   * must not break an archive.
   */
  noteArchive(accountId: string, before: MailThread | null, actionId: string | undefined, payloadJson?: string | null) {
    if (!actionId || !before || isSenderRuleActionPayload(payloadJson)) return;
    const thread = before;
    const threadId = before.id;
    try {
      if (!thread || !thread.labelIds.some(label => label.toUpperCase() === 'INBOX')) return;
      if (!isSenderRuleEligible(thread, accountId)) return;
      const counted = SenderRulesRepo.recordConfirmation({
        actionId,
        accountId,
        threadId,
        senderEmail: thread.senderEmail,
        senderName: senderNameOf(thread),
        subject: thread.subject,
        archivedAt: now().toISOString(),
      });
      if (counted) safePublish({ accountId: normalizeAccountId(accountId) });
    } catch (error) {
      deps?.logError('Could not count a sender-rule confirmation.', error, { accountId });
    }
  },

  /** Called by `api:modifyLabels` when a thread returns to the inbox. */
  noteRestore(accountId: string, threadId: string) {
    try {
      const bringBack = SenderRulesRepo.recordBringBack(accountId, threadId, now());
      if (!bringBack) return;
      safePublish({
        accountId: bringBack.accountId,
        bringBack: {
          senderEmail: bringBack.senderEmail,
          senderName: bringBack.senderName,
          ruleId: bringBack.origin === 'senderRule' ? bringBack.ruleId : null,
        },
      });
    } catch (error) {
      deps?.logError('Could not count a sender-rule bring-back.', error, { accountId });
    }
  },

  // --- Arrival ------------------------------------------------------------------

  /**
   * Records which threads got new inbound mail in this persist and returns
   * the ids of threads a rule will archive (no desktop notification for them).
   * `messages` is everything that was persisted, `newMessages` the subset
   * that was not stored before.
   */
  noteArrivals(messages: readonly MailMessage[], newMessages: readonly MailMessage[]): Set<string> {
    const suppressed = new Set<string>();
    if (newMessages.length === 0) return suppressed;
    const settings = readSettings();
    const byThread = new Map<string, MailMessage[]>();
    for (const message of messages) {
      const threadKey = key(message.accountId, message.threadId);
      const list = byThread.get(threadKey);
      if (list) list.push(message);
      else byThread.set(threadKey, [message]);
    }
    for (const message of newMessages) {
      const accountId = normalizeAccountId(message.accountId);
      if (normalizeAccountId(message.senderEmail) === accountId) continue;
      if (!message.labelIds.some(label => label.toUpperCase() === 'INBOX')) continue;
      rememberArrival(key(message.accountId, message.threadId), message.receivedAt);
    }
    for (const [threadKey, receivedAt] of pendingArrivals) {
      const threadMessages = byThread.get(threadKey);
      if (!threadMessages || threadMessages.length === 0) continue;
      const first = threadMessages[0];
      try {
        const ordered = [...threadMessages].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
        const thread = buildMailThreadFromMessages(first.accountId, first.threadId, ordered);
        if (thread && this.ruleFor(thread, receivedAt, settings)) suppressed.add(first.threadId);
      } catch (error) {
        deps?.logError('Could not evaluate sender rules for new mail.', error, { accountId: first.accountId });
      }
    }
    return suppressed;
  },

  ruleFor(thread: MailThread, newestArrivalAt: string | null, settings: AccountSettingsSource = readSettings()): SenderRule | null {
    const accountId = normalizeAccountId(thread.accountId);
    const rules = getSenderRules(settings, accountId);
    if (rules.length === 0) return null;
    const input = {
      thread,
      accountEmail: accountId,
      rules,
      autonomy: resolveAccountSetting(settings, accountId, 'agentAutonomy').value,
      hasUserCorrection: false,
      newestArrivalAt,
    };
    // Cheap checks first; the database lookups only run for a candidate.
    const candidate = matchSenderRule(input);
    if (!candidate) return null;
    return matchSenderRule({
      ...input,
      hasUserCorrection: hasUserCorrection(thread.accountId, thread.id),
      broughtBackBefore: SenderRulesRepo.wasBroughtBackFromRule(accountId, thread.id),
      // Enforced here too: the renderer may not have switched the rule off yet.
      storedBringBacks: storedBringBacks(accountId, candidate),
    });
  },

  /**
   * After a sync persisted `threads`: archives the newly arrived ones an
   * enabled rule matches. Returns the threads as they now are locally, so the
   * published delta already shows them out of the inbox.
   */
  async applyToPersistedThreads(accountId: string, threads: MailThread[]): Promise<MailThread[]> {
    if (threads.length === 0 || pendingArrivals.size === 0) return threads;
    const settings = readSettings();
    let changed = false;
    const result: MailThread[] = [];
    for (const thread of threads) {
      const threadKey = key(thread.accountId, thread.id);
      const arrival = pendingArrivals.get(threadKey);
      if (!arrival) {
        result.push(thread);
        continue;
      }
      pendingArrivals.delete(threadKey);
      let rule: SenderRule | null = null;
      try {
        rule = this.ruleFor(thread, arrival, settings);
      } catch (error) {
        deps?.logError('Could not evaluate sender rules for a synced thread.', error, { accountId });
      }
      if (!rule) {
        result.push(thread);
        continue;
      }
      const archived = await this.archiveByRule(thread, rule);
      if (archived !== thread) changed = true;
      result.push(archived);
    }
    if (changed) safePublish({ accountId: normalizeAccountId(accountId) });
    return result;
  },

  /** The user's `E` path, run by the main process with rule provenance. */
  async archiveByRule(thread: MailThread, rule: SenderRule): Promise<MailThread> {
    const accountId = thread.accountId;
    const actionId = crypto.randomUUID();
    const createdAt = now().toISOString();
    const log: MailActionLog = {
      id: actionId,
      accountId,
      threadId: thread.id,
      kind: 'markDone',
      status: 'running',
      createdAt,
      payloadJson: senderRuleActionPayload(normalizeAccountId(accountId), rule.id),
    };
    const archivedThread: MailThread = {
      ...thread,
      labelIds: thread.labelIds.filter(label => label.toUpperCase() !== 'INBOX'),
    };
    try {
      ThreadsRepo.updateLabels(accountId, thread.id, [], ['INBOX']);
    } catch (error) {
      deps?.logError('Sender rule could not archive locally.', error, { accountId, threadId: thread.id });
      return thread;
    }
    try {
      ActionLogRepo.save(log);
      SenderRulesRepo.recordRuleArchive({
        actionId,
        accountId,
        threadId: thread.id,
        senderEmail: thread.senderEmail,
        senderName: senderNameOf(thread),
        subject: thread.subject,
        ruleId: rule.id,
        archivedAt: createdAt,
      });
    } catch (error) {
      // Without a log entry the archive could never sync or be undone: undo it.
      try { ThreadsRepo.updateLabels(accountId, thread.id, ['INBOX'], []); } catch { /* next sync repairs */ }
      deps?.logError('Sender rule could not record its archive.', error, { accountId, threadId: thread.id });
      return thread;
    }

    try {
      await deps?.runRemoteArchive(accountId, thread.id);
      ActionLogRepo.save({ ...log, status: 'completed', completedAt: now().toISOString() });
      return archivedThread;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isRetryableRemoteError(error)) {
        // Parked like an offline `E`; the reconciler replays it.
        ActionLogRepo.save({ ...log, status: 'pending_sync', failureMessage: message });
        return archivedThread;
      }
      try { ThreadsRepo.updateLabels(accountId, thread.id, ['INBOX'], []); } catch { /* next sync repairs */ }
      SenderRulesRepo.forgetArchive(actionId);
      ActionLogRepo.save({ ...log, status: 'failed', completedAt: now().toISOString(), failureMessage: message });
      deps?.logError('Sender rule archive was rejected by Gmail and rolled back.', error, { accountId, threadId: thread.id });
      return thread;
    }
  },

  // --- Parked rule archives ------------------------------------------------------
  //
  // A rule archive that hit a retryable Gmail error waits as `pending_sync`.
  // Before it may reach Gmail (on replay, or when a sync sees the thread
  // again) it is checked against the current state with the same gate as on
  // arrival (`ruleFor`); one that no longer qualifies is dropped, never sent.

  /** Why a parked rule archive must not reach Gmail now; null while it still may. */
  parkedArchiveBlockReason(action: MailActionLog, current?: MailThread | null): string | null {
    const ruleId = senderRuleIdFromPayload(action.payloadJson);
    if (!ruleId) return 'The action has no sender-rule provenance.';
    if (!action.threadId) return 'The action has no thread.';
    const thread = current === undefined ? this.readThreadBeforeArchive(action.accountId, action.threadId) : current;
    if (!thread) return 'The conversation no longer exists.';
    const archive = SenderRulesRepo.getArchive(action.id);
    if (!archive || archive.origin !== 'senderRule') return 'The rule archive record is gone.';
    if (archive.broughtBackAt) return 'The conversation was brought back.';
    const settings = readSettings();
    const accountId = normalizeAccountId(action.accountId);
    const rule = getSenderRules(settings, accountId).find(candidate => candidate.id === ruleId);
    if (!rule) return 'The sender rule was deleted.';
    if (!rule.enabled) return 'The sender rule is switched off.';
    if (resolveAccountSetting(settings, accountId, 'agentAutonomy').value !== 'prepareAndRules') {
      return 'The account no longer lets the agent apply rules.';
    }
    // The authority: the arrival gate, judging the thread as it is now (its
    // signals include any message that arrived since) as if still in the inbox.
    const asInbox: MailThread = thread.labelIds.some(label => label.toUpperCase() === 'INBOX')
      ? thread
      : { ...thread, labelIds: [...thread.labelIds, 'INBOX'] };
    const match = this.ruleFor(asInbox, archive.archivedAt, settings);
    if (!match || match.id !== ruleId) {
      return 'The conversation no longer qualifies (a person, a protected notice or invitation, a correction, or bring-backs).';
    }
    return null;
  },

  /**
   * Ends a parked rule archive without sending it: the action is failed with
   * `reason`, optionally the local archive is undone and the "Handled for
   * you" record removed, and the renderer is told.
   */
  dropParkedArchive(action: MailActionLog, reason: string, options: { rollbackLocal: boolean; forgetRecord: boolean }) {
    try {
      const stored = ActionLogRepo.get(action.id) || action;
      if (stored.status === 'pending_sync' || stored.status === 'queued' || stored.status === 'running') {
        ActionLogRepo.save({ ...stored, status: 'failed', completedAt: now().toISOString(), failureMessage: `Sender rule archive not sent: ${reason}` });
      }
      if (options.rollbackLocal && action.threadId) ThreadsRepo.updateLabels(action.accountId, action.threadId, ['INBOX'], []);
      if (options.forgetRecord) SenderRulesRepo.forgetArchive(action.id);
    } catch (error) {
      deps?.logError('Could not drop a parked sender-rule archive.', error, { accountId: action.accountId, threadId: action.threadId });
    }
    safePublish({ accountId: normalizeAccountId(action.accountId) });
  },

  /**
   * The reconciler's replay gate for sender-rule actions (passed as part of
   * `validateAgentProposalReplay`). Throws when the parked archive must not
   * reach Gmail; the reconciler then fails it and puts INBOX back locally.
   */
  assertParkedArchiveReplayable(action: MailActionLog) {
    const reason = action.kind === 'markDone' ? this.parkedArchiveBlockReason(action) : 'Sender rules only archive.';
    if (reason) throw new Error(`Sender rule archive not sent: ${reason}`);
  },

  /**
   * The reconciler failed a rule archive permanently (rejected by the replay
   * gate or by Gmail) and rolled back its local change: remove it from
   * "Handled for you" and tell the renderer. Returns the thread as it is now
   * for the mailbox delta, or null when this is not a rule archive.
   */
  afterReplayRejected(action: MailActionLog): MailThread | null {
    if (!action.threadId || !isSenderRuleActionPayload(action.payloadJson)) return null;
    this.dropParkedArchive(action, action.failureMessage || 'Rejected.', { rollbackLocal: false, forgetRecord: true });
    return this.readThreadBeforeArchive(action.accountId, action.threadId);
  },

  /** Parked (not yet sent) rule archives of one thread. */
  parkedArchivesFor(accountId: string, threadId: string): MailActionLog[] {
    return ActionLogRepo.listOpenMutations(accountId).filter(action => (
      action.threadId === threadId
      && action.kind === 'markDone'
      && (action.status === 'pending_sync' || action.status === 'queued')
      && isSenderRuleActionPayload(action.payloadJson)
    ));
  },

  /**
   * A sync is about to persist these threads as Gmail has them (still in the
   * inbox, since the archive never reached Gmail). A parked rule archive
   * whose thread no longer qualifies (for example a new invitation or a
   * person's reply arrived) is dropped first, so the pending-label overlay no
   * longer hides the thread. Returns the ids of threads whose archive was dropped.
   */
  revalidateParkedArchives(accountId: string, threads: readonly MailThread[]): Set<string> {
    const dropped = new Set<string>();
    if (threads.length === 0) return dropped;
    let parked: MailActionLog[];
    try {
      const ids = new Set(threads.map(thread => thread.id));
      parked = ActionLogRepo.listOpenMutations(accountId).filter(action => (
        action.threadId && ids.has(action.threadId)
        && action.kind === 'markDone'
        && (action.status === 'pending_sync' || action.status === 'queued')
        && isSenderRuleActionPayload(action.payloadJson)
      ));
    } catch (error) {
      deps?.logError('Could not read parked sender-rule archives.', error, { accountId });
      return dropped;
    }
    for (const action of parked) {
      const fresh = threads.find(thread => thread.id === action.threadId) || null;
      const reason = this.parkedArchiveBlockReason(action, fresh);
      if (!reason) continue;
      this.dropParkedArchive(action, reason, { rollbackLocal: false, forgetRecord: true });
      dropped.add(action.threadId!);
    }
    return dropped;
  },

  /**
   * The user brought the thread back (Undo, restore, "Bring back"): no parked
   * rule archive of it may ever replay. The archive record stays so the
   * bring-back is counted against the rule.
   */
  cancelParkedArchivesOnRestore(accountId: string, threadId: string) {
    try {
      for (const action of this.parkedArchivesFor(accountId, threadId)) {
        this.dropParkedArchive(action, 'The conversation was brought back.', { rollbackLocal: false, forgetRecord: false });
      }
    } catch (error) {
      deps?.logError('Could not cancel parked sender-rule archives.', error, { accountId, threadId });
    }
  },

  /** A removed account: drop its arrivals waiting for the next persist. */
  forgetAccount(accountId: string) {
    const prefix = `${normalizeAccountId(accountId)}:`;
    for (const threadKey of Array.from(pendingArrivals.keys())) {
      if (threadKey.startsWith(prefix)) pendingArrivals.delete(threadKey);
    }
  },

  /** Number of arrivals waiting (test seam). */
  pendingArrivalCount(): number {
    return pendingArrivals.size;
  },

  /** Test seam. */
  resetForTests() {
    pendingArrivals.clear();
    deps = null;
  },
};
