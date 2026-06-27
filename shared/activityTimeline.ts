// Activity timeline dedup logic, ported from the Swift original
// `UI/Root/MailActivityTimeline.swift` (`makeItems(from:limit:)`) and the row
// presentation derivation in `UI/Root/MailActionLogRow.swift`.
//
// Pure module: lives in `shared/` and is imported by both the Electron main
// process and the React renderer. No Electron / Node / React / DOM imports.

import type { MailActionLog } from './types';
import { ACTION_KIND_META } from './types';

/** A presentation-ready, de-duplicated row for the activity ledger. */
export interface ActivityItem {
  id: string;
  kind: MailActionLog['kind'];
  status: MailActionLog['status'];
  /** Human title via ACTION_KIND_META (e.g. "Sent message"). */
  title: string;
  /** lucide-react icon name via ACTION_KIND_META (renderer maps it to a component). */
  iconName: string;
  createdAt: string;
  completedAt?: string | null;
  /** `completedAt - createdAt`, clamped to >= 0; null when not yet completed/parseable. */
  durationMs?: number | null;
  /** Number of collapsed consecutive same-target failures (>=1). */
  repeatCount: number;
  threadId?: string | null;
  failureMessage?: string | null;
}

const DEFAULT_MAX = 8;

/**
 * Collapse markRead/autoMarkRead into one family and send/sendDraft into one
 * family so that a later success hides an earlier failure of the "same thing".
 * Mirrors `MailActionResolutionFamily` in the Swift source (which folds
 * markRead+autoMarkRead); send+sendDraft are folded here because they are the
 * Electron port's two aliases for the single Swift `sendDraft` kind.
 */
function resolutionFamily(kind: MailActionLog['kind']): string {
  switch (kind) {
    case 'markRead':
    case 'autoMarkRead':
      return 'markRead';
    case 'send':
    case 'sendDraft':
      return 'sendDraft';
    default:
      return kind;
  }
}

/** {accountID, threadID, draftID, family} — what a completed entry "resolves". */
function resolutionKey(log: MailActionLog): string {
  return JSON.stringify([
    log.accountId,
    log.threadId ?? null,
    log.draftId ?? null,
    resolutionFamily(log.kind),
  ]);
}

/** {accountID, draftID, kind} — how surviving failures are grouped/counted. */
function failureGroupKey(log: MailActionLog): string {
  return JSON.stringify([log.accountId, log.draftId ?? null, log.kind]);
}

function computeDurationMs(log: MailActionLog): number | null {
  if (!log.completedAt) return null;
  const created = Date.parse(log.createdAt);
  const completed = Date.parse(log.completedAt);
  if (Number.isNaN(created) || Number.isNaN(completed)) return null;
  return Math.max(0, completed - created);
}

function toActivityItem(log: MailActionLog, repeatCount: number): ActivityItem {
  const meta = ACTION_KIND_META[log.kind];
  return {
    id: log.id,
    kind: log.kind,
    status: log.status,
    title: meta?.title ?? log.kind,
    iconName: meta?.icon ?? 'Circle',
    createdAt: log.createdAt,
    completedAt: log.completedAt ?? null,
    durationMs: computeDurationMs(log),
    repeatCount,
    threadId: log.threadId ?? null,
    failureMessage: log.failureMessage ?? null,
  };
}

/**
 * Build the de-duplicated activity timeline from action-log entries.
 *
 * `logs` MUST already be newest-first (the repository returns `created_at DESC`).
 * Rules ported verbatim from `MailActivityTimeline.makeItems`:
 *  - a `completed` entry marks its resolution key as resolved;
 *  - a `failed` entry whose resolution key is already resolved is dropped
 *    (a later success hides earlier failures of the same family/target);
 *  - surviving `failed` entries are grouped by {account, draft, kind} and
 *    duplicates increment `repeatCount` instead of adding a row;
 *  - the result is truncated to `max` (default 8).
 */
export function makeActivityItems(logs: MailActionLog[], max: number = DEFAULT_MAX): ActivityItem[] {
  if (max <= 0) return [];

  const items: { log: MailActionLog; repeatCount: number }[] = [];
  const resolvedKeys = new Set<string>();
  const failureIndexes = new Map<string, number>();

  for (const log of logs) {
    const rKey = resolutionKey(log);

    if (log.status === 'completed') {
      resolvedKeys.add(rKey);
    } else if (log.status === 'failed' && resolvedKeys.has(rKey)) {
      continue;
    }

    if (log.status === 'failed') {
      const fKey = failureGroupKey(log);
      const existingIndex = failureIndexes.get(fKey);
      if (existingIndex !== undefined) {
        items[existingIndex].repeatCount += 1;
        continue;
      }
      failureIndexes.set(fKey, items.length);
    }

    items.push({ log, repeatCount: 1 });
  }

  return items.slice(0, max).map((item) => toActivityItem(item.log, item.repeatCount));
}
