import Database from 'better-sqlite3';

export function runMigrations(db: Database.Database) {
  // Self-heal: Drop old camelCase ai_conversations table if it exists
  try {
    const columns = db.pragma('table_info(ai_conversations)') as { name: string }[];
    if (columns.length > 0) {
      const hasAccountId = columns.some(c => c.name === 'account_id');
      if (!hasAccountId) {
        db.exec(`
          DROP TABLE IF EXISTS ai_messages;
          DROP TABLE IF EXISTS ai_conversations;
        `);
      }
    }
  } catch (e) {
    console.error('Self-healing ai_conversations check failed:', e);
  }

  // Execute base tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        color_hex TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS labels (
        id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'user',
        color_hex TEXT,
        text_color_hex TEXT,
        message_list_visibility TEXT,
        label_list_visibility TEXT,
        PRIMARY KEY (account_id, id)
    );

    CREATE TABLE IF NOT EXISTS account_integrations (
        account_id TEXT PRIMARY KEY,
        gmail_enabled INTEGER NOT NULL DEFAULT 1,
        calendar_enabled INTEGER NOT NULL DEFAULT 0,
        contacts_enabled INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
        id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        resource_name TEXT,
        etag TEXT,
        display_name TEXT NOT NULL,
        local_display_name TEXT,
        email TEXT NOT NULL,
        photo_url TEXT,
        phone_numbers_json TEXT NOT NULL DEFAULT '[]',
        local_phone_numbers_json TEXT,
        organizations_json TEXT NOT NULL DEFAULT '[]',
        local_organizations_json TEXT,
        notes TEXT,
        group_ids_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
    );

    CREATE TABLE IF NOT EXISTS contact_groups (
        id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        member_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
        id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        calendar_id TEXT NOT NULL,
        ical_uid TEXT,
        summary TEXT NOT NULL,
        description TEXT,
        location TEXT,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        is_all_day INTEGER NOT NULL DEFAULT 0,
        status TEXT,
        html_link TEXT,
        conference_url TEXT,
        organizer_email TEXT,
        attendees_json TEXT NOT NULL DEFAULT '[]',
        source_message_id TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, calendar_id, id)
    );

    CREATE TABLE IF NOT EXISTS calendar_lists (
        id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        description TEXT,
        is_primary INTEGER NOT NULL DEFAULT 0,
        is_selected INTEGER NOT NULL DEFAULT 1,
        access_role TEXT NOT NULL DEFAULT 'reader',
        background_color TEXT NOT NULL DEFAULT '#3b82f6',
        foreground_color TEXT NOT NULL DEFAULT '#ffffff',
        time_zone TEXT,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, id)
    );

    CREATE TABLE IF NOT EXISTS calendar_sync_ranges (
        account_id TEXT NOT NULL,
        calendar_id TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        sync_token TEXT,
        PRIMARY KEY (account_id, calendar_id, start_at, end_at)
    );

    CREATE TABLE IF NOT EXISTS calendar_mutations (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        calendar_id TEXT NOT NULL,
        event_id TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS calendar_notification_log (
        account_id TEXT NOT NULL,
        calendar_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        start_at TEXT NOT NULL,
        notified_at TEXT NOT NULL,
        snoozed_until TEXT,
        PRIMARY KEY (account_id, calendar_id, event_id, start_at)
    );

    CREATE TABLE IF NOT EXISTS threads (
        id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        snippet TEXT NOT NULL,
        last_message_at TEXT NOT NULL,
        sender_names_json TEXT NOT NULL,
        sender_email TEXT NOT NULL,
        to_recipients_json TEXT NOT NULL DEFAULT '[]',
        cc_recipients_json TEXT NOT NULL DEFAULT '[]',
        label_ids_json TEXT NOT NULL,
        has_attachments INTEGER NOT NULL,
        is_unread INTEGER NOT NULL,
        PRIMARY KEY (account_id, id)
    );

    CREATE TABLE IF NOT EXISTS messages (
        id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        sender_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        snippet TEXT NOT NULL,
        received_at TEXT NOT NULL,
        label_ids_json TEXT NOT NULL,
        has_attachments INTEGER NOT NULL,
        is_unread INTEGER NOT NULL,
        to_recipients_json TEXT NOT NULL DEFAULT '[]',
        cc_recipients_json TEXT NOT NULL DEFAULT '[]',
        bcc_recipients_json TEXT NOT NULL DEFAULT '[]',
        body_html TEXT,
        body_plain TEXT,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        headers_json TEXT NOT NULL DEFAULT '[]',
        rfc_message_id TEXT,
        rfc_references TEXT,
        rfc_in_reply_to TEXT,
        PRIMARY KEY (account_id, id)
    );

    CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        thread_id TEXT,
        to_json TEXT NOT NULL,
        cc_json TEXT NOT NULL,
        bcc_json TEXT NOT NULL,
        subject TEXT NOT NULL,
        body_plain_text TEXT NOT NULL,
        body_html TEXT,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        reply_message_id TEXT,
        reply_references TEXT,
        send_at TEXT,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
        account_id TEXT PRIMARY KEY,
        history_id TEXT,
        last_full_sync_at TEXT,
        history_backfill_page_token TEXT,
        last_history_backfill_at TEXT,
        history_backfill_completed_at TEXT,
        history_backfill_pages_synced INTEGER NOT NULL DEFAULT 0,
        history_backfill_threads_synced INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS thread_reminders (
        account_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        reminder_at TEXT NOT NULL,
        PRIMARY KEY (account_id, thread_id)
    );

    CREATE TABLE IF NOT EXISTS follow_up_radar_state (
        account_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        sent_message_id TEXT NOT NULL,
        status TEXT NOT NULL,
        snoozed_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, thread_id, sent_message_id)
    );

    CREATE TABLE IF NOT EXISTS operator_home_state (
        scope_id TEXT PRIMARY KEY,
        agent_plan_json TEXT,
        selected_item_ids_json TEXT NOT NULL DEFAULT '[]',
        daily_briefing_json TEXT,
        last_auto_refresh_window TEXT,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reply_pipeline_state (
        account_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        source_received_at TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        resume_status TEXT,
        draft_id TEXT,
        draft_origin TEXT,
        has_placeholders INTEGER NOT NULL DEFAULT 0,
        waiting_since TEXT,
        due_at TEXT,
        snoozed_until TEXT,
        reason TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 0,
        resolved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, thread_id)
    );

    -- Senders the user successfully unsubscribed from. Cleanup Center excludes
    -- these so an approved unsubscribe removes the row even though List-Unsubscribe
    -- headers remain on historical messages in the local cache.
    CREATE TABLE IF NOT EXISTS unsubscribed_senders (
        account_id TEXT NOT NULL,
        sender_email TEXT NOT NULL,
        unsubscribed_at TEXT NOT NULL,
        thread_id TEXT,
        method TEXT,
        PRIMARY KEY (account_id, sender_email)
    );

    -- User-managed senders that should not appear in Cleanup suggestions.
    -- This preference is account-scoped and does not mutate Gmail state.
    CREATE TABLE IF NOT EXISTS cleanup_sender_exclusions (
        account_id TEXT NOT NULL,
        sender_email TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        excluded_at TEXT NOT NULL,
        PRIMARY KEY (account_id, sender_email)
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        account_id TEXT,
        thread_id TEXT,
        thread_subject TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sequence_index INTEGER NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        sources_json TEXT,
        FOREIGN KEY(conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mail_action_log (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        thread_id TEXT,
        draft_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        scheduled_at TEXT,
        completed_at TEXT,
        failure_message TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_drafts (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        body_plain TEXT NOT NULL,
        status TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_security (
        account_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        tracker_count INTEGER NOT NULL DEFAULT 0,
        phishing_link_count INTEGER NOT NULL DEFAULT 0,
        analyzed_at TEXT NOT NULL,
        PRIMARY KEY (account_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS mail_embeddings (
        account_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        model TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        vector_json TEXT NOT NULL,
        subject TEXT NOT NULL,
        sender TEXT NOT NULL,
        snippet TEXT NOT NULL,
        received_at TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        PRIMARY KEY (account_id, message_id, model)
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS application_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        occurred_at TEXT NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated_at ON ai_conversations(updated_at);
    CREATE INDEX IF NOT EXISTS idx_ai_conversations_account_id ON ai_conversations(account_id);
    CREATE INDEX IF NOT EXISTS idx_mail_action_log_created_at ON mail_action_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_mail_action_log_account_id ON mail_action_log(account_id);
    CREATE INDEX IF NOT EXISTS idx_follow_up_radar_state_account ON follow_up_radar_state(account_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_operator_home_state_updated_at ON operator_home_state(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reply_pipeline_account_status ON reply_pipeline_state(account_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reply_pipeline_draft ON reply_pipeline_state(draft_id);
    CREATE INDEX IF NOT EXISTS idx_reply_pipeline_account_draft ON reply_pipeline_state(account_id, draft_id);
    CREATE INDEX IF NOT EXISTS idx_unsubscribed_senders_account ON unsubscribed_senders(account_id, unsubscribed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cleanup_sender_exclusions_account ON cleanup_sender_exclusions(account_id, excluded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_drafts_thread ON agent_drafts(account_id, thread_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_message_security_thread ON message_security(account_id, thread_id);
    CREATE INDEX IF NOT EXISTS idx_mail_embeddings_account_model ON mail_embeddings(account_id, model, indexed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mail_embeddings_account_model_received ON mail_embeddings(account_id, model, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_threads_account_last_message_at ON threads(account_id, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_account_thread_received_at ON messages(account_id, thread_id, received_at);
    CREATE INDEX IF NOT EXISTS idx_messages_account_sender_received_at ON messages(account_id, sender_email COLLATE NOCASE, received_at);
    CREATE INDEX IF NOT EXISTS idx_contacts_account_email ON contacts(account_id, email);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_account_start ON calendar_events(account_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_account_calendar_start ON calendar_events(account_id, calendar_id, start_at);
    CREATE INDEX IF NOT EXISTS idx_calendar_lists_account_selected ON calendar_lists(account_id, is_selected, is_deleted);
    CREATE INDEX IF NOT EXISTS idx_calendar_mutations_created ON calendar_mutations(created_at);
    CREATE INDEX IF NOT EXISTS idx_calendar_notification_start ON calendar_notification_log(start_at);
    CREATE INDEX IF NOT EXISTS idx_application_logs_occurred_at ON application_logs(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_application_logs_level_id ON application_logs(level, id DESC);
    CREATE INDEX IF NOT EXISTS idx_application_logs_source_id ON application_logs(source, id DESC);
    CREATE VIRTUAL TABLE IF NOT EXISTS mail_search USING fts5(account_id, thread_id, message_id, subject, sender, snippet, body_plain);
    CREATE VIRTUAL TABLE IF NOT EXISTS calendar_search USING fts5(
        account_id UNINDEXED, calendar_id UNINDEXED, event_id UNINDEXED,
        summary, description, location, attendees
    );
    CREATE TRIGGER IF NOT EXISTS calendar_events_search_insert AFTER INSERT ON calendar_events BEGIN
        INSERT INTO calendar_search (account_id, calendar_id, event_id, summary, description, location, attendees)
        VALUES (new.account_id, new.calendar_id, new.id, new.summary, COALESCE(new.description, ''), COALESCE(new.location, ''), new.attendees_json);
    END;
    CREATE TRIGGER IF NOT EXISTS calendar_events_search_update AFTER UPDATE ON calendar_events BEGIN
        DELETE FROM calendar_search WHERE account_id = old.account_id AND calendar_id = old.calendar_id AND event_id = old.id;
        INSERT INTO calendar_search (account_id, calendar_id, event_id, summary, description, location, attendees)
        VALUES (new.account_id, new.calendar_id, new.id, new.summary, COALESCE(new.description, ''), COALESCE(new.location, ''), new.attendees_json);
    END;
    CREATE TRIGGER IF NOT EXISTS calendar_events_search_delete AFTER DELETE ON calendar_events BEGIN
        DELETE FROM calendar_search WHERE account_id = old.account_id AND calendar_id = old.calendar_id AND event_id = old.id;
    END;
  `);

  // Ensure newer columns are present (equivalent to addColumnIfMissing in Swift)
  const tablesInfo = [
    { table: 'accounts', column: 'avatar_url', definition: 'avatar_url TEXT' },
    { table: 'labels', column: 'type', definition: 'type TEXT NOT NULL DEFAULT \'user\'' },
    { table: 'labels', column: 'text_color_hex', definition: 'text_color_hex TEXT' },
    { table: 'labels', column: 'message_list_visibility', definition: 'message_list_visibility TEXT' },
    { table: 'labels', column: 'label_list_visibility', definition: 'label_list_visibility TEXT' },
    { table: 'contacts', column: 'local_display_name', definition: 'local_display_name TEXT' },
    { table: 'contacts', column: 'local_phone_numbers_json', definition: 'local_phone_numbers_json TEXT' },
    { table: 'contacts', column: 'local_organizations_json', definition: 'local_organizations_json TEXT' },
    { table: 'messages', column: 'attachments_json', definition: 'attachments_json TEXT NOT NULL DEFAULT \'[]\'' },
    { table: 'messages', column: 'to_recipients_json', definition: 'to_recipients_json TEXT NOT NULL DEFAULT \'[]\'' },
    { table: 'messages', column: 'cc_recipients_json', definition: 'cc_recipients_json TEXT NOT NULL DEFAULT \'[]\'' },
    { table: 'messages', column: 'bcc_recipients_json', definition: 'bcc_recipients_json TEXT NOT NULL DEFAULT \'[]\'' },
    { table: 'messages', column: 'headers_json', definition: 'headers_json TEXT NOT NULL DEFAULT \'[]\'' },
    { table: 'messages', column: 'rfc_message_id', definition: 'rfc_message_id TEXT' },
    { table: 'messages', column: 'rfc_references', definition: 'rfc_references TEXT' },
    { table: 'messages', column: 'rfc_in_reply_to', definition: 'rfc_in_reply_to TEXT' },
    { table: 'threads', column: 'to_recipients_json', definition: 'to_recipients_json TEXT NOT NULL DEFAULT \'[]\'' },
    { table: 'threads', column: 'cc_recipients_json', definition: 'cc_recipients_json TEXT NOT NULL DEFAULT \'[]\'' },
    { table: 'sync_state', column: 'history_backfill_page_token', definition: 'history_backfill_page_token TEXT' },
    { table: 'sync_state', column: 'last_history_backfill_at', definition: 'last_history_backfill_at TEXT' },
    { table: 'sync_state', column: 'history_backfill_completed_at', definition: 'history_backfill_completed_at TEXT' },
    { table: 'sync_state', column: 'history_backfill_pages_synced', definition: 'history_backfill_pages_synced INTEGER NOT NULL DEFAULT 0' },
    { table: 'sync_state', column: 'history_backfill_threads_synced', definition: 'history_backfill_threads_synced INTEGER NOT NULL DEFAULT 0' },
    { table: 'drafts', column: 'attachments_json', definition: 'attachments_json TEXT NOT NULL DEFAULT \'[]\'' },
    { table: 'drafts', column: 'body_html', definition: 'body_html TEXT' },
    { table: 'drafts', column: 'reply_message_id', definition: 'reply_message_id TEXT' },
    { table: 'drafts', column: 'reply_references', definition: 'reply_references TEXT' },
    { table: 'drafts', column: 'send_at', definition: 'send_at TEXT' },
    { table: 'mail_action_log', column: 'scheduled_at', definition: 'scheduled_at TEXT' },
    { table: 'mail_action_log', column: 'payload_json', definition: 'payload_json TEXT' },
    { table: 'mail_embeddings', column: 'vector_blob', definition: 'vector_blob BLOB' },
    { table: 'calendar_events', column: 'ical_uid', definition: 'ical_uid TEXT' },
    { table: 'calendar_events', column: 'conference_url', definition: 'conference_url TEXT' },
    { table: 'calendar_events', column: 'source_message_id', definition: 'source_message_id TEXT' },
    { table: 'calendar_events', column: 'source_thread_id', definition: 'source_thread_id TEXT' },
    { table: 'calendar_events', column: 'start_date', definition: 'start_date TEXT' },
    { table: 'calendar_events', column: 'end_date', definition: 'end_date TEXT' },
    { table: 'calendar_events', column: 'time_zone', definition: 'time_zone TEXT' },
    { table: 'calendar_events', column: 'etag', definition: 'etag TEXT' },
    { table: 'calendar_events', column: 'creator_email', definition: 'creator_email TEXT' },
    { table: 'calendar_events', column: 'recurring_event_id', definition: 'recurring_event_id TEXT' },
    { table: 'calendar_events', column: 'original_start_at', definition: 'original_start_at TEXT' },
    { table: 'calendar_events', column: 'recurrence_json', definition: 'recurrence_json TEXT NOT NULL DEFAULT \'[]\'' },
    { table: 'calendar_events', column: 'transparency', definition: 'transparency TEXT' },
    { table: 'calendar_events', column: 'visibility', definition: 'visibility TEXT' },
    { table: 'calendar_events', column: 'color_id', definition: 'color_id TEXT' },
    { table: 'calendar_events', column: 'self_response_status', definition: 'self_response_status TEXT' },
    { table: 'calendar_events', column: 'reminders_json', definition: 'reminders_json TEXT' },
    { table: 'calendar_notification_log', column: 'snoozed_until', definition: 'snoozed_until TEXT' },
    { table: 'calendar_sync_ranges', column: 'sync_token', definition: 'sync_token TEXT' },
    { table: 'ai_messages', column: 'sources_json', definition: 'sources_json TEXT' },
    { table: 'reply_pipeline_state', column: 'has_placeholders', definition: 'has_placeholders INTEGER NOT NULL DEFAULT 0' }
  ];

  for (const { table, column, definition } of tablesInfo) {
    try {
      const columns = db.pragma(`table_info(${table})`) as { name: string }[];
      const exists = columns.some(c => c.name === column);
      if (!exists) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
      }
    } catch (e) {
      console.error(`Migration error for ${table}.${column}:`, e);
    }
  }

  const indexedCalendarCount = db.prepare('SELECT COUNT(*) AS count FROM calendar_search').get() as { count: number };
  if (indexedCalendarCount.count === 0) {
    db.exec(`
      INSERT INTO calendar_search (account_id, calendar_id, event_id, summary, description, location, attendees)
      SELECT account_id, calendar_id, id, summary, COALESCE(description, ''), COALESCE(location, ''), attendees_json
      FROM calendar_events;
    `);
  }

  // Existing installs already have recipient metadata on cached messages. Keep
  // thread summaries fast by denormalizing those values once instead of joining
  // every message while loading the mailbox.
  try {
    const backfillKey = 'migration:threadRecipientsBackfilled';
    const completed = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(backfillKey);
    if (!completed) {
      db.transaction(() => {
        db.exec(`
          DROP TABLE IF EXISTS temp.thread_to_recipient_backfill;
          CREATE TEMP TABLE thread_to_recipient_backfill (
            account_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            recipients_json TEXT NOT NULL,
            PRIMARY KEY (account_id, thread_id)
          ) WITHOUT ROWID;

          INSERT INTO thread_to_recipient_backfill (account_id, thread_id, recipients_json)
          SELECT
            message.account_id,
            message.thread_id,
            json_group_array(json(recipient.value))
          FROM messages AS message,
               json_each(CASE
                 WHEN json_valid(message.to_recipients_json) THEN message.to_recipients_json
                 ELSE '[]'
               END) AS recipient
          GROUP BY message.account_id, message.thread_id;

          UPDATE threads AS thread
          SET to_recipients_json = (
            SELECT backfill.recipients_json
            FROM thread_to_recipient_backfill AS backfill
            WHERE backfill.account_id = thread.account_id
              AND backfill.thread_id = thread.id
          )
          WHERE thread.to_recipients_json = '[]'
            AND EXISTS (
              SELECT 1
              FROM thread_to_recipient_backfill AS backfill
              WHERE backfill.account_id = thread.account_id
                AND backfill.thread_id = thread.id
            );

          DROP TABLE thread_to_recipient_backfill;

          DROP TABLE IF EXISTS temp.thread_cc_recipient_backfill;
          CREATE TEMP TABLE thread_cc_recipient_backfill (
            account_id TEXT NOT NULL,
            thread_id TEXT NOT NULL,
            recipients_json TEXT NOT NULL,
            PRIMARY KEY (account_id, thread_id)
          ) WITHOUT ROWID;

          INSERT INTO thread_cc_recipient_backfill (account_id, thread_id, recipients_json)
          SELECT
            message.account_id,
            message.thread_id,
            json_group_array(json(recipient.value))
          FROM messages AS message,
               json_each(CASE
                 WHEN json_valid(message.cc_recipients_json) THEN message.cc_recipients_json
                 ELSE '[]'
               END) AS recipient
          GROUP BY message.account_id, message.thread_id;

          UPDATE threads AS thread
          SET cc_recipients_json = (
            SELECT backfill.recipients_json
            FROM thread_cc_recipient_backfill AS backfill
            WHERE backfill.account_id = thread.account_id
              AND backfill.thread_id = thread.id
          )
          WHERE thread.cc_recipients_json = '[]'
            AND EXISTS (
              SELECT 1
              FROM thread_cc_recipient_backfill AS backfill
              WHERE backfill.account_id = thread.account_id
                AND backfill.thread_id = thread.id
            );

          DROP TABLE thread_cc_recipient_backfill;
        `);
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(backfillKey, 'true');
      })();
    }
  } catch (e) {
    console.error('Migration error backfilling thread recipients:', e);
  }

  // Idempotent backfill: completed unsubscribe actions that predate the
  // unsubscribed_senders table still need to hide those senders in Cleanup.
  try {
    db.exec(`
      INSERT OR IGNORE INTO unsubscribed_senders (
        account_id, sender_email, unsubscribed_at, thread_id, method
      )
      SELECT
        al.account_id,
        lower(t.sender_email),
        COALESCE(al.completed_at, al.created_at),
        al.thread_id,
        NULL
      FROM mail_action_log al
      JOIN threads t
        ON t.account_id = al.account_id
       AND t.id = al.thread_id
      WHERE al.kind = 'unsubscribeSender'
        AND al.status = 'completed'
        AND t.sender_email IS NOT NULL
        AND trim(t.sender_email) != ''
    `);
  } catch (e) {
    console.error('Migration error backfilling unsubscribed_senders:', e);
  }
}
