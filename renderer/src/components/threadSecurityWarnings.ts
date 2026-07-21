import type {
  MailSecuritySeverity,
  MailSecurityWarning,
  MessageSecurityInsight,
} from '../../../shared/types';

export interface ThreadSecurityWarning extends MailSecurityWarning {
  messageId: string;
}

const SEVERITY_PRIORITY: Record<MailSecuritySeverity, number> = {
  danger: 0,
  warning: 1,
  info: 2,
};

function warningKey(warning: MailSecurityWarning): string {
  return [warning.kind, warning.severity, warning.title, warning.detail].join('\u0000');
}

export function selectThreadSecurityWarnings(
  insights: MessageSecurityInsight[],
  limit = 4,
): ThreadSecurityWarning[] {
  const unique = new Map<string, ThreadSecurityWarning>();
  for (const insight of insights) {
    for (const warning of insight.warnings) {
      const key = warningKey(warning);
      if (!unique.has(key)) {
        unique.set(key, { ...warning, messageId: insight.messageId });
      }
    }
  }

  return [...unique.values()]
    .sort((first, second) => SEVERITY_PRIORITY[first.severity] - SEVERITY_PRIORITY[second.severity])
    .slice(0, Math.max(0, limit));
}
