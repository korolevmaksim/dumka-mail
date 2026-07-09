import { describe, expect, it, vi } from 'vitest';
import { sendReplyPipelineUpdateSafely } from '../main/replyPipelineNotifications';

function windowDouble(options: { windowDestroyed?: boolean; contentsDestroyed?: boolean; send?: () => void } = {}) {
  return {
    isDestroyed: () => options.windowDestroyed === true,
    webContents: {
      isDestroyed: () => options.contentsDestroyed === true,
      send: vi.fn(options.send),
    },
  };
}

describe('sendReplyPipelineUpdateSafely', () => {
  it('sends the scoped lifecycle update to a live renderer', () => {
    const window = windowDouble();
    sendReplyPipelineUpdateSafely(window, 'me@example.com', 'thread-1');
    expect(window.webContents.send).toHaveBeenCalledWith('api:replyPipelineUpdated', {
      accountId: 'me@example.com',
      threadId: 'thread-1',
    });
  });

  it('never throws after a confirmed send when the renderer is gone or send fails', () => {
    const logger = { error: vi.fn() };
    expect(() => sendReplyPipelineUpdateSafely(windowDouble({ windowDestroyed: true }), 'me@example.com', 'thread-1', logger)).not.toThrow();
    const error = new Error('webContents destroyed during send');
    expect(() => sendReplyPipelineUpdateSafely(windowDouble({ send: () => { throw error; } }), 'me@example.com', 'thread-1', logger)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith('[Reply Pipeline] Failed to notify renderer:', error);
  });
});
