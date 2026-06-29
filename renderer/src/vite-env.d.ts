/// <reference types="vite/client" />
import { Account, MailThread, MailMessage, Draft, SyncState, MailActionLog, AIConversation, AIChatMessage, AIProviderPreference, AIProviderDescriptor, MCPServerConfig } from '../../shared/types';
import { AIRequest } from '../../main/ai';

export interface IElectronAPI {
  // Accounts
  listAccounts: () => Promise<Account[]>;
  getAccount: (id: string) => Promise<Account | null>;
  saveAccount: (account: Account) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;

  // Threads
  listThreads: (accountId: string) => Promise<MailThread[]>;
  saveThreads: (threads: MailThread[]) => Promise<void>;
  deleteThread: (accountId: string, threadId: string) => Promise<void>;

  // Messages
  listMessagesForThread: (accountId: string, threadId: string) => Promise<MailMessage[]>;
  saveMessages: (messages: MailMessage[], options?: { notifyOfNew?: boolean }) => Promise<void>;

  // Drafts
  listDrafts: (accountId: string) => Promise<Draft[]>;
  getDraft: (id: string) => Promise<Draft | null>;
  saveDraft: (draft: Draft) => Promise<void>;
  deleteDraft: (id: string) => Promise<void>;

  // Reminders
  getReminder: (accountId: string, threadId: string) => Promise<string | null>;
  saveReminder: (accountId: string, threadId: string, reminderAt: string) => Promise<void>;
  deleteReminder: (accountId: string, threadId: string) => Promise<void>;

  // Sync State
  getSyncState: (accountId: string) => Promise<SyncState | null>;
  saveSyncState: (state: SyncState) => Promise<void>;

  // Action Log
  listActionLog: (accountId: string) => Promise<MailActionLog[]>;
  saveActionLog: (log: MailActionLog) => Promise<void>;

  // AI Conversations
  listConversations: (accountId: string) => Promise<AIConversation[]>;
  getConversationMessages: (id: string) => Promise<AIChatMessage[]>;
  saveConversation: (conv: AIConversation, messages: AIChatMessage[]) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;

  // Search FTS
  searchFTS: (accountId: string, query: string) => Promise<{ threadId: string; messageId: string }[]>;

  // OAuth onboarding
  onboardAccount: (emailHint?: string) => Promise<Account>;
  verifyTokenExists: (email: string) => Promise<boolean>;

  // Gmail sync & mutations
  syncInbox: (email: string) => Promise<{ threads: MailThread[]; messages: MailMessage[]; historyId: string }>;
  syncIncremental: (email: string, startHistoryId: string) => Promise<{ updatedThreadIds: string[]; deletedThreadIds: string[]; historyId: string }>;
  syncBackfillPage: (email: string, pageToken?: string) => Promise<{ threads: MailThread[]; messages: MailMessage[]; nextPageToken?: string }>;
  runBackfillPage: (email: string) => Promise<{ threadsIndexed: number; pageThreadsIndexed: number; completed: boolean; busy: boolean }>;
  fetchThreadDetail: (email: string, threadId: string) => Promise<MailMessage[]>;
  fetchRawMessage: (email: string, messageId: string) => Promise<string>;
  modifyLabels: (email: string, threadId: string, addLabelIds: string[], removeLabelIds: string[], actionId?: string) => Promise<{ offline: boolean }>;
  sendDraft: (email: string, draft: any, actionId?: string) => Promise<{ offline: boolean; threadId?: string }>;
  fetchAttachmentData: (email: string, messageId: string, attachmentId: string) => Promise<string>;
  downloadAttachment: (email: string, messageId: string, attachmentId: string, filename: string) => Promise<void>;
  uploadAttachment: () => Promise<AttachmentMetadata | null>;

  // AI
  getAIProviderDescriptor: (preference: AIProviderPreference, overrideModel?: string) => Promise<AIProviderDescriptor>;
  completeAI: (request: AIRequest, preference: AIProviderPreference, overrideModel?: string) => Promise<{ text: string }>;
  loadAIConfig: () => Promise<Record<string, string>>;
  saveAIConfig: (config: Record<string, string>) => Promise<void>;
  listProviderModels: (provider: string, apiKey: string, baseUrl?: string) => Promise<string[]>;
  verifyMCPServer: (config: MCPServerConfig) => Promise<{ success: boolean; toolsCount?: number; error?: string }>;
  setMenuCommandState: (state: { canCreateDraft?: boolean; canUndo?: boolean }) => Promise<void>;

  // Settings
  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<void>;

  // Native Find in Page
  findInPage: (text: string, options?: any) => Promise<number>;
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => Promise<void>;
  onFoundInPageResult: (callback: (result: any) => void) => () => void;
  onOpenThread: (callback: (data: { accountId: string; threadId: string }) => void) => () => void;
  getPendingOpenThread: () => Promise<{ accountId: string; threadId: string } | null>;
  onExecuteCommand: (callback: (cmdId: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
