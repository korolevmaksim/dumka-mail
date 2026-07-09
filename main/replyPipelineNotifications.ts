interface ReplyPipelineWebContents {
  isDestroyed(): boolean;
  send(channel: string, payload: { accountId: string; threadId: string }): void;
}

interface ReplyPipelineWindow {
  isDestroyed(): boolean;
  webContents: ReplyPipelineWebContents;
}

export function sendReplyPipelineUpdateSafely(
  window: ReplyPipelineWindow | null,
  accountId: string,
  threadId: string,
  logger: Pick<Console, 'error'> = console,
): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  try {
    window.webContents.send('api:replyPipelineUpdated', { accountId, threadId });
  } catch (error) {
    logger.error('[Reply Pipeline] Failed to notify renderer:', error);
  }
}
