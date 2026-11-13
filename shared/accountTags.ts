// Short account markers for rows that mix several accounts (the unified inbox).
// Pure and dependency-free: the label is text, so the marker never depends on
// colour alone; the colour only helps the eye group rows.

export interface AccountTag {
  /** Short text that tells the accounts apart ("northwind", "family"). */
  label: string;
  /** Two or three letters for rows too narrow for the label ("NO", "MF"); unique within the set. */
  short: string;
  /** The full address, for the tooltip and the accessible name. */
  email: string;
  /** Stable dot colour for this account within the current set. */
  color: string;
}

/** Decorative only; chosen to stay distinguishable on light and dark surfaces. */
const TAG_COLORS = ['#5B8DEF', '#D0619F', '#3DAA86', '#D39A2C', '#8B72E0', '#DB6A4E'] as const;

function parts(email: string): { local: string; domain: string } {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  return { local, domain: domain.split('.')[0] || domain };
}

/** "morgan-family" → "MF", "northwind" → "NO"; lengthened until every code in the set differs. */
function shortCodes(labels: readonly string[]): string[] {
  const letters = (label: string) => label.replace(/[^a-z0-9]/gi, '');
  const initial = (label: string) => {
    const words = label.split(/[^a-z0-9]+/i).filter(Boolean);
    return words.length > 1 ? words.map(word => word[0]).join('').slice(0, 3) : letters(label).slice(0, 2);
  };
  let codes = labels.map(label => initial(label).toUpperCase() || '?');
  for (let length = 3; new Set(codes).size < codes.length && length <= 8; length += 1) {
    const clashing = new Set(codes.filter((code, index) => codes.indexOf(code) !== index));
    codes = codes.map((code, index) => (clashing.has(code) ? (letters(labels[index]).slice(0, length).toUpperCase() || code) : code));
  }
  return codes;
}

/**
 * One tag per account. Different domains are told apart by the domain's first
 * label; accounts on the same domain by the part before `@`. Returns an empty
 * map for fewer than two accounts: a single account needs no marker.
 */
export function buildAccountTags(emails: readonly string[]): Map<string, AccountTag> {
  const tags = new Map<string, AccountTag>();
  const unique = Array.from(new Set(emails.map(email => email.trim()).filter(Boolean)));
  if (unique.length < 2) return tags;
  const domainCounts = new Map<string, number>();
  for (const email of unique) {
    const { domain } = parts(email);
    domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
  }
  const labels = unique.map(email => {
    const { local, domain } = parts(email);
    return domain && domainCounts.get(domain) === 1 ? domain : local || email;
  });
  const shorts = shortCodes(labels);
  unique.forEach((email, index) => {
    tags.set(email, { label: labels[index], short: shorts[index], email, color: TAG_COLORS[index % TAG_COLORS.length] });
  });
  return tags;
}
