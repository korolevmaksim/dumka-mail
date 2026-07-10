import { parentPort } from 'worker_threads';
import { getDatabase, initializeDatabase, MessagesRepo, ThreadsRepo } from './database';
import type { MailMessage, MailThread } from '../shared/types';

type WorkerRequest =
  | { id: number; type: 'saveMessages'; messages: MailMessage[]; notifyOfNew?: boolean; indexBodies?: boolean }
  | { id: number; type: 'saveThreads'; threads: MailThread[] }
  | { id: number; type: 'listThreads'; accountIds: string[] }
  | { id: number; type: 'listMessagesForThread'; accountId: string; threadId: string }
  | { id: number; type: 'listMessageMetadataForThread'; accountId: string; threadId: string }
  | { id: number; type: 'recentSenderMessages'; accountId: string; senderEmail: string; limit: number }
  | { id: number; type: 'senderCleanupStats'; accountId: string };

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { name: string; message: string; stack?: string } };

function serializeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: 'Error',
    message: String(error)
  };
}

function findNewMessages(messages: MailMessage[]): MailMessage[] {
  if (messages.length === 0) return [];

  const db = getDatabase();
  const checkExists = db.prepare('SELECT 1 FROM messages WHERE account_id = ? AND id = ?');
  return messages.filter(message => !checkExists.get(message.accountId, message.id));
}

function send(response: WorkerResponse) {
  parentPort?.postMessage(response);
}

initializeDatabase();

parentPort?.on('message', (request: WorkerRequest) => {
  try {
    if (request.type === 'saveMessages') {
      const newMessages = request.notifyOfNew ? findNewMessages(request.messages) : [];
      MessagesRepo.save(request.messages, { indexBodies: request.indexBodies });
      send({ id: request.id, ok: true, result: { newMessages } });
      return;
    }

    if (request.type === 'senderCleanupStats') {
      send({ id: request.id, ok: true, result: MessagesRepo.senderCleanupStats(request.accountId) });
      return;
    }

    if (request.type === 'listThreads') {
      send({ id: request.id, ok: true, result: ThreadsRepo.listMany(request.accountIds) });
      return;
    }

    if (request.type === 'listMessagesForThread') {
      send({
        id: request.id,
        ok: true,
        result: MessagesRepo.listForThread(request.accountId, request.threadId),
      });
      return;
    }

    if (request.type === 'recentSenderMessages') {
      send({
        id: request.id,
        ok: true,
        result: MessagesRepo.listLatestBySender(request.accountId, request.senderEmail, request.limit),
      });
      return;
    }

    if (request.type === 'listMessageMetadataForThread') {
      send({
        id: request.id,
        ok: true,
        result: MessagesRepo.listMetadataForThreads(request.accountId, [request.threadId]).get(request.threadId) || [],
      });
      return;
    }

    ThreadsRepo.save(request.threads);
    send({ id: request.id, ok: true, result: null });
  } catch (error) {
    send({ id: request.id, ok: false, error: serializeError(error) });
  }
});
