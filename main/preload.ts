import { contextBridge, ipcRenderer } from 'electron';
import {
  Account,
  AgentPlanItem,
  AgentPlanValidationResult,
  CalendarAttendeeResponse,
  CalendarEventCreateInput,
  CalendarEventDeleteOptions,
  CalendarEventUpdateInput,
  CalendarFreeBusyRequest,
  CalendarInvite,
  CleanupSenderExclusion,
  ContactCard,
  ContactGroup,
  MailLabelDefinition,
  MailThread,
  MailMessage,
  MailboxDelta,
  Draft,
  SyncState,
  MailActionLog,
  AIConversation,
  AIChatMessage,
  DailyBriefing,
  DailyBriefingBuildOptions,
  EmbeddingIndexReindexOptions,
  EmbeddingIndexStatus,
  FollowUpRadarListOptions,
  AIProviderPreference,
  FollowUpRadarResult,
  OperatorHomeStateSnapshot,
  ReplyPipelineCandidate,
  ReplyPipelineDraftResult,
  ReplyPipelineState,
  ThreadReaderPayload,
  MCPServerConfig
} from '../shared/types';
import { AIRequest } from './ai';
import type { AutoUpdateStatus } from '../shared/autoUpdate';
import type { SystemLogEntry, SystemLogPage, SystemLogQuery, SystemLogStats } from '../shared/systemLogs';

contextBridge.exposeInMainWorld('electronAPI', {
  // Accounts
  listAccounts: () => ipcRenderer.invoke('db:listAccounts'),
  getAccount: (id: string) => ipcRenderer.invoke('db:getAccount', id),
  saveAccount: (account: Account) => ipcRenderer.invoke('db:saveAccount', account),
  deleteAccount: (id: string, options?: { purgeCache?: boolean }) => ipcRenderer.invoke('db:deleteAccount', id, options),

  // Threads
  listThreads: (accountId: string) => ipcRenderer.invoke('db:listThreads', accountId),
  listThreadsForAccounts: (accountIds: string[]) => ipcRenderer.invoke('db:listThreadsForAccounts', accountIds),
  saveThreads: (threads: MailThread[]) => ipcRenderer.invoke('db:saveThreads', threads),
  deleteThread: (accountId: string, threadId: string) => ipcRenderer.invoke('db:deleteThread', accountId, threadId),

  // Messages
  listMessagesForThread: (accountId: string, threadId: string) => ipcRenderer.invoke('db:listMessagesForThread', accountId, threadId),
  getThreadReaderPayload: (accountId: string, threadId: string): Promise<ThreadReaderPayload> => ipcRenderer.invoke('api:getThreadReaderPayload', accountId, threadId),
  saveMessages: (messages: MailMessage[], options?: { notifyOfNew?: boolean }) => ipcRenderer.invoke('db:saveMessages', messages, options),
  listEmailSuggestions: (accountId?: string, limit?: number) => ipcRenderer.invoke('db:listEmailSuggestions', accountId, limit),

  // Labels, contacts, and calendar cache
  getGoogleIntegrationStatus: (accountId: string) => ipcRenderer.invoke('db:getGoogleIntegrationStatus', accountId),
  listLabels: (accountId: string) => ipcRenderer.invoke('db:listLabels', accountId),
  listContacts: (accountId: string, query?: string) => ipcRenderer.invoke('db:listContacts', accountId, query),
  updateContactLocal: (accountId: string, contactId: string, patch: Partial<ContactCard>) => ipcRenderer.invoke('db:updateContactLocal', accountId, contactId, patch),
  listContactGroups: (accountId: string) => ipcRenderer.invoke('db:listContactGroups', accountId),
  saveContactGroup: (group: ContactGroup) => ipcRenderer.invoke('db:saveContactGroup', group),
  deleteContactGroup: (accountId: string, groupId: string) => ipcRenderer.invoke('db:deleteContactGroup', accountId, groupId),
  listCalendarEvents: (accountId: string, startAt: string, endAt: string) => ipcRenderer.invoke('db:listCalendarEvents', accountId, startAt, endAt),
  listCalendars: (accountId: string) => ipcRenderer.invoke('db:listCalendars', accountId),

  // Drafts
  listDrafts: (accountId: string) => ipcRenderer.invoke('db:listDrafts', accountId),
  getDraft: (id: string) => ipcRenderer.invoke('db:getDraft', id),
  saveDraft: (draft: Draft) => ipcRenderer.invoke('db:saveDraft', draft),
  deleteDraft: (id: string) => ipcRenderer.invoke('db:deleteDraft', id),

  // Reminders
  getReminder: (accountId: string, threadId: string) => ipcRenderer.invoke('db:getReminder', accountId, threadId),
  saveReminder: (accountId: string, threadId: string, reminderAt: string, proposalItem?: AgentPlanItem) => ipcRenderer.invoke('db:saveReminder', accountId, threadId, reminderAt, proposalItem),
  deleteReminder: (accountId: string, threadId: string) => ipcRenderer.invoke('db:deleteReminder', accountId, threadId),

  // Sync State
  getSyncState: (accountId: string) => ipcRenderer.invoke('db:getSyncState', accountId),
  saveSyncState: (state: SyncState) => ipcRenderer.invoke('db:saveSyncState', state),

  // Action Log
  listActionLog: (accountId: string) => ipcRenderer.invoke('db:listActionLog', accountId),
  saveActionLog: (log: MailActionLog) => ipcRenderer.invoke('db:saveActionLog', log),

  // Cleanup exclusions
  listCleanupExclusions: (accountIds: string[]): Promise<CleanupSenderExclusion[]> => ipcRenderer.invoke('db:listCleanupExclusions', accountIds),
  saveCleanupExclusion: (exclusion: CleanupSenderExclusion): Promise<CleanupSenderExclusion> => ipcRenderer.invoke('db:saveCleanupExclusion', exclusion),
  deleteCleanupExclusion: (accountId: string, senderEmail: string): Promise<void> => ipcRenderer.invoke('db:deleteCleanupExclusion', accountId, senderEmail),

  // Operator Home state
  getOperatorHomeState: (scopeId: string): Promise<OperatorHomeStateSnapshot | null> => ipcRenderer.invoke('db:getOperatorHomeState', scopeId),
  saveOperatorHomeState: (snapshot: OperatorHomeStateSnapshot) => ipcRenderer.invoke('db:saveOperatorHomeState', snapshot),
  finalizeOperatorHomeAutoRefreshWindow: (scopeId: string, windowKey: string, briefing: DailyBriefing): Promise<boolean> => ipcRenderer.invoke('db:finalizeOperatorHomeAutoRefreshWindow', scopeId, windowKey, briefing),

  // AI Conversations
  listConversations: (accountId: string) => ipcRenderer.invoke('db:listConversations', accountId),
  getConversationMessages: (id: string) => ipcRenderer.invoke('db:getConversationMessages', id),
  saveConversation: (conv: AIConversation, messages: AIChatMessage[]) => ipcRenderer.invoke('db:saveConversation', conv, messages),
  deleteConversation: (id: string) => ipcRenderer.invoke('db:deleteConversation', id),

  // Search FTS
  searchFTS: (accountId: string, query: string) => ipcRenderer.invoke('db:searchFTS', accountId, query),

  // OAuth onboarding
  onboardAccount: (emailHint?: string) => ipcRenderer.invoke('api:onboardAccount', emailHint),
  verifyTokenExists: (email: string) => ipcRenderer.invoke('api:verifyTokenExists', email),
  disconnectAccount: (email: string, options?: { purgeCache?: boolean; revokeToken?: boolean }) => ipcRenderer.invoke('api:disconnectAccount', email, options),
  authorizeGoogleIntegration: (email: string, integration: 'calendar' | 'contacts') => ipcRenderer.invoke('api:authorizeGoogleIntegration', email, integration),

  // Follow-up Radar
  listFollowUpRadarItems: (accountId: string, options?: FollowUpRadarListOptions): Promise<FollowUpRadarResult> => ipcRenderer.invoke('api:listFollowUpRadarItems', accountId, options),
  dismissFollowUpRadarItem: (accountId: string, threadId: string, sentMessageId: string) => ipcRenderer.invoke('api:dismissFollowUpRadarItem', accountId, threadId, sentMessageId),
  snoozeFollowUpRadarItem: (accountId: string, threadId: string, sentMessageId: string, snoozedUntil: string) => ipcRenderer.invoke('api:snoozeFollowUpRadarItem', accountId, threadId, sentMessageId, snoozedUntil),

  // Reply Pipeline
  reconcileReplyPipeline: (candidates: ReplyPipelineCandidate[]): Promise<ReplyPipelineState[]> => ipcRenderer.invoke('api:reconcileReplyPipeline', candidates),
  listReplyPipeline: (accountIds: string[]): Promise<ReplyPipelineState[]> => ipcRenderer.invoke('api:listReplyPipeline', accountIds),
  prepareReplyPipelineDraft: (accountId: string, threadId: string): Promise<ReplyPipelineDraftResult> => ipcRenderer.invoke('api:prepareReplyPipelineDraft', accountId, threadId),
  snoozeReplyPipelineItem: (accountId: string, threadId: string, snoozedUntil: string): Promise<ReplyPipelineState> => ipcRenderer.invoke('api:snoozeReplyPipelineItem', accountId, threadId, snoozedUntil),
  suppressReplyPipelineItem: (accountId: string, threadId: string): Promise<ReplyPipelineState> => ipcRenderer.invoke('api:suppressReplyPipelineItem', accountId, threadId),
  resolveReplyPipelineItem: (accountId: string, threadId: string): Promise<ReplyPipelineState> => ipcRenderer.invoke('api:resolveReplyPipelineItem', accountId, threadId),

  // Gmail sync & mutations
  syncMailboxNow: (accountIds: string[]): Promise<MailboxDelta[]> => ipcRenderer.invoke('api:syncMailboxNow', accountIds),
  syncInbox: (email: string) => ipcRenderer.invoke('api:syncInbox', email),
  syncSent: (email: string) => ipcRenderer.invoke('api:syncSent', email),
  syncIncremental: (email: string, startHistoryId: string) => ipcRenderer.invoke('api:syncIncremental', email, startHistoryId),
  syncBackfillPage: (email: string, pageToken?: string) => ipcRenderer.invoke('api:syncBackfillPage', email, pageToken),
  runBackfillPage: (email: string) => ipcRenderer.invoke('api:runBackfillPage', email),
  syncGmailSignature: (email: string) => ipcRenderer.invoke('api:syncGmailSignature', email),
  fetchThreadDetail: (email: string, threadId: string) => ipcRenderer.invoke('api:fetchThreadDetail', email, threadId),
  fetchRawMessage: (email: string, messageId: string) => ipcRenderer.invoke('api:fetchRawMessage', email, messageId),
  syncLabels: (email: string) => ipcRenderer.invoke('api:syncLabels', email),
  createLabel: (email: string, name: string) => ipcRenderer.invoke('api:createLabel', email, name),
  updateLabel: (email: string, labelId: string, patch: Partial<MailLabelDefinition>) => ipcRenderer.invoke('api:updateLabel', email, labelId, patch),
  deleteLabel: (email: string, labelId: string) => ipcRenderer.invoke('api:deleteLabel', email, labelId),
  modifyLabels: (email: string, threadId: string, addLabelIds: string[], removeLabelIds: string[], actionId?: string, actionKind?: string, payloadJson?: string) => ipcRenderer.invoke('api:modifyLabels', email, threadId, addLabelIds, removeLabelIds, actionId, actionKind, payloadJson),
  sendDraft: (email: string, draft: any, actionId?: string) => ipcRenderer.invoke('api:sendDraft', email, draft, actionId),
  fetchAttachmentData: (email: string, messageId: string, attachmentId: string) => ipcRenderer.invoke('api:fetchAttachmentData', email, messageId, attachmentId),
  downloadAttachment: (
    email: string,
    messageId: string,
    attachmentId: string,
    filename: string,
    options?: { saveAs?: boolean; base64Data?: string | null },
  ) => ipcRenderer.invoke('api:downloadAttachment', email, messageId, attachmentId, filename, options),
  openAttachment: (
    email: string,
    messageId: string,
    attachmentId: string,
    filename: string,
    mimeType: string,
    options?: { base64Data?: string | null },
  ) => ipcRenderer.invoke('api:openAttachment', email, messageId, attachmentId, filename, mimeType, options),
  chooseAttachmentDownloadFolder: () => ipcRenderer.invoke('api:chooseAttachmentDownloadFolder'),
  getSystemDownloadsPath: () => ipcRenderer.invoke('api:getSystemDownloadsPath'),
  revealInFolder: (filePath: string) => ipcRenderer.invoke('api:revealInFolder', filePath),
  uploadAttachment: () => ipcRenderer.invoke('api:uploadAttachment'),
  uploadAttachments: () => ipcRenderer.invoke('api:uploadAttachments'),
  syncContacts: (email: string) => ipcRenderer.invoke('api:syncContacts', email),
  syncCalendarEvents: (email: string, startAt: string, endAt: string) => ipcRenderer.invoke('api:syncCalendarEvents', email, startAt, endAt),
  syncCalendarLists: (email: string) => ipcRenderer.invoke('api:syncCalendarLists', email),
  searchCalendarEvents: (accountIds: string[], query: string, limit?: number) => ipcRenderer.invoke('db:searchCalendarEvents', accountIds, query, limit),
  pickCalendarIcsFile: () => ipcRenderer.invoke('api:pickCalendarIcsFile'),
  exportCalendarEventIcs: (event: import('../shared/types').CalendarEvent) => ipcRenderer.invoke('api:exportCalendarEventIcs', event),
  queryCalendarFreeBusy: (email: string, input: CalendarFreeBusyRequest) => ipcRenderer.invoke('api:queryCalendarFreeBusy', email, input),
  respondToCalendarInvite: (email: string, invite: CalendarInvite, responseStatus: CalendarAttendeeResponse, actionId?: string) => ipcRenderer.invoke('api:respondToCalendarInvite', email, invite, responseStatus, actionId),
  respondToCalendarEvent: (email: string, calendarId: string, eventId: string, responseStatus: CalendarAttendeeResponse, actionId?: string) => ipcRenderer.invoke('api:respondToCalendarEvent', email, calendarId, eventId, responseStatus, actionId),
  addCalendarEvent: (email: string, invite: CalendarInvite, actionId?: string) => ipcRenderer.invoke('api:addCalendarEvent', email, invite, actionId),
  importCalendarInvite: (email: string, invite: CalendarInvite, calendarId: string) => ipcRenderer.invoke('api:importCalendarInvite', email, invite, calendarId),
  createGoogleMeetDraftEvent: (email: string, input: { summary: string; attendees: string[]; durationMinutes: number }) => ipcRenderer.invoke('api:createGoogleMeetDraftEvent', email, input),
  createCalendarEvent: (email: string, input: CalendarEventCreateInput, actionId?: string) => ipcRenderer.invoke('api:createCalendarEvent', email, input, actionId),
  updateCalendarEvent: (email: string, input: CalendarEventUpdateInput, actionId?: string) => ipcRenderer.invoke('api:updateCalendarEvent', email, input, actionId),
  deleteCalendarEvent: (email: string, calendarId: string, eventId: string, actionId?: string, options?: CalendarEventDeleteOptions) => ipcRenderer.invoke('api:deleteCalendarEvent', email, calendarId, eventId, actionId, options),

  // AI
  getAIProviderDescriptor: (preference: AIProviderPreference, overrideModel?: string) => ipcRenderer.invoke('api:getAIProviderDescriptor', preference, overrideModel),
  completeAI: (request: AIRequest, preference: AIProviderPreference, overrideModel?: string) => ipcRenderer.invoke('api:completeAI', request, preference, overrideModel),
  validateAgentActionProposal: (item: AgentPlanItem): Promise<AgentPlanValidationResult> => ipcRenderer.invoke('api:validateAgentActionProposal', item),
  getThreadAgentInsights: (accountId: string, threadId: string) => ipcRenderer.invoke('api:getThreadAgentInsights', accountId, threadId),
  buildDailyBriefing: (accountId: string, options?: DailyBriefingBuildOptions) => ipcRenderer.invoke('api:buildDailyBriefing', accountId, options),
  dismissAgentDraftSuggestion: (id: string) => ipcRenderer.invoke('api:dismissAgentDraftSuggestion', id),
  markAgentDraftSuggestionApplied: (id: string) => ipcRenderer.invoke('api:markAgentDraftSuggestionApplied', id),
  testEmbeddingConfig: (settings: any) => ipcRenderer.invoke('api:testEmbeddingConfig', settings),
  getEmbeddingIndexStatus: (accountId: string): Promise<EmbeddingIndexStatus> => ipcRenderer.invoke('api:getEmbeddingIndexStatus', accountId),
  startEmbeddingReindex: (accountId: string, options?: EmbeddingIndexReindexOptions): Promise<EmbeddingIndexStatus> => ipcRenderer.invoke('api:startEmbeddingReindex', accountId, options),
  cancelEmbeddingReindex: (accountId: string): Promise<EmbeddingIndexStatus> => ipcRenderer.invoke('api:cancelEmbeddingReindex', accountId),
  deleteEmbeddingIndex: (accountId: string, model: string): Promise<{ deleted: number; status: EmbeddingIndexStatus }> => ipcRenderer.invoke('api:deleteEmbeddingIndex', accountId, model),
  deleteOtherEmbeddingIndexes: (accountId: string): Promise<{ deleted: number; status: EmbeddingIndexStatus }> => ipcRenderer.invoke('api:deleteOtherEmbeddingIndexes', accountId),
  searchSemantic: (accountId: string, query: string, limit?: number) => ipcRenderer.invoke('api:searchSemantic', accountId, query, limit),
  unsubscribeThread: (email: string, threadId: string, actionId?: string, sourceMessageId?: string) => ipcRenderer.invoke('api:unsubscribeThread', email, threadId, actionId, sourceMessageId),
  listCleanupSenderStats: (accountId: string) => ipcRenderer.invoke('api:listCleanupSenderStats', accountId),
  listRecentSenderMessages: (accountId: string, senderEmail: string, limit = 3): Promise<MailMessage[]> => ipcRenderer.invoke('api:listRecentSenderMessages', accountId, senderEmail, limit),
  loadAIConfig: () => ipcRenderer.invoke('api:loadAIConfig'),
  saveAIConfig: (config: Record<string, string>) => ipcRenderer.invoke('api:saveAIConfig', config),
  listProviderModels: (provider: string, apiKey: string, baseUrl?: string) => ipcRenderer.invoke('api:listProviderModels', provider, apiKey, baseUrl),
  verifyMCPServer: (config: MCPServerConfig) => ipcRenderer.invoke('api:verifyMCPServer', config),
  setMenuCommandState: (state: { canCreateDraft?: boolean; canUndo?: boolean }) => ipcRenderer.invoke('api:setMenuCommandState', state),
  undoFocusedInput: () => ipcRenderer.invoke('api:undoFocusedInput'),
  getAutoUpdateStatus: (): Promise<AutoUpdateStatus> => ipcRenderer.invoke('api:getAutoUpdateStatus'),
  checkForAppUpdates: (): Promise<AutoUpdateStatus> => ipcRenderer.invoke('api:checkForAppUpdates'),
  installDownloadedAppUpdate: (): Promise<AutoUpdateStatus> => ipcRenderer.invoke('api:installDownloadedAppUpdate'),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('db:getSetting', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('db:setSetting', key, value),

  // Local application logs
  listSystemLogs: (query?: SystemLogQuery): Promise<SystemLogPage> => ipcRenderer.invoke('api:listSystemLogs', query),
  getSystemLogStats: (): Promise<SystemLogStats> => ipcRenderer.invoke('api:getSystemLogStats'),
  clearSystemLogs: (): Promise<number> => ipcRenderer.invoke('api:clearSystemLogs'),
  onSystemLogEntry: (callback: (entry: SystemLogEntry) => void) => {
    const listener = (_: unknown, entry: SystemLogEntry) => callback(entry);
    ipcRenderer.on('api:systemLogEntry', listener);
    return () => ipcRenderer.off('api:systemLogEntry', listener);
  },

  // Native Find in Page
  findInPage: (text: string, options?: any) => ipcRenderer.invoke('api:findInPage', text, options),
  stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => ipcRenderer.invoke('api:stopFindInPage', action),
  onFoundInPageResult: (callback: (result: any) => void) => {
    const listener = (_: any, result: any) => callback(result);
    ipcRenderer.on('api:foundInPageResult', listener);
    return () => {
      ipcRenderer.off('api:foundInPageResult', listener);
    };
  },
  onOpenThread: (callback: (data: { accountId: string; threadId: string }) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on('api:openThread', listener);
    return () => {
      ipcRenderer.off('api:openThread', listener);
    };
  },
  onCalendarChanged: (callback: (data: { accountId: string }) => void) => {
    const listener = (_: unknown, data: { accountId: string }) => callback(data);
    ipcRenderer.on('api:calendarChanged', listener);
    return () => ipcRenderer.off('api:calendarChanged', listener);
  },
  onOpenCalendar: (callback: (data: { accountId: string; eventId?: string }) => void) => {
    const listener = (_: unknown, data: { accountId: string; eventId?: string }) => callback(data);
    ipcRenderer.on('api:openCalendar', listener);
    return () => ipcRenderer.off('api:openCalendar', listener);
  },
  onRemindersDue: (callback: (data: { accountId: string; threadId: string }[]) => void) => {
    const listener = (_: any, data: any) => callback(Array.isArray(data) ? data : []);
    ipcRenderer.on('api:remindersDue', listener);
    return () => {
      ipcRenderer.off('api:remindersDue', listener);
    };
  },
  onReplyPipelineUpdated: (callback: (data: { accountId: string; threadId: string }) => void) => {
    const listener = (_: unknown, data: { accountId: string; threadId: string }) => callback(data);
    ipcRenderer.on('api:replyPipelineUpdated', listener);
    return () => {
      ipcRenderer.off('api:replyPipelineUpdated', listener);
    };
  },
  onMailboxDelta: (callback: (delta: MailboxDelta) => void) => {
    const listener = (_: unknown, delta: MailboxDelta) => callback(delta);
    ipcRenderer.on('api:mailboxDelta', listener);
    return () => {
      ipcRenderer.off('api:mailboxDelta', listener);
    };
  },
  onAutoUpdateStatus: (callback: (status: AutoUpdateStatus) => void) => {
    const listener = (_: any, status: AutoUpdateStatus) => callback(status);
    ipcRenderer.on('api:autoUpdateStatus', listener);
    return () => {
      ipcRenderer.off('api:autoUpdateStatus', listener);
    };
  },
  getPendingOpenThread: () => ipcRenderer.invoke('api:getPendingOpenThread'),
  onExecuteCommand: (callback: (cmdId: string) => void) => {
    const listener = (_: any, cmdId: string) => callback(cmdId);
    ipcRenderer.on('menu:executeCommand', listener);
    return () => {
      ipcRenderer.off('menu:executeCommand', listener);
    };
  }
});
