import {
  buildUndoMailActionPayload,
  resolveMailActionFeedback,
  type ResolveMailActionFeedbackInput,
} from '../../../shared/mailActionFeedback';
import type { MailActionExecutionResult } from '../../../shared/types';
import { emitToast } from './toastBus';

export function presentMailActionFeedback(
  input: ResolveMailActionFeedbackInput,
  handlers: { onUndo?: () => void; onRetry?: () => void } = {},
): MailActionExecutionResult {
  const feedback = resolveMailActionFeedback(input);
  if (feedback.silent) return input.result;

  emitToast({
    type: feedback.tone,
    message: feedback.message,
    ...(feedback.action === 'undo' ? { duration: 8000 } : {}),
    actionLabel: feedback.action === 'undo' ? 'Undo' : feedback.action === 'retry' ? 'Retry' : undefined,
    onAction: feedback.action === 'undo'
      ? handlers.onUndo
      : feedback.action === 'retry'
        ? handlers.onRetry
        : undefined,
  });
  return input.result;
}

export function undoPayloadJson(payloadJson?: string | null, extra: Record<string, unknown> = {}): string {
  return JSON.stringify(buildUndoMailActionPayload(payloadJson, extra));
}
