export interface ParsedSearchQuery {
  textTerms: string[];
  from?: string;
  domain?: string;
  hasAttachment?: boolean;
  isUnread?: boolean;
  label?: string;
  inSplit?: string;
  after?: string; // YYYY-MM-DD
  before?: string; // YYYY-MM-DD
}

export function searchDateBoundaryMs(value: string, boundary: 'start' | 'end'): number | null {
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    const date = new Date(year, month, day, boundary === 'start' ? 0 : 23, boundary === 'start' ? 0 : 59, boundary === 'start' ? 0 : 59, boundary === 'start' ? 0 : 999);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date.getTime();
  }

  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function matchesSearchDateRange(receivedAt: string, after?: string, before?: string): boolean {
  const receivedMs = Date.parse(receivedAt);
  if (!Number.isFinite(receivedMs)) return false;

  if (after) {
    const afterMs = searchDateBoundaryMs(after, 'start');
    if (afterMs !== null && receivedMs < afterMs) return false;
  }

  if (before) {
    const beforeMs = searchDateBoundaryMs(before, 'end');
    if (beforeMs !== null && receivedMs > beforeMs) return false;
  }

  return true;
}

// Known operator prefixes that accept a value after the colon.
// When the user types "from: value" (space after colon), the parser
// consumes the next token as the operator's value.
const OPERATOR_PREFIXES = [
  'from:', 'sender:', 'domain:', 'has:', 'is:',
  'label:', 'in:', 'after:', 'before:'
];

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const parts = query.split(/\s+/).filter(Boolean);
  const result: ParsedSearchQuery = {
    textTerms: []
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const colonIdx = part.indexOf(':');

    // Check if this token is a known operator (e.g. "from:value" or bare "from:")
    if (colonIdx !== -1) {
      const prefix = part.substring(0, colonIdx + 1).toLowerCase();
      if (OPERATOR_PREFIXES.includes(prefix)) {
        // Value is everything after the colon; if empty, take the next token
        let value = part.substring(colonIdx + 1);
        if (!value && i + 1 < parts.length) {
          // Only consume next token if it's not itself an operator
          const next = parts[i + 1];
          const nextColon = next.indexOf(':');
          const isNextOperator = nextColon !== -1 &&
            OPERATOR_PREFIXES.includes(next.substring(0, nextColon + 1).toLowerCase());
          if (!isNextOperator) {
            value = parts[++i];
          }
        }

        if (!value) continue; // bare operator with no value — skip

        applyOperator(result, prefix, value);
        continue;
      }
    }

    result.textTerms.push(part);
  }

  return result;
}

function applyOperator(result: ParsedSearchQuery, prefix: string, value: string): void {
  switch (prefix) {
    case 'from:':
    case 'sender:':
      result.from = value.toLowerCase();
      break;
    case 'domain:':
      result.domain = value.toLowerCase();
      break;
    case 'has:': {
      const v = value.toLowerCase();
      if (v === 'attachment') result.hasAttachment = true;
      if (v === 'noattachment') result.hasAttachment = false;
      break;
    }
    case 'is:': {
      const v = value.toLowerCase();
      if (v === 'unread') result.isUnread = true;
      if (v === 'read') result.isUnread = false;
      break;
    }
    case 'label:':
      result.label = value.toUpperCase();
      break;
    case 'in:':
      result.inSplit = value.toLowerCase();
      break;
    case 'after:':
      result.after = value;
      break;
    case 'before:':
      result.before = value;
      break;
  }
}
