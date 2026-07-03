import type { AppLanguage } from './i18n';

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

export interface ComposeSignatureSettings {
  signaturePlain: string;
  signatureHtml: string;
  signatureFormat: 'plain' | 'html';
  sourceEmail?: string;
  importedAt?: string;
}

export type MailLabel = 'INBOX' | 'UNREAD' | 'SENT' | 'IMPORTANT' | 'CATEGORY_PRIMARY' | 'CATEGORY_UPDATES' | 'CATEGORY_PROMOTIONS' | string;
export type MailboxView = 'inbox' | 'drafts' | 'sent' | 'trash' | 'spam' | 'muted';

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

export interface MailHeader {
  name: string;
  value: string;
}

export type EmailAddressSuggestionKind = 'address' | 'contact' | 'group';

export interface EmailAddressSuggestion extends Recipient {
  sourceCount: number;
  lastMessageAt?: string | null;
  kind?: EmailAddressSuggestionKind;
  groupId?: string;
  members?: Recipient[];
  subtitle?: string;
}

export type MailLabelType = 'system' | 'user';

export interface MailLabelDefinition {
  id: string;
  accountId: AccountID;
  name: string;
  type: MailLabelType;
  colorHex?: string | null;
  textColorHex?: string | null;
  messageListVisibility?: 'show' | 'hide' | null;
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide' | null;
}

export interface GoogleIntegrationStatus {
  accountId: AccountID;
  gmailEnabled: boolean;
  calendarEnabled: boolean;
  contactsEnabled: boolean;
  updatedAt: string;
}

export interface ContactCard {
  id: string;
  accountId: AccountID;
  resourceName?: string | null;
  etag?: string | null;
  displayName: string;
  email: string;
  photoUrl?: string | null;
  phoneNumbers: string[];
  organizations: string[];
  notes?: string | null;
  groupIds: string[];
  updatedAt: string;
}

export interface ContactGroup {
  id: string;
  accountId: AccountID;
  name: string;
  memberCount: number;
  updatedAt: string;
}

export type CalendarAttendeeResponse = 'needsAction' | 'accepted' | 'declined' | 'tentative';

export interface CalendarAttendee {
  email: string;
  displayName?: string | null;
  responseStatus?: CalendarAttendeeResponse | null;
  optional?: boolean | null;
}

export interface CalendarEvent {
  id: string;
  accountId: AccountID;
  calendarId: string;
  iCalUID?: string | null;
  summary: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  status?: string | null;
  htmlLink?: string | null;
  conferenceUrl?: string | null;
  organizerEmail?: string | null;
  attendees: CalendarAttendee[];
  sourceMessageId?: MessageID | null;
  updatedAt: string;
}

export type CalendarEventRecurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface CalendarEventCreateInput {
  summary: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt: string;
  attendees?: string[];
  conferenceProvider?: 'none' | 'googleMeet';
  recurrence?: CalendarEventRecurrence;
  timeZone?: string | null;
}

export interface CalendarEventUpdateInput extends CalendarEventCreateInput {
  eventId: string;
  calendarId?: string | null;
}

export interface CalendarBusyInterval {
  calendarId: string;
  startAt: string;
  endAt: string;
}

export interface CalendarFreeBusyRequest {
  timeMin: string;
  timeMax: string;
  attendees: string[];
  timeZone?: string | null;
}

export interface CalendarFreeBusyCalendar {
  id: string;
  busy: CalendarBusyInterval[];
  errors?: Array<{ reason?: string; domain?: string }>;
}

export interface CalendarFreeBusyResult {
  calendars: CalendarFreeBusyCalendar[];
  busy: CalendarBusyInterval[];
}

export interface CalendarInvite {
  uid: string;
  method?: string | null;
  summary: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  startDate?: string | null;
  endDate?: string | null;
  timeZone?: string | null;
  organizerEmail?: string | null;
  attendees: CalendarAttendee[];
  recurrenceRules?: string[];
  sequence?: number | null;
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
  headers?: MailHeader[];
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
  bodyHtml?: string | null;
  attachments: AttachmentMetadata[];
  replyMessageId?: string | null;
  replyReferences?: string | null;
  sendAt?: string | null;
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
  | 'moveToTrash'
  | 'restoreFromTrash'
  | 'reportSpam'
  | 'restoreFromSpam'
  | 'muteThread'
  | 'unmuteThread'
  | 'applyLabel'
  | 'removeLabel'
  | 'moveToLabel'
  | 'autoMarkRead'
  | 'send'
  | 'sendDraft'
  | 'setReminder'
  | 'clearReminder'
  | 'calendarRSVP'
  | 'unsubscribeSender'
  | 'addCalendarEvent'
  | 'createCalendarEvent'
  | 'updateCalendarEvent'
  | 'deleteCalendarEvent'
  | 'applyAIDraftPreview'
  | 'insertSnippet'
  | 'forwardThread'
  | 'autoReply';
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
  moveToTrash: { title: 'Moved to Trash', icon: 'Trash2' },
  restoreFromTrash: { title: 'Restored from Trash', icon: 'ArchiveRestore' },
  reportSpam: { title: 'Moved to Spam', icon: 'OctagonAlert' },
  restoreFromSpam: { title: 'Moved to Inbox', icon: 'Inbox' },
  muteThread: { title: 'Ignored thread', icon: 'BellOff' },
  unmuteThread: { title: 'Unmuted thread', icon: 'Bell' },
  applyLabel: { title: 'Label applied', icon: 'Tag' },
  removeLabel: { title: 'Label removed', icon: 'Tag' },
  moveToLabel: { title: 'Moved to label', icon: 'FolderInput' },
  autoMarkRead: { title: 'Snoozed', icon: 'Clock' },
  send: { title: 'Sent message', icon: 'Send' },
  sendDraft: { title: 'Sent message', icon: 'Send' },
  setReminder: { title: 'Reminder set', icon: 'Clock' },
  clearReminder: { title: 'Reminder cleared', icon: 'BellOff' },
  calendarRSVP: { title: 'RSVP sent', icon: 'CalendarCheck' },
  unsubscribeSender: { title: 'Unsubscribed', icon: 'MailMinus' },
  addCalendarEvent: { title: 'Calendar event added', icon: 'CalendarPlus' },
  createCalendarEvent: { title: 'Calendar event created', icon: 'CalendarPlus' },
  updateCalendarEvent: { title: 'Calendar event updated', icon: 'CalendarCheck' },
  deleteCalendarEvent: { title: 'Calendar event deleted', icon: 'Trash2' },
  applyAIDraftPreview: { title: 'Applied AI draft', icon: 'Sparkles' },
  insertSnippet: { title: 'Inserted snippet', icon: 'Braces' },
  forwardThread: { title: 'Forwarded thread', icon: 'Forward' },
  autoReply: { title: 'Auto replied', icon: 'Reply' },
};

export interface MailActionLog {
  id: string;
  accountId: AccountID;
  threadId?: ThreadID | null;
  draftId?: DraftID | null;
  kind: ActionKind;
  status: ActionStatus;
  createdAt: string;
  scheduledAt?: string | null;
  completedAt?: string | null;
  failureMessage?: string | null;
  payloadJson?: string | null;
}

export type AIProviderPreference = 'automatic' | 'openAI' | 'anthropic' | 'gemini' | 'openRouter' | 'deepSeek' | 'openAICompatible' | 'disabled';

export const AI_SECRET_STORED_PLACEHOLDER = '__DUMKA_SECRET_STORED__';
export const AI_SECRET_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
  'OPENAI_COMPATIBLE_API_KEY',
  'MISTRAL_API_KEY',
  'COHERE_API_KEY',
  'VOYAGE_API_KEY',
  'DASHSCOPE_API_KEY'
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

export type DailyBriefingCategory = 'needsReply' | 'waitingOnMe' | 'fyi' | 'riskOrNoise';

export type DailyBriefingAction = 'openThread' | 'draftReply' | 'setReminder' | 'archive' | 'applyLabel';

export interface DailyBriefingSourceCitation {
  accountId: AccountID;
  threadId: ThreadID;
  messageId: MessageID;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
  receivedAt: string;
  evidence: string;
}

export interface DailyBriefingItem {
  id: string;
  accountId: AccountID;
  threadId: ThreadID;
  category: DailyBriefingCategory;
  title: string;
  summary: string;
  reason: string;
  priority: number;
  source: DailyBriefingSourceCitation;
  suggestedActions: DailyBriefingAction[];
  semanticScore?: number | null;
  riskLevel?: MailSecurityRiskLevel | null;
  trackerCount: number;
  phishingLinkCount: number;
  isUnread: boolean;
  receivedAt: string;
}

export interface DailyBriefingSettings {
  enabled: boolean;
  lookbackHours: number;
  maxItems: number;
  includeRead: boolean;
  includeFyi: boolean;
  includeRiskAndNoise: boolean;
  useSemanticSearch: boolean;
  defaultReminderHour: number;
}

export interface DailyBriefingBuildOptions extends Partial<DailyBriefingSettings> {
  nowIso?: string;
}

export interface DailyBriefingCoverage {
  accountId: AccountID;
  generatedAt: string;
  lookbackHours: number;
  candidateThreadCount: number;
  includedItemCount: number;
  semanticSearchEnabled: boolean;
  semanticMatches: number;
  bodyContextIncluded: boolean;
  warnings: string[];
}

export interface DailyBriefing {
  id: string;
  accountId: AccountID;
  title: string;
  generatedAt: string;
  items: DailyBriefingItem[];
  coverage: DailyBriefingCoverage;
  settings: DailyBriefingSettings;
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
  language: AppLanguage;
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

export type MailRuleActionType = 'archive' | 'applyLabel' | 'moveToLabel' | 'forward' | 'autoReply';

export interface MailRuleAction {
  id: string;
  type: MailRuleActionType;
  labelId?: string;
  forwardTo?: string;
  replyBody?: string;
}

export interface MailAutomationRule {
  id: string;
  title: string;
  isEnabled: boolean;
  accountId?: string;
  matchMode: 'all' | 'any';
  conditions: MailCategoryRule[];
  actions: MailRuleAction[];
}

export interface MailRulesSettings {
  enabled: boolean;
  rules: MailAutomationRule[];
}

export interface ComposeSettings {
  defaultSignature: string;
  defaultSignatureHtml: string;
  signatureFormat: 'plain' | 'html';
  signaturesByAccount: Record<AccountID, ComposeSignatureSettings>;
  autoSaveDrafts: boolean;
  spellCheck: boolean;
  autocorrect: boolean;
  smartCompose: boolean;
  alwaysReplyAll: boolean;
  sendUndoDelay: number;
  defaultFontSize: 'compact' | 'normal' | 'large';
}

export interface CalendarSettings {
  showAgendaInRightPanel: boolean;
  defaultMeetingDurationMinutes: number;
  availabilityLookaheadDays: number;
  availabilityStartTime: string;
  availabilityEndTime: string;
  availabilitySlotStepMinutes: number;
  calendlyUrl: string;
  calComUrl: string;
  defaultConferenceProvider: 'googleMeet' | 'calendly' | 'calCom' | 'none';
}

export interface ShortcutSettings {
  mode: 'superhuman' | 'gmail' | 'appleMail';
  singleKeyShortcuts: boolean;
  commandPaletteEnabled: boolean;
  vimNavigation: boolean;
  composeShortcutEnabled: boolean;
  reminderShortcutEnabled: boolean;
}

export interface SnippetTemplate {
  id: string;
  title: string;
  trigger: string;
  body: string;
  includeSignature: boolean;
}

export interface SnippetSettings {
  enabled: boolean;
  expandWithTab: boolean;
  includeSignature: boolean;
  defaultSnippetTrigger: string;
  defaultSnippet: string;
  templates: SnippetTemplate[];
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

export interface AIPromptShortcut {
  id: string;
  title: string;
  instruction: string;
  requiresThread: boolean;
}

export type AIEmbeddingProvider =
  | 'openAI'
  | 'gemini'
  | 'ollama'
  | 'mistral'
  | 'cohere'
  | 'voyage'
  | 'dashscope'
  | 'openAICompatible';

export interface AIEmbeddingSettings {
  provider: AIEmbeddingProvider;
  model: string;
  baseURL: string;
  dimensions: number | null;
}

export interface AgentRulesSettings {
  proactiveDraftTrigger: 'directOnly' | 'directOrActionRequest';
  blockBulkAndAutomated: boolean;
  maxDraftSourceWords: number;
}

export interface AISettings {
  provider: AIProviderPreference;
  globalDefaultModel: string;
  fallback: AIFallbackSettings;
  providerConfigurations: AIProviderConfiguration[];
  promptShortcuts: AIPromptShortcut[];
  replyTone: 'direct' | 'concise' | 'warm' | 'formal';
  allowMailBodyContext: boolean;
  savePromptHistory: boolean;
  proactiveDraftsEnabled: boolean;
  semanticSearchEnabled: boolean;
  externalToolsEnabled: boolean;
  embeddings: AIEmbeddingSettings;
  agentRules: AgentRulesSettings;
  dailyBriefing: DailyBriefingSettings;
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
  type: 'stdio' | 'streamableHttp' | 'sse';
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
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
  calendar: CalendarSettings;
  shortcuts: ShortcutSettings;
  snippets: SnippetSettings;
  mailRules: MailRulesSettings;
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

export type AgentDraftStatus = 'ready' | 'applied' | 'dismissed' | 'failed';

export interface AgentDraftSuggestion {
  id: string;
  accountId: AccountID;
  threadId: ThreadID;
  messageId: MessageID;
  subject: string;
  bodyPlain: string;
  status: AgentDraftStatus;
  confidence: number;
  reason: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export type MailSecuritySeverity = 'info' | 'warning' | 'danger';

export type MailSecurityWarningKind =
  | 'trackingPixel'
  | 'suspiciousLink'
  | 'senderMismatch'
  | 'styleShift'
  | 'remoteForm'
  | 'unsafeProtocol';

export interface MailSecurityWarning {
  kind: MailSecurityWarningKind;
  severity: MailSecuritySeverity;
  title: string;
  detail: string;
  evidence?: string;
}

export type MailSecurityRiskLevel = 'low' | 'medium' | 'high';

export interface MessageSecurityInsight {
  accountId: AccountID;
  messageId: MessageID;
  threadId: ThreadID;
  riskLevel: MailSecurityRiskLevel;
  warnings: MailSecurityWarning[];
  trackerCount: number;
  phishingLinkCount: number;
  analyzedAt: string;
}

export type UnsubscribeMethodKind = 'httpPost' | 'httpGet' | 'mailto';

export interface UnsubscribeMethod {
  kind: UnsubscribeMethodKind;
  url: string;
  isOneClick: boolean;
  email?: string;
  subject?: string;
  body?: string;
}

export interface UnsubscribeCandidate {
  accountId: AccountID;
  threadId: ThreadID;
  messageId: MessageID;
  senderEmail: string;
  senderName: string;
  methods: UnsubscribeMethod[];
  recommendedMethod: UnsubscribeMethod | null;
  canOneClick: boolean;
}

export interface ThreadAgentInsights {
  accountId: AccountID;
  threadId: ThreadID;
  draftSuggestion: AgentDraftSuggestion | null;
  securityInsights: MessageSecurityInsight[];
  unsubscribeCandidate: UnsubscribeCandidate | null;
}

export interface SemanticSearchResult {
  threadId: ThreadID;
  messageId: MessageID;
  score: number;
  subject: string;
  sender: string;
  snippet: string;
  receivedAt: string;
}

export type EmbeddingIndexJobState = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface EmbeddingIndexModelStats {
  model: string;
  count: number;
  lastIndexedAt: string | null;
  isCurrent: boolean;
}

export interface EmbeddingIndexJobStatus {
  state: EmbeddingIndexJobState;
  accountId: AccountID;
  model: string;
  total: number;
  processed: number;
  indexed: number;
  failed: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  cancelRequested: boolean;
}

export interface EmbeddingIndexStatus {
  accountId: AccountID;
  currentModel: string;
  totalMessages: number;
  indexedMessages: number;
  pendingMessages: number;
  staleMessages: number;
  otherIndexedMessages: number;
  models: EmbeddingIndexModelStats[];
  job: EmbeddingIndexJobStatus | null;
  semanticSearchEnabled: boolean;
}

export interface EmbeddingIndexReindexOptions {
  clearCurrent?: boolean;
  clearOther?: boolean;
}
