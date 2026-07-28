/**
 * .mbox export of locally cached mail.
 *
 * Reads are paged through the database worker (`databaseWorkerClient`) — one
 * thread at a time — so archive-sized exports never run on the Electron main
 * event loop. Output is streamed to disk with backpressure, progress is pushed
 * to the renderer between threads, and a cancellation token is checked before
 * every thread and message.
 *
 * Attachments are not part of the export: only their metadata is cached
 * locally (see shared/mboxExport.ts for the serialization rules).
 */
import { app, dialog, type BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { databaseWorkerClient } from './databaseWorkerClient';
import { SystemLogger } from './systemLogger';
import {
  exportMboxFileName,
  messageToMboxEntry,
  type MailboxExportProgress,
  type MailboxExportResult,
  type MailboxExportScope,
} from '../shared/mboxExport';
import type { MailLabel } from '../shared/types';

interface ExportToken {
  cancelled: boolean;
}

interface ActiveExport {
  accountId: string;
  token: ExportToken;
}

let activeExport: ActiveExport | null = null;

function scopeMatches(scope: MailboxExportScope, labelIds: MailLabel[]): boolean {
  if (scope === 'inbox') return labelIds.includes('INBOX');
  if (scope === 'sent') return labelIds.includes('SENT');
  return true;
}

function writeChunk(stream: fs.WriteStream, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    if (stream.write(chunk)) {
      resolve();
    } else {
      // Respect backpressure so a large export does not buffer unboundedly.
      stream.once('error', onError);
      stream.once('drain', () => {
        stream.off('error', onError);
        resolve();
      });
    }
  });
}

function closeStream(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(() => resolve());
  });
}

export function cancelMailboxExport(accountId: string): boolean {
  if (!activeExport || activeExport.accountId !== accountId.trim()) return false;
  activeExport.token.cancelled = true;
  return true;
}

export async function exportMailboxMbox(
  win: BrowserWindow | null,
  accountId: string,
  scope: MailboxExportScope,
  onProgress: (progress: MailboxExportProgress) => void,
): Promise<MailboxExportResult> {
  const trimmedAccount = (accountId || '').trim();
  if (!trimmedAccount) return { ok: false, message: 'No account selected.' };
  if (activeExport) return { ok: false, message: 'Another export is already running.' };
  if (!win) return { ok: false, message: 'No window is available for the save dialog.' };
  const safeScope: MailboxExportScope = scope === 'inbox' || scope === 'sent' ? scope : 'all';

  const { filePath } = await dialog.showSaveDialog(win, {
    title: 'Export Mailbox as .mbox',
    defaultPath: path.join(app.getPath('downloads'), exportMboxFileName(trimmedAccount, new Date())),
    filters: [{ name: 'Mbox Archive', extensions: ['mbox'] }],
  });
  if (!filePath) return { ok: false, cancelled: true };

  const token: ExportToken = { cancelled: false };
  activeExport = { accountId: trimmedAccount, token };

  let stream: fs.WriteStream | null = null;
  let processedThreads = 0;
  let processedMessages = 0;
  let totalThreads = 0;

  const emit = (state: MailboxExportProgress['state'], extra: Partial<MailboxExportProgress> = {}) => {
    try {
      onProgress({
        accountId: trimmedAccount,
        scope: safeScope,
        processedThreads,
        totalThreads,
        processedMessages,
        state,
        ...extra,
      });
    } catch {
      // Progress delivery is best effort; never fail the export over it.
    }
  };

  try {
    const threads = await databaseWorkerClient.listThreads([trimmedAccount]);
    const scopedThreads = threads.filter(thread => scopeMatches(safeScope, thread.labelIds || []));
    totalThreads = scopedThreads.length;
    emit('running');

    stream = fs.createWriteStream(filePath, { encoding: 'utf8' });

    for (const thread of scopedThreads) {
      if (token.cancelled) break;
      const messages = await databaseWorkerClient.listMessagesForThread(trimmedAccount, thread.id);
      for (const message of messages) {
        if (token.cancelled) break;
        await writeChunk(stream, messageToMboxEntry(message));
        processedMessages += 1;
      }
      processedThreads += 1;
      // Throttle progress events; the renderer re-renders on every one.
      if (processedThreads % 10 === 0 || processedThreads === totalThreads) {
        emit('running');
      }
    }

    await closeStream(stream);
    stream = null;

    if (token.cancelled) {
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        // Best effort removal of the partial export.
      }
      emit('cancelled');
      SystemLogger.info('Mailbox Export', 'Mailbox export was cancelled.', { messages: processedMessages });
      return { ok: false, cancelled: true };
    }

    emit('done', { filePath });
    SystemLogger.info('Mailbox Export', 'Mailbox export completed.', { messages: processedMessages, threads: totalThreads });
    return { ok: true, filePath, exportedMessages: processedMessages };
  } catch (error) {
    try {
      stream?.destroy();
    } catch {
      // Best effort.
    }
    try {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    } catch {
      // Best effort removal of the partial export.
    }
    const message = error instanceof Error ? error.message : String(error);
    emit('failed', { message });
    SystemLogger.error('Mailbox Export', 'Mailbox export failed.', error);
    return { ok: false, message };
  } finally {
    if (activeExport?.token === token) activeExport = null;
  }
}
