export type MailNotificationKind = 'newMail' | 'reminder';

export type MailNotificationActionId =
  | 'archive'
  | 'markRead'
  | 'clearReminder'
  | 'snoozeTomorrow'
  | 'open';

export interface MailNotificationActionDefinition {
  id: MailNotificationActionId;
  title: string;
}

const NEW_MAIL_ACTIONS: MailNotificationActionDefinition[] = [
  { id: 'archive', title: 'Done' },
  { id: 'markRead', title: 'Mark Read' },
  { id: 'open', title: 'Open' },
];

const REMINDER_ACTIONS: MailNotificationActionDefinition[] = [
  { id: 'snoozeTomorrow', title: 'Tomorrow' },
  { id: 'clearReminder', title: 'Clear' },
  { id: 'open', title: 'Open' },
];

export function notificationActionsFor(kind: MailNotificationKind): MailNotificationActionDefinition[] {
  return kind === 'newMail' ? NEW_MAIL_ACTIONS : REMINDER_ACTIONS;
}

export function notificationActionAt(
  kind: MailNotificationKind,
  actionIndex: number,
): MailNotificationActionDefinition | null {
  return notificationActionsFor(kind)[actionIndex] ?? null;
}

export function nextMorningIso(now = new Date(), hour = 9): string {
  const reminderAt = new Date(now);
  reminderAt.setDate(reminderAt.getDate() + 1);
  reminderAt.setHours(hour, 0, 0, 0);
  return reminderAt.toISOString();
}
