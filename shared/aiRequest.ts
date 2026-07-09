export const AI_CHAT_REQUEST_TIMEOUT_MS = 90_000;

export class AIRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The AI request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = 'AIRequestTimeoutError';
  }
}

export async function withAIRequestTimeout<T>(
  request: Promise<T>,
  timeoutMs = AI_CHAT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new AIRequestTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }
}
