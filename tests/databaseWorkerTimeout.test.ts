import { describe, expect, it } from 'vitest';
import {
  DATABASE_WORKER_REQUEST_TIMEOUT_MS,
  databaseWorkerTimeoutMessage,
} from '../shared/databaseWorkerTimeout';

describe('databaseWorkerTimeout', () => {
  it('names the timed-out worker request', () => {
    expect(databaseWorkerTimeoutMessage('saveMessages')).toBe(
      `Database worker request timed out after ${DATABASE_WORKER_REQUEST_TIMEOUT_MS}ms (saveMessages).`,
    );
  });
});
