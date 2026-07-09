export const INITIAL_EXPANDED_MESSAGES = 3;
export const EARLIER_MESSAGE_BATCH_SIZE = 10;

export function initialMessageWindowStart(messageCount: number): number {
  return Math.max(0, Math.floor(messageCount) - INITIAL_EXPANDED_MESSAGES);
}

export function revealEarlierMessageWindowStart(currentStart: number): number {
  return Math.max(0, Math.floor(currentStart) - EARLIER_MESSAGE_BATCH_SIZE);
}
