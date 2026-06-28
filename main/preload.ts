import { contextBridge, ipcRenderer } from 'electron';
import { Account, MailThread, MailMessage, Draft, SyncState, MailActionLog, AIConversation, AIChatMessage, AIProviderPreference } from '../shared/types';
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

  // Gmail sync & mutations
  syncInbox: (email: string) => ipcRenderer.invoke('api:syncInbox', email),
  syncIncremental: (email: string, startHistoryId: string) => ipcRenderer.invoke('api:syncIncremental', email, startHistoryId),
  syncBackfillPage: (email: string, pageToken?: string) => ipcRenderer.invoke('api:syncBackfillPage', email, pageToken),
  fetchThreadDetail: (email: string, threadId: string) => ipcRenderer.invoke('api:fetchThreadDetail', email, threadId),
  fetchRawMessage: (email: string, messageId: string) => ipcRenderer.invoke('api:fetchRawMessage', email, messageId),
  modifyLabels: (email: string, threadId: string, addLabelIds: string[], removeLabelIds: string[], actionId?: string) => ipcRenderer.invoke('api:modifyLabels', email, threadId, addLabelIds, removeLabelIds, actionId),
  sendDraft: (email: string, draft: any, actionId?: string) => ipcRenderer.invoke('api:sendDraft', email, draft, actionId),
  downloadAttachment: (email: string, messageId: string, attachmentId: string, filename: string) => ipcRenderer.invoke('api:downloadAttachment', email, messageId, attachmentId, filename),
  uploadAttachment: () => ipcRenderer.invoke('api:uploadAttachment'),

  // AI
  getAIProviderDescriptor: (preference: AIProviderPreference, overrideModel?: string) => ipcRenderer.invoke('api:getAIProviderDescriptor', preference, overrideModel),
  completeAI: (request: AIRequest, preference: AIProviderPreference, overrideModel?: string) => ipcRenderer.invoke('api:completeAI', request, preference, overrideModel),
  loadAIConfig: () => ipcRenderer.invoke('api:loadAIConfig'),
  saveAIConfig: (config: Record<string, string>) => ipcRenderer.invoke('api:saveAIConfig', config),
  listProviderModels: (provider: string, apiKey: string, baseUrl?: string) => ipcRenderer.invoke('api:listProviderModels', provider, apiKey, baseUrl),
  verifyMCPServer: (config: any) => ipcRenderer.invoke('api:verifyMCPServer', config),

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
  getPendingOpenThread: () => ipcRenderer.invoke('api:getPendingOpenThread')
});
