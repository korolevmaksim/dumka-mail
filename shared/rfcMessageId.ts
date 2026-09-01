export function createRfcMessageId(now = Date.now(), random = () => Math.random().toString(36).slice(2, 12)): string {
  return `<${now}.${random()}@dumka-mail.local>`;
}

export function normalizeRfcMessageId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^<|>$/g, '');
}

export function rfc822MessageIdQuery(value: string | null | undefined): string | null {
  const normalized = normalizeRfcMessageId(value);
  return normalized ? `rfc822msgid:${normalized}` : null;
}

export function resolveActionRfcMessageId(
  payloadJson: string | null | undefined,
  fallback?: string | null,
  createId: () => string = () => createRfcMessageId(),
): { rfcMessageId: string; payloadJson: string; wrote: boolean } {
  let payload: Record<string, unknown> = {};
  if (payloadJson) {
    try {
      const parsed = JSON.parse(payloadJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      payload = {};
    }
  }
  const fromPayload = typeof payload.rfcMessageId === 'string' && payload.rfcMessageId
    ? payload.rfcMessageId
    : null;
  const fromFallback = fallback?.trim() ? fallback : null;
  const rfcMessageId = fromPayload || fromFallback || createId();
  return {
    rfcMessageId,
    payloadJson: JSON.stringify({ ...payload, rfcMessageId }),
    wrote: fromPayload !== rfcMessageId,
  };
}
