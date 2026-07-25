import { parentPort } from 'worker_threads';
import { getDatabase, initializeDatabase, MessagesRepo, ThreadsRepo } from './database';
import {
  collectBriefingThreadBatch,
  collectPendingEmbeddingCandidates,
  saveEmbeddingVectors,
  selectBriefingThreads,
  threadSecurityInsights,
} from './mailAnalysisJobs';
import type { DatabaseWorkerRequest, DatabaseWorkerResponse } from './databaseWorkerProtocol';
import type { MailMessage } from '../shared/types';

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

function send(response: DatabaseWorkerResponse) {
  parentPort?.postMessage(response);
}

initializeDatabase();

parentPort?.on('message', (request: DatabaseWorkerRequest) => {
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

    if (request.type === 'threadSecurityInsights') {
      send({
        id: request.id,
        ok: true,
        result: threadSecurityInsights(
          request.accountId,
          request.threadId,
          request.mode,
          request.knownMessageCount,
        ),
      });
      return;
    }

    if (request.type === 'embeddingCandidates') {
      send({
        id: request.id,
        ok: true,
        result: collectPendingEmbeddingCandidates(request.accountId, request.model, request.source),
      });
      return;
    }

    if (request.type === 'saveEmbeddingVectors') {
      saveEmbeddingVectors(request.rows);
      send({ id: request.id, ok: true, result: null });
      return;
    }

    if (request.type === 'selectBriefingThreads') {
      send({
        id: request.id,
        ok: true,
        result: selectBriefingThreads(request.accountId, request.selection),
      });
      return;
    }

    if (request.type === 'briefingThreadBatch') {
      send({
        id: request.id,
        ok: true,
        result: collectBriefingThreadBatch(request.accountId, request.threadIds),
      });
      return;
    }

    if (request.type === 'saveThreads') {
      ThreadsRepo.save(request.threads);
      send({ id: request.id, ok: true, result: null });
      return;
    }

    // Reachable only if the worker bundle is older than the client that spawned
    // it; a named error beats a TypeError on an undefined field.
    throw new Error(`Unknown database worker request type: ${(request as { type: string }).type}`);
  } catch (error) {
    send({ id: request.id, ok: false, error: serializeError(error) });
  }
});
