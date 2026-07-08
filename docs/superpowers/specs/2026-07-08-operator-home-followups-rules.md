# Operator Home, Follow-up Radar, and Rules Simulator

Date: 2026-07-08
Status: Implementation spec

## Goal

Make Dumka Mail feel like a local-first mail operator instead of a set of separate AI widgets. The next product slice is three connected features:

1. **Operator Home / Today Inbox**: a first-class workspace surface that consolidates Daily Briefing, Agent Review Queue, Follow-up Radar, cleanup entry points, calendar, reminders, and recent actions.
2. **Follow-up Radar and Reply Pipeline**: deterministic local detection of sent threads where the user is waiting for a reply, with review/dismiss/remind/draft actions.
3. **Approval-to-Automation Rules Simulator**: a dry-run simulator for safe mail automation rules, plus candidate suggestions from repeated approved actions.

Signing, notarization, release distribution, and deployment are explicitly out of scope.

## Market Evidence

Current competitor direction is not "AI chat beside email"; it is AI inbox/operator workflow:

- Gmail AI Inbox surfaces suggested to-dos and topics in one place.
- Gmail I/O 2026 updates say AI Inbox prioritizes to-dos and important updates and adds personalized draft replies.
- Shortwave positions its agent around organizing, scheduling, writing, and searching email.
- Notion Mail emphasizes AI auto-labeling and organized views, while its shutdown notice makes local-first ownership a stronger Dumka angle.
- Superhuman sells AI reply/follow-up workflows.
- SaneBox sells automatic filtering, one-click unsubscribe, and follow-up reminders.

## Local Evidence

Dumka already has the primitives:

- `DailyBriefingCard` and `runDailyBriefing`.
- `AgentReviewQueueCard`, `AgentPlan`, queue readiness, approve/reject flows.
- `CleanupPanel` with local sender stats and archive/unsubscribe proposal generation.
- Local SQLite mail cache, action log, reminders, calendar agenda, contacts, drafts, sent-mail sync.
- `shared/mailRules.ts` and deterministic classifier/rule helpers.

The gap is workflow consolidation and safe conversion of repeated approvals into inspectable rules.

## Architecture Decisions

### Operator Home

- Add a renderer workspace state, `workspaceView: 'today' | 'mail'`.
- Do **not** add Today to `MailboxView`; mailbox cycling and tests assume Gmail-like mailboxes only.
- Do **not** add Today as a split-inbox tab; split tabs are classifier categories.
- Today closes Settings/Cleanup panels and renders in the main workspace where mail/settings/cleanup currently switch.
- Account selection, mailbox changes, split changes, search focus/typing, and thread opening return to `workspaceView: 'mail'`.
- Today reuses existing cards and store actions wherever possible.

### Follow-up Radar

- Detection is deterministic and local.
- Correctness requires message timelines, not `MailThread` alone.
- Main process owns list generation to avoid renderer fan-out over every sent thread.
- Add an idempotent SQLite table for per-message user state only:
  - `(account_id, thread_id, sent_message_id)`
  - `status: dismissed | snoozed`
  - `snoozed_until`, `created_at`, `updated_at`
- Do not persist resolved follow-ups. A later inbound message resolves them automatically.
- Sent freshness is local-cache-bound. UI must state when results are from cached mail.

### Rules Simulator

- V1 is renderer/local-cache simulation only, no new IPC.
- Simulate against `store.threads` and current `store.actionLog`.
- Support deterministic safe actions: `archive`, `applyLabel`, `moveToLabel`.
- Show `forward` and `autoReply` as preview-only/high-risk in simulation; do not propose enabling send-like automation in this slice.
- Candidate suggestions come from existing approved/recent action evidence and visible threads, not AI.

## Data Model

### Shared Follow-up Types

Add to `shared/types.ts`:

```ts
export type FollowUpRadarStateStatus = 'dismissed' | 'snoozed';

export interface FollowUpRadarState {
  accountId: AccountID;
  threadId: ThreadID;
  sentMessageId: MessageID;
  status: FollowUpRadarStateStatus;
  snoozedUntil?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpRadarItem {
  id: string;
  accountId: AccountID;
  threadId: ThreadID;
  sentMessageId: MessageID;
  subject: string;
  recipientLine: string;
  lastSentAt: string;
  ageHours: number;
  priority: number;
  reason: string;
  snippet: string;
  thread: MailThread;
  sentMessage: MailMessage;
}

export interface FollowUpRadarResult {
  accountId: AccountID;
  generatedAt: string;
  scannedThreadCount: number;
  candidateCount: number;
  items: FollowUpRadarItem[];
  warnings: string[];
}
```

### Follow-up Settings

Add to `InboxSettings`:

- `followUpThresholdHours: number` — min wait before a sent message becomes a candidate
- `followUpMaxAgeDays: number` — lookback window; older unanswered sent mail is excluded (default 30)
- `followUpMaxItems: number`
- `followUpSnoozeHours: number`

Existing `enableFollowUps` remains the master switch.

### Workspace State

Add to store:

```ts
export type WorkspaceView = 'today' | 'mail';
workspaceView: WorkspaceView;
setWorkspaceView(view: WorkspaceView): void;
```

## Shared Helpers

### `shared/followUpRadar.ts`

Required APIs:

- `buildFollowUpRadarItem({ thread, messages, accountId, now, state, thresholdHours, maxAgeHours }): FollowUpRadarItem | null`
- `buildFollowUpRadarResult({ accountId, threadsWithMessages, states, now, thresholdHours, maxAgeHours, maxItems }): FollowUpRadarResult`
- `followUpStateKey(accountId, threadId, sentMessageId): string`
- `normalizeFollowUpAgeWindow(thresholdHours, maxAgeHours)` — clamps the window so max ≥ min

Behavior:

- Sort messages by `receivedAt`.
- Ignore trash/spam messages when choosing the latest active message.
- Outbound if message label IDs include `SENT`; fallback to `senderEmail === accountId`.
- Candidate only when latest active message is outbound, older than threshold, and younger than max age (lookback).
- Candidate must have at least one external recipient in `to/cc/bcc`.
- If state is `dismissed`, hide.
- If state is `snoozed` and `snoozedUntil` is in the future, hide.
- Score by age plus message/request signals. Clamp to 1-100.
- Suppress or reduce no-reply/bulk-looking recipients.

### `shared/mailRuleSimulator.ts`

Required APIs:

- `simulateMailRule({ rule, threads, actionLogs, labelDefinitions, now }): MailRuleSimulation`
- `simulateMailRules({ settings, threads, actionLogs, labelDefinitions, now }): MailRuleSimulationSummary`
- `buildAutomationCandidatesFromAgentPlan({ plan, threads, actionLogs }): AutomationRuleCandidate[]`

Behavior:

- Reuse `evaluateMailRules` and `mailRuleActionLogId`.
- Detect incomplete actions and missing labels.
- Detect already-applied action IDs from `actionLog`.
- Mark `forward` and `autoReply` as preview-only.
- Provide sample threads and clear effect summaries.

## UI Requirements

### `TodayHome`

Create `renderer/src/components/today/TodayHome.tsx`.

Sections:

- Header with active account, generated/cache note, Daily Briefing refresh, Follow-up refresh.
- Summary strip:
  - inbox unread count
  - Daily Briefing item count
  - Review Queue count
  - Follow-up count
  - due reminders
  - next calendar event count
- Daily Briefing:
  - show existing `DailyBriefingCard` if present
  - otherwise compact empty/CTA state
- Agent Review Queue:
  - show existing `AgentReviewQueueCard` if present
  - otherwise compact empty state
- Follow-up Radar:
  - list top follow-ups
  - actions: Open, Draft follow-up, Remind, Snooze, Dismiss
- Cleanup:
  - CTA to open full Privacy & Cleanup panel
  - optional summary from existing sender stats if already loaded later
- Automation Simulator:
  - show top candidate suggestions
  - open settings/rules simulator for full detail
- Calendar and recent actions:
  - compact read-only sections using existing store data

### Navigation

- Add Today/Operator Home button to left rail.
- Add command palette action `Open Operator Home`.
- When opening Today: close Settings and Cleanup, keep AI panel untouched.
- When opening Cleanup/Settings/mailboxes/search/thread: switch to `mail`.

### Follow-up Actions

- Open: `store.openThread(item.thread)`.
- Draft follow-up: use the sent source message with `startReplyWithBody`.
- Remind: `executeMailAction('setReminder', threadId, ...)`.
- Snooze/Dismiss: update Follow-up Radar state through IPC and reload radar.

### Rules Simulator UI

- Create a compact reusable component `RuleSimulatorPanel`.
- Mount it in Operator Home and inside `MailRulesSettingsSection`.
- Display:
  - total rules/effects/matches
  - warnings
  - top samples
  - candidate rules from approved actions
- Candidate activation can create a disabled draft rule in settings. It must not auto-enable.

## Verification

Required focused tests:

- `tests/followUpRadar.test.ts`
- `tests/mailRuleSimulator.test.ts`

Required broad checks:

- `npm test`
- `npm run build`

Final manual/runtime check:

- `npm run install-app` only after code review is clean.

