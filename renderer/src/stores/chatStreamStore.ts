// Streaming "Ask Dumka" text lives outside the global AppStore (like
// `useAgentPrep`): a delta would otherwise re-render every `useAppStore()`
// consumer — the mailbox list, the open reader — once per chunk. Deltas are
// coalesced to one publish per animation frame and only the streaming bubble
// subscribes. The finished answer is committed to the store once.
import { useSyncExternalStore } from 'react';

export interface ChatStreamSnapshot {
  /** Assistant message receiving text; null when nothing streams. */
  messageId: string | null;
  text: string;
}

const EMPTY: ChatStreamSnapshot = { messageId: null, text: '' };

let snapshot: ChatStreamSnapshot = EMPTY;
let pending: ChatStreamSnapshot | null = null;
let frame: number | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function scheduleFrame(callback: () => void): number {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(id: number): void {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(id);
  } else {
    clearTimeout(id);
  }
}

function flush(): void {
  frame = null;
  if (!pending) return;
  snapshot = pending;
  pending = null;
  notify();
}

export const chatStream = {
  /** Starts a stream for `messageId` (drops any previous one). */
  start(messageId: string): void {
    chatStream.clear();
    snapshot = { messageId, text: '' };
    notify();
  },
  /** Sets the full text so far; published on the next animation frame. */
  update(messageId: string, text: string): void {
    const current = pending ?? snapshot;
    if (current.messageId !== messageId) return;
    pending = { messageId, text };
    if (frame === null) frame = scheduleFrame(flush);
  },
  clear(): void {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    pending = null;
    if (snapshot === EMPTY) return;
    snapshot = EMPTY;
    notify();
  },
  getSnapshot(): ChatStreamSnapshot {
    return snapshot;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

export function useChatStream(): ChatStreamSnapshot {
  return useSyncExternalStore(chatStream.subscribe, chatStream.getSnapshot, chatStream.getSnapshot);
}
