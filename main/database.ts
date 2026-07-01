import Database from 'better-sqlite3';
import path from 'path';
import { runMigrations } from './migrations';
import { ensureAppSupportDir } from './appPaths';

let dbInstance: Database.Database | null = null;

export function initializeDatabase(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = path.join(ensureAppSupportDir(), 'database.sqlite');
  
  dbInstance = new Database(dbPath);
  dbInstance.pragma('foreign_keys = ON');
  dbInstance.pragma('busy_timeout = 5000');
  dbInstance.pragma('journal_mode = WAL');

  runMigrations(dbInstance);

  return dbInstance;
}

export function getDatabase(): Database.Database {
  if (!dbInstance) {
    return initializeDatabase();
  }
  return dbInstance;
}

// Re-export all repository implementations
export {
  AccountsRepo,
  AccountIntegrationsRepo,
  CalendarEventsRepo,
  ContactGroupsRepo,
  ContactsRepo,
  ThreadsRepo,
  LabelsRepo,
  MessagesRepo,
  EmailSuggestionsRepo,
  SearchRepo,
  RemindersRepo,
  SyncStateRepo,
  ActionLogRepo,
  DraftsRepo,
  AIConversationsRepo,
  AgentDraftsRepo,
  MailEmbeddingsRepo,
  MessageSecurityRepo,
  SettingsRepo
} from './repositories';
