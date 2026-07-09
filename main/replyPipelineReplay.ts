import type { MailMessage, ReplyPipelineState } from '../shared/types';

export interface ReplyPipelineReplayEvent {
  message: MailMessage;
  canonicalPendingSend: boolean;
}

function messageTime(message: MailMessage): number {
  const parsed = Date.parse(message.receivedAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function replayKey(message: MailMessage): string {
  return `${message.accountId.toLowerCase()}\u0000${message.threadId}`;
}

export function planReplyPipelineMessageReplay(
  messages: MailMessage[],
  getState: (accountId: string, threadId: string) => ReplyPipelineState | null,
  isOutbound: (message: MailMessage) => boolean,
): ReplyPipelineReplayEvent[] {
  const outboundByThread = new Map<string, MailMessage[]>();
  for (const message of messages) {
    if (!isOutbound(message)) continue;
    const key = replayKey(message);
    outboundByThread.set(key, [...(outboundByThread.get(key) || []), message]);
  }

  const canonicalIds = new Map<string, string>();
  for (const [key, outbound] of outboundByThread) {
    const first = outbound[0];
    const current = getState(first.accountId, first.threadId);
    if (!current?.sourceMessageId.startsWith('pending-send:')) continue;
    const anchor = Date.parse(current.sourceReceivedAt);
    const match = outbound
      .filter(message => Number.isFinite(messageTime(message)) && Math.abs(messageTime(message) - anchor) <= 5 * 60_000)
      .sort((a, b) => {
        const delta = Math.abs(messageTime(a) - anchor) - Math.abs(messageTime(b) - anchor);
        return delta || messageTime(b) - messageTime(a);
      })[0];
    if (match) canonicalIds.set(key, match.id);
  }

  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => messageTime(a.message) - messageTime(b.message) || a.index - b.index)
    .map(({ message }) => ({
      message,
      canonicalPendingSend: canonicalIds.get(replayKey(message)) === message.id,
    }));
}
