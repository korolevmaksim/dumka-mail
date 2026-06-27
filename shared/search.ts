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
