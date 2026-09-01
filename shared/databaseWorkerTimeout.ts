export const DATABASE_WORKER_REQUEST_TIMEOUT_MS = 60_000;

export function databaseWorkerTimeoutMessage(
  type: string,
  timeoutMs = DATABASE_WORKER_REQUEST_TIMEOUT_MS,
): string {
  return `Database worker request timed out after ${timeoutMs}ms (${type}).`;
}
