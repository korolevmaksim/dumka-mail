// Per-account mail notification filter (design-review/SPEC.md §8).
//
// Applied in the main process on top of the global notification settings
// (desktop notifications, quiet hours, "important only"); the stricter wins.
//   none   → never notify for this account
//   all    → as before (only the global filters apply)
//   people → only when the rule layer decides `people`, `event`, or a
//            protected `read` (security notices)
import { decideByRules, type DecisionThread } from './decision';
import { computeThreadSignals } from './threadSignals';
import { normalizeAccountId, resolveAccountSetting, type AccountSettingsSource } from './accountSettings';
import type { AccountNotificationMode, MailMessage, ThreadDecision } from './types';

export function decisionWarrantsNotification(mode: AccountNotificationMode, decision: Pick<ThreadDecision, 'decision' | 'protected'>): boolean {
  if (mode === 'none') return false;
  if (mode === 'all') return true;
  return decision.decision === 'people'
    || decision.decision === 'event'
    || (decision.decision === 'read' && decision.protected);
}

export type NotificationMessage = Pick<MailMessage, 'accountId' | 'subject' | 'senderEmail' | 'senderName' | 'labelIds' | 'id'>
  & Partial<Pick<MailMessage, 'headers' | 'attachments'>>;

/** The rule-layer view of a single new message (signals from its own headers and invite parts). */
export function decisionThreadForMessage(message: NotificationMessage, accountEmail: string): DecisionThread {
  return {
    subject: message.subject || '',
    senderEmail: message.senderEmail || '',
    senderNames: message.senderName ? [message.senderName] : [],
    labelIds: message.labelIds || [],
    signals: computeThreadSignals([{
      id: message.id,
      senderEmail: message.senderEmail || '',
      labelIds: message.labelIds || [],
      headers: message.headers ?? null,
      attachments: message.attachments ?? null,
    }], accountEmail),
  };
}

/** True when the account's notification mode allows a desktop notification for this message. */
export function shouldNotifyForAccount(message: NotificationMessage, settings: AccountSettingsSource): boolean {
  const accountEmail = normalizeAccountId(message.accountId);
  const { value: mode } = resolveAccountSetting(settings, accountEmail, 'notifications');
  if (mode !== 'people') return mode === 'all';
  return decisionWarrantsNotification(mode, decideByRules(decisionThreadForMessage(message, accountEmail), { accountEmail }));
}
