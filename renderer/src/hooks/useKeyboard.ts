import { useEffect, useRef } from 'react';
import { useAppStore, UNIFIED_ACCOUNT } from '../stores/AppStore';
import { deriveShortcuts, physicalKeyChar, resolveInviteKey, resolveSectionKey, resolveSingleKey } from '../../../shared/keyboard';
import { threadNeedsInviteAnswer, type InviteAnswer } from '../../../shared/inviteRsvp';
import { activeReplyDock } from '../lib/replyDockBridge';
import { nextMailboxView } from '../../../shared/mailboxNavigation';
import { composeOrConnectAccount } from '../lib/composeOrConnect';
import { emitToast } from '../lib/toastBus';
import type { MailThread } from '../../../shared/types';

interface KeyboardOptions {
  isComposeActive: boolean;
  isSearchActive: boolean;
  onSearchFocus: () => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  onOpenShortcutGuide: () => void;
  onOpenReminder: (thread: MailThread) => void;
  /** `V`: open the "Move to section" popover for this thread. */
  onOpenMoveToSection: (thread: MailThread) => void;
  /** `Y` / `N` on a thread whose invitation still needs an answer. */
  onAnswerInvite: (thread: MailThread, answer: InviteAnswer) => void;
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
      // Checkboxes (group rows) and other non-text inputs do not take typing.
      const isTextInput = activeEl instanceof HTMLInputElement
        && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(activeEl.type);
      const isInputFocused = activeEl && (
        isTextInput ||
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
      // ⌘↩ follows "After sending a reply"; ⌘⇧↩ does the opposite.
      // The reply dock goes first: it also sends a prepared draft that is
      // shown but not yet opened for editing, and arms "Remind me if no reply".
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey && currentStore.openedThread) {
        const focusOutsideDock = Boolean(isInputFocused) && !(activeEl instanceof HTMLElement && activeEl.closest('[data-reply-dock]'));
        const dock = focusOutsideDock ? null : activeReplyDock();
        if (dock?.send(e.shiftKey ? 'alternate' : 'default')) {
          e.preventDefault();
          return;
        }
      }
      if (currentOptions.isComposeActive && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void currentStore.sendDraftWithUndo({ intent: e.shiftKey ? 'alternate' : 'default' });
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

      // The split tabs (unmodified 1–5) were removed with the decision-sections inbox.

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
        || (noModifiers && ['a', 'c', 'e', 'f', 'h', 'j', 'k', 'm', 'n', 'o', 'r', 's', 'u', 'x', 'y', 'z'].includes(e.key.toLowerCase()));
      if (isTodayWorkspace && mailOnlyKey) {
        e.preventDefault();
        return;
      }
      if (isTodayWorkspace && e.key === 'Enter' && isInteractiveFocused) {
        return;
      }

      // Mode-aware resolution (KC-C1): Apple Mail disables single keys;
      // superhuman/gmail force vim navigation.
      // Display order: decision sections reorder the inbox; a collapsed group
      // is one stop (its first thread stands in for the group row).
      const visible = currentStore.listNavigationThreads;
      const currentIdx = visible.findIndex(t => t.id === currentStore.focusedThreadId);
      const focusedThread = currentIdx !== -1 ? visible[currentIdx] : null;
      const lastMsg = currentStore.openedThreadMessages.length > 0
        ? currentStore.openedThreadMessages[currentStore.openedThreadMessages.length - 1]
        : null;

      // Arrows always navigate; vim j/k only when enabled.
      // "Handled for you" (SPEC §7) sits above the first row: K / ↑ from the top reaches it.
      const handledRowAvailable = currentStore.sectioned && currentStore.handledItems.length > 0 && !currentStore.openedThread;
      const handledFocused = handledRowAvailable && currentStore.handledRowFocused;

      if (e.key === 'ArrowUp' || (sc.vim && noModifiers && (e.code === 'KeyK' || e.key === 'k'))) {
        e.preventDefault();
        if (currentStore.openedThread) {
          const reader = document.getElementById('thread-reader-pane');
          if (reader) reader.scrollTop -= 60;
        } else if (handledRowAvailable && (handledFocused || currentIdx <= 0)) {
          currentStore.setHandledRowFocused(true);
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
        } else if (handledFocused) {
          currentStore.setHandledRowFocused(false);
          if (visible.length && currentIdx === -1) currentStore.setFocusedThreadId(visible[0].id);
        } else if (visible.length) {
          currentStore.setFocusedThreadId(visible[Math.min(visible.length - 1, currentIdx + 1)].id);
        }
        return;
      }

      const focusedGroup = currentStore.focusedCollapsedGroup;

      // Enter on a focused button / link activates it natively — including a
      // control nested inside a row; only the list rows themselves (thread rows,
      // group rows) and the bare list hand Enter to the mailbox.
      const onListRow = activeEl instanceof HTMLElement && activeEl.matches('[data-thread-row],[data-group-row],[data-handled-row]');
      if (e.key === 'Enter' && isInteractiveFocused && !onListRow) return;

      if (handledFocused) {
        if (e.key === 'Enter' || (sc.singleKey && noModifiers && resolveSingleKey(physicalKeyChar(e.key, e.code), sc) === 'open')) {
          e.preventDefault();
          currentStore.toggleHandledExpanded();
          return;
        }
        // The row stands for several archived threads: only undo and global keys apply.
        const handledAction = sc.singleKey && noModifiers ? resolveSingleKey(physicalKeyChar(e.key, e.code), sc) : 'none';
        if (handledAction === 'undo') {
          e.preventDefault();
          currentStore.undoLastAction();
          return;
        }
        if (handledAction === 'compose') {
          e.preventDefault();
          composeOrConnectAccount(currentStore);
          return;
        }
        if (handledAction !== 'none' || mailOnlyKey) {
          e.preventDefault();
          return;
        }
      }

      // Enter opens the focused thread (works in every mode); on a collapsed group it opens the group.
      if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedGroup) {
          currentStore.toggleSectionGroup(focusedGroup, true);
        } else if (focusedThread) {
          currentStore.setWorkspaceView('mail');
          currentStore.openThread(focusedThread);
        }
        return;
      }

      // Letter shortcuts below require single-key mode to be enabled.
      if (!sc.singleKey) return;
      if (!(noModifiers || e.key === 'Backspace' || e.key === 'Delete')) return;

      const sectionAction = resolveSectionKey(e.key, e.code, e, sc);
      if (sectionAction !== 'none') {
        e.preventDefault();
        const section = focusedGroup || currentStore.focusedSection;
        if (sectionAction === 'archiveClearSection') {
          if (!currentStore.sectioned) return;
          if (section === 'clear') void currentStore.runClearGroupAction();
          else emitToast({ type: 'info', message: 'Move to the Clear section to archive it as a group.' });
          return;
        }
        if (sectionAction === 'remindLaterSection') {
          if (!currentStore.sectioned) return;
          if (section === 'later') void currentStore.remindLaterGroup();
          else emitToast({ type: 'info', message: 'Move to the Later section to schedule it as a group.' });
          return;
        }
        const target = currentStore.openedThread || (focusedGroup ? null : focusedThread);
        if (target && currentStore.mailboxView === 'inbox') currentOptions.onOpenMoveToSection(target);
        return;
      }

      // Y / N answer an invitation; bound only while the target needs an answer.
      const inviteTarget = currentStore.openedThread || (focusedGroup ? null : focusedThread);
      const inviteAction = resolveInviteKey(e.key, e.code, e, sc, threadNeedsInviteAnswer(inviteTarget));
      if (inviteAction !== 'none' && inviteTarget) {
        e.preventDefault();
        currentOptions.onAnswerInvite(inviteTarget, inviteAction === 'acceptInvite' ? 'accepted' : 'declined');
        return;
      }

      const action = resolveSingleKey(physicalKeyChar(e.key, e.code), sc);
      if (action === 'none' || action === 'search' || action === 'shortcutGuide' || action === 'next' || action === 'prev') {
        return;
      }

      // A collapsed group row stands for several threads: only opening it,
      // undo and global keys apply; single-thread actions would hit a hidden row.
      if (focusedGroup && action !== 'open' && action !== 'undo' && action !== 'compose') {
        e.preventDefault();
        return;
      }

      e.preventDefault();
      const target = currentStore.openedThread || focusedThread;
      switch (action) {
        case 'open':
          if (focusedGroup) {
            currentStore.toggleSectionGroup(focusedGroup, true);
          } else if (focusedThread) {
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
          // The dock focuses an open editor or opens a prepared / saved draft.
          if (currentStore.openedThread && activeReplyDock()?.reply()) return;
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
