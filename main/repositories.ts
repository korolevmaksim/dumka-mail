import crypto from 'crypto';
import { getDatabase } from './database';
import {
  decodeStoredEmbeddingVector,
  decodeStoredEmbeddingVectorAsNumbers,
  encodeEmbeddingVector,
} from './embeddingVectorCodec';
import { isValidEmail } from '../shared/compose';
import {
  Account,
  CalendarEvent,
  ContactCard,
  ContactGroup,
  Draft,
  EmailAddressSuggestion,
  GoogleIntegrationStatus,
  MailActionLog,
  MailLabelDefinition,
  MailMessage,
  MailThread,
  Recipient,
  SyncState,
  AIConversation,
  AIChatMessage,
  DailyBriefing,
  MailboxSearchSource,
  AgentDraftSuggestion,
  FollowUpRadarListOptions,
  FollowUpRadarResult,
  FollowUpRadarState,
  OperatorHomeStateSnapshot,
  ReplyPipelineState,
  MessageSecurityInsight,
  SenderCleanupStat,
  CleanupSenderExclusion,
} from '../shared/types';
import { buildFollowUpRadarResult, normalizeFollowUpAgeWindow } from '../shared/followUpRadar';
import {
  normalizeOperatorHomeScopeId,
  normalizeOperatorHomeStateSnapshot,
} from '../shared/operatorHomeState';

const DEFAULT_EMAIL_SUGGESTION_LIMIT = 1000;
const MAX_EMAIL_SUGGESTION_LIMIT = 5000;

function sanitizeSuggestionLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_EMAIL_SUGGESTION_LIMIT;
  return Math.min(MAX_EMAIL_SUGGESTION_LIMIT, Math.max(1, Math.floor(limit)));
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonArray<T = any>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function parseJsonValue(value: string | null | undefined, fallback: unknown): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function suggestionMember(row: { display_name?: string | null; email?: string | null }): Recipient | null {
  const email = (row.email || '').trim();
  if (!isValidEmail(email)) return null;
  return { name: (row.display_name || '').trim(), email };
}

// === Accounts Repository ===
export const AccountsRepo = {
  list(): Account[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM accounts').all() as any[];
    return rows.map(r => {
      const emailHash = crypto.createHash('md5').update((r.email || '').trim().toLowerCase()).digest('hex');
      return {
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        colorHex: r.color_hex,
        createdAt: r.created_at,
        avatarUrl: r.avatar_url || `https://www.gravatar.com/avatar/${emailHash}?d=identicon`
      };
    });
  },

  get(id: string): Account | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as any;
    if (!row) return null;
    const emailHash = crypto.createHash('md5').update((row.email || '').trim().toLowerCase()).digest('hex');
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      colorHex: row.color_hex,
      createdAt: row.created_at,
      avatarUrl: row.avatar_url || `https://www.gravatar.com/avatar/${emailHash}?d=identicon`
    };
  },

  save(account: Account) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO accounts (id, email, display_name, color_hex, created_at, avatar_url)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        email=excluded.email,
        display_name=excluded.display_name,
        color_hex=excluded.color_hex,
        avatar_url=excluded.avatar_url
    `).run(account.id, account.email, account.displayName, account.colorHex, account.createdAt, account.avatarUrl || null);
  },

  delete(id: string, options: { purgeCache?: boolean } = {}) {
    const db = getDatabase();
    const purgeCache = options.purgeCache !== false;
    db.transaction(() => {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      if (!purgeCache) return;
      db.prepare('DELETE FROM threads WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM messages WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM labels WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM account_integrations WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM contacts WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM contact_groups WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM calendar_events WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM drafts WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM sync_state WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM thread_reminders WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM follow_up_radar_state WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM reply_pipeline_state WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM operator_home_state WHERE scope_id = ?').run(id.toLowerCase());
      db.prepare('DELETE FROM unsubscribed_senders WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM cleanup_sender_exclusions WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM ai_conversations WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM mail_action_log WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM mail_search WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM agent_drafts WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM message_security WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM mail_embeddings WHERE account_id = ?').run(id);
    })();
  }
};

// === Account Integrations Repository ===
export const AccountIntegrationsRepo = {
  get(accountId: string): GoogleIntegrationStatus {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM account_integrations WHERE account_id = ?').get(accountId) as any;
    if (!row) {
      return {
        accountId,
        gmailEnabled: true,
        calendarEnabled: false,
        contactsEnabled: false,
        updatedAt: new Date().toISOString()
      };
    }
    return {
      accountId: row.account_id,
      gmailEnabled: row.gmail_enabled === 1,
      calendarEnabled: row.calendar_enabled === 1,
      contactsEnabled: row.contacts_enabled === 1,
      updatedAt: row.updated_at
    };
  },

  save(status: GoogleIntegrationStatus) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO account_integrations (account_id, gmail_enabled, calendar_enabled, contacts_enabled, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        gmail_enabled=excluded.gmail_enabled,
        calendar_enabled=excluded.calendar_enabled,
        contacts_enabled=excluded.contacts_enabled,
        updated_at=excluded.updated_at
    `).run(
      status.accountId,
      status.gmailEnabled ? 1 : 0,
      status.calendarEnabled ? 1 : 0,
      status.contactsEnabled ? 1 : 0,
      status.updatedAt
    );
  },

  patch(accountId: string, patch: Partial<Omit<GoogleIntegrationStatus, 'accountId' | 'updatedAt'>>) {
    const current = this.get(accountId);
    this.save({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    });
  }
};

// === Labels Repository ===
export const LabelsRepo = {
  list(accountId: string): MailLabelDefinition[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM labels WHERE account_id = ? ORDER BY type ASC, name COLLATE NOCASE ASC').all(accountId) as any[];
    return rows.map(row => ({
      id: row.id,
      accountId: row.account_id,
      name: row.name,
      type: row.type === 'system' ? 'system' : 'user',
      colorHex: row.color_hex,
      textColorHex: row.text_color_hex,
      messageListVisibility: row.message_list_visibility,
      labelListVisibility: row.label_list_visibility
    }));
  },

  saveMany(labels: MailLabelDefinition[]) {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO labels (
        id, account_id, name, type, color_hex, text_color_hex, message_list_visibility, label_list_visibility
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET
        name=excluded.name,
        type=excluded.type,
        color_hex=excluded.color_hex,
        text_color_hex=excluded.text_color_hex,
        message_list_visibility=excluded.message_list_visibility,
        label_list_visibility=excluded.label_list_visibility
    `);

    db.transaction(() => {
      for (const label of labels) {
        insert.run(
          label.id,
          label.accountId,
          label.name,
          label.type,
          label.colorHex || null,
          label.textColorHex || null,
          label.messageListVisibility || null,
          label.labelListVisibility || null
        );
      }
    })();
  },

  delete(accountId: string, id: string) {
    const db = getDatabase();
    db.prepare('DELETE FROM labels WHERE account_id = ? AND id = ?').run(accountId, id);
  }
};

function mapThreadRow(r: any): MailThread {
  return {
    id: r.id,
    accountId: r.account_id,
    subject: r.subject,
    snippet: r.snippet,
    lastMessageAt: r.last_message_at,
    senderNames: JSON.parse(r.sender_names_json),
    senderEmail: r.sender_email,
    labelIds: JSON.parse(r.label_ids_json),
    hasAttachments: r.has_attachments === 1,
    isUnread: r.is_unread === 1,
    reminderAt: r.reminder_at
  };
}

// === Threads Repository ===
export const ThreadsRepo = {
  list(accountId: string): MailThread[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT t.*, r.reminder_at 
      FROM threads t
      LEFT JOIN thread_reminders r ON t.account_id = r.account_id AND t.id = r.thread_id
      WHERE t.account_id = ?
      ORDER BY t.last_message_at DESC
    `).all(accountId) as any[];

    return rows.map(mapThreadRow);
  },

  listMany(accountIds: string[]): MailThread[] {
    const ids = Array.from(new Set(accountIds.map(id => id.trim()).filter(Boolean)));
    if (ids.length === 0) return [];

    const db = getDatabase();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT t.*, r.reminder_at
      FROM threads t
      LEFT JOIN thread_reminders r ON t.account_id = r.account_id AND t.id = r.thread_id
      WHERE t.account_id IN (${placeholders})
      ORDER BY t.last_message_at DESC
    `).all(...ids) as any[];

    return rows.map(mapThreadRow);
  },

  listRecentInbox(accountId: string, limit = 8): MailThread[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT t.*, r.reminder_at
      FROM threads t
      LEFT JOIN thread_reminders r ON t.account_id = r.account_id AND t.id = r.thread_id
      WHERE t.account_id = ?
        AND instr(upper(t.label_ids_json), '"INBOX"') > 0
      ORDER BY t.last_message_at DESC
      LIMIT ?
    `).all(accountId, Math.max(1, Math.min(100, limit))) as any[];

    return rows.map(mapThreadRow);
  },

  get(accountId: string, threadId: string): MailThread | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT t.*, r.reminder_at
      FROM threads t
      LEFT JOIN thread_reminders r ON t.account_id = r.account_id AND t.id = r.thread_id
      WHERE t.account_id = ? AND t.id = ?
    `).get(accountId, threadId) as any;

    return row ? mapThreadRow(row) : null;
  },

  save(threads: MailThread[]) {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO threads (
        id, account_id, subject, snippet, last_message_at,
        sender_names_json, sender_email, label_ids_json, has_attachments, is_unread
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET
        subject=excluded.subject,
        snippet=excluded.snippet,
        last_message_at=excluded.last_message_at,
        sender_names_json=excluded.sender_names_json,
        sender_email=excluded.sender_email,
        label_ids_json=excluded.label_ids_json,
        has_attachments=excluded.has_attachments,
        is_unread=excluded.is_unread
    `);

    db.transaction(() => {
      for (const t of threads) {
        insert.run(
          t.id,
          t.accountId,
          t.subject,
          t.snippet,
          t.lastMessageAt,
          JSON.stringify(t.senderNames),
          t.senderEmail,
          JSON.stringify(t.labelIds),
          t.hasAttachments ? 1 : 0,
          t.isUnread ? 1 : 0
        );
      }
    })();
  },

  delete(accountId: string, threadId: string) {
    const db = getDatabase();
    db.transaction(() => {
      db.prepare('DELETE FROM threads WHERE account_id = ? AND id = ?').run(accountId, threadId);
      db.prepare('DELETE FROM messages WHERE account_id = ? AND thread_id = ?').run(accountId, threadId);
      db.prepare('DELETE FROM thread_reminders WHERE account_id = ? AND thread_id = ?').run(accountId, threadId);
      db.prepare('DELETE FROM follow_up_radar_state WHERE account_id = ? AND thread_id = ?').run(accountId, threadId);
      db.prepare('DELETE FROM reply_pipeline_state WHERE account_id = ? AND thread_id = ?').run(accountId, threadId);
      db.prepare('DELETE FROM mail_search WHERE account_id = ? AND thread_id = ?').run(accountId, threadId);
      db.prepare('DELETE FROM agent_drafts WHERE account_id = ? AND thread_id = ?').run(accountId, threadId);
      db.prepare('DELETE FROM message_security WHERE account_id = ? AND thread_id = ?').run(accountId, threadId);
      db.prepare('DELETE FROM mail_embeddings WHERE account_id = ? AND thread_id = ?').run(accountId, threadId);
    })();
  },

  updateLabels(accountId: string, threadId: string, addLabelIds: string[], removeLabelIds: string[]) {
    const db = getDatabase();
    db.transaction(() => {
      const row = db.prepare('SELECT label_ids_json FROM threads WHERE account_id = ? AND id = ?').get(accountId, threadId) as any;
      if (row) {
        let labels: string[] = JSON.parse(row.label_ids_json);
        for (const l of addLabelIds) {
          if (!labels.includes(l)) labels.push(l);
        }
        labels = labels.filter(l => !removeLabelIds.includes(l));
        db.prepare('UPDATE threads SET label_ids_json = ? WHERE account_id = ? AND id = ?')
          .run(JSON.stringify(labels), accountId, threadId);
      }

      const messageRows = db.prepare('SELECT id, label_ids_json FROM messages WHERE account_id = ? AND thread_id = ?').all(accountId, threadId) as any[];
      const updateMessage = db.prepare('UPDATE messages SET label_ids_json = ?, is_unread = ? WHERE account_id = ? AND id = ?');
      for (const messageRow of messageRows) {
        let labels: string[] = JSON.parse(messageRow.label_ids_json);
        for (const label of addLabelIds) {
          if (!labels.includes(label)) labels.push(label);
        }
        labels = labels.filter(label => !removeLabelIds.includes(label));
        updateMessage.run(JSON.stringify(labels), labels.includes('UNREAD') ? 1 : 0, accountId, messageRow.id);
      }
    })();
  }
};

function mapMessageRow(r: any): MailMessage {
  return {
    id: r.id,
    threadId: r.thread_id,
    accountId: r.account_id,
    senderName: r.sender_name,
    senderEmail: r.sender_email,
    subject: r.subject,
    snippet: r.snippet,
    receivedAt: r.received_at,
    labelIds: JSON.parse(r.label_ids_json),
    hasAttachments: r.has_attachments === 1,
    isUnread: r.is_unread === 1,
    to: JSON.parse(r.to_recipients_json),
    cc: JSON.parse(r.cc_recipients_json),
    bcc: JSON.parse(r.bcc_recipients_json),
    bodyHtml: r.body_html,
    bodyPlain: r.body_plain,
    attachments: JSON.parse(r.attachments_json),
    headers: JSON.parse(r.headers_json || '[]'),
    rfcMessageId: r.rfc_message_id,
    rfcReferences: r.rfc_references,
    rfcInReplyTo: r.rfc_in_reply_to
  };
}

function mapMessageMetadataRow(r: any): MailMessage {
  return {
    id: r.id,
    threadId: r.thread_id,
    accountId: r.account_id,
    senderName: r.sender_name,
    senderEmail: r.sender_email,
    subject: r.subject,
    snippet: r.snippet,
    receivedAt: r.received_at,
    labelIds: JSON.parse(r.label_ids_json),
    hasAttachments: r.has_attachments === 1,
    isUnread: r.is_unread === 1,
    to: JSON.parse(r.to_recipients_json),
    cc: JSON.parse(r.cc_recipients_json),
    bcc: JSON.parse(r.bcc_recipients_json),
    bodyHtml: null,
    bodyPlain: null,
    attachments: [],
    headers: JSON.parse(r.headers_json || '[]'),
    rfcMessageId: r.rfc_message_id,
    rfcReferences: r.rfc_references,
    rfcInReplyTo: r.rfc_in_reply_to
  };
}

// === Messages Repository ===
export const MessagesRepo = {
  listForThread(accountId: string, threadId: string): MailMessage[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE account_id = ? AND thread_id = ?
      ORDER BY received_at ASC
    `).all(accountId, threadId) as any[];

    return rows.map(mapMessageRow);
  },

  listMetadataForThreads(accountId: string, threadIds: string[]): Map<string, MailMessage[]> {
    const uniqueThreadIds = Array.from(new Set(threadIds.filter(Boolean)));
    const messagesByThread = new Map<string, MailMessage[]>();
    if (uniqueThreadIds.length === 0) return messagesByThread;

    const db = getDatabase();
    const placeholders = uniqueThreadIds.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT
        id, thread_id, account_id, sender_name, sender_email, subject, snippet, received_at,
        label_ids_json, has_attachments, is_unread, to_recipients_json, cc_recipients_json,
        bcc_recipients_json, headers_json, rfc_message_id, rfc_references, rfc_in_reply_to
      FROM messages
      WHERE account_id = ? AND thread_id IN (${placeholders})
      ORDER BY thread_id ASC, received_at ASC
    `).all(accountId, ...uniqueThreadIds) as any[];

    for (const message of rows.map(mapMessageMetadataRow)) {
      const list = messagesByThread.get(message.threadId) || [];
      list.push(message);
      messagesByThread.set(message.threadId, list);
    }
    return messagesByThread;
  },

  save(messages: MailMessage[], options: { indexBodies?: boolean } = {}) {
    const db = getDatabase();
    const indexBodies = options.indexBodies !== false;
    const insertMsg = db.prepare(`
      INSERT INTO messages (
        id, thread_id, account_id, sender_name, sender_email, subject, snippet, received_at,
        label_ids_json, has_attachments, is_unread, to_recipients_json, cc_recipients_json, bcc_recipients_json,
        body_html, body_plain, attachments_json, headers_json, rfc_message_id, rfc_references, rfc_in_reply_to
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET
        sender_name=excluded.sender_name,
        sender_email=excluded.sender_email,
        subject=excluded.subject,
        snippet=excluded.snippet,
        received_at=excluded.received_at,
        label_ids_json=excluded.label_ids_json,
        has_attachments=excluded.has_attachments,
        is_unread=excluded.is_unread,
        to_recipients_json=excluded.to_recipients_json,
        cc_recipients_json=excluded.cc_recipients_json,
        bcc_recipients_json=excluded.bcc_recipients_json,
        body_html=excluded.body_html,
        body_plain=excluded.body_plain,
        attachments_json=excluded.attachments_json,
        headers_json=excluded.headers_json,
        rfc_message_id=excluded.rfc_message_id,
        rfc_references=excluded.rfc_references,
        rfc_in_reply_to=excluded.rfc_in_reply_to
    `);

    const insertSearch = db.prepare(`
      INSERT INTO mail_search (account_id, thread_id, message_id, subject, sender, snippet, body_plain)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteSearch = db.prepare('DELETE FROM mail_search WHERE account_id = ? AND message_id = ?');

    db.transaction(() => {
      for (const m of messages) {
        insertMsg.run(
          m.id,
          m.threadId,
          m.accountId,
          m.senderName,
          m.senderEmail,
          m.subject,
          m.snippet,
          m.receivedAt,
          JSON.stringify(m.labelIds),
          m.hasAttachments ? 1 : 0,
          m.isUnread ? 1 : 0,
          JSON.stringify(m.to),
          JSON.stringify(m.cc),
          JSON.stringify(m.bcc),
          m.bodyHtml || null,
          m.bodyPlain || null,
          JSON.stringify(m.attachments),
          JSON.stringify(m.headers || []),
          m.rfcMessageId || null,
          m.rfcReferences || null,
          m.rfcInReplyTo || null
        );

        // Update search FTS index: delete old index entry and insert new
        deleteSearch.run(m.accountId, m.id);
        insertSearch.run(
          m.accountId,
          m.threadId,
          m.id,
          m.subject,
          `${m.senderName} <${m.senderEmail}>`,
          m.snippet,
          indexBodies ? (m.bodyPlain || '') : ''
        );
      }
    })();
  },

  listRecent(accountId: string, limit = 100): MailMessage[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE account_id = ?
      ORDER BY received_at DESC
      LIMIT ?
    `).all(accountId, Math.max(1, Math.min(1000, limit))) as any[];
    return rows.map(mapMessageRow);
  },

  listForEmbedding(accountId: string, limit = 100000): MailMessage[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE account_id = ?
      ORDER BY received_at DESC
      LIMIT ?
    `).all(accountId, Math.max(1, Math.min(200000, limit))) as any[];
    return rows.map(mapMessageRow);
  },

  listForEmbeddingPage(accountId: string, limit = 500, offset = 0): MailMessage[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE account_id = ?
      ORDER BY received_at DESC
      LIMIT ? OFFSET ?
    `).all(
      accountId,
      Math.max(1, Math.min(2000, limit)),
      Math.max(0, offset)
    ) as any[];
    return rows.map(mapMessageRow);
  },

  countForEmbedding(accountId: string, limit = 100000): number {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM messages
      WHERE account_id = ?
    `).get(accountId) as { count: number } | undefined;
    return Math.min(Number(row?.count || 0), Math.max(1, Math.min(200000, limit)));
  },

  listRecentBySender(accountId: string, senderEmail: string, beforeReceivedAt: string, limit = 8): MailMessage[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE account_id = ?
        AND sender_email = ? COLLATE NOCASE
        AND received_at < ?
      ORDER BY received_at DESC
      LIMIT ?
    `).all(accountId, senderEmail, beforeReceivedAt, Math.max(1, Math.min(1000, limit))) as any[];
    return rows.reverse().map(mapMessageRow);
  },

  listLatestBySender(accountId: string, senderEmail: string, limit = 3): MailMessage[] {
    const normalizedAccountId = accountId.trim();
    const normalized = senderEmail.trim().toLowerCase();
    if (!normalizedAccountId || !normalized) return [];
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE account_id = ?
        AND sender_email = ? COLLATE NOCASE
      ORDER BY received_at DESC
      LIMIT ?
    `).all(normalizedAccountId, normalized, Math.max(1, Math.min(10, limit))) as any[];
    return rows.map(mapMessageRow);
  },

  senderCleanupStats(accountId: string): SenderCleanupStat[] {
    const db = getDatabase();
    // NOTE: attachment bytes MUST stay a pre-aggregated json_each JOIN.
    // A correlated per-sender subquery measured 35.9 s vs 0.6 s for this form.
    // Only return senders the user can act on (unsubscribe header and/or
    // archiveable old INBOX threads). Volume-only noise is filtered out.
    //
    // Previously unsubscribed senders stay hidden until post-grace mail reaches
    // UNSUBSCRIBE_RESURFACE_MIN_MESSAGES (shared/cleanup.ts: 7-day grace, 2 msgs).
    // The +7 in julianday() MUST match UNSUBSCRIBE_GRACE_PERIOD_DAYS.
    const rows = db.prepare(`
      WITH sender_stats AS (
        SELECT
          account_id,
          lower(sender_email) AS sender_key,
          MAX(sender_name) AS sender_name,
          COUNT(DISTINCT thread_id) AS thread_count,
          COUNT(*) AS message_count,
          SUM(is_unread) AS unread_count,
          MAX(received_at) AS last_received_at,
          SUM(CASE WHEN received_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days') THEN 1 ELSE 0 END) AS recent_30d,
          MAX(CASE WHEN headers_json LIKE '%list-unsubscribe%' THEN 1 ELSE 0 END) AS has_unsubscribe
        FROM messages
        WHERE account_id = @accountId
        GROUP BY account_id, sender_key
      ),
      archiveable AS (
        SELECT
          account_id,
          lower(sender_email) AS sender_key,
          COUNT(*) AS archiveable_old_count
        FROM threads
        WHERE account_id = @accountId
          AND last_message_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
          AND instr(upper(label_ids_json), '"INBOX"') > 0
        GROUP BY account_id, sender_key
      ),
      att_bytes AS (
        SELECT
          m.account_id,
          lower(m.sender_email) AS sender_key,
          SUM(COALESCE(json_extract(att.value, '$.sizeBytes'), 0)) AS attachment_bytes
        FROM messages m,
          json_each(CASE WHEN json_valid(m.attachments_json) THEN m.attachments_json ELSE '[]' END) att
        WHERE m.account_id = @accountId AND m.has_attachments = 1
        GROUP BY m.account_id, sender_key
      ),
      security AS (
        SELECT
          m.account_id,
          lower(m.sender_email) AS sender_key,
          SUM(s.tracker_count) AS tracker_count,
          MAX(CASE s.risk_level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) AS max_risk_rank
        FROM messages m
        JOIN message_security s ON s.account_id = m.account_id AND s.message_id = m.id
        WHERE m.account_id = @accountId
        GROUP BY m.account_id, sender_key
      ),
      post_unsubscribe AS (
        SELECT
          us.account_id,
          us.sender_email AS sender_key,
          COUNT(m.id) AS post_grace_count
        FROM unsubscribed_senders us
        LEFT JOIN messages m
          ON m.account_id = us.account_id
         AND lower(m.sender_email) = us.sender_email
         AND julianday(m.received_at) > julianday(us.unsubscribed_at) + 7.0
        WHERE us.account_id = @accountId
        GROUP BY us.account_id, us.sender_email
      )
      SELECT
        st.account_id,
        st.sender_key,
        st.sender_name,
        st.thread_count,
        st.message_count,
        st.unread_count,
        st.last_received_at,
        st.recent_30d,
        st.has_unsubscribe,
        COALESCE(arc.archiveable_old_count, 0) AS archiveable_old_count,
        COALESCE(sec.tracker_count, 0) AS tracker_count,
        COALESCE(sec.max_risk_rank, 0) AS max_risk_rank,
        COALESCE(ab.attachment_bytes, 0) AS attachment_bytes,
        CASE WHEN us.sender_email IS NOT NULL THEN 1 ELSE 0 END AS previously_unsubscribed,
        COALESCE(pu.post_grace_count, 0) AS post_grace_count
      FROM sender_stats st
      LEFT JOIN archiveable arc ON arc.account_id = st.account_id AND arc.sender_key = st.sender_key
      LEFT JOIN att_bytes ab ON ab.account_id = st.account_id AND ab.sender_key = st.sender_key
      LEFT JOIN security sec ON sec.account_id = st.account_id AND sec.sender_key = st.sender_key
      LEFT JOIN unsubscribed_senders us
        ON us.account_id = st.account_id AND us.sender_email = st.sender_key
      LEFT JOIN post_unsubscribe pu
        ON pu.account_id = st.account_id AND pu.sender_key = st.sender_key
      WHERE (st.has_unsubscribe = 1
         OR COALESCE(arc.archiveable_old_count, 0) > 0)
        AND NOT EXISTS (
          SELECT 1
          FROM cleanup_sender_exclusions ce
          WHERE ce.account_id = st.account_id
            AND ce.sender_email = st.sender_key
        )
        AND (
          us.sender_email IS NULL
          OR COALESCE(pu.post_grace_count, 0) >= 2
        )
      ORDER BY
        CASE WHEN us.sender_email IS NOT NULL THEN 1 ELSE 0 END DESC,
        CASE WHEN st.has_unsubscribe = 1 THEN 1 ELSE 0 END DESC,
        COALESCE(arc.archiveable_old_count, 0) DESC,
        st.recent_30d DESC,
        st.message_count DESC
      LIMIT 200
    `).all({ accountId }) as any[];

    const riskForRank: Record<number, SenderCleanupStat['maxRiskLevel']> = {
      3: 'high',
      2: 'medium',
      1: 'low',
      0: null,
    };

    return rows.map(r => ({
      accountId: r.account_id,
      senderEmail: r.sender_key,
      senderName: r.sender_name || r.sender_key,
      threadCount: r.thread_count,
      messageCount: r.message_count,
      unreadCount: r.unread_count || 0,
      lastReceivedAt: r.last_received_at,
      recent30dCount: r.recent_30d || 0,
      hasUnsubscribeHeader: r.has_unsubscribe === 1,
      archiveableOldCount: r.archiveable_old_count || 0,
      trackerCount: r.tracker_count || 0,
      maxRiskLevel: riskForRank[r.max_risk_rank as number] ?? null,
      attachmentBytes: r.attachment_bytes || 0,
      previouslyUnsubscribed: r.previously_unsubscribed === 1,
      postUnsubscribeMessageCount: r.post_grace_count || 0,
    }));
  }
};

// === Email Suggestions Repository ===
export const EmailSuggestionsRepo = {
  list(accountId?: string, limit?: number): EmailAddressSuggestion[] {
    const db = getDatabase();
    const normalizedAccountId = accountId?.trim();
    const scopedWhere = normalizedAccountId ? 'WHERE m.account_id = @accountId' : '';
    const contactsWhere = normalizedAccountId ? 'WHERE account_id = @accountId' : '';
    const safeLimit = sanitizeSuggestionLimit(limit);
    const sqlLimit = Math.min(MAX_EMAIL_SUGGESTION_LIMIT * 2, safeLimit * 3);
    const historyRows = db.prepare(`
      WITH contact_rows(name, email, received_at) AS (
        SELECT m.sender_name, m.sender_email, m.received_at
        FROM messages AS m
        ${scopedWhere}

        UNION ALL

        SELECT json_extract(recipient.value, '$.name'), json_extract(recipient.value, '$.email'), m.received_at
        FROM messages AS m,
          json_each(CASE WHEN json_valid(m.to_recipients_json) THEN m.to_recipients_json ELSE '[]' END) AS recipient
        ${scopedWhere}

        UNION ALL

        SELECT json_extract(recipient.value, '$.name'), json_extract(recipient.value, '$.email'), m.received_at
        FROM messages AS m,
          json_each(CASE WHEN json_valid(m.cc_recipients_json) THEN m.cc_recipients_json ELSE '[]' END) AS recipient
        ${scopedWhere}

        UNION ALL

        SELECT json_extract(recipient.value, '$.name'), json_extract(recipient.value, '$.email'), m.received_at
        FROM messages AS m,
          json_each(CASE WHEN json_valid(m.bcc_recipients_json) THEN m.bcc_recipients_json ELSE '[]' END) AS recipient
        ${scopedWhere}
      ),
      normalized AS (
        SELECT
          lower(trim(email)) AS key,
          trim(email) AS email,
          trim(coalesce(name, '')) AS name,
          received_at
        FROM contact_rows
        WHERE email IS NOT NULL AND trim(email) <> ''
      ),
      ranked AS (
        SELECT
          key,
          email,
          name,
          COUNT(*) OVER (PARTITION BY key) AS source_count,
          MAX(received_at) OVER (PARTITION BY key) AS last_message_at,
          ROW_NUMBER() OVER (
            PARTITION BY key
            ORDER BY CASE WHEN name <> '' THEN 0 ELSE 1 END, received_at DESC, email COLLATE NOCASE ASC
          ) AS rank
        FROM normalized
      )
      SELECT name, email, source_count, last_message_at
      FROM ranked
      WHERE rank = 1
      ORDER BY last_message_at DESC, source_count DESC, email COLLATE NOCASE ASC
      LIMIT @limit
    `).all({ accountId: normalizedAccountId, limit: sqlLimit }) as {
      name: string | null;
      email: string | null;
      source_count: number;
      last_message_at: string | null;
    }[];

    const contactRows = db.prepare(`
      SELECT COALESCE(NULLIF(local_display_name, ''), display_name) AS display_name, email, updated_at
      FROM contacts
      ${contactsWhere}
      ORDER BY COALESCE(NULLIF(local_display_name, ''), display_name) COLLATE NOCASE ASC, email COLLATE NOCASE ASC
      LIMIT @limit
    `).all({ accountId: normalizedAccountId, limit: sqlLimit }) as {
      display_name: string | null;
      email: string | null;
      updated_at: string | null;
    }[];

    const groupRows = db.prepare(`
      SELECT id, account_id, name, member_count, updated_at
      FROM contact_groups
      ${contactsWhere}
      ORDER BY name COLLATE NOCASE ASC
      LIMIT @limit
    `).all({ accountId: normalizedAccountId, limit: sqlLimit }) as {
      id: string;
      account_id: string;
      name: string;
      member_count: number;
      updated_at: string | null;
    }[];

    const groupedContactRows = db.prepare(`
      SELECT account_id, COALESCE(NULLIF(local_display_name, ''), display_name) AS display_name, email, group_ids_json
      FROM contacts
      ${contactsWhere}
      ORDER BY COALESCE(NULLIF(local_display_name, ''), display_name) COLLATE NOCASE ASC, email COLLATE NOCASE ASC
      LIMIT @limit
    `).all({ accountId: normalizedAccountId, limit: MAX_EMAIL_SUGGESTION_LIMIT }) as {
      account_id: string;
      display_name: string | null;
      email: string | null;
      group_ids_json: string | null;
    }[];

    const membersByGroupId = new Map<string, Recipient[]>();
    for (const row of groupedContactRows) {
      const member = suggestionMember(row);
      if (!member) continue;
      for (const groupId of parseStringArray(row.group_ids_json)) {
        const key = `${row.account_id}:${groupId}`;
        const members = membersByGroupId.get(key) || [];
        members.push(member);
        membersByGroupId.set(key, members);
      }
    }

    const groupSuggestions: EmailAddressSuggestion[] = groupRows
      .flatMap((group): EmailAddressSuggestion[] => {
        const members = membersByGroupId.get(`${group.account_id}:${group.id}`) || [];
        if (members.length === 0) return [];
        return [{
          name: group.name,
          email: `group:${group.id}`,
          sourceCount: members.length,
          lastMessageAt: group.updated_at,
          kind: 'group' as const,
          groupId: group.id,
          members,
          subtitle: `${members.length} contacts`
        }];
      });

    const contactSuggestions: EmailAddressSuggestion[] = contactRows
      .map(row => ({
        name: (row.display_name || '').trim(),
        email: (row.email || '').trim(),
        sourceCount: 1,
        lastMessageAt: row.updated_at,
        kind: 'contact' as const,
        subtitle: 'Google Contacts'
      }))
      .filter(suggestion => isValidEmail(suggestion.email));

    const historySuggestions: EmailAddressSuggestion[] = historyRows
      .map(row => ({
        name: (row.name || '').trim(),
        email: (row.email || '').trim(),
        sourceCount: row.source_count,
        lastMessageAt: row.last_message_at,
        kind: 'address' as const
      }))
      .filter(suggestion => isValidEmail(suggestion.email));

    return [...groupSuggestions, ...contactSuggestions, ...historySuggestions].slice(0, safeLimit);
  }
};

// === Contacts Repository ===
export const ContactsRepo = {
  list(accountId: string, query?: string): ContactCard[] {
    const db = getDatabase();
    const trimmedQuery = (query || '').trim().toLowerCase();
    const rows = db.prepare(`
      SELECT * FROM contacts
      WHERE account_id = ?
      ORDER BY COALESCE(NULLIF(local_display_name, ''), display_name) COLLATE NOCASE ASC, email COLLATE NOCASE ASC
      LIMIT 2000
    `).all(accountId) as any[];

    const contacts = rows.map(row => ({
      id: row.id,
      accountId: row.account_id,
      resourceName: row.resource_name,
      etag: row.etag,
      displayName: row.local_display_name || row.display_name,
      email: row.email,
      photoUrl: row.photo_url,
      phoneNumbers: row.local_phone_numbers_json ? parseStringArray(row.local_phone_numbers_json) : parseStringArray(row.phone_numbers_json),
      organizations: row.local_organizations_json ? parseStringArray(row.local_organizations_json) : parseStringArray(row.organizations_json),
      notes: row.notes,
      groupIds: JSON.parse(row.group_ids_json),
      updatedAt: row.updated_at
    }));

    if (!trimmedQuery) return contacts;
    return contacts.filter(contact => {
      const haystack = [
        contact.displayName,
        contact.email,
        contact.phoneNumbers.join(' '),
        contact.organizations.join(' '),
        contact.notes || ''
      ].join(' ').toLowerCase();
      return haystack.includes(trimmedQuery);
    });
  },

  saveMany(contacts: ContactCard[]) {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO contacts (
        id, account_id, resource_name, etag, display_name, local_display_name, email, photo_url,
        phone_numbers_json, local_phone_numbers_json, organizations_json, local_organizations_json, notes, group_ids_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET
        resource_name=excluded.resource_name,
        etag=excluded.etag,
        display_name=excluded.display_name,
        email=excluded.email,
        photo_url=excluded.photo_url,
        phone_numbers_json=excluded.phone_numbers_json,
        organizations_json=excluded.organizations_json,
        updated_at=excluded.updated_at
    `);

    db.transaction(() => {
      for (const contact of contacts) {
        const existing = db.prepare('SELECT local_display_name, local_phone_numbers_json, local_organizations_json, notes, group_ids_json FROM contacts WHERE account_id = ? AND id = ?')
          .get(contact.accountId, contact.id) as any;
        insert.run(
          contact.id,
          contact.accountId,
          contact.resourceName || null,
          contact.etag || null,
          contact.displayName,
          existing?.local_display_name ?? null,
          contact.email,
          contact.photoUrl || null,
          JSON.stringify(contact.phoneNumbers),
          existing?.local_phone_numbers_json ?? null,
          JSON.stringify(contact.organizations),
          existing?.local_organizations_json ?? null,
          existing?.notes ?? contact.notes ?? null,
          existing?.group_ids_json ?? JSON.stringify(contact.groupIds),
          contact.updatedAt
        );
      }
    })();
  },

  updateLocal(accountId: string, id: string, patch: Pick<Partial<ContactCard>, 'notes' | 'groupIds' | 'displayName' | 'phoneNumbers' | 'organizations'>) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM contacts WHERE account_id = ? AND id = ?').get(accountId, id) as any;
    if (!row) return;
    const nextLocalDisplayName = patch.displayName === undefined
      ? row.local_display_name
      : (patch.displayName.trim() === row.display_name ? null : patch.displayName.trim());
    const nextLocalPhoneNumbers = patch.phoneNumbers === undefined
      ? row.local_phone_numbers_json
      : (JSON.stringify(patch.phoneNumbers) === row.phone_numbers_json ? null : JSON.stringify(patch.phoneNumbers));
    const nextLocalOrganizations = patch.organizations === undefined
      ? row.local_organizations_json
      : (JSON.stringify(patch.organizations) === row.organizations_json ? null : JSON.stringify(patch.organizations));
    db.prepare(`
      UPDATE contacts
      SET local_display_name = ?, local_phone_numbers_json = ?, local_organizations_json = ?, notes = ?, group_ids_json = ?, updated_at = ?
      WHERE account_id = ? AND id = ?
    `).run(
      nextLocalDisplayName,
      nextLocalPhoneNumbers,
      nextLocalOrganizations,
      patch.notes ?? row.notes,
      patch.groupIds ? JSON.stringify(patch.groupIds) : row.group_ids_json,
      new Date().toISOString(),
      accountId,
      id
    );
  }
};

export const ContactGroupsRepo = {
  list(accountId: string): ContactGroup[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM contact_groups WHERE account_id = ? ORDER BY name COLLATE NOCASE ASC').all(accountId) as any[];
    return rows.map(row => ({
      id: row.id,
      accountId: row.account_id,
      name: row.name,
      memberCount: row.member_count,
      updatedAt: row.updated_at
    }));
  },

  save(group: ContactGroup) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO contact_groups (id, account_id, name, member_count, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, id) DO UPDATE SET
        name=excluded.name,
        member_count=excluded.member_count,
        updated_at=excluded.updated_at
    `).run(group.id, group.accountId, group.name, group.memberCount, group.updatedAt);
  },

  delete(accountId: string, id: string) {
    const db = getDatabase();
    const contacts = db.prepare('SELECT id, group_ids_json FROM contacts WHERE account_id = ?').all(accountId) as any[];
    const updateContact = db.prepare('UPDATE contacts SET group_ids_json = ?, updated_at = ? WHERE account_id = ? AND id = ?');
    db.transaction(() => {
      db.prepare('DELETE FROM contact_groups WHERE account_id = ? AND id = ?').run(accountId, id);
      const now = new Date().toISOString();
      for (const contact of contacts) {
        const groupIds = parseStringArray(contact.group_ids_json);
        const nextGroupIds = groupIds.filter(groupId => groupId !== id);
        if (nextGroupIds.length !== groupIds.length) {
          updateContact.run(JSON.stringify(nextGroupIds), now, accountId, contact.id);
        }
      }
    })();
  }
};

// === Calendar Events Repository ===
export const CalendarEventsRepo = {
  listBetween(accountId: string, startAt: string, endAt: string): CalendarEvent[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM calendar_events
      WHERE account_id = ? AND end_at >= ? AND start_at <= ?
      ORDER BY start_at ASC, end_at ASC
    `).all(accountId, startAt, endAt) as any[];

    return rows.map(row => ({
      id: row.id,
      accountId: row.account_id,
      calendarId: row.calendar_id,
      iCalUID: row.ical_uid,
      summary: row.summary,
      description: row.description,
      location: row.location,
      startAt: row.start_at,
      endAt: row.end_at,
      isAllDay: row.is_all_day === 1,
      status: row.status,
      htmlLink: row.html_link,
      conferenceUrl: row.conference_url,
      organizerEmail: row.organizer_email,
      attendees: JSON.parse(row.attendees_json),
      sourceMessageId: row.source_message_id,
      updatedAt: row.updated_at
    }));
  },

  saveMany(events: CalendarEvent[]) {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO calendar_events (
        id, account_id, calendar_id, ical_uid, summary, description, location,
        start_at, end_at, is_all_day, status, html_link, conference_url,
        organizer_email, attendees_json, source_message_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, calendar_id, id) DO UPDATE SET
        ical_uid=excluded.ical_uid,
        summary=excluded.summary,
        description=excluded.description,
        location=excluded.location,
        start_at=excluded.start_at,
        end_at=excluded.end_at,
        is_all_day=excluded.is_all_day,
        status=excluded.status,
        html_link=excluded.html_link,
        conference_url=excluded.conference_url,
        organizer_email=excluded.organizer_email,
        attendees_json=excluded.attendees_json,
        source_message_id=excluded.source_message_id,
        updated_at=excluded.updated_at
    `);

    db.transaction(() => {
      for (const event of events) {
        insert.run(
          event.id,
          event.accountId,
          event.calendarId,
          event.iCalUID || null,
          event.summary,
          event.description || null,
          event.location || null,
          event.startAt,
          event.endAt,
          event.isAllDay ? 1 : 0,
          event.status || null,
          event.htmlLink || null,
          event.conferenceUrl || null,
          event.organizerEmail || null,
          JSON.stringify(event.attendees),
          event.sourceMessageId || null,
          event.updatedAt
        );
      }
    })();
  },

  delete(accountId: string, calendarId: string, eventId: string) {
    getDatabase()
      .prepare('DELETE FROM calendar_events WHERE account_id = ? AND calendar_id = ? AND id = ?')
      .run(accountId, calendarId, eventId);
  }
};

// === Search Repository ===
export const SearchRepo = {
  search(accountId: string, ftsQuery: string): { threadId: string; messageId: string }[] {
    const db = getDatabase();
    if (!ftsQuery.trim()) return [];
    
    const rows = db.prepare(`
      SELECT thread_id, message_id FROM mail_search
      WHERE account_id = ? AND mail_search MATCH ?
      ORDER BY rank
      LIMIT 100
    `).all(accountId, ftsQuery) as any[];

    return rows.map(r => ({
      threadId: r.thread_id,
      messageId: r.message_id
    }));
  },

  searchDetailed(accountId: string, ftsQuery: string, limit = 40): MailboxSearchSource[] {
    const db = getDatabase();
    if (!ftsQuery.trim()) return [];

    const rows = db.prepare(`
      SELECT
        s.thread_id,
        s.message_id,
        COALESCE(m.subject, t.subject, '') AS subject,
        COALESCE(NULLIF(m.sender_name, ''), m.sender_email, t.sender_email, '') AS sender,
        m.sender_email AS sender_email,
        COALESCE(m.received_at, t.last_message_at) AS received_at,
        t.last_message_at AS last_message_at,
        COALESCE(NULLIF(m.snippet, ''), t.snippet, '') AS snippet
      FROM mail_search s
      LEFT JOIN messages m
        ON m.account_id = s.account_id AND m.id = s.message_id
      LEFT JOIN threads t
        ON t.account_id = s.account_id AND t.id = s.thread_id
      WHERE s.account_id = ? AND mail_search MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(accountId, ftsQuery, Math.max(1, Math.min(100, Math.floor(limit)))) as any[];

    return rows.map(r => ({
      accountId,
      threadId: r.thread_id,
      messageId: r.message_id,
      subject: r.subject || '(No subject)',
      sender: r.sender || 'Unknown sender',
      senderEmail: r.sender_email || null,
      receivedAt: r.received_at || null,
      lastMessageAt: r.last_message_at || null,
      snippet: r.snippet || '',
      sourceKind: 'fts',
      whyMatched: 'Matched by full-text search in the local cache.',
    }));
  },

  setBodyIndexEnabled(enabled: boolean, accountId?: string) {
    const db = getDatabase();
    const nextBodySql = enabled
      ? `COALESCE((
          SELECT messages.body_plain
          FROM messages
          WHERE messages.account_id = mail_search.account_id
            AND messages.id = mail_search.message_id
        ), '')`
      : `''`;

    if (accountId) {
      db.prepare(`UPDATE mail_search SET body_plain = ${nextBodySql} WHERE account_id = ?`).run(accountId);
      return;
    }
    db.prepare(`UPDATE mail_search SET body_plain = ${nextBodySql}`).run();
  }
};

// === Agent Drafts Repository ===
export const AgentDraftsRepo = {
  getReadyForThread(accountId: string, threadId: string): AgentDraftSuggestion | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM agent_drafts
      WHERE account_id = ? AND thread_id = ? AND status = 'ready'
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(accountId, threadId) as any;
    return row ? mapAgentDraftRow(row) : null;
  },

  getForMessage(accountId: string, messageId: string): AgentDraftSuggestion | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM agent_drafts
      WHERE account_id = ? AND message_id = ? AND status IN ('ready', 'applied')
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(accountId, messageId) as any;
    return row ? mapAgentDraftRow(row) : null;
  },

  save(draft: AgentDraftSuggestion) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO agent_drafts (
        id, account_id, thread_id, message_id, subject, body_plain, status,
        confidence, reason, model, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        subject=excluded.subject,
        body_plain=excluded.body_plain,
        status=excluded.status,
        confidence=excluded.confidence,
        reason=excluded.reason,
        model=excluded.model,
        updated_at=excluded.updated_at
    `).run(
      draft.id,
      draft.accountId,
      draft.threadId,
      draft.messageId,
      draft.subject,
      draft.bodyPlain,
      draft.status,
      draft.confidence,
      draft.reason,
      draft.model,
      draft.createdAt,
      draft.updatedAt
    );
  },

  setStatus(id: string, status: AgentDraftSuggestion['status']) {
    const db = getDatabase();
    db.prepare('UPDATE agent_drafts SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
  }
};

function mapAgentDraftRow(row: any): AgentDraftSuggestion {
  return {
    id: row.id,
    accountId: row.account_id,
    threadId: row.thread_id,
    messageId: row.message_id,
    subject: row.subject,
    bodyPlain: row.body_plain,
    status: row.status,
    confidence: row.confidence,
    reason: row.reason,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// === Message Security Repository ===
export const MessageSecurityRepo = {
  listForThread(accountId: string, threadId: string): MessageSecurityInsight[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM message_security
      WHERE account_id = ? AND thread_id = ?
      ORDER BY analyzed_at DESC
    `).all(accountId, threadId) as any[];
    return rows.map(mapMessageSecurityRow);
  },

  save(insight: MessageSecurityInsight) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO message_security (
        account_id, message_id, thread_id, risk_level, warnings_json,
        tracker_count, phishing_link_count, analyzed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, message_id) DO UPDATE SET
        thread_id=excluded.thread_id,
        risk_level=excluded.risk_level,
        warnings_json=excluded.warnings_json,
        tracker_count=excluded.tracker_count,
        phishing_link_count=excluded.phishing_link_count,
        analyzed_at=excluded.analyzed_at
    `).run(
      insight.accountId,
      insight.messageId,
      insight.threadId,
      insight.riskLevel,
      JSON.stringify(insight.warnings),
      insight.trackerCount,
      insight.phishingLinkCount,
      insight.analyzedAt
    );
  },

  saveMany(insights: MessageSecurityInsight[]) {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO message_security (
        account_id, message_id, thread_id, risk_level, warnings_json,
        tracker_count, phishing_link_count, analyzed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, message_id) DO UPDATE SET
        thread_id=excluded.thread_id,
        risk_level=excluded.risk_level,
        warnings_json=excluded.warnings_json,
        tracker_count=excluded.tracker_count,
        phishing_link_count=excluded.phishing_link_count,
        analyzed_at=excluded.analyzed_at
    `);
    db.transaction(() => {
      for (const insight of insights) {
        insert.run(
          insight.accountId,
          insight.messageId,
          insight.threadId,
          insight.riskLevel,
          JSON.stringify(insight.warnings),
          insight.trackerCount,
          insight.phishingLinkCount,
          insight.analyzedAt
        );
      }
    })();
  }
};

function mapMessageSecurityRow(row: any): MessageSecurityInsight {
  return {
    accountId: row.account_id,
    messageId: row.message_id,
    threadId: row.thread_id,
    riskLevel: row.risk_level,
    warnings: JSON.parse(row.warnings_json || '[]'),
    trackerCount: row.tracker_count,
    phishingLinkCount: row.phishing_link_count,
    analyzedAt: row.analyzed_at
  };
}

export interface MailEmbeddingRow {
  accountId: string;
  messageId: string;
  threadId: string;
  model: string;
  textHash: string;
  vector: number[];
  subject: string;
  sender: string;
  snippet: string;
  receivedAt: string;
  indexedAt: string;
}

export interface MailEmbeddingScanRow {
  threadId: string;
  messageId: string;
  subject: string;
  sender: string;
  snippet: string;
  receivedAt: string;
  vector: Float32Array;
}

export interface MailEmbeddingModelStats {
  model: string;
  count: number;
  lastIndexedAt: string | null;
}

export const MailEmbeddingsRepo = {
  indexedHashes(accountId: string, model: string): Record<string, string> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT message_id, text_hash
      FROM mail_embeddings
      WHERE account_id = ? AND model = ?
    `).all(accountId, model) as { message_id: string; text_hash: string }[];
    return Object.fromEntries(rows.map(row => [row.message_id, row.text_hash]));
  },

  indexedHashesForMessageIds(accountId: string, model: string, messageIds: string[]): Record<string, string> {
    const ids = [...new Set(messageIds)].filter(Boolean).slice(0, 2000);
    if (ids.length === 0) return {};

    const db = getDatabase();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT message_id, text_hash
      FROM mail_embeddings
      WHERE account_id = ? AND model = ? AND message_id IN (${placeholders})
    `).all(accountId, model, ...ids) as { message_id: string; text_hash: string }[];
    return Object.fromEntries(rows.map(row => [row.message_id, row.text_hash]));
  },

  listForAccount(accountId: string, model: string, limit = 10000): MailEmbeddingRow[] {
    return this.listForAccountPage(accountId, model, Math.max(1, Math.min(50000, limit)), 0);
  },

  listForAccountPage(accountId: string, model: string, limit = 1000, offset = 0): MailEmbeddingRow[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM mail_embeddings
      WHERE account_id = ? AND model = ?
      ORDER BY received_at DESC
      LIMIT ? OFFSET ?
    `).all(
      accountId,
      model,
      Math.max(1, Math.min(5000, limit)),
      Math.max(0, offset)
    ) as any[];
    return rows.map(mapMailEmbeddingRow);
  },

  scanForAccountPage(accountId: string, model: string, limit = 1000, offset = 0): MailEmbeddingScanRow[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT thread_id, message_id, subject, sender, snippet, received_at, vector_blob, vector_json
      FROM mail_embeddings
      WHERE account_id = ? AND model = ?
      ORDER BY received_at DESC
      LIMIT ? OFFSET ?
    `).all(
      accountId,
      model,
      Math.max(1, Math.min(5000, limit)),
      Math.max(0, offset)
    ) as any[];
    return rows.map(row => ({
      threadId: row.thread_id,
      messageId: row.message_id,
      subject: row.subject,
      sender: row.sender,
      snippet: row.snippet,
      receivedAt: row.received_at,
      vector: decodeStoredEmbeddingVector(row.vector_blob, row.vector_json),
    }));
  },

  countForAccount(accountId: string, model: string): number {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM mail_embeddings
      WHERE account_id = ? AND model = ?
    `).get(accountId, model) as { count: number };
    return row.count;
  },

  modelStats(accountId: string): MailEmbeddingModelStats[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT model, COUNT(*) AS count, MAX(indexed_at) AS last_indexed_at
      FROM mail_embeddings
      WHERE account_id = ?
      GROUP BY model
      ORDER BY last_indexed_at DESC
    `).all(accountId) as Array<{ model: string; count: number; last_indexed_at: string | null }>;
    return rows.map(row => ({
      model: row.model,
      count: Number(row.count),
      lastIndexedAt: row.last_indexed_at,
    }));
  },

  deleteByModel(accountId: string, model: string): number {
    const db = getDatabase();
    const result = db.prepare(`
      DELETE FROM mail_embeddings
      WHERE account_id = ? AND model = ?
    `).run(accountId, model);
    return Number(result.changes || 0);
  },

  deleteOtherModels(accountId: string, currentModel: string): number {
    const db = getDatabase();
    const result = db.prepare(`
      DELETE FROM mail_embeddings
      WHERE account_id = ? AND model <> ?
    `).run(accountId, currentModel);
    return Number(result.changes || 0);
  },

  saveMany(rows: MailEmbeddingRow[]) {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT INTO mail_embeddings (
        account_id, message_id, thread_id, model, text_hash, vector_json, vector_blob,
        subject, sender, snippet, received_at, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, message_id, model) DO UPDATE SET
        thread_id=excluded.thread_id,
        text_hash=excluded.text_hash,
        vector_json=excluded.vector_json,
        vector_blob=excluded.vector_blob,
        subject=excluded.subject,
        sender=excluded.sender,
        snippet=excluded.snippet,
        received_at=excluded.received_at,
        indexed_at=excluded.indexed_at
    `);
    db.transaction(() => {
      for (const row of rows) {
        insert.run(
          row.accountId,
          row.messageId,
          row.threadId,
          row.model,
          row.textHash,
          '',
          encodeEmbeddingVector(row.vector),
          row.subject,
          row.sender,
          row.snippet,
          row.receivedAt,
          row.indexedAt
        );
      }
    })();
  },

  // Converts legacy vector_json rows to vector_blob in place. Each call handles at
  // most one batch inside its own transaction, so it is idempotent and crash-safe.
  // Returns the number of rows visited; callers loop until it returns 0.
  // Blanking vector_json makes the conversion one-way; see embeddingVectorCodec.ts
  // for the rollback story (pre-blob builds need a manual reindex afterwards).
  migrateVectorJsonBatch(batchSize = 200): number {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT rowid AS row_id, vector_json
      FROM mail_embeddings
      WHERE vector_blob IS NULL
      LIMIT ?
    `).all(Math.max(1, batchSize)) as Array<{ row_id: number; vector_json: string | null }>;
    if (rows.length === 0) return 0;

    // Re-check vector_blob IS NULL inside the UPDATE: the main process can
    // re-embed one of the selected rows (or delete and reinsert, reusing its
    // rowid) while this batch parses JSON, and a fresh blob must never be
    // clobbered with the stale vector_json snapshot.
    const writeBlob = db.prepare(`
      UPDATE mail_embeddings SET vector_blob = ?, vector_json = '' WHERE rowid = ? AND vector_blob IS NULL
    `);
    const markUnconvertible = db.prepare(`
      UPDATE mail_embeddings SET vector_blob = ? WHERE rowid = ? AND vector_blob IS NULL
    `);
    db.transaction(() => {
      for (const row of rows) {
        let blob: Buffer = Buffer.alloc(0);
        try {
          const parsed = JSON.parse(row.vector_json || '[]');
          if (Array.isArray(parsed) && parsed.length > 0) {
            blob = encodeEmbeddingVector(parsed);
          }
        } catch {
          // Unreadable vector_json: keep it for the JSON fallback path and only
          // mark the row with an empty blob so the migration terminates.
        }
        if (blob.byteLength > 0) {
          writeBlob.run(blob, row.row_id);
        } else {
          markUnconvertible.run(blob, row.row_id);
        }
      }
    })();
    return rows.length;
  }
};

function mapMailEmbeddingRow(row: any): MailEmbeddingRow {
  return {
    accountId: row.account_id,
    messageId: row.message_id,
    threadId: row.thread_id,
    model: row.model,
    textHash: row.text_hash,
    vector: decodeStoredEmbeddingVectorAsNumbers(row.vector_blob, row.vector_json),
    subject: row.subject,
    sender: row.sender,
    snippet: row.snippet,
    receivedAt: row.received_at,
    indexedAt: row.indexed_at
  };
}

// === Reminders Repository ===
export const RemindersRepo = {
  get(accountId: string, threadId: string): string | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT reminder_at FROM thread_reminders
      WHERE account_id = ? AND thread_id = ?
    `).get(accountId, threadId) as any;
    return row ? row.reminder_at : null;
  },

  save(accountId: string, threadId: string, reminderAt: string) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO thread_reminders (account_id, thread_id, reminder_at)
      VALUES (?, ?, ?)
      ON CONFLICT(account_id, thread_id) DO UPDATE SET reminder_at=excluded.reminder_at
    `).run(accountId, threadId, reminderAt);
  },

  listDue(nowIso: string, limit = 25): MailThread[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT t.*, r.reminder_at
      FROM thread_reminders r
      INNER JOIN threads t ON t.account_id = r.account_id AND t.id = r.thread_id
      WHERE r.reminder_at <= ?
      ORDER BY r.reminder_at ASC
      LIMIT ?
    `).all(nowIso, limit) as any[];

    return rows.map(mapThreadRow);
  },

  delete(accountId: string, threadId: string) {
    const db = getDatabase();
    db.prepare(`
      DELETE FROM thread_reminders
      WHERE account_id = ? AND thread_id = ?
    `).run(accountId, threadId);
  }
};

function mapFollowUpRadarStateRow(row: any): FollowUpRadarState {
  return {
    accountId: row.account_id,
    threadId: row.thread_id,
    sentMessageId: row.sent_message_id,
    status: row.status,
    snoozedUntil: row.snoozed_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// === Unsubscribed Senders Repository ===
export const UnsubscribedSendersRepo = {
  /**
   * Record a successful one-click / mailto unsubscribe so Cleanup Center can
   * hide the sender. Sender emails are stored lower-cased to match sender_key.
   */
  mark(accountId: string, senderEmail: string, options?: {
    threadId?: string | null;
    method?: string | null;
    unsubscribedAt?: string;
  }) {
    const normalized = senderEmail.trim().toLowerCase();
    if (!accountId || !normalized) return;
    const db = getDatabase();
    const unsubscribedAt = options?.unsubscribedAt || new Date().toISOString();
    db.prepare(`
      INSERT INTO unsubscribed_senders (
        account_id, sender_email, unsubscribed_at, thread_id, method
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, sender_email) DO UPDATE SET
        unsubscribed_at=excluded.unsubscribed_at,
        thread_id=COALESCE(excluded.thread_id, unsubscribed_senders.thread_id),
        method=COALESCE(excluded.method, unsubscribed_senders.method)
    `).run(
      accountId,
      normalized,
      unsubscribedAt,
      options?.threadId || null,
      options?.method || null,
    );
  },

  has(accountId: string, senderEmail: string): boolean {
    const normalized = senderEmail.trim().toLowerCase();
    if (!accountId || !normalized) return false;
    const db = getDatabase();
    const row = db.prepare(`
      SELECT 1 AS ok FROM unsubscribed_senders
      WHERE account_id = ? AND sender_email = ?
      LIMIT 1
    `).get(accountId, normalized) as { ok: number } | undefined;
    return Boolean(row);
  },

  list(accountId: string): string[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT sender_email FROM unsubscribed_senders
      WHERE account_id = ?
      ORDER BY unsubscribed_at DESC
    `).all(accountId) as { sender_email: string }[];
    return rows.map(row => row.sender_email);
  },
};

// === Cleanup Sender Exclusions Repository ===
export const CleanupExclusionsRepo = {
  list(accountIds: string[]): CleanupSenderExclusion[] {
    const normalizedAccountIds = Array.from(new Set(
      accountIds.map(accountId => accountId.trim()).filter(Boolean),
    ));
    if (normalizedAccountIds.length === 0) return [];

    const placeholders = normalizedAccountIds.map(() => '?').join(', ');
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT account_id, sender_email, sender_name, excluded_at
      FROM cleanup_sender_exclusions
      WHERE account_id IN (${placeholders})
      ORDER BY excluded_at DESC, sender_name COLLATE NOCASE ASC
    `).all(...normalizedAccountIds) as any[];

    return rows.map(row => ({
      accountId: row.account_id,
      senderEmail: row.sender_email,
      senderName: row.sender_name || row.sender_email,
      excludedAt: row.excluded_at,
    }));
  },

  save(exclusion: CleanupSenderExclusion): CleanupSenderExclusion {
    const accountId = exclusion.accountId.trim();
    const senderEmail = exclusion.senderEmail.trim().toLowerCase();
    if (!accountId || !senderEmail) {
      throw new Error('Cleanup exclusion requires an account and sender email.');
    }

    const normalized: CleanupSenderExclusion = {
      accountId,
      senderEmail,
      senderName: exclusion.senderName.trim() || senderEmail,
      excludedAt: exclusion.excludedAt || new Date().toISOString(),
    };
    const db = getDatabase();
    db.prepare(`
      INSERT INTO cleanup_sender_exclusions (
        account_id, sender_email, sender_name, excluded_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id, sender_email) DO UPDATE SET
        sender_name=excluded.sender_name,
        excluded_at=excluded.excluded_at
    `).run(
      normalized.accountId,
      normalized.senderEmail,
      normalized.senderName,
      normalized.excludedAt,
    );
    return normalized;
  },

  delete(accountId: string, senderEmail: string): void {
    const normalizedAccountId = accountId.trim();
    const normalizedSenderEmail = senderEmail.trim().toLowerCase();
    if (!normalizedAccountId || !normalizedSenderEmail) return;
    const db = getDatabase();
    db.prepare(`
      DELETE FROM cleanup_sender_exclusions
      WHERE account_id = ? AND sender_email = ?
    `).run(normalizedAccountId, normalizedSenderEmail);
  },
};

// === Follow-up Radar Repository ===
export const FollowUpRadarRepo = {
  listStates(accountId: string): FollowUpRadarState[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM follow_up_radar_state
      WHERE account_id = ?
      ORDER BY updated_at DESC
    `).all(accountId) as any[];
    return rows.map(mapFollowUpRadarStateRow);
  },

  listItems(accountId: string, options: FollowUpRadarListOptions = {}): FollowUpRadarResult {
    const scanLimit = Math.max(1, Math.min(500, Math.floor(options.sentThreadScanLimit || 150)));
    const maxItems = Math.max(1, Math.min(50, Math.floor(options.maxItems || 12)));
    const { thresholdHours, maxAgeHours } = normalizeFollowUpAgeWindow(
      options.thresholdHours,
      options.maxAgeHours,
    );
    const now = options.nowIso ? new Date(options.nowIso) : new Date();
    const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
    // Window of interest: [now - maxAge, now - threshold].
    // latest_sent_at must be old enough to be past the min wait, but not so old it is archaeology.
    const minAgeCutoffIso = new Date(safeNow.getTime() - thresholdHours * 3_600_000).toISOString();
    const maxAgeCutoffIso = new Date(safeNow.getTime() - maxAgeHours * 3_600_000).toISOString();
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT t.*, r.reminder_at
      FROM threads t
      JOIN (
        SELECT account_id, thread_id, MAX(received_at) AS latest_sent_at
        FROM messages
        WHERE account_id = ?
          AND label_ids_json LIKE '%"SENT"%'
        GROUP BY account_id, thread_id
        HAVING latest_sent_at <= ?
           AND latest_sent_at >= ?
      ) sent ON sent.account_id = t.account_id AND sent.thread_id = t.id
      LEFT JOIN thread_reminders r ON t.account_id = r.account_id AND t.id = r.thread_id
      WHERE t.account_id = ?
      ORDER BY sent.latest_sent_at DESC
      LIMIT ?
    `).all(accountId, minAgeCutoffIso, maxAgeCutoffIso, accountId, scanLimit) as any[];
    const threads = rows.map(mapThreadRow);
    const states = this.listStates(accountId);
    const messagesByThread = MessagesRepo.listMetadataForThreads(accountId, threads.map(thread => thread.id));

    return buildFollowUpRadarResult({
      accountId,
      threadsWithMessages: threads.map(thread => ({
        thread,
        messages: messagesByThread.get(thread.id) || [],
      })),
      states,
      now: safeNow,
      thresholdHours,
      maxAgeHours,
      maxItems,
    });
  },

  saveState(state: FollowUpRadarState) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO follow_up_radar_state (
        account_id, thread_id, sent_message_id, status, snoozed_until, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, thread_id, sent_message_id) DO UPDATE SET
        status=excluded.status,
        snoozed_until=excluded.snoozed_until,
        updated_at=excluded.updated_at
    `).run(
      state.accountId,
      state.threadId,
      state.sentMessageId,
      state.status,
      state.snoozedUntil || null,
      state.createdAt,
      state.updatedAt,
    );
  },

  dismiss(accountId: string, threadId: string, sentMessageId: string) {
    const now = new Date().toISOString();
    this.saveState({
      accountId,
      threadId,
      sentMessageId,
      status: 'dismissed',
      snoozedUntil: null,
      createdAt: now,
      updatedAt: now,
    });
  },

  snooze(accountId: string, threadId: string, sentMessageId: string, snoozedUntil: string) {
    const now = new Date().toISOString();
    this.saveState({
      accountId,
      threadId,
      sentMessageId,
      status: 'snoozed',
      snoozedUntil,
      createdAt: now,
      updatedAt: now,
    });
  },
};

// === Operator Home Repository ===
export const OperatorHomeStateRepo = {
  get(scopeId: string): OperatorHomeStateSnapshot | null {
    const normalizedScopeId = normalizeOperatorHomeScopeId(scopeId);
    if (!normalizedScopeId) return null;
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM operator_home_state WHERE scope_id = ?
    `).get(normalizedScopeId) as any;
    if (!row) return null;

    const agentPlan = parseJsonValue(row.agent_plan_json, null);
    const selectedAgentPlanItemIds = parseJsonValue(row.selected_item_ids_json, []);
    const dailyBriefing = parseJsonValue(row.daily_briefing_json, null);

    const snapshot = normalizeOperatorHomeStateSnapshot({
      scopeId: normalizedScopeId,
      agentPlan,
      selectedAgentPlanItemIds,
      dailyBriefing,
      lastAutoRefreshWindow: row.last_auto_refresh_window,
      updatedAt: row.updated_at,
    }, normalizedScopeId);
    if (!snapshot) return null;

    if (snapshot.agentPlan) {
      const retainedItems = snapshot.agentPlan.items.filter(item => ThreadsRepo.get(item.accountId, item.threadId));
      const expiredCount = snapshot.agentPlan.items.length - retainedItems.length;
      snapshot.agentPlan = {
        ...snapshot.agentPlan,
        items: retainedItems,
        coverage: {
          ...snapshot.agentPlan.coverage,
          proposedActionCount: retainedItems.length,
          warnings: expiredCount > 0
            ? [...snapshot.agentPlan.coverage.warnings, `${expiredCount} stale review item${expiredCount === 1 ? '' : 's'} expired from the local cache.`]
            : snapshot.agentPlan.coverage.warnings,
        },
      };
      const retainedIds = new Set(retainedItems.map(item => item.id));
      snapshot.selectedAgentPlanItemIds = snapshot.selectedAgentPlanItemIds.filter(id => retainedIds.has(id));
    }

    if (snapshot.dailyBriefing) {
      const retainedItems = snapshot.dailyBriefing.items.filter(item => ThreadsRepo.get(item.accountId, item.threadId));
      snapshot.dailyBriefing = {
        ...snapshot.dailyBriefing,
        items: retainedItems,
        coverage: {
          ...snapshot.dailyBriefing.coverage,
          includedItemCount: retainedItems.length,
        },
      };
    }

    return snapshot;
  },

  saveSnapshot(snapshot: OperatorHomeStateSnapshot): void {
    const normalized = normalizeOperatorHomeStateSnapshot(snapshot, snapshot.scopeId);
    if (!normalized) throw new Error('Invalid Operator Home state snapshot.');
    const db = getDatabase();
    const updatedAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO operator_home_state (
        scope_id, agent_plan_json, selected_item_ids_json, daily_briefing_json,
        last_auto_refresh_window, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_id) DO UPDATE SET
        agent_plan_json=excluded.agent_plan_json,
        selected_item_ids_json=excluded.selected_item_ids_json,
        daily_briefing_json=excluded.daily_briefing_json,
        updated_at=excluded.updated_at
    `).run(
      normalized.scopeId,
      normalized.agentPlan ? JSON.stringify(normalized.agentPlan) : null,
      JSON.stringify(normalized.selectedAgentPlanItemIds),
      normalized.dailyBriefing ? JSON.stringify(normalized.dailyBriefing) : null,
      normalized.lastAutoRefreshWindow,
      updatedAt,
    );
  },

  finalizeAutoRefreshWindow(scopeId: string, windowKey: string, briefing: DailyBriefing): boolean {
    const normalizedScopeId = normalizeOperatorHomeScopeId(scopeId);
    const normalizedWindowKey = typeof windowKey === 'string' ? windowKey.trim() : '';
    if (!normalizedScopeId || !normalizedWindowKey || normalizedWindowKey.length > 80) return false;
    if (normalizeOperatorHomeScopeId(briefing?.accountId) !== normalizedScopeId) return false;
    const now = new Date().toISOString();
    const normalizedSnapshot = normalizeOperatorHomeStateSnapshot({
      scopeId: normalizedScopeId,
      agentPlan: null,
      selectedAgentPlanItemIds: [],
      dailyBriefing: briefing,
      lastAutoRefreshWindow: normalizedWindowKey,
      updatedAt: now,
    }, normalizedScopeId);
    if (!normalizedSnapshot?.dailyBriefing) return false;
    const db = getDatabase();
    const result = db.prepare(`
      INSERT INTO operator_home_state (
        scope_id, agent_plan_json, selected_item_ids_json, daily_briefing_json,
        last_auto_refresh_window, updated_at
      ) VALUES (?, NULL, '[]', ?, ?, ?)
      ON CONFLICT(scope_id) DO UPDATE SET
        daily_briefing_json=excluded.daily_briefing_json,
        last_auto_refresh_window=excluded.last_auto_refresh_window,
        updated_at=excluded.updated_at
    `).run(
      normalizedScopeId,
      JSON.stringify(normalizedSnapshot.dailyBriefing),
      normalizedWindowKey,
      now,
    );
    return Number(result.changes || 0) > 0;
  },
};

function mapReplyPipelineStateRow(row: any): ReplyPipelineState {
  return {
    accountId: row.account_id,
    threadId: row.thread_id,
    sourceMessageId: row.source_message_id,
    sourceReceivedAt: row.source_received_at,
    sourceKind: row.source_kind,
    status: row.status,
    resumeStatus: row.resume_status,
    draftId: row.draft_id,
    draftOrigin: row.draft_origin,
    hasPlaceholders: Boolean(row.has_placeholders),
    waitingSince: row.waiting_since,
    dueAt: row.due_at,
    snoozedUntil: row.snoozed_until,
    reason: row.reason || '',
    priority: Number(row.priority) || 0,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// === Reply Pipeline Repository ===
export const ReplyPipelineRepo = {
  get(accountId: string, threadId: string): ReplyPipelineState | null {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM reply_pipeline_state
      WHERE account_id = ? AND thread_id = ?
    `).get(accountId, threadId) as any;
    return row ? mapReplyPipelineStateRow(row) : null;
  },

  list(accountIds: string | string[]): ReplyPipelineState[] {
    const ids = Array.from(new Set((Array.isArray(accountIds) ? accountIds : [accountIds])
      .map(id => id.trim())
      .filter(Boolean)));
    if (ids.length === 0) return [];
    const db = getDatabase();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT * FROM reply_pipeline_state
      WHERE account_id IN (${placeholders})
      ORDER BY priority DESC, updated_at DESC
    `).all(...ids) as any[];
    return rows.map(mapReplyPipelineStateRow);
  },

  findByDraftId(accountId: string, draftId: string): ReplyPipelineState | null {
    if (!accountId || !draftId) return null;
    const db = getDatabase();
    const row = db.prepare(`
      SELECT * FROM reply_pipeline_state
      WHERE account_id = ? AND draft_id = ? LIMIT 1
    `).get(accountId, draftId) as any;
    return row ? mapReplyPipelineStateRow(row) : null;
  },

  save(state: ReplyPipelineState): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO reply_pipeline_state (
        account_id, thread_id, source_message_id, source_received_at, source_kind, status,
        resume_status, draft_id, draft_origin, has_placeholders, waiting_since, due_at,
        snoozed_until, reason, priority, resolved_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, thread_id) DO UPDATE SET
        source_message_id=excluded.source_message_id,
        source_received_at=excluded.source_received_at,
        source_kind=excluded.source_kind,
        status=excluded.status,
        resume_status=excluded.resume_status,
        draft_id=excluded.draft_id,
        draft_origin=excluded.draft_origin,
        has_placeholders=excluded.has_placeholders,
        waiting_since=excluded.waiting_since,
        due_at=excluded.due_at,
        snoozed_until=excluded.snoozed_until,
        reason=excluded.reason,
        priority=excluded.priority,
        resolved_at=excluded.resolved_at,
        updated_at=excluded.updated_at
    `).run(
      state.accountId,
      state.threadId,
      state.sourceMessageId,
      state.sourceReceivedAt,
      state.sourceKind,
      state.status,
      state.resumeStatus || null,
      state.draftId || null,
      state.draftOrigin || null,
      state.hasPlaceholders ? 1 : 0,
      state.waitingSince || null,
      state.dueAt || null,
      state.snoozedUntil || null,
      state.reason || '',
      Math.max(0, Math.min(100, Math.round(state.priority || 0))),
      state.resolvedAt || null,
      state.createdAt,
      state.updatedAt,
    );
  },

  delete(accountId: string, threadId: string): void {
    getDatabase().prepare(`
      DELETE FROM reply_pipeline_state WHERE account_id = ? AND thread_id = ?
    `).run(accountId, threadId);
  },
};

// === Sync State Repository ===
export const SyncStateRepo = {
  get(accountId: string): SyncState | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM sync_state WHERE account_id = ?').get(accountId) as any;
    if (!row) return null;
    return {
      accountId: row.account_id,
      historyId: row.history_id,
      lastFullSyncAt: row.last_full_sync_at,
      historyBackfillPageToken: row.history_backfill_page_token,
      lastHistoryBackfillAt: row.last_history_backfill_at,
      historyBackfillCompletedAt: row.history_backfill_completed_at,
      historyBackfillPagesSynced: row.history_backfill_pages_synced,
      historyBackfillThreadsSynced: row.history_backfill_threads_synced
    };
  },

  save(state: SyncState) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO sync_state (
        account_id, history_id, last_full_sync_at, history_backfill_page_token,
        last_history_backfill_at, history_backfill_completed_at,
        history_backfill_pages_synced, history_backfill_threads_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        history_id=excluded.history_id,
        last_full_sync_at=excluded.last_full_sync_at,
        history_backfill_page_token=excluded.history_backfill_page_token,
        last_history_backfill_at=excluded.last_history_backfill_at,
        history_backfill_completed_at=excluded.history_backfill_completed_at,
        history_backfill_pages_synced=excluded.history_backfill_pages_synced,
        history_backfill_threads_synced=excluded.history_backfill_threads_synced
    `).run(
      state.accountId,
      state.historyId || null,
      state.lastFullSyncAt || null,
      state.historyBackfillPageToken || null,
      state.lastHistoryBackfillAt || null,
      state.historyBackfillCompletedAt || null,
      state.historyBackfillPagesSynced,
      state.historyBackfillThreadsSynced
    );
  }
};

// === Action Log Repository ===
export const ActionLogRepo = {
  get(id: string): MailActionLog | null {
    const db = getDatabase();
    const r = db.prepare('SELECT * FROM mail_action_log WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      accountId: r.account_id,
      threadId: r.thread_id,
      draftId: r.draft_id,
      kind: r.kind,
      status: r.status,
      createdAt: r.created_at,
      scheduledAt: r.scheduled_at,
      completedAt: r.completed_at,
      failureMessage: r.failure_message,
      payloadJson: r.payload_json
    };
  },

  list(accountId: string): MailActionLog[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM mail_action_log
      WHERE account_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(accountId) as any[];

    return rows.map(r => ({
      id: r.id,
      accountId: r.account_id,
      threadId: r.thread_id,
      draftId: r.draft_id,
      kind: r.kind,
      status: r.status,
      createdAt: r.created_at,
      scheduledAt: r.scheduled_at,
      completedAt: r.completed_at,
      failureMessage: r.failure_message,
      payloadJson: r.payload_json
    }));
  },

  listPending(nowIso = new Date().toISOString()): MailActionLog[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM mail_action_log
      WHERE status = 'pending_sync'
        AND (scheduled_at IS NULL OR scheduled_at <= ?)
      ORDER BY COALESCE(scheduled_at, created_at) ASC
    `).all(nowIso) as any[];

    return rows.map(r => ({
      id: r.id,
      accountId: r.account_id,
      threadId: r.thread_id,
      draftId: r.draft_id,
      kind: r.kind,
      status: r.status,
      createdAt: r.created_at,
      scheduledAt: r.scheduled_at,
      completedAt: r.completed_at,
      failureMessage: r.failure_message,
      payloadJson: r.payload_json
    }));
  },

  listRunning(): MailActionLog[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM mail_action_log
      WHERE status = 'running'
      ORDER BY created_at ASC
    `).all() as any[];

    return rows.map(r => ({
      id: r.id,
      accountId: r.account_id,
      threadId: r.thread_id,
      draftId: r.draft_id,
      kind: r.kind,
      status: r.status,
      createdAt: r.created_at,
      scheduledAt: r.scheduled_at,
      completedAt: r.completed_at,
      failureMessage: r.failure_message,
      payloadJson: r.payload_json
    }));
  },

  save(log: MailActionLog) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO mail_action_log (
        id, account_id, thread_id, draft_id, kind, status, created_at, scheduled_at, completed_at, failure_message, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status,
        scheduled_at=excluded.scheduled_at,
        completed_at=excluded.completed_at,
        failure_message=excluded.failure_message,
        payload_json=excluded.payload_json
    `).run(
      log.id,
      log.accountId,
      log.threadId || null,
      log.draftId || null,
      log.kind,
      log.status,
      log.createdAt,
      log.scheduledAt || null,
      log.completedAt || null,
      log.failureMessage || null,
      log.payloadJson || null
    );
  }
};

// === Drafts Repository ===
export const DraftsRepo = {
  list(accountId: string): Draft[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM drafts WHERE account_id = ? ORDER BY updated_at DESC').all(accountId) as any[];
    return rows.map(r => ({
      id: r.id,
      accountId: r.account_id,
      threadId: r.thread_id,
      to: JSON.parse(r.to_json),
      cc: JSON.parse(r.cc_json),
      bcc: JSON.parse(r.bcc_json),
      subject: r.subject,
      bodyPlain: r.body_plain_text,
      bodyHtml: r.body_html,
      attachments: JSON.parse(r.attachments_json),
      replyMessageId: r.reply_message_id,
      replyReferences: r.reply_references,
      sendAt: r.send_at,
      updatedAt: r.updated_at
    }));
  },

  get(id: string): Draft | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      accountId: row.account_id,
      threadId: row.thread_id,
      to: JSON.parse(row.to_json),
      cc: JSON.parse(row.cc_json),
      bcc: JSON.parse(row.bcc_json),
      subject: row.subject,
      bodyPlain: row.body_plain_text,
      bodyHtml: row.body_html,
      attachments: JSON.parse(row.attachments_json),
      replyMessageId: row.reply_message_id,
      replyReferences: row.reply_references,
      sendAt: row.send_at,
      updatedAt: row.updated_at
    };
  },

  save(draft: Draft) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO drafts (
        id, account_id, thread_id, to_json, cc_json, bcc_json, subject, body_plain_text,
        body_html, attachments_json, reply_message_id, reply_references, send_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        thread_id=excluded.thread_id,
        to_json=excluded.to_json,
        cc_json=excluded.cc_json,
        bcc_json=excluded.bcc_json,
        subject=excluded.subject,
        body_plain_text=excluded.body_plain_text,
        body_html=excluded.body_html,
        attachments_json=excluded.attachments_json,
        reply_message_id=excluded.reply_message_id,
        reply_references=excluded.reply_references,
        send_at=excluded.send_at,
        updated_at=excluded.updated_at
    `).run(
      draft.id,
      draft.accountId,
      draft.threadId || null,
      JSON.stringify(draft.to),
      JSON.stringify(draft.cc),
      JSON.stringify(draft.bcc),
      draft.subject,
      draft.bodyPlain,
      draft.bodyHtml || null,
      JSON.stringify(draft.attachments),
      draft.replyMessageId || null,
      draft.replyReferences || null,
      draft.sendAt || null,
      draft.updatedAt
    );
  },

  delete(id: string) {
    const db = getDatabase();
    db.prepare('DELETE FROM drafts WHERE id = ?').run(id);
  }
};

// === AI Conversations Repository ===
export const AIConversationsRepo = {
  list(accountId: string): AIConversation[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM ai_conversations
      WHERE account_id = ?
      ORDER BY updated_at DESC
    `).all(accountId) as any[];

    return rows.map(r => ({
      id: r.id,
      title: r.title,
      accountId: r.account_id,
      threadId: r.thread_id,
      threadSubject: r.thread_subject,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  },

  getMessages(conversationId: string): AIChatMessage[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM ai_messages
      WHERE conversation_id = ?
      ORDER BY sequence_index ASC
    `).all(conversationId) as any[];

    return rows.map(r => ({
      id: r.id,
      role: r.role as any,
      text: r.text,
      sources: parseJsonArray(r.sources_json)
    }));
  },

  saveConversation(conv: AIConversation, messages: AIChatMessage[]) {
    const db = getDatabase();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO ai_conversations (id, title, account_id, thread_id, thread_subject, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title,
          updated_at=excluded.updated_at
      `).run(conv.id, conv.title, conv.accountId || null, conv.threadId || null, conv.threadSubject || null, conv.createdAt, conv.updatedAt);

      // Simple sync: delete old messages and rewrite
      db.prepare('DELETE FROM ai_messages WHERE conversation_id = ?').run(conv.id);
      
      const insertMsg = db.prepare(`
        INSERT INTO ai_messages (id, conversation_id, sequence_index, role, text, sources_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        insertMsg.run(m.id, conv.id, i, m.role, m.text, m.sources && m.sources.length > 0 ? JSON.stringify(m.sources) : null);
      }
    })();
  },

  deleteConversation(id: string) {
    const db = getDatabase();
    db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(id);
  }
};

export const SettingsRepo = {
  get(key: string): string | null {
    const db = getDatabase();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
  },

  set(key: string, value: string): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }
};
