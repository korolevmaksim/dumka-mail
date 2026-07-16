import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AttachmentMetadata, MailMessage } from '../../../shared/types';
import {
  calendarInvitesFromMessage,
  calendarResponseFromGoogleRsvpUrl,
  isCalendarInviteAttachment,
} from '../../../shared/calendar';
import { emitToast } from '../lib/toastBus';
import { useAppStore } from '../stores/AppStore';
import { CalendarInviteCard } from './CalendarInviteCard';
import { SafeHtmlRenderer } from './SafeHtmlRenderer';

interface CalendarAwareMessageBodyProps {
  msg: MailMessage;
  html: string;
  loadRemoteImages: boolean;
}

function attachmentFetchId(attachment: AttachmentMetadata): string | null {
  return attachment.attachmentId || attachment.id || null;
}

function messageWithCalendarAttachmentData(message: MailMessage, data: Readonly<Record<string, string>>): MailMessage {
  return {
    ...message,
    attachments: message.attachments.map(attachment => {
      const fetchId = attachmentFetchId(attachment);
      const base64Data = fetchId ? data[fetchId] : undefined;
      return base64Data && !attachment.base64Data ? { ...attachment, base64Data } : attachment;
    }),
  };
}

export function CalendarAwareMessageBody({ msg, html, loadRemoteImages }: CalendarAwareMessageBodyProps) {
  const { respondToCalendarInvite } = useAppStore();
  const [attachmentData, setAttachmentData] = useState<Record<string, string>>({});
  const attachmentDataRef = useRef<Record<string, string>>({});
  const responseInFlightRef = useRef(false);
  const calendarAttachments = useMemo(
    () => msg.attachments.filter(isCalendarInviteAttachment),
    [msg.attachments],
  );

  const hydrateCalendarAttachments = useCallback(async (): Promise<Record<string, string>> => {
    const next = { ...attachmentDataRef.current };
    await Promise.all(calendarAttachments.map(async attachment => {
      const fetchId = attachmentFetchId(attachment);
      if (!fetchId || attachment.base64Data || next[fetchId]) return;
      try {
        next[fetchId] = await window.electronAPI.fetchAttachmentData(msg.accountId, msg.id, fetchId);
      } catch (error) {
        console.error('Failed to hydrate calendar invitation:', error);
      }
    }));
    attachmentDataRef.current = next;
    setAttachmentData(next);
    return next;
  }, [calendarAttachments, msg.accountId, msg.id]);

  useEffect(() => {
    attachmentDataRef.current = {};
    responseInFlightRef.current = false;
    setAttachmentData({});
  }, [msg.id]);

  useEffect(() => {
    void hydrateCalendarAttachments();
  }, [hydrateCalendarAttachments]);

  const calendarInvites = useMemo(
    () => calendarInvitesFromMessage(messageWithCalendarAttachmentData(msg, attachmentData)),
    [attachmentData, msg],
  );

  const handleHtmlLink = useCallback((url: string): boolean => {
    const responseStatus = calendarResponseFromGoogleRsvpUrl(url);
    if (!responseStatus) return false;
    if (responseInFlightRef.current) return true;
    responseInFlightRef.current = true;

    void (async () => {
      try {
        const data = calendarInvites.length > 0 ? attachmentDataRef.current : await hydrateCalendarAttachments();
        const invite = calendarInvites[0]
          || calendarInvitesFromMessage(messageWithCalendarAttachmentData(msg, data))[0];
        if (!invite) throw new Error('The calendar invitation attachment could not be read.');
        await respondToCalendarInvite(invite, responseStatus, msg.accountId);
        emitToast({ type: 'success', message: 'Calendar response saved.' });
      } catch (error) {
        console.error('Calendar RSVP link failed:', error);
        emitToast({ type: 'error', message: 'Could not update calendar response.' });
      } finally {
        responseInFlightRef.current = false;
      }
    })();

    return true;
  }, [calendarInvites, hydrateCalendarAttachments, msg, respondToCalendarInvite]);

  return (
    <>
      {calendarInvites.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {calendarInvites.map(invite => (
            <CalendarInviteCard key={`${invite.uid}:${invite.startAt}`} invite={invite} accountId={msg.accountId} />
          ))}
        </div>
      )}
      {msg.bodyHtml ? (
        <SafeHtmlRenderer html={html} loadRemoteImages={loadRemoteImages} onLinkClick={handleHtmlLink} />
      ) : (
        <pre className="text-[calc(12px*var(--font-scale))] whitespace-pre-wrap font-sans text-[var(--text-primary)] select-text leading-relaxed">
          {msg.bodyPlain || msg.snippet}
        </pre>
      )}
    </>
  );
}
