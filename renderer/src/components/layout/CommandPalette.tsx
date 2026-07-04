import { useState } from 'react';
import { useAppStore, UNIFIED_ACCOUNT } from '../../stores/AppStore';
import { Command, X } from 'lucide-react';
import { emitToast } from '../../lib/toastBus';
import { nextMailboxView } from '../../../../shared/mailboxNavigation';
import { rankCommands, type PaletteCommand } from '../../../../shared/commandPalette';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenReminder: () => void;
}

export function CommandPalette({ isOpen, onClose, onOpenReminder }: CommandPaletteProps) {
  const store = useAppStore();
  const [paletteSearch, setPaletteSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  if (!isOpen) return null;

  // Command palette actions list
  const commands: Array<PaletteCommand & { action: () => void }> = [
    { id: 'mark-done', group: 'mail', title: 'Mark Done (Archive)', shortcut: 'E', keywords: ['archive', 'done'], action: () => store.executeMailAction('markDone') },
    { id: 'mark-read', group: 'mail', title: 'Mark Read', shortcut: 'R', keywords: ['read'], action: () => store.executeMailAction('markRead') },
    { id: 'mark-unread', group: 'mail', title: 'Mark Unread', shortcut: 'Shift+R', keywords: ['unread'], action: () => store.executeMailAction('markUnread') },
    { id: 'move-trash', group: 'mail', title: 'Move to Trash', shortcut: '#', keywords: ['delete', 'remove'], action: () => store.executeMailAction('moveToTrash') },
    { id: 'move-spam', group: 'mail', title: 'Move to Spam', shortcut: '!', keywords: ['spam', 'junk'], action: () => store.executeMailAction('reportSpam') },
    { id: 'ignore-thread', group: 'mail', title: 'Ignore Thread', shortcut: 'M', keywords: ['mute'], action: () => store.muteThread() },
    { id: 'set-reminder', group: 'mail', title: 'Set Reminder', shortcut: 'H', keywords: ['remind', 'snooze'], action: onOpenReminder },
    { id: 'open-ai-assistant', group: 'ai', title: 'Open AI Assistant', shortcut: 'Cmd+J', keywords: ['ai', 'assistant'], action: () => store.setAiPanelOpen(true) },
    { id: 'ai-triage-queue', group: 'ai', title: 'AI Triage Queue', shortcut: 'S', keywords: ['triage', 'queue'], action: () => store.runAITriagePlan() },
    { id: 'compose-message', group: 'compose', title: 'Compose Message', shortcut: 'C', keywords: ['new mail', 'draft'], action: () => {
      const draft = store.startNewDraft();
      if (!draft) {
        store.setSettingsOpen(true);
        store.setCleanupOpen(false);
        emitToast({ type: 'warning', message: 'Connect an account before composing.' });
        return;
      }
    }},
    { id: 'toggle-unified-inbox', group: 'navigation', title: 'Toggle Unified Inbox', shortcut: 'Cmd+0', keywords: ['unified', 'all accounts'], action: () => {
      store.setActiveAccount(store.activeAccount?.id === 'unified' ? (store.accounts[0] || null) : UNIFIED_ACCOUNT);
      store.setSettingsOpen(false);
      store.setCleanupOpen(false);
    } },
    { id: 'switch-mailbox', group: 'navigation', title: 'Switch Mailbox', shortcut: 'G', keywords: ['inbox', 'sent', 'trash', 'spam'], action: () => {
      store.setMailboxView(nextMailboxView(store.mailboxView));
      store.setSettingsOpen(false);
      store.setCleanupOpen(false);
    } },
    { id: 'undo-last-action', group: 'mail', title: 'Undo Last Action', shortcut: 'Z', keywords: ['undo'], action: () => store.undoLastAction() },
    { id: 'toggle-theme', group: 'settings', title: 'Toggle Theme', shortcut: 'Cmd+Shift+T', keywords: ['theme', 'dark', 'light'], action: () => {
      const nextTheme = store.theme === 'system' ? 'light' : (store.theme === 'light' ? 'dark' : 'system');
      store.setTheme(nextTheme);
    }},
    { id: 'cache-visible-bodies', group: 'sync', title: 'Cache Visible Bodies', shortcut: 'Cmd+Shift+B', keywords: ['body', 'cache'], action: () => store.triggerVisibleBodyRepair() },
    { id: 'resume-older-mail-indexing', group: 'sync', title: 'Resume Older Mail Indexing', shortcut: 'Cmd+Shift+I', keywords: ['backfill', 'index'], action: () => store.triggerBackfillManual() },
  ];

  const filteredCommands = rankCommands(paletteSearch, commands);
  const effectiveActiveIndex = filteredCommands.length > 0 ? Math.min(activeIndex, filteredCommands.length - 1) : 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (filteredCommands.length > 0 ? (prev + 1) % filteredCommands.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (filteredCommands.length > 0 ? (prev - 1 + filteredCommands.length) % filteredCommands.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filteredCommands[effectiveActiveIndex];
      if (cmd) {
        cmd.action();
        onClose();
      }
    }
  };

  return (
    <div className="absolute inset-0 bg-black/40 flex items-start justify-center pt-24 z-50 select-none">
      <div className="w-[500px] bg-[var(--panel-bg)] rounded-xl border border-[var(--strong-border)] shadow-2xl flex flex-col overflow-hidden max-h-[360px]">
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5 focus-within:outline focus-within:outline-2 focus-within:outline-[var(--accent)] focus-within:outline-offset-[-1px]">
          <Command className="w-4 h-4 text-[var(--text-secondary)]" />
          <input
            autoFocus
            type="text"
            placeholder="Type a command…"
            value={paletteSearch}
            onChange={(e) => {
              setPaletteSearch(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-0 outline-none text-[calc(12px*var(--font-scale))] text-[var(--text-primary)] placeholder-[var(--text-tertiary)]"
          />
          <button onClick={onClose} className="cursor-pointer">
            <X className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto py-1">
          {filteredCommands.length === 0 ? (
            <div className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] text-center py-6">No commands found</div>
          ) : (
            filteredCommands.map((c, idx) => (
              <div
                key={c.id}
                onClick={() => {
                  c.action();
                  onClose();
                }}
                className={`flex justify-between items-center px-4 py-2 cursor-pointer text-[calc(12px*var(--font-scale))] transition-colors ${
                  idx === effectiveActiveIndex
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-primary)] hover:bg-[var(--hover-row)]'
                }`}
              >
                <span>{c.title}</span>
                <kbd className={`text-[calc(10px*var(--font-scale))] px-1.5 rounded ${
                  idx === activeIndex
                    ? 'bg-white/20 text-white'
                    : 'bg-[var(--border)] text-[var(--text-secondary)]'
                }`}>
                  {c.shortcut}
                </kbd>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
