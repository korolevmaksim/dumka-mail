import { redactSecrets } from './aiContext';

const MAX_VISIBLE_ERROR_LENGTH = 500;

/** Longest provider response text kept in an error (and so in the system log). */
export const MAX_PROVIDER_ERROR_TEXT = 300;

/**
 * A provider's error response body, bounded and redacted, for an error
 * message. Error bodies can echo parts of the request (prompt, mail text);
 * only the first few hundred characters are kept, on one line.
 */
export function truncateProviderText(text: string, maxLength = MAX_PROVIDER_ERROR_TEXT): string {
  const singleLine = redactSecrets(String(text ?? '')).replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, Math.max(0, maxLength - 1))}…` : singleLine;
}

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

/** The only model-failure text shown in the UI (SPEC §5); details go to the log. */
export const AI_UNREACHABLE_MESSAGE = "Couldn't reach the model";

/** One-line prompt shown instead of AI actions when no model is configured. */
export const AI_NO_PROVIDER_PROMPT = 'Add a model to get summaries and drafts';

export interface AIProviderDescriptorLike {
  preference: string;
  status: string;
}

/**
 * True when no usable model is configured: AI disabled, the automatic chain
 * found no key, or the selected provider is missing its key / base URL or has
 * no model chosen (`Missing model`: there is no built-in model to fall back to).
 * Unknown (descriptor not loaded yet) counts as available so buttons do not flicker.
 */
export function isAIProviderUnavailable(descriptor: AIProviderDescriptorLike | null | undefined): boolean {
  if (!descriptor) return false;
  if (descriptor.preference === 'disabled') return true;
  return /^missing\b/i.test(descriptor.status.trim()) || /no ai keys/i.test(descriptor.status);
}

/** True when the provider has a key but no model was chosen for it yet. */
export function isAIModelMissing(descriptor: AIProviderDescriptorLike | null | undefined): boolean {
  return Boolean(descriptor) && /^missing model\b/i.test(descriptor!.status.trim());
}
