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

interface SearchToken {
  value: string;
}

function tokenizeSearchQuery(query: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  let buffer = '';
  let inQuote = false;

  const flush = () => {
    const value = buffer.trim();
    if (value) tokens.push({ value });
    buffer = '';
  };

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];

    if (inQuote) {
      if (char === '"') {
        if (query[index + 1] === '"') {
          buffer += '"';
          index += 1;
        } else {
          inQuote = false;
        }
      } else {
        buffer += char;
      }
      continue;
    }

    if (char === '"') {
      inQuote = true;
      continue;
    }

    if (/\s/.test(char)) {
      flush();
      continue;
    }

    buffer += char;
  }

  flush();
  return tokens;
}

function isOperatorToken(value: string): boolean {
  const colonIdx = value.indexOf(':');
  if (colonIdx === -1) return false;
  const prefix = value.substring(0, colonIdx + 1).toLowerCase();
  return OPERATOR_PREFIXES.includes(prefix);
}

function flushTextPhrase(result: ParsedSearchQuery, parts: string[]): void {
  const phrase = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (phrase) result.textTerms.push(phrase);
  parts.length = 0;
}

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const parts = tokenizeSearchQuery(query).map(token => token.value);
  const result: ParsedSearchQuery = {
    textTerms: []
  };
  const textParts: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const colonIdx = part.indexOf(':');

    // Check if this token is a known operator (e.g. "from:value" or bare "from:")
    if (colonIdx !== -1) {
      const prefix = part.substring(0, colonIdx + 1).toLowerCase();
      if (OPERATOR_PREFIXES.includes(prefix)) {
        flushTextPhrase(result, textParts);

        // Value is everything after the colon; if empty, take the next token
        let value = part.substring(colonIdx + 1);
        if (!value && i + 1 < parts.length) {
          // Only consume next token if it's not itself an operator
          const next = parts[i + 1];
          if (!isOperatorToken(next)) {
            value = parts[++i];
          }
        }

        if (!value) continue; // bare operator with no value — skip

        applyOperator(result, prefix, value);
        continue;
      }
    }

    textParts.push(part);
  }

  flushTextPhrase(result, textParts);
  return result;
}

export function searchTextQuery(parsed: ParsedSearchQuery): string {
  return parsed.textTerms.join(' ').replace(/\s+/g, ' ').trim();
}

export function buildFtsMatchQuery(textTerms: string[]): string {
  return textTerms
    .map(term => term.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(term => `"${term.replace(/"/g, '""')}"`)
    .join(' ');
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
