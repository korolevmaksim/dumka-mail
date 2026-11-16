// Send later, when "later" was missed.
//
// A scheduled message is sent by this app, not by Gmail (the Gmail API has no
// scheduled send). If the app was not running, the Mac was asleep or Gmail
// could not be reached at the chosen time, the message would otherwise leave
// the moment the app next gets the chance, however late that is. A message
// that is more than the grace period late is held instead: it goes back to
// Drafts as an ordinary draft and the person decides.
//
// Only messages the person scheduled are held. A message in the undo-send
// window, or one parked while offline after Send was pressed, was meant to go
// out now and still does.
// Pure and dependency-free.

/** How late a scheduled message may still be sent without asking. */
export const LATE_SCHEDULED_SEND_GRACE_MS = 30 * 60 * 1000;

export interface ScheduledSendSettingsSource {
  compose?: { holdLateScheduledSends?: unknown } | null;
}

/** On unless switched off. */
export function holdsLateScheduledSends(settings: ScheduledSendSettingsSource | null | undefined): boolean {
  return settings?.compose?.holdLateScheduledSends !== false;
}

/**
 * The chosen send time when this `send` action is a scheduled message that is
 * now too late to send without asking, else null. `payload` is the action's
 * parsed `payloadJson`.
 */
export function lateScheduledSendAt(payload: unknown, now: Date, graceMs: number = LATE_SCHEDULED_SEND_GRACE_MS): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = payload as Record<string, unknown>;
  if (raw.undoSend === true) return null;
  if (typeof raw.sendAt !== 'string') return null;
  const sendAt = Date.parse(raw.sendAt);
  if (!Number.isFinite(sendAt)) return null;
  return now.getTime() - sendAt > graceMs ? new Date(sendAt).toISOString() : null;
}

/** Stored as the action's failure message. */
export function heldScheduledSendFailure(sendAt: string): string {
  return `Not sent: it was scheduled for ${sendAt} and could not be sent then. It is back in Drafts.`;
}

/** A held message the person has not been told about yet. */
export interface HeldScheduledSend {
  actionId: string;
  accountId: string;
  draftId: string;
  subject: string;
  /** The time the person chose. */
  sendAt: string;
  heldAt: string;
}

export const HELD_SCHEDULED_SENDS_MAX = 50;

/** Validates the stored list (it is plain JSON in the settings table). */
export function normalizeHeldScheduledSends(value: unknown): HeldScheduledSend[] {
  if (!Array.isArray(value)) return [];
  const out: HeldScheduledSend[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;
    const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
    const actionId = text('actionId');
    const accountId = text('accountId');
    const draftId = text('draftId');
    const sendAt = text('sendAt');
    if (!actionId || !accountId || !draftId || !Number.isFinite(Date.parse(sendAt)) || seen.has(actionId)) continue;
    seen.add(actionId);
    out.push({ actionId, accountId, draftId, subject: text('subject').slice(0, 300), sendAt, heldAt: text('heldAt') || sendAt });
  }
  return out.slice(-HELD_SCHEDULED_SENDS_MAX);
}

export function heldScheduledSendTitle(): string {
  return 'Scheduled message not sent';
}

/** `when` is the chosen time, already formatted for display. */
export function heldScheduledSendMessage(subject: string, when: string): string {
  const name = subject.trim() ? `“${subject.trim()}”` : 'A message';
  return `${name} was scheduled for ${when} and could not be sent then. It is in Drafts: send it or change the time.`;
}
