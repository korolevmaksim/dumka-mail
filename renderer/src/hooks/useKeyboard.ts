import { useEffect, useRef } from 'react';
import { useAppStore, UNIFIED_ACCOUNT } from '../stores/AppStore';
import { deriveShortcuts, physicalKeyChar, resolveSingleKey } from '../../../shared/keyboard';
import { nextMailboxView } from '../../../shared/mailboxNavigation';
import { visibleSplitTabs } from '../../../shared/splitTabs';
import { composeOrConnectAccount } from '../lib/composeOrConnect';
import type { MailThread } from '../../../shared/types';

interface KeyboardOptions {
  isComposeActive: boolean;
  isSearchActive: boolean;
  onSearchFocus: () => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  onOpenShortcutGuide: () => void;
  onOpenReminder: (thread: MailThread) => void;
  onEscape: () => void;
}

export function useKeyboard(options: KeyboardOptions) {
  const store = useAppStore();

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const currentOptions = optionsRef.current;
      const currentStore = storeRef.current;

      // Check if an input field is focused (so we don't trigger hotkeys while typing)
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        (activeEl as HTMLElement).isContentEditable
      );
      const isInteractiveFocused = activeEl instanceof HTMLElement && Boolean(activeEl.closest('button,a,select,input,textarea,[role="button"],[tabindex]'));

      // Escape key handles closing layers (independent of text input focus!)
      if (e.key === 'Escape') {
        e.preventDefault();
        currentOptions.onEscape();
        return;
      }

      // Compose specific shortcut: Command+Return to send email
      if (currentOptions.isComposeActive && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        currentStore.sendDraftWithUndo();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === 'KeyC' || e.key.toLowerCase() === 'c')) {
        e.preventDefault();
        currentStore.setWorkspaceView('calendar');
        currentStore.setSettingsOpen(false);
        currentStore.setCleanupOpen(false);
        return;
      }

      // If typing in input, ignore single-key shortcuts
      if (isInputFocused) return;

      const isMetaOrCtrl = e.metaKey || e.ctrlKey;
      const noModifiers = !e.metaKey && !e.ctrlKey && !e.altKey;
      const isTodayWorkspace = currentStore.workspaceView === 'today';
      const isCalendarWorkspace = currentStore.workspaceView === 'calendar';

      // Command/Ctrl + A: Select All Threads
      if (isMetaOrCtrl && (e.code === 'KeyA' || e.key === 'a')) {
        e.preventDefault();
        if (isTodayWorkspace) return;
        currentStore.selectAllThreads();
        return;
      }


      // Command + K: Toggle Command Palette
      if (isMetaOrCtrl && (e.code === 'KeyK' || e.key === 'k')) {
        e.preventDefault();
        currentOptions.setCommandPaletteOpen(!currentOptions.commandPaletteOpen);
        return;
      }


      // Calendar owns its navigation, creation, search, and view shortcuts.
      if (isCalendarWorkspace) return;

      const sc = deriveShortcuts(currentStore.settings.shortcuts);

      // ?: open keyboard shortcut discovery. Shift is allowed because '?' is Shift+/.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key === '?' && sc.singleKey) {
        e.preventDefault();
        currentOptions.onOpenShortcutGuide();
        return;
      }

      // Command + J (Toggle AI Panel) is owned exclusively by the native menu
      // accelerator (main/menu.ts -> 'view.toggleAiCopilot' -> App.tsx). Binding
      // it here as well makes one keypress toggle the panel twice whenever the
      // menu accelerator also fires (e.g. focus inside the mail iframe).

      if (isTodayWorkspace && isMetaOrCtrl && e.shiftKey && (
        e.code === 'KeyE' || e.key === 'E' ||
        e.code === 'KeyU' || e.key === 'U' ||
        e.code === 'KeyH' || e.key === 'H'
      )) {
        e.preventDefault();
        return;
      }

      // Command + Shift + E: Archive/Done fallback
      if (isMetaOrCtrl && e.shiftKey && (e.code === 'KeyE' || e.key === 'E')) {
        e.preventDefault();
        currentStore.executeMailAction('markDone');
        return;
      }

      // Command + Shift + U: Mark Read fallback
      if (isMetaOrCtrl && e.shiftKey && (e.code === 'KeyU' || e.key === 'U')) {
        e.preventDefault();
        currentStore.executeMailAction('markRead');
        return;
      }

      // Command + Shift + H: open Remind me even when single-key shortcuts are off.
      if (isMetaOrCtrl && e.shiftKey && (e.code === 'KeyH' || e.key === 'H')) {
        e.preventDefault();
        const target = currentStore.openedThread || currentStore.visibleThreads.find(t => t.id === currentStore.focusedThreadId);
        if (target) currentOptions.onOpenReminder(target);
        return;
      }

      // Command + 1 to 9: Account tabs switching
      if (isMetaOrCtrl && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        if (currentStore.accounts[idx]) {
          currentStore.setWorkspaceView('mail');
          currentStore.setActiveAccount(currentStore.accounts[idx]);
          currentStore.setSettingsOpen(false);
          currentStore.setCleanupOpen(false);
        }
        return;
      }

      // Command + 0: Toggle Unified Inbox
      if (isMetaOrCtrl && e.key === '0') {
        e.preventDefault();
        if (currentStore.activeAccount?.id === 'unified') {
          if (currentStore.accounts.length > 0) {
            currentStore.setWorkspaceView('mail');
            currentStore.setActiveAccount(currentStore.accounts[0]);
          }
        } else {
          currentStore.setWorkspaceView('mail');
          currentStore.setActiveAccount(UNIFIED_ACCOUNT);
        }
        currentStore.setSettingsOpen(false);
        currentStore.setCleanupOpen(false);
        return;
      }

      // G / Shift+G: cycle mailbox views without mixing them into split tabs.
      if (noModifiers && (e.code === 'KeyG' || e.key.toLowerCase() === 'g')) {
        e.preventDefault();
        currentStore.setWorkspaceView('mail');
        currentStore.setMailboxView(nextMailboxView(currentStore.mailboxView, e.shiftKey ? -1 : 1));
        currentStore.setSettingsOpen(false);
        currentStore.setCleanupOpen(false);
        return;
      }

      // Split switching (unmodified keys 1 to 9 based on the visible tabs)
      if (noModifiers && e.key >= '1' && e.key <= '9') {
        const activeTabs = visibleSplitTabs(
          currentStore.tabCategories.filter(c => {
            if (c.isSystem) return true;
            if (!currentStore.activeAccount || currentStore.activeAccount.id === 'unified') return true;
            return !c.accountId || c.accountId === 'global' || c.accountId === currentStore.activeAccount.email;
          }),
          currentStore.splitCounts,
          currentStore.settings.inbox.hideEmptySplits,
          currentStore.activeSplit,
        );
        const idx = parseInt(e.key, 10) - 1;
        if (activeTabs[idx]) {
          e.preventDefault();
          currentStore.setWorkspaceView('mail');
          currentStore.setActiveSplit(activeTabs[idx].id);
          currentStore.setSettingsOpen(false);
          currentStore.setCleanupOpen(false);
          return;
        }
      }

      // Slash (/): Focus search
      if (noModifiers && (e.code === 'Slash' || e.key === '/')) {
        e.preventDefault();
        currentStore.setWorkspaceView('mail');
        currentOptions.onSearchFocus();
        currentStore.setSettingsOpen(false);
        currentStore.setCleanupOpen(false);
        return;
      }

      const mailOnlyKey = (e.key === 'Enter' && !isInteractiveFocused)
        || e.key === 'Backspace'
        || e.key === 'Delete'
        || e.key === 'ArrowUp'
        || e.key === 'ArrowDown'
        || e.key === '!'
        || (noModifiers && ['a', 'c', 'e', 'f', 'h', 'j', 'k', 'm', 'o', 'r', 's', 'u', 'x', 'z'].includes(e.key.toLowerCase()));
      if (isTodayWorkspace && mailOnlyKey) {
        e.preventDefault();
        return;
      }
      if (isTodayWorkspace && e.key === 'Enter' && isInteractiveFocused) {
        return;
      }

      // Mode-aware resolution (KC-C1): Apple Mail disables single keys;
      // superhuman/gmail force vim navigation.
      const visible = currentStore.visibleThreads;
      const currentIdx = visible.findIndex(t => t.id === currentStore.focusedThreadId);
      const focusedThread = currentIdx !== -1 ? visible[currentIdx] : null;
      const lastMsg = currentStore.openedThreadMessages.length > 0
        ? currentStore.openedThreadMessages[currentStore.openedThreadMessages.length - 1]
        : null;

      // Arrows always navigate; vim j/k only when enabled.
      if (e.key === 'ArrowUp' || (sc.vim && noModifiers && (e.code === 'KeyK' || e.key === 'k'))) {
        e.preventDefault();
        if (currentStore.openedThread) {
          const reader = document.getElementById('thread-reader-pane');
          if (reader) reader.scrollTop -= 60;
        } else if (visible.length) {
          currentStore.setFocusedThreadId(visible[Math.max(0, currentIdx - 1)].id);
        }
        return;
      }
      if (e.key === 'ArrowDown' || (sc.vim && noModifiers && (e.code === 'KeyJ' || e.key === 'j'))) {
        e.preventDefault();
        if (currentStore.openedThread) {
          const reader = document.getElementById('thread-reader-pane');
          if (reader) reader.scrollTop += 60;
        } else if (visible.length) {
          currentStore.setFocusedThreadId(visible[Math.min(visible.length - 1, currentIdx + 1)].id);
        }
        return;
      }

      // Enter opens the focused thread (works in every mode).
      if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedThread) {
          currentStore.setWorkspaceView('mail');
          currentStore.openThread(focusedThread);
        }
        return;
      }

      // Letter shortcuts below require single-key mode to be enabled.
      if (!sc.singleKey) return;
      if (!(noModifiers || e.key === 'Backspace' || e.key === 'Delete')) return;

      const action = resolveSingleKey(physicalKeyChar(e.key, e.code), sc);
      if (action === 'none' || action === 'search' || action === 'shortcutGuide' || action === 'next' || action === 'prev') {
        return;
      }

      e.preventDefault();
      const target = currentStore.openedThread || focusedThread;
      switch (action) {
        case 'open':
          if (focusedThread) {
            currentStore.setWorkspaceView('mail');
            currentStore.openThread(focusedThread);
          }
          return;
        case 'archive': {
          const targetId = currentStore.openedThread?.id || currentStore.focusedThreadId;
          if (targetId) {
            const nextIdx = Math.min(visible.length - 1, currentIdx + 1);
            if (nextIdx !== currentIdx && visible[nextIdx]) currentStore.setFocusedThreadId(visible[nextIdx].id);
            currentStore.executeMailAction('markDone', targetId);
          }
          return;
        }
        case 'toggleRead':
          if (target) currentStore.executeMailAction(target.isUnread ? 'markRead' : 'markUnread', target.id);
          return;
        case 'trash':
          if (target) currentStore.executeMailAction('moveToTrash', target.id);
          return;
        case 'spam':
          if (target) currentStore.executeMailAction('reportSpam', target.id);
          return;
        case 'mute':
          if (target) currentStore.muteThread(target.id);
          return;
        case 'reply':
          if (lastMsg) currentStore.startReply(lastMsg);
          else if (focusedThread) {
            currentStore.setWorkspaceView('mail');
            currentStore.openThread(focusedThread);
          }
          return;
        case 'replyAll':
          if (lastMsg) currentStore.startReply(lastMsg, true);
          return;
        case 'forward':
          if (lastMsg) currentStore.startForward(lastMsg);
          return;
        case 'remind':
          if (target) currentOptions.onOpenReminder(target);
          return;
        case 'summarize':
          if (currentStore.openedThread) currentStore.runAIAction('summarize');
          else currentStore.runAITriagePlan();
          return;
        case 'compose':
          composeOrConnectAccount(currentStore);
          return;
        case 'undo':
          currentStore.undoLastAction();
          return;
        case 'select':
          if (currentStore.focusedThreadId) {
            currentStore.toggleThreadSelection(currentStore.focusedThreadId);
          }
          return;
        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }

    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
