// Pure, dependency-free label helpers ported from the Swift original.
//
// Sources:
//   - Models/MailLabel.swift   (displayName, threadRowLabelIDs, visibleLabelIDs)
//   - UI/Inbox/ThreadRow.swift  (LabelPill.color, primary row label rendering)
//
// This file runs in BOTH the Electron main process and the React renderer, so it
// must stay free of electron/node/react/DOM imports. Only standard JS/TS and
// relative `shared/` imports are allowed.

import type { MailThread } from './types';

/** Default pill color, mirrors `Palette.accent` (`--accent` in renderer/src/index.css). */
const ACCENT_HEX = '#668FEA';

/**
 * Labels that are pure system noise and never worth showing as a row pill.
 *
 * Swift `MailLabel.hiddenRowLabels` hides INBOX + UNREAD; the Electron port also
 * drops SENT (it carries no triage signal in the inbox list).
 */
const HIDDEN_ROW_LABELS: ReadonlySet<string> = new Set(['INBOX', 'UNREAD', 'SENT']);

/**
 * Human-readable name for a Gmail label id.
 * Direct port of `MailLabel.displayName(for:)`.
 */
export function labelDisplayName(labelId: string): string {
  switch (labelId.toUpperCase()) {
    case 'CATEGORY_PROMOTIONS':
      return 'marketing';
    case 'CATEGORY_UPDATES':
      return 'updates';
    case 'CATEGORY_SOCIAL':
      return 'social';
    case 'CATEGORY_FORUMS':
      return 'forums';
    case 'CATEGORY_PRIMARY':
      return 'primary';
    case 'IMPORTANT':
      return 'important';
    case 'SENT':
      return 'sent';
    case 'UNREAD':
      return 'unread';
    default: {
      if (labelId.toUpperCase().startsWith('CATEGORY_')) {
        return labelId
          .slice('CATEGORY_'.length)
          .replace(/_/g, ' ')
          .toLowerCase();
      }
      return labelId.replace(/_/g, ' ').toLowerCase();
    }
  }
}

/**
 * Stable pill background color (hex) for a label id.
 * Direct port of `LabelPill.color` — matches by case-insensitive substring.
 */
export function pillColorHex(labelId: string): string {
  const id = labelId.toUpperCase();
  if (id.includes('PROMOTION')) return '#DB8059'; // rgb(0.86, 0.50, 0.35)
  if (id.includes('UPDATE')) return '#BD8C2E'; // rgb(0.74, 0.55, 0.18)
  if (id.includes('IMPORTANT')) return '#AD63CC'; // rgb(0.68, 0.39, 0.80)
  return ACCENT_HEX;
}

/**
 * Display priority for a normalized (uppercased) label id. Lower sorts first.
 * Colored / triage-meaningful labels rank above plain categories; CATEGORY_PRIMARY
 * (the "no real category" bucket) ranks last.
 */
function labelPriority(normalized: string): number {
  if (normalized === 'CATEGORY_PRIMARY') return 100;
  if (normalized.includes('IMPORTANT')) return 0;
  if (normalized.includes('PROMOTION')) return 1;
  if (normalized.includes('UPDATE')) return 2;
  if (normalized.includes('SOCIAL')) return 3;
  if (normalized.includes('FORUM')) return 4;
  if (normalized.startsWith('CATEGORY_')) return 5;
  return 6; // custom / user-defined labels
}

/**
 * Display-worthy labels for a thread row: drops system noise (INBOX/UNREAD/SENT),
 * dedupes case-insensitively (first occurrence wins, original casing preserved),
 * and orders by display priority. Ports `MailLabel.visibleLabelIDs`, adding a
 * deterministic priority sort so the most meaningful label leads.
 */
export function threadRowLabelIds(labelIds: string[]): string[] {
  const seen = new Set<string>();
  const visible: string[] = [];

  for (const id of labelIds) {
    const normalized = id.toUpperCase();
    if (HIDDEN_ROW_LABELS.has(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    visible.push(id);
  }

  // Stable sort by priority (Array.prototype.sort is stable on Node >= 11),
  // preserving original order for equal-priority labels.
  return visible
    .map((id, index) => ({ id, index, priority: labelPriority(id.toUpperCase()) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((entry) => entry.id);
}

export interface RowLabel {
  id: string;
  name: string;
  color: string;
}

/**
 * Single best label to render in a thread row (or null when none qualify).
 * Mirrors Swift `MailLabel.threadRowLabelIDs(...).prefix(1)` feeding `LabelPill`.
 */
export function primaryRowLabel(thread: MailThread): RowLabel | null {
  const [id] = threadRowLabelIds(thread.labelIds);
  if (id === undefined) return null;
  return {
    id,
    name: labelDisplayName(id),
    color: pillColorHex(id),
  };
}
