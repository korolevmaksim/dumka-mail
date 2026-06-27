import { Mail, Clock, Tag, Link2, AlignLeft, type LucideIcon } from 'lucide-react';
import { MailThread } from '../../../shared/types';
import { messageHeaderDate } from '../../../shared/dateFormat';
import { normalizePreview } from '../../../shared/textNormalizer';

function MetaRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-3.5 h-3.5 text-[var(--text-tertiary)] mt-[1px] shrink-0" />
      <div className="flex flex-col min-w-0">
        <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)] leading-tight">{label}</span>
        <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] break-words leading-snug">{value}</span>
      </div>
    </div>
  );
}

// Right-panel thread context (RL-C3): sender + Open badge, then Subject / Last /
// State / Domain / Preview meta rows for the currently open thread.
export function ThreadContextPanel({ thread }: { thread: MailThread }) {
  const name = thread.senderNames[0] || thread.senderEmail;
  const inInbox = thread.labelIds.some((l) => l.toUpperCase() === 'INBOX');
  const domain = thread.senderEmail.includes('@') ? thread.senderEmail.split('@').pop()! : thread.senderEmail;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <span className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] truncate">{name}</span>
          <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] truncate">{thread.senderEmail}</span>
        </div>
        <span className="text-[calc(10px*var(--font-scale))] font-semibold px-2 py-0.5 rounded-md bg-[var(--accent)]/15 text-[var(--accent)] shrink-0">
          Open
        </span>
      </div>
      <div className="flex flex-col gap-2.5 border-t border-[var(--border)] pt-3">
        <MetaRow icon={Mail} label="Subject" value={thread.subject || '(no subject)'} />
        <MetaRow icon={Clock} label="Last" value={messageHeaderDate(thread.lastMessageAt)} />
        <MetaRow icon={Tag} label="State" value={`${thread.isUnread ? 'Unread' : 'Read'} · ${inInbox ? 'Inbox' : 'Archived'}`} />
        <MetaRow icon={Link2} label="Domain" value={domain} />
        <MetaRow icon={AlignLeft} label="Preview" value={normalizePreview(thread.snippet) || '—'} />
      </div>
    </div>
  );
}
