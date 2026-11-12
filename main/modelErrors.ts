// Model request errors, kept free of provider/config imports so pure main
// modules (agent prep core, tests) can classify failures without loading the
// AI configuration or Electron.

export type ModelErrorKind = 'config' | 'network' | 'timeout' | 'http' | 'empty' | 'invalid';

/** A failed model request. `message` may contain provider text: log it truncated only. */
export class ModelRequestError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    readonly provider: string,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ModelRequestError';
  }
}

export function isAbortError(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError';
}

export function abortError(): Error {
  const error = new Error('The request was cancelled.');
  error.name = 'AbortError';
  return error;
}

/** The model answered, but the answer was unusable: the model is reachable. */
export function isUnusableAnswerError(error: unknown): boolean {
  return error instanceof ModelRequestError && (error.kind === 'invalid' || error.kind === 'empty');
}

/** Provider, status code and a truncated message: the only fields that reach the system log. */
export function describeModelError(error: unknown, maxLength = 200): { provider: string | null; status: number | null; kind: string; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  const truncated = message.length > maxLength ? `${message.slice(0, maxLength - 1)}…` : message;
  if (error instanceof ModelRequestError) {
    return { provider: error.provider, status: error.status, kind: error.kind, error: truncated };
  }
  return { provider: null, status: null, kind: 'unknown', error: truncated };
}
