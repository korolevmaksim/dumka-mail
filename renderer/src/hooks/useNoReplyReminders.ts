// "Remind me if no reply" (reply dock). The dock asks for a reminder when the
// user presses Send; it is armed only once the send flow reports that the
// message was sent (never for an undone or failed send), and the thread then
// gets an ordinary reminder, the same one `H` sets
// (logged as setReminder, so it shows in Later and `Z` can undo it).
// A watch list in localStorage lets the app clear that reminder silently when
// someone else replies. Mount `useNoReplyReminders()` once (App).
import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';
import { describeReminder } from '../../../shared/reminders';
import {
  evaluateNoReplyWatch,
  parseNoReplyWatches,
  upsertNoReplyWatch,
  type NoReplyWatch,
} from '../../../shared/noReplyReminder';

const STORAGE_KEY = 'dumka.noReplyReminders.v1';

export interface ArmedReminder {
  accountId: string;
  threadId: string;
  draftId: string;
  sentAt: string;
  remindAt: string;
}

let commit: ((entry: ArmedReminder) => void) | null = null;

/**
 * Called from `sendDraftWithUndo`'s `onSent`, i.e. once the send was accepted
 * (sent, or parked offline for sync) — never on the absence of a draft.
 */
export function armNoReplyReminder(entry: ArmedReminder): void {
  commit?.(entry);
}

function readWatches(): NoReplyWatch[] {
  try {
    return parseNoReplyWatches(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

function writeWatches(watches: NoReplyWatch[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(watches));
  } catch (error) {
    console.error('Could not save the reply watch list:', error);
  }
}

export function useNoReplyReminders(): void {
  const store = useAppStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    commit = (entry) => {
      void setReminder(entry);
    };
    return () => { commit = null; };
  }, []);

  async function setReminder(entry: ArmedReminder): Promise<void> {
    const current = storeRef.current;
    const payload = JSON.stringify({ accountId: entry.accountId, reminderAt: entry.remindAt, silent: true, source: 'noReply' });
    let saved = false;
    if (current.threads.some(thread => thread.id === entry.threadId && thread.accountId === entry.accountId)) {
      const result = await current.executeMailAction('setReminder', entry.threadId, null, undefined, payload);
      saved = result.accepted;
    }
    if (!saved) {
      try {
        await window.electronAPI.saveReminder(entry.accountId, entry.threadId, entry.remindAt);
        saved = true;
      } catch (error) {
        console.error('Could not save the no-reply reminder:', error);
      }
    }
    if (!saved) {
      emitToast({ type: 'error', message: 'The message was sent, but the reminder could not be set.' });
      return;
    }
    writeWatches(upsertNoReplyWatch(readWatches(), {
      accountId: entry.accountId,
      threadId: entry.threadId,
      sentAt: entry.sentAt,
      remindAt: entry.remindAt,
    }));
    emitToast({ type: 'info', message: `Reminder set for ${describeReminder(new Date(entry.remindAt))} if nobody replies.` });
  }

  // Clear the reminder when a reply arrives.
  useEffect(() => {
    const watches = readWatches();
    if (watches.length === 0) return;
    const now = new Date();
    const remaining: NoReplyWatch[] = [];
    let changed = false;
    for (const watch of watches) {
      const thread = store.threads.find(entry => entry.id === watch.threadId && entry.accountId === watch.accountId);
      const verdict = evaluateNoReplyWatch(watch, thread, now);
      if (verdict === 'keep') {
        remaining.push(watch);
        continue;
      }
      changed = true;
      if (verdict === 'clear') {
        void store.executeMailAction(
          'clearReminder',
          watch.threadId,
          null,
          undefined,
          JSON.stringify({ accountId: watch.accountId, silent: true, source: 'noReply' }),
        ).catch(error => console.error('Could not clear the no-reply reminder:', error));
      }
    }
    if (changed) writeWatches(remaining);
  }, [store.threads]);
}
