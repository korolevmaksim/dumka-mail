import { parentPort } from 'worker_threads';
import { initializeDatabase, MailEmbeddingsRepo } from './database';
import { runSemanticScan, type SemanticScanOutcome } from './semanticSearchScan';

type WorkerRequest =
  | { id: number; type: 'semanticSearch'; accountId: string; model: string; queryVector: number[]; limit: number; requestId: number; scope: string }
  | { id: number; type: 'migrateVectors' };

type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { name: string; message: string; stack?: string } };

const VECTOR_MIGRATION_BATCH_SIZE = 200;
const VECTOR_MIGRATION_BUSY_PAUSE_MS = 250;

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

function send(response: WorkerResponse) {
  parentPort?.postMessage(response);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const latestRequestIds = new Map<string, number>();
let activeSearchCount = 0;

// Supersession is namespaced per caller scope and account so that independent
// callers (interactive search vs daily briefing) never abort each other.
function supersedeKey(request: Extract<WorkerRequest, { type: 'semanticSearch' }>): string {
  return `${request.scope}:${request.accountId}`;
}

async function handleSemanticSearch(
  request: Extract<WorkerRequest, { type: 'semanticSearch' }>
): Promise<SemanticScanOutcome & { totalIndexed: number }> {
  const staleKey = supersedeKey(request);
  activeSearchCount += 1;
  try {
    const totalIndexed = MailEmbeddingsRepo.countForAccount(request.accountId, request.model);
    const outcome = await runSemanticScan({
      queryVector: Float32Array.from(request.queryVector),
      limit: request.limit,
      fetchPage: (limit, offset) => MailEmbeddingsRepo.scanForAccountPage(request.accountId, request.model, limit, offset),
      isStale: () => latestRequestIds.get(staleKey) !== request.requestId,
      yieldBetweenPages: yieldToEventLoop,
    });
    return { ...outcome, totalIndexed };
  } finally {
    activeSearchCount -= 1;
  }
}

async function migrateVectorFormats(): Promise<number> {
  let migrated = 0;
  for (;;) {
    if (activeSearchCount > 0) {
      await pause(VECTOR_MIGRATION_BUSY_PAUSE_MS);
      continue;
    }
    const processed = MailEmbeddingsRepo.migrateVectorJsonBatch(VECTOR_MIGRATION_BATCH_SIZE);
    if (processed === 0) return migrated;
    migrated += processed;
    await yieldToEventLoop();
  }
}

initializeDatabase();

parentPort?.on('message', (request: WorkerRequest) => {
  if (request.type === 'semanticSearch') {
    // Mark this request as the latest for its scope and account immediately so
    // scans that are already running (and yield between pages) can abort early.
    const key = supersedeKey(request);
    const latest = latestRequestIds.get(key) || 0;
    if (request.requestId > latest) {
      latestRequestIds.set(key, request.requestId);
    }
    void handleSemanticSearch(request)
      .then(result => send({ id: request.id, ok: true, result }))
      .catch(error => send({ id: request.id, ok: false, error: serializeError(error) }));
    return;
  }

  void migrateVectorFormats()
    .then(migrated => send({ id: request.id, ok: true, result: { migrated } }))
    .catch(error => send({ id: request.id, ok: false, error: serializeError(error) }));
});
