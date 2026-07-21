import type { MailSecurityWarning } from './types';

const SHORT_LINK_HOSTS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'buff.ly',
  'cutt.ly',
  'is.gd',
]);

export interface LinkSecurityOptions {
  isBulkMessage?: boolean;
}

export interface LinkSecurityAnalysis {
  warnings: MailSecurityWarning[];
  phishingLinkCount: number;
}

interface GroupedLinkWarning {
  count: number;
  warning: MailSecurityWarning;
  pluralDetail: (count: number) => string;
}

function quotedAttr(tag: string, attrName: string): string {
  const pattern = new RegExp(`\\b${attrName}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(pattern);
  return (match?.[2] || match?.[3] || match?.[4] || '').trim();
}

function numericAttr(tag: string, attrName: string): number | null {
  const value = quotedAttr(tag, attrName);
  if (!value) return null;
  const match = value.match(/^(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericStyleSize(style: string, property: 'width' | 'height'): number | null {
  const match = style.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px(?:\\s*!important)?(?:;|$)`, 'i'));
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isHiddenPixelTag(tag: string): boolean {
  const attrWidth = numericAttr(tag, 'width');
  const attrHeight = numericAttr(tag, 'height');
  const style = quotedAttr(tag, 'style').toLowerCase();
  const width = attrWidth ?? numericStyleSize(style, 'width');
  const height = attrHeight ?? numericStyleSize(style, 'height');
  const tinyDimensions = (width !== null && width <= 2 && (height === null || height <= 2)) ||
    (height !== null && height <= 2 && (width === null || width <= 2));

  return tinyDimensions ||
    /(?:^|;)\s*display\s*:\s*none(?:\s*!important)?(?:;|$)/i.test(style) ||
    /(?:^|;)\s*visibility\s*:\s*hidden(?:\s*!important)?(?:;|$)/i.test(style) ||
    /(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?(?:\s*!important)?(?:;|$)/i.test(style) ||
    /(?:^|;)\s*max-height\s*:\s*0(?:px)?(?:\s*!important)?(?:;|$)/i.test(style);
}

export function detectTrackingPixelTags(html: string): string[] {
  if (!html) return [];
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  return tags.filter(tag => {
    const src = quotedAttr(tag, 'src');
    return Boolean(src && /^https?:\/\//i.test(src) && isHiddenPixelTag(tag));
  });
}

export function stripTrackingPixelsFromHtml(html: string): string {
  if (!html) return html;
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const src = quotedAttr(tag, 'src');
    if (!src || !/^https?:\/\//i.test(src)) return tag;
    return isHiddenPixelTag(tag) ? '' : tag;
  });
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function domainFromHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return null;
  }
}

function visibleUrlFromText(text: string): string | null {
  const trimmed = text.trim().replace(/[),.;!?]+$/, '');
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (/^https?:\/\/[^<>]+$/i.test(trimmed)) return trimmed;
  if (/^www\.[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#][^<>]*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

function hostsAreRelated(first: string, second: string): boolean {
  return first === second || first.endsWith(`.${second}`) || second.endsWith(`.${first}`);
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || (host.startsWith('[') && host.endsWith(']'));
}

function hasPunycodeLabel(host: string): boolean {
  return host.split('.').some(label => label.startsWith('xn--'));
}

function addGroupedWarning(
  grouped: Map<string, GroupedLinkWarning>,
  key: string,
  warning: MailSecurityWarning,
  pluralDetail: (count: number) => string,
): void {
  const existing = grouped.get(key);
  if (existing) {
    existing.count += 1;
    return;
  }
  grouped.set(key, { count: 1, warning, pluralDetail });
}

function groupedWarnings(groups: Map<string, GroupedLinkWarning>): MailSecurityWarning[] {
  return [...groups.values()].map(group => ({
    ...group.warning,
    detail: group.count === 1 ? group.warning.detail : group.pluralDetail(group.count),
  }));
}

export function analyzeLinkSecurity(html: string, options: LinkSecurityOptions = {}): LinkSecurityAnalysis {
  const grouped = new Map<string, GroupedLinkWarning>();
  let phishingLinkCount = 0;
  const links = html.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi);

  for (const match of links) {
    const href = (match[2] || match[3] || match[4] || '').trim();
    if (!href) continue;
    const protocol = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase() || '';
    if (protocol && !['http', 'https', 'mailto', 'tel', 'cid'].includes(protocol)) {
      phishingLinkCount += 1;
      addGroupedWarning(grouped, `unsafeProtocol:${protocol}`, {
        kind: 'unsafeProtocol',
        severity: 'danger',
        title: 'Unsafe link protocol',
        detail: `A link uses the ${protocol}: protocol.`,
        evidence: href.slice(0, 120),
      }, count => `${count} links use the ${protocol}: protocol.`);
      continue;
    }

    const hrefDomain = domainFromHttpUrl(href);
    if (!hrefDomain) continue;
    const text = stripTags(match[5] || '');
    const visibleUrl = visibleUrlFromText(text);
    const visibleDomain = visibleUrl ? domainFromHttpUrl(visibleUrl) : null;
    if (visibleDomain && !hostsAreRelated(visibleDomain, hrefDomain)) {
      if (options.isBulkMessage) continue;
      phishingLinkCount += 1;
      addGroupedWarning(grouped, `mismatch:${visibleDomain}:${hrefDomain}`, {
        kind: 'suspiciousLink',
        severity: 'danger',
        title: 'Link destination mismatch',
        detail: `Visible link points to ${visibleDomain}, but the real destination is ${hrefDomain}.`,
        evidence: href.slice(0, 160),
      }, count => `${count} visible links point to ${visibleDomain}, but their real destination is ${hrefDomain}.`);
      continue;
    }

    if (hasPunycodeLabel(hrefDomain) || isIpLiteral(hrefDomain) || SHORT_LINK_HOSTS.has(hrefDomain)) {
      phishingLinkCount += 1;
      addGroupedWarning(grouped, `obscured:${hrefDomain}`, {
        kind: 'suspiciousLink',
        severity: 'warning',
        title: 'Obscured link destination',
        detail: `A link uses ${hrefDomain}, which hides or obscures its final destination.`,
        evidence: href.slice(0, 160),
      }, count => `${count} links use ${hrefDomain}, which hides or obscures their final destinations.`);
    }
  }

  return {
    warnings: groupedWarnings(grouped),
    phishingLinkCount,
  };
}
