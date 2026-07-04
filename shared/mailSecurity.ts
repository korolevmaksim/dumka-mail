import type {
  AgentRulesSettings,
  MailHeader,
  MailMessage,
  MailSecurityWarning,
  MessageSecurityInsight,
  UnsubscribeCandidate,
  UnsubscribeMethod,
} from './types';
import { htmlToText } from './aiContext';

export interface NotificationFilterSettings {
  notifyImportantOnly?: boolean;
}

export type AgentDraftRuleOptions = Pick<
  AgentRulesSettings,
  'proactiveDraftTrigger' | 'blockBulkAndAutomated' | 'maxDraftSourceWords'
>;

const TRACKING_HOST_HINTS = [
  'mailchimp.com',
  'list-manage.com',
  'sendgrid.net',
  'mandrillapp.com',
  'hubspotemail.net',
  'hubspotlinks.com',
  'marketo.com',
  'salesforce.com',
  'pardot.com',
  'customeriomail.com',
  'intercom-mail.com',
  'tracking',
  'track',
  'pixel',
  'open',
  'click',
];

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

const BULK_HEADER_NAMES = new Set([
  'list-id',
  'list-unsubscribe',
  'list-unsubscribe-post',
  'x-campaign-id',
  'x-mailchimp-campaign',
  'x-sg-eid',
]);

function cleanHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

export function normalizeHeaders(headers?: MailHeader[]): MailHeader[] {
  return (headers || [])
    .map(header => ({ name: header.name.trim(), value: header.value.trim() }))
    .filter(header => header.name && header.value);
}

export function getHeader(headers: MailHeader[] | undefined, name: string): string {
  const normalizedName = cleanHeaderName(name);
  return normalizeHeaders(headers).find(header => cleanHeaderName(header.name) === normalizedName)?.value || '';
}

function hasLabel(message: MailMessage, label: string): boolean {
  const target = label.toUpperCase();
  return message.labelIds.some(item => item.toUpperCase() === target);
}

function messageText(message: MailMessage): string {
  const plain = (message.bodyPlain || '').trim();
  if (plain) return plain;
  const html = (message.bodyHtml || '').trim();
  if (html) return htmlToText(html);
  return message.snippet || '';
}

function senderText(message: MailMessage): string {
  return `${message.senderName || ''} ${message.senderEmail || ''}`.toLowerCase();
}

function isAutomatedSender(message: MailMessage): boolean {
  const sender = senderText(message);
  return sender.includes('noreply') ||
    sender.includes('no-reply') ||
    sender.includes('do-not-reply') ||
    sender.includes('donotreply') ||
    sender.includes('notification') ||
    sender.includes('newsletter');
}

export function isLikelyBulkMessage(message: MailMessage): boolean {
  const headers = normalizeHeaders(message.headers);
  if (headers.some(header => BULK_HEADER_NAMES.has(cleanHeaderName(header.name)))) return true;

  const precedence = getHeader(headers, 'precedence').toLowerCase();
  if (['bulk', 'list', 'junk'].includes(precedence)) return true;

  const subject = message.subject.toLowerCase();
  const snippet = message.snippet.toLowerCase();
  return hasLabel(message, 'CATEGORY_PROMOTIONS') ||
    subject.includes('newsletter') ||
    subject.includes('digest') ||
    subject.includes('promotion') ||
    subject.includes('discount') ||
    subject.includes('sale') ||
    snippet.includes('unsubscribe');
}

function isDirectlyAddressedToAccount(message: MailMessage, accountId: string): boolean {
  const self = accountId.trim().toLowerCase();
  if (!self) return false;
  return [...(message.to || []), ...(message.cc || [])]
    .some(recipient => recipient.email.trim().toLowerCase() === self);
}

function looksLikeActionRequest(message: MailMessage): boolean {
  const text = `${message.subject} ${message.snippet} ${messageText(message).slice(0, 1200)}`.toLowerCase();
  return text.includes('?') ||
    /\b(can|could|would|will)\s+you\b/.test(text) ||
    /\bplease\b/.test(text) ||
    /\blet me know\b/.test(text) ||
    /\bwhat do you think\b/.test(text) ||
    /\bare you available\b/.test(text) ||
    /\bdoes this work\b/.test(text) ||
    /\bneed your\b/.test(text) ||
    /\bwaiting for\b/.test(text) ||
    /\bfollow up\b/.test(text);
}

export function shouldGenerateAgentDraft(
  message: MailMessage,
  accountId: string,
  options: Partial<AgentDraftRuleOptions> = {}
): boolean {
  const trigger = options.proactiveDraftTrigger || 'directOrActionRequest';
  const blockBulkAndAutomated = options.blockBulkAndAutomated !== false;
  const maxDraftSourceWords = Number.isInteger(options.maxDraftSourceWords) && Number(options.maxDraftSourceWords) > 0
    ? Number(options.maxDraftSourceWords)
    : 6000;

  if (!hasLabel(message, 'INBOX')) return false;
  if (hasLabel(message, 'SPAM') || hasLabel(message, 'TRASH')) return false;
  if (message.senderEmail.trim().toLowerCase() === accountId.trim().toLowerCase()) return false;
  if (blockBulkAndAutomated && (isAutomatedSender(message) || isLikelyBulkMessage(message))) return false;
  if (messageText(message).split(/\s+/).length > maxDraftSourceWords) return false;
  if (trigger === 'directOnly') return isDirectlyAddressedToAccount(message, accountId);
  return isDirectlyAddressedToAccount(message, accountId) || looksLikeActionRequest(message);
}

export function shouldNotifyForMessage(message: MailMessage, settings: NotificationFilterSettings = {}): boolean {
  if (!hasLabel(message, 'INBOX') || !hasLabel(message, 'UNREAD')) return false;
  if (hasLabel(message, 'SPAM') || hasLabel(message, 'TRASH')) return false;
  if (isLikelyBulkMessage(message) || isAutomatedSender(message)) return false;
  if (!settings.notifyImportantOnly) return true;
  return hasLabel(message, 'IMPORTANT') ||
    hasLabel(message, 'CATEGORY_PRIMARY') ||
    looksLikeActionRequest(message);
}

function splitListUnsubscribeHeader(value: string): string[] {
  const result: string[] = [];
  const matches = value.matchAll(/<([^>]+)>|([^,\s]+)/g);
  for (const match of matches) {
    const item = (match[1] || match[2] || '').trim();
    if (item) result.push(item);
  }
  return result;
}

function parseMailto(value: string, oneClick: boolean): UnsubscribeMethod | null {
  try {
    const parsed = new URL(value);
    const email = decodeURIComponent(parsed.pathname || '').trim();
    if (!email || !email.includes('@')) return null;
    return {
      kind: 'mailto',
      url: value,
      isOneClick: oneClick,
      email,
      subject: parsed.searchParams.get('subject') || 'unsubscribe',
      body: parsed.searchParams.get('body') || 'unsubscribe',
    };
  } catch {
    return null;
  }
}

function parseHttpUrl(value: string, oneClick: boolean): UnsubscribeMethod | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return {
      kind: oneClick ? 'httpPost' : 'httpGet',
      url: parsed.toString(),
      isOneClick: oneClick,
    };
  } catch {
    return null;
  }
}

export function parseUnsubscribeCandidate(message: MailMessage): UnsubscribeCandidate | null {
  const headers = normalizeHeaders(message.headers);
  const listUnsubscribe = getHeader(headers, 'list-unsubscribe');
  if (!listUnsubscribe) return null;

  const listUnsubscribePost = getHeader(headers, 'list-unsubscribe-post').toLowerCase();
  const supportsOneClick = listUnsubscribePost.includes('list-unsubscribe=one-click');
  const methods = splitListUnsubscribeHeader(listUnsubscribe)
    .map(value => {
      const lower = value.toLowerCase();
      if (lower.startsWith('mailto:')) return parseMailto(value, supportsOneClick);
      if (lower.startsWith('http://') || lower.startsWith('https://')) return parseHttpUrl(value, supportsOneClick);
      return null;
    })
    .filter((method): method is UnsubscribeMethod => Boolean(method));

  if (methods.length === 0) return null;

  const recommendedMethod =
    methods.find(method => method.kind === 'httpPost' && method.isOneClick) ||
    methods.find(method => method.kind === 'mailto') ||
    null;

  return {
    accountId: message.accountId,
    threadId: message.threadId,
    messageId: message.id,
    senderEmail: message.senderEmail,
    senderName: message.senderName,
    methods,
    recommendedMethod,
    canOneClick: Boolean(recommendedMethod),
  };
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  const [a, b] = octets;
  return a === 0 ||                        // 0.0.0.0/8 ("this network")
    a === 10 ||                            // 10.0.0.0/8
    a === 127 ||                           // 127.0.0.0/8 (loopback)
    (a === 169 && b === 254) ||            // 169.254.0.0/16 (link-local, incl. cloud metadata)
    (a === 172 && b >= 16 && b <= 31) ||   // 172.16.0.0/12
    (a === 192 && b === 168) ||            // 192.168.0.0/16
    (a === 100 && b >= 64 && b <= 127);    // 100.64.0.0/10 (CGNAT)
}

function isPrivateIpv6(literal: string): boolean {
  const host = literal.split('%')[0].toLowerCase();
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true; // loopback

  // IPv4-mapped IPv6 (::ffff:a.b.c.d, or the ::ffff:hhhh:hhhh hex form WHATWG
  // URL normalizes it to) inherits the embedded IPv4 address's classification.
  // Unparseable mapped forms fail closed as private.
  const mapped = host.match(/^(?:0:0:0:0:0|:):ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    if (tail.includes('.')) return isPrivateIpv4(tail);
    const groups = tail.split(':');
    if (groups.length === 2) {
      const hi = Number.parseInt(groups[0], 16);
      const lo = Number.parseInt(groups[1], 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return isPrivateIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
      }
    }
    return true;
  }

  const firstGroup = (host.split(':')[0] || '').padStart(4, '0');
  if (firstGroup.startsWith('fc') || firstGroup.startsWith('fd')) return true; // fc00::/7 (unique local)
  const value = Number.parseInt(firstGroup, 16);
  return Number.isFinite(value) && value >= 0xfe80 && value <= 0xfebf; // fe80::/10 (link-local)
}

/**
 * Hostname-level screening for one-click unsubscribe destinations: rejects
 * non-http(s) protocols and literal loopback/private/link-local addresses so
 * a crafted List-Unsubscribe header cannot point an approved POST at internal
 * infrastructure. DNS-resolution checks (a public hostname resolving to a
 * private IP) are a deliberate non-goal here since execution is always
 * user-approved per destination.
 */
export function isSafePublicHttpUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host.startsWith('[') && host.endsWith(']')) return !isPrivateIpv6(host.slice(1, -1));
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return !isPrivateIpv4(host);
  return true;
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

function isTrackingUrl(value: string): boolean {
  try {
    const parsed = new URL(value, 'https://example.invalid');
    const haystack = `${parsed.hostname} ${parsed.pathname} ${parsed.search}`.toLowerCase();
    return TRACKING_HOST_HINTS.some(hint => haystack.includes(hint)) ||
      parsed.searchParams.has('utm_source') ||
      parsed.searchParams.has('mc_eid') ||
      parsed.searchParams.has('mkt_tok');
  } catch {
    return false;
  }
}

function isHiddenPixelTag(tag: string): boolean {
  const width = numericAttr(tag, 'width');
  const height = numericAttr(tag, 'height');
  const style = quotedAttr(tag, 'style').toLowerCase();
  return (width !== null && width <= 2) ||
    (height !== null && height <= 2) ||
    style.includes('display:none') ||
    style.includes('display: none') ||
    style.includes('visibility:hidden') ||
    style.includes('visibility: hidden') ||
    style.includes('opacity:0') ||
    style.includes('opacity: 0') ||
    style.includes('max-height:0') ||
    style.includes('max-height: 0');
}

export function detectTrackingPixelTags(html: string): string[] {
  if (!html) return [];
  const tags = html.match(/<img\b[^>]*>/gi) || [];
  return tags.filter(tag => {
    const src = quotedAttr(tag, 'src');
    if (!src || !/^https?:\/\//i.test(src)) return false;
    return isHiddenPixelTag(tag) || isTrackingUrl(src);
  });
}

export function stripTrackingPixelsFromHtml(html: string): string {
  if (!html) return html;
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const src = quotedAttr(tag, 'src');
    if (!src || !/^https?:\/\//i.test(src)) return tag;
    return isHiddenPixelTag(tag) || isTrackingUrl(src) ? '' : tag;
  });
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function domainFromUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function visibleUrlFromText(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>()]+|(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>()]*)?/i);
  if (!match) return null;
  const value = match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
  return value;
}

function isIpHost(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

function linkWarnings(html: string): MailSecurityWarning[] {
  const warnings: MailSecurityWarning[] = [];
  const links = html.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of links) {
    const href = (match[2] || match[3] || match[4] || '').trim();
    if (!href) continue;
    const lowerHref = href.toLowerCase();
    if (lowerHref.startsWith('javascript:') || lowerHref.startsWith('data:')) {
      warnings.push({
        kind: 'unsafeProtocol',
        severity: 'danger',
        title: 'Unsafe link protocol',
        detail: 'A link uses a script or data URL protocol.',
        evidence: href.slice(0, 120),
      });
      continue;
    }

    const hrefDomain = domainFromUrl(href);
    if (!hrefDomain) continue;
    const text = stripTags(match[5] || '');
    const visibleUrl = visibleUrlFromText(text);
    const visibleDomain = visibleUrl ? domainFromUrl(visibleUrl) : null;
    if (visibleDomain && visibleDomain !== hrefDomain && !hrefDomain.endsWith(`.${visibleDomain}`)) {
      warnings.push({
        kind: 'suspiciousLink',
        severity: 'danger',
        title: 'Link destination mismatch',
        detail: `Visible link points to ${visibleDomain}, but the real destination is ${hrefDomain}.`,
        evidence: href.slice(0, 160),
      });
      continue;
    }

    if (lowerHref.startsWith('http://') || hrefDomain.startsWith('xn--') || isIpHost(hrefDomain) || SHORT_LINK_HOSTS.has(hrefDomain)) {
      warnings.push({
        kind: 'suspiciousLink',
        severity: 'warning',
        title: 'Suspicious link',
        detail: `The message contains a link through ${hrefDomain}.`,
        evidence: href.slice(0, 160),
      });
    }
  }
  return warnings;
}

function senderMismatchWarning(message: MailMessage): MailSecurityWarning | null {
  const headers = normalizeHeaders(message.headers);
  const replyTo = getHeader(headers, 'reply-to');
  if (!replyTo) return null;

  const replyDomain = (replyTo.match(/@([^>\s]+)/)?.[1] || '').toLowerCase().replace(/^www\./, '');
  const fromDomain = (message.senderEmail.split('@')[1] || '').toLowerCase().replace(/^www\./, '');
  if (!replyDomain || !fromDomain || replyDomain === fromDomain) return null;
  if (replyDomain.endsWith(`.${fromDomain}`) || fromDomain.endsWith(`.${replyDomain}`)) return null;

  return {
    kind: 'senderMismatch',
    severity: 'warning',
    title: 'Reply-to mismatch',
    detail: `Replies go to ${replyDomain}, not ${fromDomain}.`,
    evidence: replyTo.slice(0, 160),
  };
}

function styleShiftWarning(message: MailMessage, priorMessages: MailMessage[]): MailSecurityWarning | null {
  const comparable = priorMessages
    .filter(item => item.senderEmail.toLowerCase() === message.senderEmail.toLowerCase() && item.id !== message.id)
    .slice(-8);
  if (comparable.length < 3) return null;

  const current = messageText(message);
  const previousTexts = comparable.map(item => messageText(item)).filter(Boolean);
  if (previousTexts.length < 3 || current.length < 40) return null;

  const avgPrevLength = previousTexts.reduce((sum, item) => sum + item.length, 0) / previousTexts.length;
  const urgent = /\b(urgent|asap|immediately|wire|payment|invoice|password|gift card|bank|login|verify)\b/i.test(current);
  const currentPunctuation = (current.match(/[!?]/g) || []).length;
  const avgPrevPunctuation = previousTexts.reduce((sum, item) => sum + (item.match(/[!?]/g) || []).length, 0) / previousTexts.length;

  if (urgent && (current.length > avgPrevLength * 2.2 || currentPunctuation > avgPrevPunctuation + 3)) {
    return {
      kind: 'styleShift',
      severity: 'warning',
      title: 'Sender style changed',
      detail: 'This message is unusually urgent compared with recent mail from the same sender.',
    };
  }

  return null;
}

function riskLevelForWarnings(warnings: MailSecurityWarning[]): 'low' | 'medium' | 'high' {
  if (warnings.some(warning => warning.severity === 'danger')) return 'high';
  if (warnings.some(warning => warning.severity === 'warning')) return 'medium';
  return 'low';
}

export function analyzeMessageSecurity(message: MailMessage, priorMessages: MailMessage[] = [], now = new Date()): MessageSecurityInsight {
  const warnings: MailSecurityWarning[] = [];
  const html = message.bodyHtml || '';
  const trackingTags = detectTrackingPixelTags(html);
  if (trackingTags.length > 0) {
    warnings.push({
      kind: 'trackingPixel',
      severity: 'warning',
      title: 'Tracking pixels detected',
      detail: `${trackingTags.length} hidden or tracking image${trackingTags.length === 1 ? '' : 's'} found.`,
    });
  }

  if (/<form\b/i.test(html)) {
    warnings.push({
      kind: 'remoteForm',
      severity: 'danger',
      title: 'Remote form detected',
      detail: 'The email contains an embedded form, which is unusual for legitimate mail.',
    });
  }

  warnings.push(...linkWarnings(html));
  const mismatch = senderMismatchWarning(message);
  if (mismatch) warnings.push(mismatch);
  const styleShift = styleShiftWarning(message, priorMessages);
  if (styleShift) warnings.push(styleShift);

  const phishingLinkCount = warnings.filter(warning => (
    warning.kind === 'suspiciousLink' ||
    warning.kind === 'senderMismatch' ||
    warning.kind === 'styleShift' ||
    warning.kind === 'unsafeProtocol'
  )).length;

  return {
    accountId: message.accountId,
    messageId: message.id,
    threadId: message.threadId,
    riskLevel: riskLevelForWarnings(warnings),
    warnings,
    trackerCount: trackingTags.length,
    phishingLinkCount,
    analyzedAt: now.toISOString(),
  };
}
