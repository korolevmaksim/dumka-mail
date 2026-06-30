import { useState, useEffect, useMemo, useRef } from 'react';
import { AttachmentMetadata, MailMessage } from '../../../shared/types';
import type { CalendarInvite } from '../../../shared/types';
import { Check, Copy, Paperclip, Download, ImageOff, X, RefreshCw, FileCode, ChevronUp, ChevronDown, CalendarCheck, CalendarX, CalendarClock, MapPin, Users } from 'lucide-react';
import { colorFromString } from './AccountAvatar';
import { hasRemoteImages, SafeHtmlRenderer } from './SafeHtmlRenderer';
import { resolveInlineCids } from '../../../shared/messageBody';
import { calendarInvitesFromMessage } from '../../../shared/calendar';
import { useAppStore } from '../stores/AppStore';

export function MessageCard({ msg, defaultLoadImages }: { msg: MailMessage; defaultLoadImages: boolean }) {
  const store = useAppStore();
  const [imagesAllowed, setImagesAllowed] = useState(defaultLoadImages);
  const [copied, setCopied] = useState(false);
  const [showRawModal, setShowRawModal] = useState(false);
  const remoteImages = msg.bodyHtml ? hasRemoteImages(msg.bodyHtml) : false;
  const initials = (msg.senderName || msg.senderEmail || '?').trim().substring(0, 2).toUpperCase();
  const [inlineAttachmentData, setInlineAttachmentData] = useState<Record<string, string>>({});

  const htmlBody = msg.bodyHtml || '';
  const htmlHasCidReferences = /cid:/i.test(htmlBody);
  const inlineImageAttachments = useMemo(
    () => msg.attachments.filter(att => shouldTreatAsInlineImage(att, htmlBody)),
    [msg.attachments, htmlBody]
  );
  const renderedHtml = useMemo(() => {
    if (!htmlBody) return '';
    const attachmentsWithData = msg.attachments.map(att => {
      const fetchId = attachmentFetchId(att);
      const hydratedData = fetchId ? inlineAttachmentData[fetchId] : undefined;
      if (!hydratedData || att.base64Data) return att;
      return { ...att, base64Data: hydratedData };
    });
    return resolveInlineCids(htmlBody, attachmentsWithData);
  }, [htmlBody, inlineAttachmentData, msg.attachments]);
  const visibleAttachments = useMemo(
    () => msg.attachments.filter(att => !shouldTreatAsInlineImage(att, htmlBody)),
    [msg.attachments, htmlBody]
  );
  const calendarInvites = useMemo(() => calendarInvitesFromMessage(msg), [msg]);

  useEffect(() => {
    setInlineAttachmentData({});
  }, [msg.id]);

  useEffect(() => {
    if (!htmlHasCidReferences || inlineImageAttachments.length === 0) return;

    let cancelled = false;
    const targets = inlineImageAttachments
      .map(att => attachmentFetchId(att))
      .filter((id): id is string => Boolean(id))
      .filter(id => !inlineAttachmentData[id]);

    if (targets.length === 0) return;

    void (async () => {
      const entries = await Promise.all(targets.map(async attachmentId => {
        try {
          const data = await window.electronAPI.fetchAttachmentData(msg.accountId, msg.id, attachmentId);
          return [attachmentId, data] as const;
        } catch (err) {
          console.error('Failed to hydrate inline attachment:', err);
          return null;
        }
      }));

      if (cancelled) return;
      setInlineAttachmentData(prev => {
        const next = { ...prev };
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [htmlHasCidReferences, inlineAttachmentData, inlineImageAttachments, msg.accountId, msg.id]);

  const copyEmail = () => {
    try { navigator.clipboard.writeText(msg.senderEmail); } catch { /* clipboard unavailable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative bg-[var(--raised-surface)] border border-[var(--border)] rounded-[6px] shadow-[0_5px_12px_rgba(0,0,0,0.07)] overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 70%, transparent)' }} />
      <div className="pl-[20px] pr-[24px] py-[18px]">
        {/* Header: sender identity */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[calc(10px*var(--font-scale))] font-bold text-white shrink-0"
              style={{ backgroundColor: colorFromString(msg.senderEmail || msg.senderName) }}
            >
              {initials}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)] truncate">
                {msg.senderName || msg.senderEmail}
              </span>
              <div className="flex items-center gap-1 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] min-w-0">
                <span className="truncate">{msg.senderEmail}</span>
                <button
                  onClick={copyEmail}
                  title="Copy email address"
                  className="p-0.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-tertiary)] hover:text-[var(--text-primary)] shrink-0"
                >
                  {copied ? <Check className="w-3 h-3 text-[var(--success)]" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              {msg.to && msg.to.length > 0 && (
                <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)] truncate">
                  To: {msg.to.map((r: { name?: string; email: string }) => r.name || r.email).join(', ')}
                </span>
              )}
              {msg.cc && msg.cc.length > 0 && (
                <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)] truncate">
                  Cc: {msg.cc.map((r: { name?: string; email: string }) => r.name || r.email).join(', ')}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)] whitespace-nowrap mt-0.5">
              {new Date(msg.receivedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
            <button
              onClick={() => setShowRawModal(true)}
              title="Show Original (Raw Message Source)"
              className="px-2 py-0.5 rounded hover:bg-[var(--hover-row)] text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)] hover:text-[var(--accent)] font-medium cursor-pointer transition-colors"
            >
              Show original
            </button>
          </div>
        </div>

        {/* Remote image gate banner */}
        {remoteImages && !imagesAllowed && (
          <button
            onClick={() => setImagesAllowed(true)}
            className="w-full flex items-center gap-2 mb-3 px-3 py-1.5 bg-[var(--warning)]/10 border border-[var(--warning)]/25 rounded text-[calc(10px*var(--font-scale))] text-[var(--warning)] hover:bg-[var(--warning)]/15 transition-colors cursor-pointer"
          >
            <ImageOff className="w-3.5 h-3.5 shrink-0" />
            <span>Remote images blocked for privacy.</span>
            <span className="underline font-semibold ml-auto">Load images</span>
          </button>
        )}

        {calendarInvites.length > 0 && (
          <div className="mb-3 flex flex-col gap-2">
            {calendarInvites.map(invite => (
              <CalendarInviteCard key={invite.uid} invite={invite} accountId={msg.accountId} store={store} />
            ))}
          </div>
        )}

        {/* Body */}
        {msg.bodyHtml ? (
          <SafeHtmlRenderer html={renderedHtml} loadRemoteImages={imagesAllowed} />
        ) : (
          <pre className="text-[calc(12px*var(--font-scale))] whitespace-pre-wrap font-sans text-[var(--text-primary)] select-text leading-relaxed">
            {msg.bodyPlain || msg.snippet}
          </pre>
        )}

        {/* Attachments */}
        {visibleAttachments.length > 0 && (
          <div className="mt-4 flex flex-col gap-1.5 border-t border-[var(--border)] pt-3">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
              {visibleAttachments.length} Attachment{visibleAttachments.length === 1 ? '' : 's'}
            </span>
            <div className="flex flex-wrap gap-2">
              {visibleAttachments.map((att) => (
                <div key={att.id} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-[6px] hover:border-[var(--strong-border)] transition-colors">
                  <Paperclip className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                  <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] max-w-[180px] truncate">{att.filename}</span>
                  <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">{att.sizeBytes >= 1048576 ? `${(att.sizeBytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(att.sizeBytes / 1024))} KB`}</span>
                  <button
                    onClick={() => window.electronAPI.downloadAttachment(msg.accountId, msg.id, attachmentFetchId(att) || att.id, att.filename)}
                    title="Download attachment"
                    className="ml-1 p-0.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <Download className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {showRawModal && (
        <RawMessageModal
          accountId={msg.accountId}
          messageId={msg.id}
          msg={msg}
          onClose={() => setShowRawModal(false)}
        />
      )}
    </div>
  );
}

function CalendarInviteCard({
  invite,
  accountId,
  store,
}: {
  invite: CalendarInvite;
  accountId: string;
  store: ReturnType<typeof useAppStore>;
}) {
  const start = new Date(invite.startAt);
  const end = new Date(invite.endAt);
  const conflict = store.calendarEvents.find(event => {
    const eventStart = new Date(event.startAt).getTime();
    const eventEnd = new Date(event.endAt).getTime();
    return eventEnd > start.getTime() && eventStart < end.getTime();
  });
  const canRespond = store.googleIntegrationStatus?.calendarEnabled === true;

  const respond = async (responseStatus: 'accepted' | 'declined' | 'tentative') => {
    await store.respondToCalendarInvite(invite, responseStatus, accountId);
  };

  return (
    <div className="rounded-[6px] border border-[var(--accent)]/30 bg-[var(--accent)]/8 p-3 select-none">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-[var(--accent)]" />
            <span className="truncate text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{invite.summary}</span>
          </div>
          <div className="mt-1 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
            {start.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            {' - '}
            {end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
          </div>
          {invite.location && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{invite.location}</span>
            </div>
          )}
          {invite.attendees.length > 0 && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">
              <Users className="h-3 w-3 shrink-0" />
              <span className="truncate">{invite.attendees.map(attendee => attendee.displayName || attendee.email).join(', ')}</span>
            </div>
          )}
          {conflict && (
            <div className="mt-2 rounded border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--warning)]">
              Conflicts with {conflict.summary}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!canRespond ? (
            <button
              type="button"
              onClick={() => void store.authorizeGoogleIntegration('calendar', accountId)}
              className="rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-[calc(10px*var(--font-scale))] font-semibold text-white"
            >
              Enable Calendar
            </button>
          ) : (
            <>
              <button
                type="button"
                title="Accept"
                onClick={() => void respond('accepted')}
                className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--success)]"
              >
                <CalendarCheck className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Maybe"
                onClick={() => void respond('tentative')}
                className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--warning)]"
              >
                <CalendarClock className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Decline"
                onClick={() => void respond('declined')}
                className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--danger)]"
              >
                <CalendarX className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function attachmentFetchId(att: AttachmentMetadata): string | null {
  return att.attachmentId || att.id || null;
}

function shouldTreatAsInlineImage(att: AttachmentMetadata, html: string): boolean {
  if (!html || !/cid:/i.test(html)) return false;
  const isImage = att.mimeType.toLowerCase().startsWith('image/');
  if (!isImage) return false;
  return att.isInline === true || Boolean(att.contentId) || att.filename.toLowerCase() === 'inline';
}

function RawMessageModal({
  accountId,
  messageId,
  onClose,
  msg
}: {
  accountId: string;
  messageId: string;
  onClose: () => void;
  msg: MailMessage;
}) {
  const [rawText, setRawText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [wrapLines, setWrapLines] = useState<boolean>(true);

  // Search states
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);

  const preRef = useRef<HTMLPreElement>(null);

  // Compute total matches
  const matchesCount = searchQuery 
    ? (rawText.match(new RegExp(searchQuery.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi')) || []).length 
    : 0;

  // Next / Prev match navigation
  const nextMatch = () => {
    if (matchesCount > 0) {
      setActiveMatchIndex((prev) => (prev + 1) % matchesCount);
    }
  };

  const prevMatch = () => {
    if (matchesCount > 0) {
      setActiveMatchIndex((prev) => (prev - 1 + matchesCount) % matchesCount);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        prevMatch();
      } else {
        nextMatch();
      }
    }
  };

  useEffect(() => {
    let active = true;
    const fetchRaw = async () => {
      try {
        setLoading(true);
        setError(null);
        const text = await window.electronAPI.fetchRawMessage(accountId, messageId);
        if (active) {
          setRawText(text);
          setLoading(false);
        }
      } catch (err: any) {
        if (active) {
          setError(err.message || 'Failed to fetch raw message source');
          setLoading(false);
        }
      }
    };
    fetchRaw();
    return () => {
      active = false;
    };
  }, [accountId, messageId]);

  // Global keydown handler inside modal: esc to close search/modal, cmd+f to search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdF = (window.navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'f';
      
      if (isCmdF) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => {
          const inputEl = document.getElementById('raw-search-input');
          if (inputEl) {
            (inputEl as HTMLInputElement).focus();
            (inputEl as HTMLInputElement).select();
          }
        }, 50);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery('');
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [searchOpen, onClose]);

  // Scroll active match into view
  useEffect(() => {
    if (searchOpen && searchQuery && preRef.current) {
      const activeEl = preRef.current.querySelector(`mark[data-match-idx="${activeMatchIndex}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [activeMatchIndex, searchQuery, searchOpen]);

  const copyToClipboard = () => {
    try {
      navigator.clipboard.writeText(rawText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const downloadEml = () => {
    try {
      const blob = new Blob([rawText], { type: 'message/rfc822' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${msg.subject ? msg.subject.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'message'}_${messageId}.eml`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download eml: ', err);
    }
  };

  // Generate highlighted text elements
  const renderContent = () => {
    if (!searchQuery) {
      return rawText;
    }

    const escaped = searchQuery.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = rawText.split(regex);
    
    let matchCounter = 0;
    const elements = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.toLowerCase() === searchQuery.toLowerCase()) {
        const currentMatchIdx = matchCounter++;
        const isActive = currentMatchIdx === activeMatchIndex;
        elements.push(
          <mark 
            key={i} 
            data-match-idx={currentMatchIdx}
            className={`rounded-[2px] px-0.5 font-semibold select-text transition-colors ${
              isActive 
                ? 'bg-[var(--accent)] text-white shadow-[0_0_0_2px_var(--accent)] animate-pulse' 
                : 'bg-[var(--warning)]/40 text-[var(--text-primary)] border-b border-[var(--warning)]'
            }`}
          >
            {part}
          </mark>
        );
      } else {
        elements.push(part);
      }
    }
    
    return elements;
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-fade-in" onClick={onClose}>
      <div 
        className="w-full max-w-5xl h-[85vh] bg-[var(--panel-bg)] border border-[var(--strong-border)] rounded-xl shadow-2xl flex flex-col overflow-hidden scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2.5">
            <FileCode className="w-5 h-5 text-[var(--accent)]" />
            <div>
              <h3 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Original Message Source</h3>
              <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">RFC 822 format & complete headers (Press Cmd+F / Ctrl+F to search)</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Info Grid (Parsed Metadata summary at top of modal) */}
        <div className="px-6 py-3 bg-[var(--rail-bg)] border-b border-[var(--border)] text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] grid grid-cols-[80px_1fr] gap-x-4 gap-y-1.5 shrink-0">
          <span className="font-semibold text-[var(--text-tertiary)]">Message ID:</span>
          <span className="font-mono text-[calc(10px*var(--font-scale))] select-all truncate">{msg.id}</span>
          
          <span className="font-semibold text-[var(--text-tertiary)]">Subject:</span>
          <span className="truncate">{msg.subject || '(No Subject)'}</span>

          <span className="font-semibold text-[var(--text-tertiary)]">From:</span>
          <span className="truncate">{msg.senderName ? `${msg.senderName} <${msg.senderEmail}>` : msg.senderEmail}</span>

          <span className="font-semibold text-[var(--text-tertiary)]">Date:</span>
          <span>{new Date(msg.receivedAt).toLocaleString()}</span>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)] shrink-0 bg-[var(--panel-bg)]">
          <div className="flex items-center gap-2">
            <button
              onClick={copyToClipboard}
              disabled={loading || !!error}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--raised-surface)] border border-[var(--border)] rounded-md text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--text-secondary)] disabled:opacity-50 cursor-pointer transition-all"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[var(--success)]" />
                  <span className="text-[var(--success)] font-medium">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                  <span>Copy to clipboard</span>
                </>
              )}
            </button>
            <button
              onClick={downloadEml}
              disabled={loading || !!error}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--raised-surface)] border border-[var(--border)] rounded-md text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--text-secondary)] disabled:opacity-50 cursor-pointer transition-all"
            >
              <Download className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <span>Download .eml</span>
            </button>
            <button
              onClick={() => {
                setSearchOpen(true);
                setTimeout(() => {
                  const inputEl = document.getElementById('raw-search-input');
                  if (inputEl) {
                    (inputEl as HTMLInputElement).focus();
                    (inputEl as HTMLInputElement).select();
                  }
                }, 50);
              }}
              disabled={loading || !!error}
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-[calc(11px*var(--font-scale))] transition-all cursor-pointer ${
                searchOpen
                  ? 'bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)] font-medium'
                  : 'bg-[var(--raised-surface)] border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--text-secondary)]'
              }`}
            >
              <span>Search (Cmd+F)</span>
            </button>
          </div>

          <label className="flex items-center gap-2 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={wrapLines}
              onChange={(e) => setWrapLines(e.target.checked)}
              className="w-3.5 h-3.5 accent-[var(--accent)] border-[var(--border)] rounded cursor-pointer"
            />
            <span>Wrap lines</span>
          </label>
        </div>

        {/* Modal Content / Text Area */}
        <div className="flex-1 min-h-0 bg-[var(--app-bg)] relative flex flex-col">
          {/* Floating Search Bar */}
          {searchOpen && (
            <div className="absolute top-4 right-6 z-20 flex items-center gap-2 px-3 py-1.5 bg-[var(--panel-bg)] border border-[var(--strong-border)] rounded-lg shadow-xl animate-fade-in select-none">
              <input
                id="raw-search-input"
                type="text"
                placeholder="Find in text…"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setActiveMatchIndex(0);
                }}
                onKeyDown={handleInputKeyDown}
                className="w-48 bg-transparent border-0 outline-none text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] placeholder-[var(--text-tertiary)]"
              />
              {searchQuery && (
                <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)] px-1 border-r border-[var(--border)] shrink-0 font-medium">
                  {matchesCount > 0 ? `${activeMatchIndex + 1} of ${matchesCount}` : '0 of 0'}
                </span>
              )}
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={prevMatch}
                  title="Previous match (Shift+Enter)"
                  className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={nextMatch}
                  title="Next match (Enter)"
                  className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    setSearchOpen(false);
                    setSearchQuery('');
                  }}
                  className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--app-bg)]">
              <RefreshCw className="w-6 h-6 animate-spin text-[var(--accent)]" />
              <span className="text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)] font-medium">Fetching original message source…</span>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[var(--app-bg)]">
              <div className="text-[var(--danger)] font-semibold text-[calc(13px*var(--font-scale))] mb-2">Error Loading Message</div>
              <div className="text-[var(--text-secondary)] text-[calc(12px*var(--font-scale))] max-w-md mb-4">{error}</div>
              <button
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  window.electronAPI.fetchRawMessage(accountId, messageId)
                    .then(text => { setRawText(text); setLoading(false); })
                    .catch(err => { setError(err.message || 'Failed to fetch raw message source'); setLoading(false); });
                }}
                className="px-4 py-2 bg-[var(--accent)] text-white rounded-md text-[calc(12px*var(--font-scale))] font-medium cursor-pointer hover:opacity-90 transition-opacity"
              >
                Retry
              </button>
            </div>
          ) : (
            <pre 
              ref={preRef}
              className={`w-full h-full p-6 font-mono text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] overflow-auto select-text leading-relaxed bg-[var(--app-bg)] ${
                wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-x-auto'
              }`}
            >
              {renderContent()}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
