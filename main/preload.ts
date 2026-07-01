import { contextBridge, ipcRenderer } from 'electron';
import {
  Account,
  CalendarAttendeeResponse,
  CalendarEventCreateInput,
  CalendarEventUpdateInput,
  CalendarFreeBusyRequest,
  CalendarInvite,
  ContactCard,
  ContactGroup,
  MailLabelDefinition,
  MailThread,
  MailMessage,
  Draft,
  SyncState,
  MailActionLog,
  AIConversation,
  AIChatMessage,
  AIProviderPreference
} from '../shared/types';
import { AIRequest } from './ai';

contextBridge.exposeInMainWorld('electronAPI', {
  // Accounts
  listAccounts: () => ipcRenderer.invoke('db:listAccounts'),
  getAccount: (id: string) => ipcRenderer.invoke('db:getAccount', id),
  saveAccount: (account: Account) => ipcRenderer.invoke('db:saveAccount', account),
  deleteAccount: (id: string) => ipcRenderer.invoke('db:deleteAccount', id),

  // Threads
  listThreads: (accountId: string) => ipcRenderer.invoke('db:listThreads', accountId),
  saveThreads: (threads: MailThread[]) => ipcRenderer.invoke('db:saveThreads', threads),
  deleteThread: (accountId: string, threadId: string) => ipcRenderer.invoke('db:deleteThread', accountId, threadId),

  // Messages
  listMessagesForThread: (accountId: string, threadId: string) => ipcRenderer.invoke('db:listMessagesForThread', accountId, threadId),
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

  // Drafts
  listDrafts: (accountId: string) => ipcRenderer.invoke('db:listDrafts', accountId),
  getDraft: (id: string) => ipcRenderer.invoke('db:getDraft', id),
  saveDraft: (draft: Draft) => ipcRenderer.invoke('db:saveDraft', draft),
  deleteDraft: (id: string) => ipcRenderer.invoke('db:deleteDraft', id),

  // Reminders
  getReminder: (accountId: string, threadId: string) => ipcRenderer.invoke('db:getReminder', accountId, threadId),
  saveReminder: (accountId: string, threadId: string, reminderAt: string) => ipcRenderer.invoke('db:saveReminder', accountId, threadId, reminderAt),
  deleteReminder: (accountId: string, threadId: string) => ipcRenderer.invoke('db:deleteReminder', accountId, threadId),

  // Sync State
  getSyncState: (accountId: string) => ipcRenderer.invoke('db:getSyncState', accountId),
  saveSyncState: (state: SyncState) => ipcRenderer.invoke('db:saveSyncState', state),

  // Action Log
  listActionLog: (accountId: string) => ipcRenderer.invoke('db:listActionLog', accountId),
  saveActionLog: (log: MailActionLog) => ipcRenderer.invoke('db:saveActionLog', log),

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
  authorizeGoogleIntegration: (email: string, integration: 'calendar' | 'contacts') => ipcRenderer.invoke('api:authorizeGoogleIntegration', email, integration),

  // Gmail sync & mutations
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
  downloadAttachment: (email: string, messageId: string, attachmentId: string, filename: string) => ipcRenderer.invoke('api:downloadAttachment', email, messageId, attachmentId, filename),
  uploadAttachment: () => ipcRenderer.invoke('api:uploadAttachment'),
  syncContacts: (email: string) => ipcRenderer.invoke('api:syncContacts', email),
  syncCalendarEvents: (email: string, startAt: string, endAt: string) => ipcRenderer.invoke('api:syncCalendarEvents', email, startAt, endAt),
  queryCalendarFreeBusy: (email: string, input: CalendarFreeBusyRequest) => ipcRenderer.invoke('api:queryCalendarFreeBusy', email, input),
  respondToCalendarInvite: (email: string, invite: CalendarInvite, responseStatus: CalendarAttendeeResponse, actionId?: string) => ipcRenderer.invoke('api:respondToCalendarInvite', email, invite, responseStatus, actionId),
  addCalendarEvent: (email: string, invite: CalendarInvite, actionId?: string) => ipcRenderer.invoke('api:addCalendarEvent', email, invite, actionId),
  createGoogleMeetDraftEvent: (email: string, input: { summary: string; attendees: string[]; durationMinutes: number }) => ipcRenderer.invoke('api:createGoogleMeetDraftEvent', email, input),
  createCalendarEvent: (email: string, input: CalendarEventCreateInput, actionId?: string) => ipcRenderer.invoke('api:createCalendarEvent', email, input, actionId),
  updateCalendarEvent: (email: string, input: CalendarEventUpdateInput, actionId?: string) => ipcRenderer.invoke('api:updateCalendarEvent', email, input, actionId),
  deleteCalendarEvent: (email: string, calendarId: string, eventId: string, actionId?: string) => ipcRenderer.invoke('api:deleteCalendarEvent', email, calendarId, eventId, actionId),

  // AI
  getAIProviderDescriptor: (preference: AIProviderPreference, overrideModel?: string) => ipcRenderer.invoke('api:getAIProviderDescriptor', preference, overrideModel),
  completeAI: (request: AIRequest, preference: AIProviderPreference, overrideModel?: string) => ipcRenderer.invoke('api:completeAI', request, preference, overrideModel),
  getThreadAgentInsights: (accountId: string, threadId: string) => ipcRenderer.invoke('api:getThreadAgentInsights', accountId, threadId),
  dismissAgentDraftSuggestion: (id: string) => ipcRenderer.invoke('api:dismissAgentDraftSuggestion', id),
  markAgentDraftSuggestionApplied: (id: string) => ipcRenderer.invoke('api:markAgentDraftSuggestionApplied', id),
  testEmbeddingConfig: (settings: any) => ipcRenderer.invoke('api:testEmbeddingConfig', settings),
  searchSemantic: (accountId: string, query: string, limit?: number) => ipcRenderer.invoke('api:searchSemantic', accountId, query, limit),
  unsubscribeThread: (email: string, threadId: string, actionId?: string) => ipcRenderer.invoke('api:unsubscribeThread', email, threadId, actionId),
  loadAIConfig: () => ipcRenderer.invoke('api:loadAIConfig'),
  saveAIConfig: (config: Record<string, string>) => ipcRenderer.invoke('api:saveAIConfig', config),
  listProviderModels: (provider: string, apiKey: string, baseUrl?: string) => ipcRenderer.invoke('api:listProviderModels', provider, apiKey, baseUrl),
  verifyMCPServer: (config: any) => ipcRenderer.invoke('api:verifyMCPServer', config),
  setMenuCommandState: (state: { canCreateDraft?: boolean; canUndo?: boolean }) => ipcRenderer.invoke('api:setMenuCommandState', state),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('db:getSetting', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('db:setSetting', key, value),

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
  getPendingOpenThread: () => ipcRenderer.invoke('api:getPendingOpenThread'),
  onExecuteCommand: (callback: (cmdId: string) => void) => {
    const listener = (_: any, cmdId: string) => callback(cmdId);
    ipcRenderer.on('menu:executeCommand', listener);
    return () => {
      ipcRenderer.off('menu:executeCommand', listener);
    };
  }
});
