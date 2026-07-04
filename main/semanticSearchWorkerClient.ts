import path from 'path';
import { Worker } from 'worker_threads';
import type { SemanticSearchResult } from '../shared/types';

type WorkerPayload =
  | { type: 'semanticSearch'; accountId: string; model: string; queryVector: number[]; limit: number; requestId: number; scope: string }
  | { type: 'migrateVectors' };

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { name: string; message: string; stack?: string } };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export interface SemanticSearchScanOutcome {
  results: SemanticSearchResult[];
  aborted: boolean;
}

function createError(error: { name: string; message: string; stack?: string }): Error {
  const result = new Error(error.message);
  result.name = error.name;
  result.stack = error.stack;
  return result;
}

class SemanticSearchWorkerClient {
  private worker: Worker | null = null;
  private nextMessageId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private shuttingDown = false;

  private getWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(path.join(__dirname, 'semanticSearchWorker.js'));
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
        this.rejectAll(new Error(`Semantic search worker exited with code ${code}`));
      }
    });

    this.startVectorMigration();

    return worker;
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private request<T>(payload: WorkerPayload): Promise<T> {
    const id = this.nextMessageId++;
    const worker = this.getWorker();

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject
      });
      worker.postMessage({ id, ...payload });
    });
  }

  // Converts legacy vector_json rows to vector_blob in the background. The worker
  // pauses the migration whenever a search request is in flight, so kicking it off
  // on spawn never delays interactive searches.
  private startVectorMigration() {
    void this.request<{ migrated: number }>({ type: 'migrateVectors' }).catch(error => {
      console.warn('[SemanticSearch] Vector format migration failed:', error);
    });
  }

  // `scope` namespaces supersession: only a newer request with the same
  // account and scope aborts an in-flight scan.
  search(accountId: string, model: string, queryVector: number[], limit: number, requestId: number, scope: string): Promise<SemanticSearchScanOutcome> {
    return this.request<SemanticSearchScanOutcome>({
      type: 'semanticSearch',
      accountId,
      model,
      queryVector,
      limit,
      requestId,
      scope
    });
  }

  shutdown() {
    this.shuttingDown = true;
    this.rejectAll(new Error('Semantic search worker is shutting down'));
    const worker = this.worker;
    this.worker = null;
    void worker?.terminate();
  }
}

export const semanticSearchWorkerClient = new SemanticSearchWorkerClient();
