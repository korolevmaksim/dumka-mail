import { useEffect, useRef } from 'react';
import { useAppStore, UNIFIED_ACCOUNT } from '../stores/AppStore';
import { deriveShortcuts } from '../../../shared/keyboard';
import { nextMailboxView } from '../../../shared/mailboxNavigation';
import { emitToast } from '../lib/toastBus';
import type { MailThread } from '../../../shared/types';

interface KeyboardOptions {
  isComposeActive: boolean;
  isSearchActive: boolean;
  onSearchFocus: () => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
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

      // If typing in input, ignore single-key shortcuts
      if (isInputFocused) return;

      const isMetaOrCtrl = e.metaKey || e.ctrlKey;
      const noModifiers = !e.metaKey && !e.ctrlKey && !e.altKey;

      // Command/Ctrl + A: Select All Threads
      if (isMetaOrCtrl && (e.code === 'KeyA' || e.key === 'a')) {
        e.preventDefault();
        currentStore.selectAllThreads();
        return;
      }


      // Command + K: Toggle Command Palette
      if (isMetaOrCtrl && (e.code === 'KeyK' || e.key === 'k')) {
        e.preventDefault();
        currentOptions.setCommandPaletteOpen(!currentOptions.commandPaletteOpen);
        return;
      }

      // Command + J: Toggle AI Panel
      if (isMetaOrCtrl && (e.code === 'KeyJ' || e.key === 'j')) {
        e.preventDefault();
        currentStore.setAiPanelOpen(!currentStore.aiPanelOpen);
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
          currentStore.setActiveAccount(currentStore.accounts[idx]);
          currentStore.setSettingsOpen(false);
        }
        return;
      }

      // Command + 0: Toggle Unified Inbox
      if (isMetaOrCtrl && e.key === '0') {
        e.preventDefault();
        if (currentStore.activeAccount?.id === 'unified') {
          if (currentStore.accounts.length > 0) {
            currentStore.setActiveAccount(currentStore.accounts[0]);
          }
        } else {
          currentStore.setActiveAccount(UNIFIED_ACCOUNT);
        }
        currentStore.setSettingsOpen(false);
        return;
      }

      // G / Shift+G: cycle mailbox views without mixing them into split tabs.
      if (noModifiers && (e.code === 'KeyG' || e.key.toLowerCase() === 'g')) {
        e.preventDefault();
        currentStore.setMailboxView(nextMailboxView(currentStore.mailboxView, e.shiftKey ? -1 : 1));
        currentStore.setSettingsOpen(false);
        return;
      }

      // Split switching (unmodified keys 1 to 9 based on active tabs)
      if (noModifiers && e.key >= '1' && e.key <= '9') {
        const activeTabs = currentStore.tabCategories.filter(c => {
          if (!c.active) return false;
          if (c.isSystem) return true;
          if (!currentStore.activeAccount || currentStore.activeAccount.id === 'unified') return true;
          return !c.accountId || c.accountId === 'global' || c.accountId === currentStore.activeAccount.email;
        });
        const idx = parseInt(e.key, 10) - 1;
        if (activeTabs[idx]) {
          e.preventDefault();
          currentStore.setActiveSplit(activeTabs[idx].id);
          currentStore.setSettingsOpen(false);
          return;
        }
      }

      // Slash (/): Focus search
      if (noModifiers && (e.code === 'Slash' || e.key === '/')) {
        e.preventDefault();
        currentOptions.onSearchFocus();
        currentStore.setSettingsOpen(false);
        return;
      }

      // Mode-aware resolution (KC-C1): Apple Mail disables single keys;
      // superhuman/gmail force vim navigation.
      const sc = deriveShortcuts(currentStore.settings.shortcuts);
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
        if (focusedThread) currentStore.openThread(focusedThread);
        return;
      }

      // Letter shortcuts below require single-key mode to be enabled.
      if (!sc.singleKey) return;

      // O: open
      if (noModifiers && (e.code === 'KeyO' || e.key === 'o')) {
        e.preventDefault();
        if (focusedThread) currentStore.openThread(focusedThread);
        return;
      }

      // E: archive/done
      if (noModifiers && (e.code === 'KeyE' || e.key === 'e')) {
        e.preventDefault();
        const targetId = currentStore.openedThread?.id || currentStore.focusedThreadId;
        if (targetId) {
          const nextIdx = Math.min(visible.length - 1, currentIdx + 1);
          if (nextIdx !== currentIdx && visible[nextIdx]) currentStore.setFocusedThreadId(visible[nextIdx].id);
          currentStore.executeMailAction('markDone', targetId);
        }
        return;
      }

      // U: toggle read/unread (KC-C3)
      if (noModifiers && (e.code === 'KeyU' || e.key === 'u')) {
        e.preventDefault();
        const target = currentStore.openedThread || focusedThread;
        if (target) currentStore.executeMailAction(target.isUnread ? 'markRead' : 'markUnread', target.id);
        return;
      }

      // Backspace/Delete: move to trash.
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        const target = currentStore.openedThread || focusedThread;
        if (target) currentStore.executeMailAction('moveToTrash', target.id);
        return;
      }

      // !: move to spam, M: ignore thread.
      if (noModifiers && e.key === '!') {
        e.preventDefault();
        const target = currentStore.openedThread || focusedThread;
        if (target) currentStore.executeMailAction('reportSpam', target.id);
        return;
      }
      if (noModifiers && (e.code === 'KeyM' || e.key === 'm')) {
        e.preventDefault();
        const target = currentStore.openedThread || focusedThread;
        if (target) currentStore.muteThread(target.id);
        return;
      }

      // R: reply / A: reply-all / F: forward (KC-C2) — operate on the open thread.
      if (noModifiers && (e.code === 'KeyR' || e.key === 'r')) {
        e.preventDefault();
        if (lastMsg) currentStore.startReply(lastMsg);
        else if (focusedThread) currentStore.openThread(focusedThread);
        return;
      }
      if (noModifiers && (e.code === 'KeyA' || e.key === 'a')) {
        e.preventDefault();
        if (lastMsg) currentStore.startReply(lastMsg, true);
        return;
      }
      if (noModifiers && (e.code === 'KeyF' || e.key === 'f')) {
        e.preventDefault();
        if (lastMsg) currentStore.startForward(lastMsg);
        return;
      }

      // H: open the Remind me chooser for the current thread.
      if (noModifiers && sc.reminderKey && (e.code === 'KeyH' || e.key === 'h')) {
        e.preventDefault();
        const target = currentStore.openedThread || focusedThread;
        if (target) currentOptions.onOpenReminder(target);
        return;
      }

      // S: summarize the open thread, or run a triage plan from the list (KC-C3).
      if (noModifiers && (e.code === 'KeyS' || e.key === 's')) {
        e.preventDefault();
        if (currentStore.openedThread) currentStore.runAIAction('summarize');
        else currentStore.runAITriagePlan();
        return;
      }

      // C: compose
      if (noModifiers && sc.composeKey && (e.code === 'KeyC' || e.key === 'c')) {
        e.preventDefault();
        const draft = currentStore.startNewDraft();
        if (!draft) {
          currentStore.setSettingsOpen(true);
          emitToast({ type: 'warning', message: 'Connect an account before composing.' });
          return;
        }
        return;
      }

      // Z: undo last action
      if (noModifiers && (e.code === 'KeyZ' || e.key === 'z')) {
        e.preventDefault();
        currentStore.undoLastAction();
        return;
      }

      // X: Toggle selection of focused thread
      if (noModifiers && (e.code === 'KeyX' || e.key === 'x')) {
        e.preventDefault();
        if (currentStore.focusedThreadId) {
          currentStore.toggleThreadSelection(currentStore.focusedThreadId);
        }
        return;
      }

    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
