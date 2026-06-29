export type AccountID = string;
export type ThreadID = string;
export type MessageID = string;
export type DraftID = string;

export interface Account {
  id: AccountID;
  email: string;
  displayName: string;
  colorHex: string;
  createdAt: string;
  avatarUrl?: string;
}

export interface GmailSignatureSyncResult {
  accountId: AccountID;
  sourceEmail: string;
  signatureHtml: string;
  signaturePlain: string;
  importedAt: string;
  found: boolean;
}

export interface OnboardAccountResult {
  account: Account;
  signatureSync?: GmailSignatureSyncResult;
  signatureSyncError?: string;
}

export type MailLabel = 'INBOX' | 'UNREAD' | 'SENT' | 'IMPORTANT' | 'CATEGORY_PRIMARY' | 'CATEGORY_UPDATES' | 'CATEGORY_PROMOTIONS' | string;

export interface MailThread {
  id: ThreadID;
  accountId: AccountID;
  subject: string;
  snippet: string;
  lastMessageAt: string;
  senderNames: string[];
  senderEmail: string;
  labelIds: MailLabel[];
  hasAttachments: boolean;
  isUnread: boolean;
  reminderAt?: string | null;
}

export interface Recipient {
  name: string;
  email: string;
}

export interface AttachmentMetadata {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  base64Data?: string;
  /** Gmail attachment part id, used to lazily fetch bytes for save/open/preview. */
  attachmentId?: string | null;
  /** MIME part id (e.g. "1.2") for inline resolution. */
  partId?: string | null;
  /** Content-ID header value (without angle brackets) for cid: inline images. */
  contentId?: string | null;
  /** True when the part is referenced inline in the HTML body (Content-Disposition: inline). */
  isInline?: boolean;
}

export interface MailMessage {
  id: MessageID;
  threadId: ThreadID;
  accountId: AccountID;
  senderName: string;
  senderEmail: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  labelIds: MailLabel[];
  hasAttachments: boolean;
  isUnread: boolean;
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  bodyHtml?: string | null;
  bodyPlain?: string | null;
  attachments: AttachmentMetadata[];
  rfcMessageId?: string | null;
  rfcReferences?: string | null;
  rfcInReplyTo?: string | null;
}

export interface Draft {
  id: DraftID;
  accountId: AccountID;
  threadId?: ThreadID | null;
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
  bodyPlain: string;
  attachments: AttachmentMetadata[];
  replyMessageId?: string | null;
  replyReferences?: string | null;
  updatedAt: string;
}

export interface SyncState {
  accountId: AccountID;
  historyId?: string | null;
  lastFullSyncAt?: string | null;
  historyBackfillPageToken?: string | null;
  lastHistoryBackfillAt?: string | null;
  historyBackfillCompletedAt?: string | null;
  historyBackfillPagesSynced: number;
  historyBackfillThreadsSynced: number;
}

export type ActionKind =
  | 'markDone'
  | 'restoreInbox'
  | 'markRead'
  | 'markUnread'
  | 'autoMarkRead'
  | 'send'
  | 'sendDraft'
  | 'setReminder'
  | 'clearReminder'
  | 'applyAIDraftPreview'
  | 'insertSnippet';
export type ActionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'pending_sync';

/** Human presentation for an action-log kind. `icon` is a lucide-react icon name
 *  (the renderer maps it to a component); keep this module free of React imports. */
export interface ActionKindMeta {
  title: string;
  icon: string;
}

export const ACTION_KIND_META: Record<ActionKind, ActionKindMeta> = {
  markDone: { title: 'Archived', icon: 'CheckCircle' },
  restoreInbox: { title: 'Moved to Inbox', icon: 'Inbox' },
  markRead: { title: 'Marked read', icon: 'MailOpen' },
  markUnread: { title: 'Marked unread', icon: 'Mail' },
  autoMarkRead: { title: 'Snoozed', icon: 'Clock' },
  send: { title: 'Sent message', icon: 'Send' },
  sendDraft: { title: 'Sent message', icon: 'Send' },
  setReminder: { title: 'Reminder set', icon: 'Clock' },
  clearReminder: { title: 'Reminder cleared', icon: 'BellOff' },
  applyAIDraftPreview: { title: 'Applied AI draft', icon: 'Sparkles' },
  insertSnippet: { title: 'Inserted snippet', icon: 'Braces' },
};

export interface MailActionLog {
  id: string;
  accountId: AccountID;
  threadId?: ThreadID | null;
  draftId?: DraftID | null;
  kind: ActionKind;
  status: ActionStatus;
  createdAt: string;
  completedAt?: string | null;
  failureMessage?: string | null;
}

export type AIProviderPreference = 'automatic' | 'openAI' | 'anthropic' | 'gemini' | 'openRouter' | 'deepSeek' | 'openAICompatible' | 'disabled';

export const AI_SECRET_STORED_PLACEHOLDER = '__DUMKA_SECRET_STORED__';
export const AI_SECRET_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENAI_COMPATIBLE_API_KEY'
] as const;

export type AISecretKey = typeof AI_SECRET_KEYS[number];

export interface AIProviderDescriptor {
  preference: AIProviderPreference;
  displayName: string;
  model: string;
  transport: string;
  status: string;
  capabilities: {
    canTriage: boolean;
    canSummarize: boolean;
    canDraft: boolean;
    latency?: string;
    context?: string;
    privacy?: string;
    responseMode?: string;
    bestFor?: string[];
    note?: string;
  };
}

export type AIAction = 'queue' | 'summarize' | 'draftReply' | 'rewrite' | 'translate';

export interface AIActionMeta {
  id: AIAction;
  label: string;
  icon: string; // lucide-react icon name
  requiresThread: boolean;
}

export const AI_ACTIONS: AIActionMeta[] = [
  { id: 'queue', label: 'Triage Queue', icon: 'ListChecks', requiresThread: false },
  { id: 'summarize', label: 'Summarize', icon: 'Text', requiresThread: true },
  { id: 'draftReply', label: 'Draft Reply', icon: 'PenLine', requiresThread: true },
  { id: 'rewrite', label: 'Rewrite', icon: 'Wand2', requiresThread: true },
  { id: 'translate', label: 'Translate', icon: 'Languages', requiresThread: true },
];

export type AIChatRole = 'user' | 'assistant' | 'system';

export interface AIChatMessage {
  id: string;
  role: AIChatRole;
  text: string;
}

export interface AIConversation {
  id: string;
  title: string;
  accountId?: AccountID | null;
  threadId?: ThreadID | null;
  threadSubject?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TriageRecommendation = 'reply' | 'reviewAttachment' | 'readNow' | 'setReminder' | 'markDoneCandidate';

export interface MailTriagePlanItem {
  threadId: ThreadID;
  subject: string;
  sender: string;
  recommendation: TriageRecommendation;
  reason: string;
  priority: number;
  automationRuleIds: string[];
}

export interface AutomationRulePreview {
  rules: {
    id: string;
    title: string;
    criteria: string;
    recommendation: TriageRecommendation;
    matchCount: number;
    priority: number;
  }[];
}

export interface MailTriagePlan {
  accountId: AccountID;
  sourceTitle: string;
  generatedAt: string;
  sourceThreadCount: number;
  items: MailTriagePlanItem[];
  intent: 'mailboxTriage' | 'automationCleanup';
  automationRulePreview?: AutomationRulePreview | null;
  selectedThreadIds?: string[];
}

export interface TabCategory {
  id: string;
  displayName: string;
  isSystem: boolean;
  colorHex?: string;
  active: boolean;
  accountId?: string;
}

export interface CustomClassifierRule {
  id: string;
  field: 'from' | 'subject';
  condition: 'contains' | 'equals' | 'startsWith' | 'endsWith';
  value: string;
  targetCategory: string;
  active: boolean;
  accountId?: string;
}

// === Unified AppSettings Schema ===

export interface ProfileSettings {
  fullName: string;
  role: string;
  company: string;
  timezone: string;
}

export interface GeneralSettings {
  startupBehavior: 'inbox' | 'lastSelectedAccount' | 'commandPalette';
  defaultSplitInbox: string;
  showBottomShortcutBar: boolean;
  showRightContextPanel: boolean;
  openLinksInBackground: boolean;
  confirmBeforeQuitting: boolean;
  keepDraftsAcrossLaunches: boolean;
}

export interface MailCategoryRule {
  id: string;
  field: 'senderDomain' | 'subject' | 'from' | 'to' | 'cc' | 'systemSignal';
  operation: 'contains' | 'equals' | 'startsWith' | 'endsWith';
  value: string;
  isNegated: boolean;
  accountId?: string;
}

export interface BuiltInMailCategorySettings {
  id: string;
  title: string;
  isEnabled: boolean;
  matchMode: 'all' | 'any';
  extraRules: MailCategoryRule[];
  colorHex?: string;
}

export interface CustomMailCategorySettings {
  id: string;
  title: string;
  isEnabled: boolean;
  matchMode: 'all' | 'any';
  rules: MailCategoryRule[];
  accountId?: string;
  colorHex?: string;
}

export interface InboxSettings {
  enableSplitInbox: boolean;
  showUnreadFirst: boolean;
  autoMarkReadOnOpen: boolean;
  openNextThreadAfterDone: boolean;
  archiveOnDoneShortcut: boolean;
  enableReminders: boolean;
  enableFollowUps: boolean;
  showPurchasesSplit: boolean;
  showLinkedInSplit: boolean;
  showAutomationSplit: boolean;
  collapseReadThreads: boolean;
  categories: {
    builtIn: BuiltInMailCategorySettings[];
    custom: CustomMailCategorySettings[];
  };
}

export interface ComposeSettings {
  defaultSignature: string;
  defaultSignatureHtml: string;
  signatureFormat: 'plain' | 'html';
  autoSaveDrafts: boolean;
  spellCheck: boolean;
  autocorrect: boolean;
  smartCompose: boolean;
  alwaysReplyAll: boolean;
  sendUndoDelay: number;
  defaultFontSize: 'compact' | 'normal' | 'large';
}

export interface ShortcutSettings {
  mode: 'superhuman' | 'gmail' | 'appleMail';
  singleKeyShortcuts: boolean;
  commandPaletteEnabled: boolean;
  vimNavigation: boolean;
  composeShortcutEnabled: boolean;
  reminderShortcutEnabled: boolean;
}

export interface SnippetSettings {
  enabled: boolean;
  expandWithTab: boolean;
  includeSignature: boolean;
  defaultSnippetTrigger: string;
  defaultSnippet: string;
}

export interface MailNotificationSettings {
  desktopNotifications: boolean;
  sound: boolean;
  notifyImportantOnly: boolean;
  reminderNotifications: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export interface AIFallbackSettings {
  isEnabled: boolean;
  orderText: string;
}

export interface AIProviderConfiguration {
  id: string;
  provider: AIProviderPreference;
  displayName: string;
  defaultModel: string;
  modelSelectionMode: 'catalog' | 'custom';
  baseURL: string;
  isEnabled: boolean;
  canRemove: boolean;
}

export interface AISettings {
  provider: AIProviderPreference;
  globalDefaultModel: string;
  fallback: AIFallbackSettings;
  providerConfigurations: AIProviderConfiguration[];
  replyTone: 'direct' | 'concise' | 'warm' | 'formal';
  allowMailBodyContext: boolean;
  savePromptHistory: boolean;
  suggestDrafts: boolean;
  suggestAutoArchive: boolean;
  suggestLabels: boolean;
  translationEnabled: boolean;
  personalizationNotes: string;
}

export interface PrivacySettings {
  loadRemoteImages: boolean;
  includeBodiesInSearchIndex: boolean;
  redactLogs: boolean;
  useKeychainForSecrets: boolean;
  clearCacheOnDisconnect: boolean;
  diagnosticsEnabled: boolean;
}

export interface AppearanceSettings {
  theme: 'system' | 'light' | 'dark';
  density: 'compact' | 'comfortable' | 'spacious';
  accentColorHex: string;
  showAvatars: boolean;
  useTranslucentPanels: boolean;
  enablePreviewPane: boolean;
  fontScale: number;
  readerMaxWidth?: 'full' | 'wide' | 'standard' | 'narrow';
}

export interface MCPServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'sse';
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface SearchProviderConfig {
  enabled: boolean;
  apiKey: string;
}

export interface SearchProvidersSettings {
  tavily: SearchProviderConfig;
  brave: SearchProviderConfig;
  perplexity: SearchProviderConfig;
}

export interface AppSettings {
  settingsSchemaVersion: number;
  profile: ProfileSettings;
  general: GeneralSettings;
  inbox: InboxSettings;
  compose: ComposeSettings;
  shortcuts: ShortcutSettings;
  snippets: SnippetSettings;
  notifications: MailNotificationSettings;
  ai: AISettings;
  privacy: PrivacySettings;
  appearance: AppearanceSettings;
  mcpServers?: MCPServerConfig[];
  searchProviders?: SearchProvidersSettings;
}

// === Triage action preview structures ===

export interface MailTriageActionPreview {
  threadId: string;
  recommendation: TriageRecommendation;
  isSelected: boolean;
  eligibility: 'ready' | 'requiresRemoteGmailCredential' | 'requiresReconnect' | 'remoteUnavailable' | 'remoteUnknown' | 'focusOnly';
  scope: 'gmail' | 'local' | 'focus';
  selectionPolicy: 'autoSelected' | 'explicitOptIn' | 'previewOnly';
}

export interface MailTriageQueueReadiness {
  summary: string;
  level: 'ready' | 'warning';
  executableActionCount: number;
  blockedActionCount: number;
  canApplySelected: boolean;
  applyButtonTitle: string;
}
