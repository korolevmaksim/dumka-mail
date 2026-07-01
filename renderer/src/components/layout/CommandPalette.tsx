import { useState } from 'react';
import { useAppStore, UNIFIED_ACCOUNT } from '../../stores/AppStore';
import { Command, X } from 'lucide-react';
import { emitToast } from '../../lib/toastBus';
import { nextMailboxView } from '../../../../shared/mailboxNavigation';

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
  const commands = [
    { title: 'Mark Done (Archive)', shortcut: 'E', action: () => store.executeMailAction('markDone') },
    { title: 'Mark Read', shortcut: 'R', action: () => store.executeMailAction('markRead') },
    { title: 'Mark Unread', shortcut: 'Shift+R', action: () => store.executeMailAction('markUnread') },
    { title: 'Move to Trash', shortcut: '#', action: () => store.executeMailAction('moveToTrash') },
    { title: 'Move to Spam', shortcut: '!', action: () => store.executeMailAction('reportSpam') },
    { title: 'Ignore Thread', shortcut: 'M', action: () => store.muteThread() },
    { title: 'Set Reminder', shortcut: 'H', action: onOpenReminder },
    { title: 'Open AI Assistant', shortcut: 'Cmd+J', action: () => store.setAiPanelOpen(true) },
    { title: 'AI Triage Queue', shortcut: 'S', action: () => store.runAITriagePlan() },
    { title: 'Compose Message', shortcut: 'C', action: () => {
      const draft = store.startNewDraft();
      if (!draft) {
        store.setSettingsOpen(true);
        emitToast({ type: 'warning', message: 'Connect an account before composing.' });
        return;
      }
    }},
    { title: 'Toggle Unified Inbox', shortcut: 'Cmd+0', action: () => {
      store.setActiveAccount(store.activeAccount?.id === 'unified' ? (store.accounts[0] || null) : UNIFIED_ACCOUNT);
      store.setSettingsOpen(false);
    } },
    { title: 'Switch Mailbox', shortcut: 'G', action: () => {
      store.setMailboxView(nextMailboxView(store.mailboxView));
      store.setSettingsOpen(false);
    } },
    { title: 'Undo Last Action', shortcut: 'Z', action: () => store.undoLastAction() },
    { title: 'Toggle Theme', shortcut: 'Cmd+Shift+T', action: () => {
      const nextTheme = store.theme === 'system' ? 'light' : (store.theme === 'light' ? 'dark' : 'system');
      store.setTheme(nextTheme);
    }},
    { title: 'Cache Visible Bodies', shortcut: 'Cmd+Shift+B', action: () => store.triggerVisibleBodyRepair() },
    { title: 'Resume Older Mail Indexing', shortcut: 'Cmd+Shift+I', action: () => store.triggerBackfillManual() },
  ];

  const filteredCommands = commands.filter(c => 
    c.title.toLowerCase().includes(paletteSearch.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (filteredCommands.length > 0 ? (prev + 1) % filteredCommands.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (filteredCommands.length > 0 ? (prev - 1 + filteredCommands.length) % filteredCommands.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filteredCommands[activeIndex];
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
                key={idx}
                onClick={() => {
                  c.action();
                  onClose();
                }}
                className={`flex justify-between items-center px-4 py-2 cursor-pointer text-[calc(12px*var(--font-scale))] transition-colors ${
                  idx === activeIndex
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
