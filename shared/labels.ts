// Pure, dependency-free label helpers shared by the Electron main process and
// the React renderer. Keep this file free of Electron, Node, React, and DOM
// imports.

import type { MailLabelDefinition, MailThread } from './types';

/** Default pill color, mirrors `Palette.accent` (`--accent` in renderer/src/index.css). */
const ACCENT_HEX = '#668FEA';

/**
 * Labels that are pure system noise and never worth showing as a row pill.
 *
 * Swift `MailLabel.hiddenRowLabels` hides INBOX + UNREAD; the Electron port also
 * drops SENT because it carries no triage signal in the inbox list.
 */
const HIDDEN_ROW_LABELS: ReadonlySet<string> = new Set(['INBOX', 'UNREAD', 'SENT']);

export interface LabelTreeNode {
  segment: string;
  fullName: string;
  depth: number;
  label?: MailLabelDefinition;
  children: LabelTreeNode[];
}

function normalizeSegment(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

export function labelSegments(name: string): string[] {
  return name
    .split('/')
    .map(normalizeSegment)
    .filter(Boolean);
}

export function labelLeafName(name: string): string {
  const segments = labelSegments(name);
  return segments[segments.length - 1] || name.trim();
}

export function labelParentName(name: string): string {
  const segments = labelSegments(name);
  return segments.length > 1 ? segments.slice(0, -1).join('/') : '';
}

export function labelDefinitionsForAccount(
  labels: MailLabelDefinition[],
  accountId?: string | null,
): MailLabelDefinition[] {
  const normalizedAccountId = accountId?.trim().toLowerCase();
  if (!normalizedAccountId) return [];
  return labels.filter(label => label.accountId.trim().toLowerCase() === normalizedAccountId);
}

export function composeNestedLabelName(parentName: string, leafName: string): string {
  const leafSegments = labelSegments(leafName);
  if (leafSegments.length > 1) return leafSegments.join('/');
  const leaf = leafSegments[0] || '';
  const parent = labelSegments(parentName).join('/');
  return [parent, leaf].filter(Boolean).join('/');
}

export function isDescendantLabel(candidateName: string, parentName: string): boolean {
  const candidate = labelSegments(candidateName).join('/');
  const parent = labelSegments(parentName).join('/');
  return Boolean(parent) && candidate.startsWith(`${parent}/`);
}

/**
 * Human-readable name for a Gmail label id.
 * Custom nested Gmail labels use only their leaf segment in tight row pills.
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
      return labelLeafName(labelId).replace(/_/g, ' ').toLowerCase();
    }
  }
}

function normalizedLabelSearchValue(value: string): string {
  return value.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

function labelSearchCandidates(labelId: string, labels: MailLabelDefinition[], accountId?: string): string[] {
  const candidates = [
    labelId,
    labelDisplayName(labelId),
    labelLeafName(labelId),
  ];
  const categoryPrefix = 'CATEGORY_';
  if (labelId.toUpperCase().startsWith(categoryPrefix)) {
    candidates.push(labelId.slice(categoryPrefix.length));
  }

  const definition = labels.find(label =>
    label.id.toLowerCase() === labelId.toLowerCase()
    && (accountId === undefined || label.accountId === accountId)
  );
  if (definition) {
    candidates.push(
      definition.id,
      definition.name,
      labelDisplayName(definition.name),
      labelLeafName(definition.name),
    );
  }

  return candidates;
}

export function labelMatchesSearchQuery(
  labelId: string,
  query: string,
  labels: MailLabelDefinition[] = [],
  accountId?: string,
): boolean {
  const normalizedQuery = normalizedLabelSearchValue(query);
  if (!normalizedQuery) return false;

  return labelSearchCandidates(labelId, labels, accountId)
    .some(candidate => normalizedLabelSearchValue(candidate) === normalizedQuery);
}

export function threadMatchesLabelSearchQuery(
  thread: Pick<MailThread, 'accountId' | 'labelIds'>,
  query: string,
  labels: MailLabelDefinition[] = [],
): boolean {
  return thread.labelIds.some(labelId => labelMatchesSearchQuery(labelId, query, labels, thread.accountId));
}

/**
 * Stable pill background color (hex) for a label id. Matches by
 * case-insensitive substring to preserve the Swift original's behavior.
 */
export function pillColorHex(labelId: string): string {
  const id = labelId.toUpperCase();
  if (id.includes('PROMOTION')) return '#DB8059';
  if (id.includes('UPDATE')) return '#BD8C2E';
  if (id.includes('IMPORTANT')) return '#AD63CC';
  return ACCENT_HEX;
}

/**
 * Display priority for a normalized (uppercased) label id. Lower sorts first.
 */
function labelPriority(normalized: string): number {
  if (normalized === 'CATEGORY_PRIMARY') return 100;
  if (normalized.includes('IMPORTANT')) return 0;
  if (normalized.includes('PROMOTION')) return 1;
  if (normalized.includes('UPDATE')) return 2;
  if (normalized.includes('SOCIAL')) return 3;
  if (normalized.includes('FORUM')) return 4;
  if (normalized.startsWith('CATEGORY_')) return 5;
  return 6;
}

/**
 * Display-worthy labels for a thread row: drops system noise, dedupes
 * case-insensitively, and orders by display priority.
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

export type LabelPresence = 'none' | 'some' | 'all';

export function labelPresenceInThreads(
  labelId: string,
  threads: Array<Pick<MailThread, 'labelIds'>>,
): LabelPresence {
  if (threads.length === 0) return 'none';

  let matchingThreads = 0;
  for (const thread of threads) {
    if (thread.labelIds.includes(labelId)) matchingThreads += 1;
  }

  if (matchingThreads === 0) return 'none';
  return matchingThreads === threads.length ? 'all' : 'some';
}

export function primaryRowLabel(thread: MailThread): RowLabel | null {
  const [id] = threadRowLabelIds(thread.labelIds);
  if (id === undefined) return null;
  return {
    id,
    name: labelDisplayName(id),
    color: pillColorHex(id),
  };
}

function sortNodes(nodes: LabelTreeNode[]): LabelTreeNode[] {
  return nodes
    .sort((a, b) => a.segment.localeCompare(b.segment, undefined, { sensitivity: 'base' }))
    .map(node => ({ ...node, children: sortNodes(node.children) }));
}

export function buildLabelTree(labels: MailLabelDefinition[]): LabelTreeNode[] {
  const roots: LabelTreeNode[] = [];
  const byFullName = new Map<string, LabelTreeNode>();

  for (const label of labels) {
    const segments = labelSegments(label.name);
    if (segments.length === 0) continue;
    let siblings = roots;
    let fullName = '';

    segments.forEach((segment, index) => {
      fullName = fullName ? `${fullName}/${segment}` : segment;
      let node = byFullName.get(fullName);
      if (!node) {
        node = { segment, fullName, depth: index, children: [] };
        byFullName.set(fullName, node);
        siblings.push(node);
      }
      if (index === segments.length - 1) {
        node.label = label;
      }
      siblings = node.children;
    });
  }

  return sortNodes(roots);
}

export function flattenLabelTree(nodes: LabelTreeNode[]): LabelTreeNode[] {
  const result: LabelTreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    result.push(...flattenLabelTree(node.children));
  }
  return result;
}
