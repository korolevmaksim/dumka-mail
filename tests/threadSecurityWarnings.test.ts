import { describe, expect, it } from 'vitest';
import type { MessageSecurityInsight } from '../shared/types';
import { selectThreadSecurityWarnings } from '../renderer/src/components/threadSecurityWarnings';

function insight(
  messageId: string,
  warnings: MessageSecurityInsight['warnings'],
): MessageSecurityInsight {
  return {
    accountId: 'me@example.com',
    messageId,
    threadId: 'thread-1',
    riskLevel: warnings.some(warning => warning.severity === 'danger') ? 'high' : 'low',
    warnings,
    trackerCount: 0,
    phishingLinkCount: 0,
    analyzedAt: '2026-07-22T00:00:00.000Z',
  };
}

describe('selectThreadSecurityWarnings', () => {
  it('deduplicates repeated warnings and prioritizes threats over privacy notices', () => {
    const privacyWarning = {
      kind: 'trackingPixel' as const,
      severity: 'info' as const,
      title: 'Tracking protection',
      detail: '1 hidden tracking pixel blocked.',
    };
    const dangerWarning = {
      kind: 'unsafeProtocol' as const,
      severity: 'danger' as const,
      title: 'Unsafe link protocol',
      detail: 'A link uses the javascript: protocol.',
    };

    const selected = selectThreadSecurityWarnings([
      insight('message-1', [privacyWarning, dangerWarning]),
      insight('message-2', [dangerWarning]),
    ]);

    expect(selected).toHaveLength(2);
    expect(selected.map(warning => warning.severity)).toEqual(['danger', 'info']);
  });

  it('applies the display limit after sorting and deduplication', () => {
    const selected = selectThreadSecurityWarnings([
      insight('message-1', Array.from({ length: 6 }, (_, index) => ({
        kind: 'suspiciousLink' as const,
        severity: index === 5 ? 'danger' as const : 'warning' as const,
        title: `Warning ${index}`,
        detail: `Detail ${index}`,
      }))),
    ], 4);

    expect(selected).toHaveLength(4);
    expect(selected[0].severity).toBe('danger');
  });
});
