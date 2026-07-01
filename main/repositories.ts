import crypto from 'crypto';
import { getDatabase } from './database';
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
} from '../shared/types';

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

  delete(id: string) {
    const db = getDatabase();
    db.transaction(() => {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
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
      db.prepare('DELETE FROM ai_conversations WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM mail_action_log WHERE account_id = ?').run(id);
      db.prepare('DELETE FROM mail_search WHERE account_id = ?').run(id);
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
      SELECT display_name, email, updated_at
      FROM contacts
      ${contactsWhere}
      ORDER BY display_name COLLATE NOCASE ASC, email COLLATE NOCASE ASC
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
      SELECT account_id, display_name, email, group_ids_json
      FROM contacts
      ${contactsWhere}
      ORDER BY display_name COLLATE NOCASE ASC, email COLLATE NOCASE ASC
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
      ORDER BY display_name COLLATE NOCASE ASC, email COLLATE NOCASE ASC
      LIMIT 2000
    `).all(accountId) as any[];

    const contacts = rows.map(row => ({
      id: row.id,
      accountId: row.account_id,
      resourceName: row.resource_name,
      etag: row.etag,
      displayName: row.display_name,
      email: row.email,
      photoUrl: row.photo_url,
      phoneNumbers: JSON.parse(row.phone_numbers_json),
      organizations: JSON.parse(row.organizations_json),
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
        id, account_id, resource_name, etag, display_name, email, photo_url,
        phone_numbers_json, organizations_json, notes, group_ids_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        const existing = db.prepare('SELECT notes, group_ids_json FROM contacts WHERE account_id = ? AND id = ?')
          .get(contact.accountId, contact.id) as any;
        insert.run(
          contact.id,
          contact.accountId,
          contact.resourceName || null,
          contact.etag || null,
          contact.displayName,
          contact.email,
          contact.photoUrl || null,
          JSON.stringify(contact.phoneNumbers),
          JSON.stringify(contact.organizations),
          existing?.notes ?? contact.notes ?? null,
          existing?.group_ids_json ?? JSON.stringify(contact.groupIds),
          contact.updatedAt
        );
      }
    })();
  },

  updateLocal(accountId: string, id: string, patch: Pick<Partial<ContactCard>, 'notes' | 'groupIds' | 'displayName'>) {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM contacts WHERE account_id = ? AND id = ?').get(accountId, id) as any;
    if (!row) return;
    db.prepare(`
      UPDATE contacts
      SET display_name = ?, notes = ?, group_ids_json = ?, updated_at = ?
      WHERE account_id = ? AND id = ?
    `).run(
      patch.displayName ?? row.display_name,
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
      failureMessage: r.failure_message,
      payloadJson: r.payload_json
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
      failureMessage: r.failure_message,
      payloadJson: r.payload_json
    }));
  },

  save(log: MailActionLog) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO mail_action_log (
        id, account_id, thread_id, draft_id, kind, status, created_at, completed_at, failure_message, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status=excluded.status,
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
