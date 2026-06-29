import crypto from 'crypto';
import { getDatabase } from './database';
import { Account, MailThread, MailMessage, Draft, SyncState, MailActionLog, AIConversation, AIChatMessage } from '../shared/types';

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

  delete(id: string) {
    const db = getDatabase();
    db.transaction(() => {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
      db.prepare('DELETE FROM threads WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM messages WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM drafts WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM sync_state WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM thread_reminders WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM ai_conversations WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM mail_action_log WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM mail_search WHERE account_id = ?').run(id);
    })();
  }
};

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

    return rows.map(r => ({
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
    }));
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
      db.prepare('DELETE FROM mail_search WHERE account_id = ? AND thread_id = ?').run(accountId, threadId);
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
    })();
  }
};

// === Messages Repository ===
export const MessagesRepo = {
  listForThread(accountId: string, threadId: string): MailMessage[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM messages
      WHERE account_id = ? AND thread_id = ?
      ORDER BY received_at ASC
    `).all(accountId, threadId) as any[];

    return rows.map(r => ({
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
      rfcMessageId: r.rfc_message_id,
      rfcReferences: r.rfc_references,
      rfcInReplyTo: r.rfc_in_reply_to
    }));
  },

  save(messages: MailMessage[]) {
    const db = getDatabase();
    const insertMsg = db.prepare(`
      INSERT INTO messages (
        id, thread_id, account_id, sender_name, sender_email, subject, snippet, received_at,
        label_ids_json, has_attachments, is_unread, to_recipients_json, cc_recipients_json, bcc_recipients_json,
        body_html, body_plain, attachments_json, rfc_message_id, rfc_references, rfc_in_reply_to
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          m.bodyPlain || ''
        );
      }
    })();
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
      LIMIT 100
    `).all(accountId, ftsQuery) as any[];

    return rows.map(r => ({
      threadId: r.thread_id,
      messageId: r.message_id
    }));
  }
};

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

  delete(accountId: string, threadId: string) {
    const db = getDatabase();
    db.prepare(`
      DELETE FROM thread_reminders
      WHERE account_id = ? AND thread_id = ?
    `).run(accountId, threadId);
  }
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
      completedAt: r.completed_at,
      failureMessage: r.failure_message
    }));
  },

  listPending(): MailActionLog[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM mail_action_log
      WHERE status = 'pending_sync'
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
      completedAt: r.completed_at,
      failureMessage: r.failure_message
    }));
  },

  save(log: MailActionLog) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO mail_action_log (
        id, account_id, thread_id, draft_id, kind, status, created_at, completed_at, failure_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status,
        completed_at=excluded.completed_at,
        failure_message=excluded.failure_message
    `).run(
      log.id,
      log.accountId,
      log.threadId || null,
      log.draftId || null,
      log.kind,
      log.status,
      log.createdAt,
      log.completedAt || null,
      log.failureMessage || null
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
      updatedAt: row.updated_at
    };
  },

  save(draft: Draft) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO drafts (
        id, account_id, thread_id, to_json, cc_json, bcc_json, subject, body_plain_text,
        body_html, attachments_json, reply_message_id, reply_references, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      text: r.text
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
        INSERT INTO ai_messages (id, conversation_id, sequence_index, role, text)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        insertMsg.run(m.id, conv.id, i, m.role, m.text);
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
