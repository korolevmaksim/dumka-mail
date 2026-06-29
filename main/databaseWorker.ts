import { parentPort } from 'worker_threads';
import { getDatabase, initializeDatabase, MessagesRepo, ThreadsRepo } from './database';
import type { MailMessage, MailThread } from '../shared/types';

type WorkerRequest =
  | { id: number; type: 'saveMessages'; messages: MailMessage[]; notifyOfNew?: boolean }
  | { id: number; type: 'saveThreads'; threads: MailThread[] };

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
      MessagesRepo.save(request.messages);
      send({ id: request.id, ok: true, result: { newMessages } });
      return;
    }

    ThreadsRepo.save(request.threads);
    send({ id: request.id, ok: true, result: null });
  } catch (error) {
    send({ id: request.id, ok: false, error: serializeError(error) });
  }
});
