const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    return ALLOWED_LINK_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
