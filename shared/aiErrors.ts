import { redactSecrets } from './aiContext';

const MAX_VISIBLE_ERROR_LENGTH = 500;

function coerceErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function formatAIUserError(error: unknown): string {
  const raw = coerceErrorMessage(error);
  const singleLine = redactSecrets(raw).replace(/\s+/g, ' ').trim();
  const detail = singleLine.length > MAX_VISIBLE_ERROR_LENGTH
    ? `${singleLine.slice(0, MAX_VISIBLE_ERROR_LENGTH - 3)}...`
    : singleLine;
  return `AI request failed${detail ? `: ${detail}` : '.'}`;
}
