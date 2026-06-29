import path from 'path';
import { Worker } from 'worker_threads';
import type { MailMessage, MailThread } from '../shared/types';

type WorkerPayload =
  | { type: 'saveMessages'; messages: MailMessage[]; notifyOfNew?: boolean }
  | { type: 'saveThreads'; threads: MailThread[] };

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { name: string; message: string; stack?: string } };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

const MESSAGE_BATCH_SIZE = 5;
const THREAD_BATCH_SIZE = 50;

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function createError(error: { name: string; message: string; stack?: string }): Error {
  const result = new Error(error.message);
  result.name = error.name;
  result.stack = error.stack;
  return result;
}

class DatabaseWorkerClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private shuttingDown = false;

  private getWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(path.join(__dirname, 'databaseWorker.js'));
    this.worker = worker;
    this.shuttingDown = false;

    worker.on('message', (response: WorkerResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;

      this.pending.delete(response.id);
      if (response.ok) {
        pending.resolve(response.result);
      } else {
        pending.reject(createError(response.error));
      }
    });

    worker.on('error', error => {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
      this.worker = null;
    });

    worker.on('exit', code => {
      this.worker = null;
      if (!this.shuttingDown && code !== 0) {
        this.rejectAll(new Error(`Database worker exited with code ${code}`));
      }
    });

    return worker;
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private request<T>(payload: WorkerPayload): Promise<T> {
    const id = this.nextRequestId++;
    const worker = this.getWorker();

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject
      });
      worker.postMessage({ id, ...payload });
    });
  }

  async saveMessages(messages: MailMessage[], options?: { notifyOfNew?: boolean }): Promise<{ newMessages: MailMessage[] }> {
    const newMessages: MailMessage[] = [];
    const batches = chunk(messages, MESSAGE_BATCH_SIZE);

    for (let index = 0; index < batches.length; index += 1) {
      const result = await this.request<{ newMessages: MailMessage[] }>({
        type: 'saveMessages',
        messages: batches[index],
        notifyOfNew: options?.notifyOfNew
      });
      newMessages.push(...result.newMessages);

      if (index < batches.length - 1) {
        await yieldToEventLoop();
      }
    }

    return { newMessages };
  }

  async saveThreads(threads: MailThread[]): Promise<void> {
    const batches = chunk(threads, THREAD_BATCH_SIZE);

    for (let index = 0; index < batches.length; index += 1) {
      await this.request<null>({
        type: 'saveThreads',
        threads: batches[index]
      });

      if (index < batches.length - 1) {
        await yieldToEventLoop();
      }
    }
  }

  shutdown() {
    this.shuttingDown = true;
    this.rejectAll(new Error('Database worker is shutting down'));
    const worker = this.worker;
    this.worker = null;
    void worker?.terminate();
  }
}

export const databaseWorkerClient = new DatabaseWorkerClient();
