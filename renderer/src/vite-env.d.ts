/// <reference types="vite/client" />
import {
  Account,
  AttachmentMetadata,
  AttachmentOpenBlocked,
  AttachmentOpenResult,
  AttachmentSaveCancelled,
  AttachmentSaveResult,
  CalendarAttendeeResponse,
  CalendarEvent,
  CalendarEventCreateInput,
  CalendarEventUpdateInput,
  CalendarFreeBusyRequest,
  CalendarFreeBusyResult,
  CalendarInvite,
  ContactCard,
  ContactGroup,
  Draft,
  EmailAddressSuggestion,
  GmailSignatureSyncResult,
  GoogleIntegrationStatus,
  MailActionLog,
  MailLabelDefinition,
  MailMessage,
  MailboxSearchSource,
  MailThread,
  OnboardAccountResult,
  SyncState,
  AIConversation,
  AIChatMessage,
  AIEmbeddingSettings,
  DailyBriefing,
  DailyBriefingBuildOptions,
  EmbeddingIndexReindexOptions,
  EmbeddingIndexStatus,
  FollowUpRadarListOptions,
  FollowUpRadarResult,
  AIProviderPreference,
  AIProviderDescriptor,
  MCPServerConfig,
  SemanticSearchOutcome,
  SenderCleanupStat,
  ThreadAgentInsights
} from '../../shared/types';
import { AIRequest } from '../../main/ai';
import type { AutoUpdateStatus } from '../../shared/autoUpdate';

export interface IElectronAPI {
  // Accounts
  listAccounts: () => Promise<Account[]>;
  getAccount: (id: string) => Promise<Account | null>;
  saveAccount: (account: Account) => Promise<void>;
  deleteAccount: (id: string, options?: { purgeCache?: boolean }) => Promise<void>;

  // Threads
  listThreads: (accountId: string) => Promise<MailThread[]>;
  saveThreads: (threads: MailThread[]) => Promise<void>;
  deleteThread: (accountId: string, threadId: string) => Promise<void>;

  // Messages
  listMessagesForThread: (accountId: string, threadId: string) => Promise<MailMessage[]>;
  saveMessages: (messages: MailMessage[], options?: { notifyOfNew?: boolean }) => Promise<void>;
  listEmailSuggestions: (accountId?: string, limit?: number) => Promise<EmailAddressSuggestion[]>;
  getGoogleIntegrationStatus: (accountId: string) => Promise<GoogleIntegrationStatus>;
  listLabels: (accountId: string) => Promise<MailLabelDefinition[]>;
  listContacts: (accountId: string, query?: string) => Promise<ContactCard[]>;
  updateContactLocal: (accountId: string, contactId: string, patch: Partial<ContactCard>) => Promise<void>;
  listContactGroups: (accountId: string) => Promise<ContactGroup[]>;
  saveContactGroup: (group: ContactGroup) => Promise<void>;
  deleteContactGroup: (accountId: string, groupId: string) => Promise<void>;
  listCalendarEvents: (accountId: string, startAt: string, endAt: string) => Promise<CalendarEvent[]>;

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
  onboardAccount: (emailHint?: string) => Promise<OnboardAccountResult>;
  verifyTokenExists: (email: string) => Promise<boolean>;
  disconnectAccount: (email: string, options?: { purgeCache?: boolean; revokeToken?: boolean }) => Promise<{ revokeStatus: 'skipped' | 'missing' | 'revoked' | 'failed' }>;
  authorizeGoogleIntegration: (email: string, integration: 'calendar' | 'contacts') => Promise<GoogleIntegrationStatus>;

  // Follow-up Radar
  listFollowUpRadarItems: (accountId: string, options?: FollowUpRadarListOptions) => Promise<FollowUpRadarResult>;
  dismissFollowUpRadarItem: (accountId: string, threadId: string, sentMessageId: string) => Promise<void>;
  snoozeFollowUpRadarItem: (accountId: string, threadId: string, sentMessageId: string, snoozedUntil: string) => Promise<void>;

  // Gmail sync & mutations
  syncInbox: (email: string) => Promise<{ threads: MailThread[]; messages: MailMessage[]; historyId: string }>;
  syncSent: (email: string) => Promise<{ threads: MailThread[]; messages: MailMessage[]; historyId: string }>;
  syncIncremental: (email: string, startHistoryId: string) => Promise<{ updatedThreadIds: string[]; deletedThreadIds: string[]; historyId: string }>;
  syncBackfillPage: (email: string, pageToken?: string) => Promise<{ threads: MailThread[]; messages: MailMessage[]; nextPageToken?: string }>;
  runBackfillPage: (email: string) => Promise<{ threadsIndexed: number; pageThreadsIndexed: number; completed: boolean; busy: boolean }>;
  syncGmailSignature: (email: string) => Promise<GmailSignatureSyncResult>;
  syncLabels: (email: string) => Promise<MailLabelDefinition[]>;
  createLabel: (email: string, name: string) => Promise<MailLabelDefinition>;
  updateLabel: (email: string, labelId: string, patch: Partial<MailLabelDefinition>) => Promise<MailLabelDefinition>;
  deleteLabel: (email: string, labelId: string) => Promise<void>;
  fetchThreadDetail: (email: string, threadId: string) => Promise<MailMessage[]>;
  fetchRawMessage: (email: string, messageId: string) => Promise<string>;
  modifyLabels: (email: string, threadId: string, addLabelIds: string[], removeLabelIds: string[], actionId?: string, actionKind?: MailActionLog['kind'], payloadJson?: string) => Promise<{ offline: boolean }>;
  sendDraft: (email: string, draft: any, actionId?: string) => Promise<{ offline: boolean; threadId?: string }>;
  fetchAttachmentData: (email: string, messageId: string, attachmentId: string) => Promise<string>;
  downloadAttachment: (
    email: string,
    messageId: string,
    attachmentId: string,
    filename: string,
    options?: { saveAs?: boolean; base64Data?: string | null },
  ) => Promise<AttachmentSaveResult | AttachmentSaveCancelled>;
  openAttachment: (
    email: string,
    messageId: string,
    attachmentId: string,
    filename: string,
    mimeType: string,
    options?: { base64Data?: string | null },
  ) => Promise<AttachmentOpenResult | AttachmentOpenBlocked>;
  chooseAttachmentDownloadFolder: () => Promise<string | null>;
  getSystemDownloadsPath: () => Promise<string>;
  revealInFolder: (filePath: string) => Promise<void>;
  uploadAttachment: () => Promise<AttachmentMetadata | null>;
  syncContacts: (email: string) => Promise<{ contacts: ContactCard[]; groups: ContactGroup[] }>;
  syncCalendarEvents: (email: string, startAt: string, endAt: string) => Promise<CalendarEvent[]>;
  queryCalendarFreeBusy: (email: string, input: CalendarFreeBusyRequest) => Promise<CalendarFreeBusyResult>;
  respondToCalendarInvite: (email: string, invite: CalendarInvite, responseStatus: CalendarAttendeeResponse, actionId?: string) => Promise<CalendarEvent>;
  addCalendarEvent: (email: string, invite: CalendarInvite, actionId?: string) => Promise<CalendarEvent>;
  createGoogleMeetDraftEvent: (email: string, input: { summary: string; attendees: string[]; durationMinutes: number }) => Promise<CalendarEvent>;
  createCalendarEvent: (email: string, input: CalendarEventCreateInput, actionId?: string) => Promise<CalendarEvent>;
  updateCalendarEvent: (email: string, input: CalendarEventUpdateInput, actionId?: string) => Promise<CalendarEvent>;
  deleteCalendarEvent: (email: string, calendarId: string, eventId: string, actionId?: string) => Promise<void>;

  // AI
  getAIProviderDescriptor: (preference: AIProviderPreference, overrideModel?: string) => Promise<AIProviderDescriptor>;
  completeAI: (request: AIRequest, preference: AIProviderPreference, overrideModel?: string) => Promise<{ text: string; sources?: MailboxSearchSource[] }>;
  getThreadAgentInsights: (accountId: string, threadId: string) => Promise<ThreadAgentInsights>;
  buildDailyBriefing: (accountId: string, options?: DailyBriefingBuildOptions) => Promise<DailyBriefing>;
  dismissAgentDraftSuggestion: (id: string) => Promise<void>;
  markAgentDraftSuggestionApplied: (id: string) => Promise<void>;
  testEmbeddingConfig: (settings: AIEmbeddingSettings) => Promise<{ model: string; dimensions: number; provider: AIEmbeddingSettings['provider'] }>;
  getEmbeddingIndexStatus: (accountId: string) => Promise<EmbeddingIndexStatus>;
  startEmbeddingReindex: (accountId: string, options?: EmbeddingIndexReindexOptions) => Promise<EmbeddingIndexStatus>;
  cancelEmbeddingReindex: (accountId: string) => Promise<EmbeddingIndexStatus>;
  deleteEmbeddingIndex: (accountId: string, model: string) => Promise<{ deleted: number; status: EmbeddingIndexStatus }>;
  deleteOtherEmbeddingIndexes: (accountId: string) => Promise<{ deleted: number; status: EmbeddingIndexStatus }>;
  searchSemantic: (accountId: string, query: string, limit?: number) => Promise<SemanticSearchOutcome>;
  unsubscribeThread: (email: string, threadId: string, actionId?: string, sourceMessageId?: string) => Promise<{ method: string; archived: boolean }>;
  listCleanupSenderStats: (accountId: string) => Promise<SenderCleanupStat[]>;
  loadAIConfig: () => Promise<Record<string, string>>;
  saveAIConfig: (config: Record<string, string>) => Promise<void>;
  listProviderModels: (provider: string, apiKey: string, baseUrl?: string) => Promise<string[]>;
  verifyMCPServer: (config: MCPServerConfig) => Promise<{ success: boolean; toolsCount?: number; error?: string }>;
  setMenuCommandState: (state: { canCreateDraft?: boolean; canUndo?: boolean }) => Promise<void>;
  getAutoUpdateStatus: () => Promise<AutoUpdateStatus>;
  checkForAppUpdates: () => Promise<AutoUpdateStatus>;
  installDownloadedAppUpdate: () => Promise<AutoUpdateStatus>;

  // Settings
  getSetting: (key: string) => Promise<string | null>;
  setSetting: (key: string, value: string) => Promise<void>;

  // Native Find in Page
  findInPage: (text: string, options?: any) => Promise<number>;
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => Promise<void>;
  onFoundInPageResult: (callback: (result: any) => void) => () => void;
  onOpenThread: (callback: (data: { accountId: string; threadId: string }) => void) => () => void;
  onRemindersDue: (callback: (data: { accountId: string; threadId: string }[]) => void) => () => void;
  onAutoUpdateStatus: (callback: (status: AutoUpdateStatus) => void) => () => void;
  getPendingOpenThread: () => Promise<{ accountId: string; threadId: string } | null>;
  onExecuteCommand: (callback: (cmdId: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
