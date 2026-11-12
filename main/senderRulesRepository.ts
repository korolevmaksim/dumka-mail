// Storage for sender-rule learning (design-review/SPEC.md §7):
//   sender_rule_stats    — confirmations / bring-backs / dismissal per sender
//   sender_rule_archives — one row per countable archive (a user's confirmation
//                          or a rule archive), so a bring-back can be matched
//                          to it and "Handled for you" can list rule archives.
// Rules themselves are settings (`accountOverrides[account].senderRules`).
// Every write is a few indexed rows; writes are guarded like the other
// interactive repositories (see sqliteWriteGuard.ts).
import { getDatabase } from './database';
import { guardRepositoryWrites } from './sqliteWriteGuard';
import { isUndoOfArchive, normalizeSenderEmail, SENDER_RULE_BRING_BACK_WINDOW_MS } from '../shared/senderRules';
import type { SenderRuleHandledItem, SenderRuleStats } from '../shared/types';

export type SenderRuleArchiveOrigin = 'user' | 'senderRule';

interface StatsRow {
  account_id: string;
  sender_email: string;
  sender_name: string;
  confirmations: number;
  bring_backs: number;
  last_confirmed_at: string | null;
  dismissed_at: string | null;
}

interface ArchiveRow {
  action_id: string;
  account_id: string;
  thread_id: string;
  sender_email: string;
  sender_name: string;
  subject: string;
  origin: SenderRuleArchiveOrigin;
  rule_id: string | null;
  archived_at: string;
  brought_back_at: string | null;
  reviewed_at: string | null;
}

export interface SenderRuleArchiveInput {
  actionId: string;
  accountId: string;
  threadId: string;
  senderEmail: string;
  senderName?: string | null;
  subject?: string | null;
  archivedAt: string;
}

export interface SenderRuleBringBack {
  accountId: string;
  threadId: string;
  senderEmail: string;
  senderName: string;
  origin: SenderRuleArchiveOrigin;
  ruleId: string | null;
}

function accountKey(accountId: string): string {
  return accountId.trim().toLowerCase();
}

function mapStats(row: StatsRow): SenderRuleStats {
  return {
    accountId: row.account_id,
    senderEmail: row.sender_email,
    senderName: row.sender_name || '',
    confirmations: Number(row.confirmations) || 0,
    bringBacks: Number(row.bring_backs) || 0,
    lastConfirmedAt: row.last_confirmed_at,
    dismissedAt: row.dismissed_at,
  };
}

function ensureStatsRow(accountId: string, senderEmail: string, senderName: string) {
  getDatabase().prepare(`
    INSERT INTO sender_rule_stats (account_id, sender_email, sender_name)
    VALUES (?, ?, ?)
    ON CONFLICT(account_id, sender_email) DO UPDATE SET
      sender_name = CASE WHEN excluded.sender_name != '' THEN excluded.sender_name ELSE sender_rule_stats.sender_name END
  `).run(accountId, senderEmail, senderName);
}

export const SenderRulesRepo = {
  listStats(accountId: string): SenderRuleStats[] {
    const rows = getDatabase()
      .prepare('SELECT * FROM sender_rule_stats WHERE account_id = ? ORDER BY confirmations DESC, sender_email ASC')
      .all(accountKey(accountId)) as StatsRow[];
    return rows.map(mapStats);
  },

  getStats(accountId: string, senderEmail: string): SenderRuleStats | null {
    const row = getDatabase()
      .prepare('SELECT * FROM sender_rule_stats WHERE account_id = ? AND sender_email = ?')
      .get(accountKey(accountId), normalizeSenderEmail(senderEmail)) as StatsRow | undefined;
    return row ? mapStats(row) : null;
  },

  /**
   * Counts one confirmation (`E` / `Clear` on a `clear` / `unsubscribe`
   * thread). Once per action id and once per thread: returns false when the
   * action or an earlier confirmation of the same thread is already stored.
   */
  recordConfirmation(input: SenderRuleArchiveInput): boolean {
    const db = getDatabase();
    const accountId = accountKey(input.accountId);
    const senderEmail = normalizeSenderEmail(input.senderEmail);
    if (!accountId || !senderEmail || !input.actionId || !input.threadId) return false;
    if (db.prepare('SELECT 1 FROM sender_rule_archives WHERE action_id = ?').get(input.actionId)) return false;
    const earlier = db.prepare(`
      SELECT 1 FROM sender_rule_archives WHERE account_id = ? AND thread_id = ? AND origin = 'user' LIMIT 1
    `).get(accountId, input.threadId);
    if (earlier) return false;
    const senderName = (input.senderName || '').trim();
    db.prepare(`
      INSERT INTO sender_rule_archives (action_id, account_id, thread_id, sender_email, sender_name, subject, origin, rule_id, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, 'user', NULL, ?)
    `).run(input.actionId, accountId, input.threadId, senderEmail, senderName, input.subject || '', input.archivedAt);
    ensureStatsRow(accountId, senderEmail, senderName);
    db.prepare(`
      UPDATE sender_rule_stats SET confirmations = confirmations + 1, last_confirmed_at = ?
      WHERE account_id = ? AND sender_email = ?
    `).run(input.archivedAt, accountId, senderEmail);
    return true;
  },

  /** A thread a rule archived on arrival. Not a confirmation. Idempotent per action id. */
  recordRuleArchive(input: SenderRuleArchiveInput & { ruleId: string }): boolean {
    const accountId = accountKey(input.accountId);
    const senderEmail = normalizeSenderEmail(input.senderEmail);
    if (!accountId || !senderEmail || !input.actionId || !input.threadId) return false;
    const result = getDatabase().prepare(`
      INSERT OR IGNORE INTO sender_rule_archives (action_id, account_id, thread_id, sender_email, sender_name, subject, origin, rule_id, archived_at)
      VALUES (?, ?, ?, ?, ?, ?, 'senderRule', ?, ?)
    `).run(input.actionId, accountId, input.threadId, senderEmail, (input.senderName || '').trim(), input.subject || '', input.ruleId, input.archivedAt);
    return result.changes > 0;
  },

  /** The archive record of one action (rule or user), or null. */
  getArchive(actionId: string): { origin: SenderRuleArchiveOrigin; ruleId: string | null; archivedAt: string; broughtBackAt: string | null } | null {
    const row = getDatabase().prepare('SELECT * FROM sender_rule_archives WHERE action_id = ?').get(actionId) as ArchiveRow | undefined;
    return row ? { origin: row.origin, ruleId: row.rule_id, archivedAt: row.archived_at, broughtBackAt: row.brought_back_at } : null;
  },

  /**
   * A rule archive that failed permanently and was rolled back is forgotten —
   * unless the user already brought that conversation back. A bring-back is
   * evidence against the rule (`wasBroughtBackFromRule`, `countBringBacksSince`)
   * and must survive any later cleanup of the action it belongs to.
   */
  forgetArchive(actionId: string) {
    getDatabase().prepare('DELETE FROM sender_rule_archives WHERE action_id = ? AND brought_back_at IS NULL').run(actionId);
  },

  /**
   * The thread came back to the inbox. Matches the newest archive of the
   * thread that is not brought back yet and is inside the window; counts one
   * bring-back on the sender. Null when nothing was counted.
   */
  recordBringBack(accountId: string, threadId: string, now: Date = new Date(), windowMs = SENDER_RULE_BRING_BACK_WINDOW_MS): SenderRuleBringBack | null {
    const db = getDatabase();
    const key = accountKey(accountId);
    const since = new Date(now.getTime() - windowMs).toISOString();
    const row = db.prepare(`
      SELECT * FROM sender_rule_archives
      WHERE account_id = ? AND thread_id = ? AND brought_back_at IS NULL AND archived_at >= ?
      ORDER BY archived_at DESC LIMIT 1
    `).get(key, threadId, since) as ArchiveRow | undefined;
    if (!row) return null;
    if (row.origin === 'user' && isUndoOfArchive(row.archived_at, now)) {
      // The toast's Undo: the archive never happened, so neither did its confirmation.
      db.prepare('DELETE FROM sender_rule_archives WHERE action_id = ?').run(row.action_id);
      db.prepare(`
        UPDATE sender_rule_stats SET confirmations = MAX(0, confirmations - 1)
        WHERE account_id = ? AND sender_email = ?
      `).run(key, row.sender_email);
      return null;
    }
    const nowIso = now.toISOString();
    db.prepare('UPDATE sender_rule_archives SET brought_back_at = ? WHERE action_id = ?').run(nowIso, row.action_id);
    ensureStatsRow(key, row.sender_email, row.sender_name);
    db.prepare('UPDATE sender_rule_stats SET bring_backs = bring_backs + 1 WHERE account_id = ? AND sender_email = ?')
      .run(key, row.sender_email);
    return {
      accountId: key,
      threadId: row.thread_id,
      senderEmail: row.sender_email,
      senderName: row.sender_name,
      origin: row.origin,
      ruleId: row.rule_id,
    };
  },

  /** Bring-backs of this sender's archives made since `sinceIso` (the rule's creation). */
  countBringBacksSince(accountId: string, senderEmail: string, sinceIso: string): number {
    const row = getDatabase().prepare(`
      SELECT COUNT(*) AS n FROM sender_rule_archives
      WHERE account_id = ? AND sender_email = ? AND brought_back_at IS NOT NULL AND brought_back_at >= ?
    `).get(accountKey(accountId), normalizeSenderEmail(senderEmail), sinceIso) as { n: number } | undefined;
    return Number(row?.n) || 0;
  },

  /** A rule archived this thread before and the user brought it back: the rule leaves it alone. */
  wasBroughtBackFromRule(accountId: string, threadId: string): boolean {
    return Boolean(getDatabase().prepare(`
      SELECT 1 FROM sender_rule_archives
      WHERE account_id = ? AND thread_id = ? AND origin = 'senderRule' AND brought_back_at IS NOT NULL LIMIT 1
    `).get(accountKey(accountId), threadId));
  },

  /** The thread has a manual section move (`V`); rules leave it alone. */
  hasUserCorrection(accountId: string, threadId: string): boolean {
    return Boolean(getDatabase().prepare(`
      SELECT 1 FROM thread_decisions WHERE account_id IN (?, ?) AND thread_id = ? AND source = 'user' LIMIT 1
    `).get(accountId, accountKey(accountId), threadId));
  },

  /** `Not now`: no further offers for this sender. */
  dismissOffer(accountId: string, senderEmail: string, now: Date = new Date()) {
    const key = accountKey(accountId);
    const sender = normalizeSenderEmail(senderEmail);
    if (!key || !sender) return;
    ensureStatsRow(key, sender, '');
    getDatabase().prepare('UPDATE sender_rule_stats SET dismissed_at = ? WHERE account_id = ? AND sender_email = ?')
      .run(now.toISOString(), key, sender);
  },

  /** Rule archives not brought back and not reviewed, newest first, one per thread. */
  listHandled(accountId: string, limit = 200): SenderRuleHandledItem[] {
    const rows = getDatabase().prepare(`
      SELECT * FROM sender_rule_archives
      WHERE account_id = ? AND origin = 'senderRule' AND brought_back_at IS NULL AND reviewed_at IS NULL
      ORDER BY archived_at DESC LIMIT ?
    `).all(accountKey(accountId), Math.max(1, Math.min(1000, limit))) as ArchiveRow[];
    const seen = new Set<string>();
    const items: SenderRuleHandledItem[] = [];
    for (const row of rows) {
      if (seen.has(row.thread_id)) continue;
      seen.add(row.thread_id);
      items.push({
        actionId: row.action_id,
        accountId: row.account_id,
        threadId: row.thread_id,
        senderEmail: row.sender_email,
        senderName: row.sender_name,
        subject: row.subject,
        ruleId: row.rule_id || '',
        handledAt: row.archived_at,
      });
    }
    return items;
  },

  /** `Mark reviewed` / collapsing the list: the current rule archives leave "Handled for you". */
  markHandledReviewed(accountId: string, now: Date = new Date()): number {
    return getDatabase().prepare(`
      UPDATE sender_rule_archives SET reviewed_at = ?
      WHERE account_id = ? AND origin = 'senderRule' AND reviewed_at IS NULL AND brought_back_at IS NULL AND archived_at <= ?
    `).run(now.toISOString(), accountKey(accountId), now.toISOString()).changes;
  },

  purgeAccount(accountId: string) {
    const db = getDatabase();
    const key = accountKey(accountId);
    db.prepare('DELETE FROM sender_rule_stats WHERE account_id = ?').run(key);
    db.prepare('DELETE FROM sender_rule_archives WHERE account_id = ?').run(key);
  },
};

guardRepositoryWrites(SenderRulesRepo, [
  'recordConfirmation',
  'recordRuleArchive',
  'forgetArchive',
  'recordBringBack',
  'dismissOffer',
  'markHandledReviewed',
  'purgeAccount',
], getDatabase);
