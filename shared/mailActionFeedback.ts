import { isReversibleMailActionKind } from './mailActions';
import {
  ACTION_KIND_META,
  type ActionKind,
  type ActionStatus,
  type MailActionExecutionResult,
  type MailActionLog,
} from './types';

export type MailActionFeedbackTone = 'success' | 'error' | 'info' | 'warning';
export type MailActionFeedbackAction = 'undo' | 'retry' | null;

export interface MailActionFeedback {
  silent: boolean;
  tone: MailActionFeedbackTone;
  message: string;
  action: MailActionFeedbackAction;
}

export interface ResolveMailActionFeedbackInput {
  result: MailActionExecutionResult;
  kind: ActionKind;
  auto?: boolean;
  silent?: boolean;
  undo?: boolean;
  count?: number;
  succeeded?: number;
  failed?: number;
}

export interface MailActionPayloadFields {
  auto: boolean;
  silent: boolean;
  undo: boolean;
  batchId: string | null;
  accountId: string | null;
  labelId: string | null;
}

export function parseMailActionPayload(payloadJson?: string | null): Record<string, unknown> {
  if (!payloadJson) return {};
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function mailActionPayloadFields(payloadJson?: string | null): MailActionPayloadFields {
  const payload = parseMailActionPayload(payloadJson);
  return {
    auto: payload.auto === true,
    silent: payload.silent === true,
    undo: payload.undo === true,
    batchId: typeof payload.batchId === 'string' && payload.batchId ? payload.batchId : null,
    accountId: typeof payload.accountId === 'string' && payload.accountId ? payload.accountId : null,
    labelId: typeof payload.labelId === 'string' && payload.labelId ? payload.labelId : null,
  };
}

export function isAutoMailActionPayload(payloadJson?: string | null): boolean {
  return mailActionPayloadFields(payloadJson).auto;
}

export function mailActionBatchId(payloadJson?: string | null): string | null {
  return mailActionPayloadFields(payloadJson).batchId;
}

export function buildUndoMailActionPayload(
  payloadJson?: string | null,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const rest = { ...parseMailActionPayload(payloadJson) };
  delete rest.batchId;
  return {
    ...rest,
    auto: false,
    undo: true,
    ...extra,
  };
}

export function isUndoableMailActionStatus(status: ActionStatus): boolean {
  return status === 'completed' || status === 'pending_sync' || status === 'queued';
}

export function isUndoableMailActionLog(log: Pick<MailActionLog, 'kind' | 'status' | 'payloadJson'>): boolean {
  return isUndoableMailActionStatus(log.status)
    && isReversibleMailActionKind(log.kind)
    && !isAutoMailActionPayload(log.payloadJson);
}

export function aggregateMailActionResults(results: MailActionExecutionResult[]): MailActionExecutionResult & {
  succeeded: number;
  failed: number;
} {
  const succeeded = results.filter(result => result.accepted).length;
  const failed = results.length - succeeded;
  return {
    accepted: failed === 0 && results.length > 0,
    offline: results.some(result => result.accepted && result.offline),
    errorMessage: results.find(result => !result.accepted)?.errorMessage,
    actionId: results.find(result => result.actionId)?.actionId,
    succeeded,
    failed,
  };
}

function kindTitle(kind: ActionKind): string {
  return ACTION_KIND_META[kind].title;
}

function successMessage(kind: ActionKind): string {
  switch (kind) {
    case 'send':
    case 'sendDraft':
      return 'Message sent.';
    default:
      return `${kindTitle(kind)}.`;
  }
}

function queuedMessage(kind: ActionKind): string {
  switch (kind) {
    case 'send':
    case 'sendDraft':
      return 'Message queued — will send when Gmail is reachable.';
    default:
      return `${kindTitle(kind)}. Queued — will sync when Gmail is reachable.`;
  }
}

function errorMessage(kind: ActionKind, result: MailActionExecutionResult): string {
  if (result.errorMessage?.trim()) return result.errorMessage;
  return `Could not complete: ${kindTitle(kind).toLowerCase()}.`;
}

function batchSuccessMessage(kind: ActionKind, count: number): string {
  return `${kindTitle(kind)} · ${count} conversation${count === 1 ? '' : 's'}.`;
}

export function resolveMailActionFeedback(input: ResolveMailActionFeedbackInput): MailActionFeedback {
  const { result, kind, auto, silent, undo, count, succeeded, failed } = input;

  if (auto || silent) {
    return { silent: true, tone: 'info', message: '', action: null };
  }

  if (typeof count === 'number' && count > 1 && typeof succeeded === 'number' && typeof failed === 'number') {
    if (failed === 0 && result.accepted) {
      return {
        silent: false,
        tone: result.offline ? 'info' : 'success',
        message: result.offline
          ? `Queued ${succeeded} actions — will sync when Gmail is reachable.`
          : batchSuccessMessage(kind, succeeded),
        action: !undo && isReversibleMailActionKind(kind) ? 'undo' : null,
      };
    }
    if (succeeded === 0) {
      return {
        silent: false,
        tone: 'error',
        message: result.errorMessage || `Could not complete ${count} actions.`,
        action: 'retry',
      };
    }
    return {
      silent: false,
      tone: 'warning',
      message: `${kindTitle(kind)} ${succeeded} of ${count}, ${failed} failed.`,
      action: 'retry',
    };
  }

  if (!result.accepted) {
    return {
      silent: false,
      tone: 'error',
      message: errorMessage(kind, result),
      action: 'retry',
    };
  }

  if (result.offline) {
    return {
      silent: false,
      tone: 'info',
      message: queuedMessage(kind),
      action: !undo && isReversibleMailActionKind(kind) ? 'undo' : null,
    };
  }

  return {
    silent: false,
    tone: 'success',
    message: successMessage(kind),
    action: !undo && isReversibleMailActionKind(kind) ? 'undo' : null,
  };
}
