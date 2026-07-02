import React from 'react';
import { Paperclip, Clock, Check } from 'lucide-react';
import { MailThread } from '../../../shared/types';
import { primaryRowLabel } from '../../../shared/labels';
import { normalizePreview } from '../../../shared/textNormalizer';
import { listTimestamp } from '../../../shared/dateFormat';

function avatarColor(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash) % 360}, 52%, 52%)`;
}

interface ThreadRowProps {
  thread: MailThread;
  isFocused: boolean;
  isOpened: boolean;
  showAvatars: boolean;
  isSelected: boolean;
  isSelectionModeActive: boolean;
  positionInSet?: number;
  setSize?: number;
  onClick: () => void;
  onToggleSelect: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

// Dense premium row (Swift ThreadRow): leading avatar/unread-dot, constant-color
// sender + subject (unread shown only via accent dot/badge + weight), one label
// pill, bare attachment/reminder glyphs, 24h timestamp, density-driven height,
// 2px accent selection bar.
export function ThreadRow({
  thread,
  isFocused,
  isOpened,
  showAvatars,
  isSelected,
  isSelectionModeActive,
  positionInSet,
  setSize,
  onClick,
  onToggleSelect,
  onContextMenu
}: ThreadRowProps) {
  const senderText = thread.senderNames.length > 0 ? thread.senderNames.join(', ') : thread.senderEmail;
  const initials = (senderText || '?').trim().substring(0, 2).toUpperCase();
  const label = primaryRowLabel(thread);
  const preview = normalizePreview(thread.snippet);
  const [isHovered, setIsHovered] = React.useState(false);

  const showCheckbox = isSelected || isHovered || isSelectionModeActive;
  const subject = thread.subject.trim() || '(no subject)';
  const timestamp = listTimestamp(thread.lastMessageAt);
  const accessibilityLabel = [
    thread.isUnread ? 'Unread thread' : 'Read thread',
    isOpened ? 'currently open' : null,
    isSelected ? 'selected' : null,
    `from ${senderText}`,
    `subject ${subject}`,
    label ? `label ${label.name}` : null,
    preview ? `preview ${preview}` : null,
    thread.hasAttachments ? 'has attachments' : null,
    thread.reminderAt ? 'has reminder' : null,
    timestamp ? `last message ${timestamp}` : null
  ].filter(Boolean).join(', ');
  const selectLabel = `${isSelected ? 'Deselect' : 'Select'} thread: ${subject}`;

  const renderSelectionButton = () => (
    <button
      type="button"
      aria-label={selectLabel}
      aria-pressed={isSelected}
      onClick={(e) => {
        e.stopPropagation();
        onToggleSelect(e);
      }}
      className={`w-4.5 h-4.5 rounded-full border flex items-center justify-center transition-all cursor-pointer outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 ${
        isSelected
          ? 'bg-[var(--accent)] border-[var(--accent)] text-white shadow-sm'
          : 'border-[var(--strong-border)] hover:border-[var(--accent)] bg-[var(--panel-bg)]'
      }`}
    >
      {isSelected && <Check aria-hidden="true" className="w-3 h-3 stroke-[3.5px]" />}
    </button>
  );

  return (
    <div
      data-thread-row
      tabIndex={0}
      role="listitem"
      aria-current={isOpened ? 'true' : undefined}
      aria-label={accessibilityLabel}
      aria-posinset={positionInSet}
      aria-setsize={setSize}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`relative shrink-0 flex items-start gap-2.5 px-[var(--row-px)] py-2 cursor-pointer select-none border-b border-[var(--border)] transition-colors min-h-[var(--thread-row-h)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-2px] ${
        isSelected ? 'bg-[var(--selected-row)] bg-opacity-80' : isOpened ? 'bg-[var(--selected-row)]' : isFocused ? 'bg-[var(--hover-row)]' : 'hover:bg-[var(--hover-row)]'
      }`}
    >
      {(isFocused || isOpened) && <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--accent)]" />}

      {/* Avatar (with unread badge) or unread dot */}
      {showAvatars ? (
        <div className="w-6 h-6 flex items-center justify-center shrink-0 mt-0.5">
          {showCheckbox ? (
            renderSelectionButton()
          ) : (
            <div
              aria-hidden="true"
              className="relative w-6 h-6 rounded-full flex items-center justify-center text-[calc(10px*var(--font-scale))] font-bold text-white shrink-0"
              style={{ backgroundColor: avatarColor(thread.senderEmail || senderText) }}
            >
              {initials}
              {thread.isUnread && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--accent)] border-2 border-[var(--panel-bg)]" />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="w-6 h-6 flex items-center justify-center shrink-0">
          {showCheckbox ? (
            renderSelectionButton()
          ) : (
            <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${thread.isUnread ? 'bg-[var(--accent)]' : 'bg-transparent'}`} />
          )}
        </div>
      )}


      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        {/* Line 1: sender + time */}
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[calc(12px*var(--font-scale))] truncate text-[var(--text-primary)] ${thread.isUnread ? 'font-semibold' : 'font-medium'}`}>
            {senderText}
          </span>
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)] shrink-0 whitespace-nowrap">
            {listTimestamp(thread.lastMessageAt)}
          </span>
        </div>

        {/* Line 2: label pill + subject */}
        <div className="flex items-center gap-1.5 min-w-0">
          {label && (
            <span
              className="text-[calc(9px*var(--font-scale))] px-1 py-px rounded-[3px] shrink-0 max-w-[80px] truncate font-medium leading-[14px]"
              style={{ color: label.color, backgroundColor: `color-mix(in srgb, ${label.color} 16%, transparent)` }}
            >
              {label.name}
            </span>
          )}
          <span className={`text-[calc(12px*var(--font-scale))] truncate ${thread.isUnread ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
            {thread.subject || '(no subject)'}
          </span>
        </div>

        {/* Line 3: preview + glyphs */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[calc(11px*var(--font-scale))] truncate text-[var(--text-tertiary)] flex-1">{preview}</span>
          {thread.hasAttachments && <Paperclip aria-hidden="true" className="w-3 h-3 text-[var(--text-tertiary)] shrink-0" />}
          {thread.reminderAt && <Clock aria-hidden="true" className="w-3 h-3 text-[var(--accent)] shrink-0" />}
        </div>
      </div>
    </div>
  );
}
