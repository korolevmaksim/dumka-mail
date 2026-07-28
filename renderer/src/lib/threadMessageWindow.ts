export const INITIAL_EXPANDED_MESSAGES = 3;
export const EARLIER_MESSAGE_BATCH_SIZE = 10;

export function initialMessageWindowStart(messageCount: number): number {
  return Math.max(0, Math.floor(messageCount) - INITIAL_EXPANDED_MESSAGES);
}

export function revealEarlierMessageWindowStart(currentStart: number): number {
  return Math.max(0, Math.floor(currentStart) - EARLIER_MESSAGE_BATCH_SIZE);
}

/**
 * Initial window start when read messages begin collapsed ("Collapse Read
 * Threads"): everything before the first unread message stays behind the
 * "show earlier" reveal, and the latest message is always visible.
 */
export function initialCollapsedReadWindowStart(messages: readonly { isUnread: boolean }[]): number {
  const lastIndex = messages.length - 1;
  if (lastIndex <= 0) return 0;
  const firstUnreadIndex = messages.findIndex(message => message.isUnread);
  return firstUnreadIndex === -1 ? lastIndex : Math.min(firstUnreadIndex, lastIndex);
}
