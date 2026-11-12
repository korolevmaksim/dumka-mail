// Invitation answers from the inbox row (Yes / No chips, `Y` / `N`) and the
// reader. Answers go straight to the organizer through the existing RSVP IPC
// (`api:respondToCalendarInvite`), then the thread is archived through the
// normal `markDone` path and the list advances like `E`.
//
// State shared by every caller (busy threads, per-account calendar access)
// lives at module level so the row chips, the reader and the keyboard agree.
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';
import { undoPayloadJson } from '../lib/presentMailAction';
import { calendarInvitesFromMessage, isCalendarInviteAttachment } from '../../../shared/calendar';
import {
  classifyRsvpError,
  inviteOrganizerLabel,
  MissingInviteError,
  rsvpFailureMessage,
  rsvpSuccessMessage,
  type InviteAnswer,
} from '../../../shared/inviteRsvp';
import type { AttachmentMetadata, CalendarInvite, MailMessage, MailThread } from '../../../shared/types';

const busyThreads = new Set<string>();
const calendarAccess = new Map<string, boolean>();
const statusRequests = new Map<string, Promise<boolean>>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getVersion(): number {
  return version;
}

function threadKey(thread: Pick<MailThread, 'accountId' | 'id'>): string {
  return `${thread.accountId}:${thread.id}`;
}

function setCalendarAccess(accountId: string, enabled: boolean): void {
  if (calendarAccess.get(accountId) === enabled) return;
  calendarAccess.set(accountId, enabled);
  notify();
}

function fetchCalendarAccess(accountId: string, force = false): Promise<boolean> {
  if (!force && calendarAccess.has(accountId)) return Promise.resolve(calendarAccess.get(accountId) === true);
  const existing = statusRequests.get(accountId);
  if (existing && !force) return existing;
  const request = window.electronAPI.getGoogleIntegrationStatus(accountId)
    .then(status => {
      setCalendarAccess(accountId, status?.calendarEnabled === true);
      return status?.calendarEnabled === true;
    })
    .catch(error => {
      console.error('Could not read calendar access:', error);
      return false;
    })
    .finally(() => {
      if (statusRequests.get(accountId) === request) statusRequests.delete(accountId);
    });
  statusRequests.set(accountId, request);
  return request;
}

function attachmentFetchId(attachment: AttachmentMetadata): string | null {
  return attachment.attachmentId || attachment.id || null;
}

async function hydrateCalendarParts(message: MailMessage): Promise<MailMessage> {
  const attachments = await Promise.all(message.attachments.map(async attachment => {
    if (!isCalendarInviteAttachment(attachment) || attachment.base64Data) return attachment;
    const fetchId = attachmentFetchId(attachment);
    if (!fetchId) return attachment;
    try {
      const base64Data = await window.electronAPI.fetchAttachmentData(message.accountId, message.id, fetchId);
      return base64Data ? { ...attachment, base64Data } : attachment;
    } catch (error) {
      console.error('Failed to read the calendar invitation part:', error);
      return attachment;
    }
  }));
  return { ...message, attachments };
}

/** The invitation the thread is waiting on: the latest message carrying a calendar part. */
export async function loadThreadInvite(
  thread: Pick<MailThread, 'accountId' | 'id'>,
  knownMessages: readonly MailMessage[] = [],
): Promise<{ invite: CalendarInvite; messages: MailMessage[] }> {
  const own = knownMessages.filter(message => message.threadId === thread.id && message.accountId === thread.accountId);
  const messages = (own.length > 0 ? own : await window.electronAPI.listMessagesForThread(thread.accountId, thread.id))
    .slice()
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message.attachments.some(isCalendarInviteAttachment)) continue;
    const invites = calendarInvitesFromMessage(await hydrateCalendarParts(message));
    const invite = invites.find(entry => (entry.method || '').toUpperCase() === 'REQUEST') || invites[0];
    if (invite) return { invite, messages };
  }
  throw new MissingInviteError();
}

export interface InviteRsvpApi {
  /** true / false once known; null while the account's calendar access is being read. */
  calendarConnected: (accountId: string) => boolean | null;
  isBusy: (thread: Pick<MailThread, 'accountId' | 'id'>) => boolean;
  /** Accept / decline / maybe; archives and advances on success. Opens the Connect prompt without calendar access. */
  answer: (thread: MailThread, answer: InviteAnswer, options?: { archive?: boolean }) => Promise<void>;
  connectCalendar: (accountId: string) => void;
}

export function useInviteRsvp(): InviteRsvpApi {
  const store = useAppStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  useSyncExternalStore(subscribe, getVersion, getVersion);

  const integration = store.googleIntegrationStatus;
  useEffect(() => {
    if (integration) setCalendarAccess(integration.accountId, integration.calendarEnabled === true);
  }, [integration]);

  const calendarConnected = useCallback((accountId: string): boolean | null => {
    if (!calendarAccess.has(accountId)) {
      void fetchCalendarAccess(accountId);
      return null;
    }
    return calendarAccess.get(accountId) === true;
  }, []);

  const isBusy = useCallback((thread: Pick<MailThread, 'accountId' | 'id'>) => busyThreads.has(threadKey(thread)), []);

  const connectCalendar = useCallback((accountId: string) => {
    emitToast({ type: 'info', message: 'Connect Google Calendar in your browser to answer invitations from Dumka Mail.' });
    void storeRef.current.authorizeGoogleIntegration('calendar', accountId)
      .then(() => fetchCalendarAccess(accountId, true))
      .then(enabled => {
        if (enabled) emitToast({ type: 'success', message: 'Calendar connected. Press Y or N to answer.' });
      })
      .catch(error => {
        console.error('Calendar connection failed:', error);
        emitToast({ type: 'error', message: 'Calendar was not connected. Try again from the invitation.' });
      });
  }, []);

  const answer = useCallback(async (thread: MailThread, response: InviteAnswer, options: { archive?: boolean } = {}) => {
    const key = threadKey(thread);
    if (busyThreads.has(key)) return;
    busyThreads.add(key);
    notify();
    try {
      const connected = await fetchCalendarAccess(thread.accountId);
      if (!connected) {
        connectCalendar(thread.accountId);
        return;
      }
      const opened = storeRef.current.openedThread;
      const known = opened && threadKey(opened) === key ? storeRef.current.openedThreadMessages : [];
      const { invite, messages } = await loadThreadInvite(thread, known);
      await window.electronAPI.respondToCalendarInvite(thread.accountId, invite, response, crypto.randomUUID());
      void storeRef.current.syncCalendarAgenda(thread.accountId).catch(error => {
        console.error('Calendar refresh after RSVP failed:', error);
      });

      const organizer = inviteOrganizerLabel(invite, messages);
      const inInbox = thread.labelIds.some(label => label.toUpperCase() === 'INBOX');
      if (options.archive === false || !inInbox) {
        emitToast({ type: 'success', message: rsvpSuccessMessage(response, organizer, null) });
        return;
      }

      // Archive and advance exactly like `E`.
      const current = storeRef.current;
      if (!current.openedThread) {
        const visible = current.listNavigationThreads;
        const index = visible.findIndex(entry => entry.id === thread.id);
        const next = index !== -1 ? visible[Math.min(visible.length - 1, index + 1)] : null;
        if (next && next.id !== thread.id) current.setFocusedThreadId(next.id);
      }
      const archived = await current.executeMailAction(
        'markDone',
        thread.id,
        null,
        undefined,
        JSON.stringify({ accountId: thread.accountId, silent: true, source: 'rsvp' }),
      );
      emitToast({
        type: 'success',
        message: archived.accepted
          ? rsvpSuccessMessage(response, organizer)
          : rsvpSuccessMessage(response, organizer, 'The conversation could not be archived.'),
        duration: 8000,
        ...(archived.accepted ? {
          actionLabel: 'Undo',
          onAction: () => {
            void storeRef.current.executeMailAction(
              'restoreInbox',
              thread.id,
              null,
              undefined,
              undoPayloadJson(JSON.stringify({ accountId: thread.accountId })),
            );
          },
        } : {}),
      });
    } catch (error) {
      console.error('Invitation answer failed:', error);
      const kind = classifyRsvpError(error);
      emitToast({
        type: 'error',
        message: rsvpFailureMessage(kind),
        duration: 8000,
        ...(kind === 'missingInvite'
          ? {
              actionLabel: 'Open',
              onAction: () => {
                storeRef.current.setWorkspaceView('mail');
                void storeRef.current.openThread(thread);
              },
            }
          : kind === 'permission'
            ? { actionLabel: 'Reconnect Calendar', onAction: () => connectCalendar(thread.accountId) }
            : { actionLabel: 'Retry', onAction: () => { void answerRef.current(thread, response, options); } }),
      });
    } finally {
      busyThreads.delete(key);
      notify();
    }
  }, [connectCalendar]);

  const answerRef = useRef(answer);
  answerRef.current = answer;

  return { calendarConnected, isBusy, answer, connectCalendar };
}
