import { compileMarkdownToHtml } from './markdown';
import type { ComposeSettings, ComposeSignatureSettings, ProfileSettings } from './types';
import { decodeHtmlEntities, sanitizeGmailSignatureHtml } from './textNormalizer';
import { renderTokens, renderTokensForHtml } from './templateTokens';

const DEFAULT_BODY_STYLE = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #1f2937;";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function plainTextToHtmlFragment(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const escaped = block
        .split('\n')
        .map((line) => escapeHtml(line))
        .join('<br>');
      return escaped.trim() ? `<p>${escaped}</p>` : '';
    })
    .filter(Boolean)
    .join('');
}

export function sanitizeDraftHtmlFragment(html: string): string {
  if (!html) return '';

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const fragment = bodyMatch ? bodyMatch[1] : html;

  return fragment
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?(html|head|body|meta|link|base)[^>]*>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|form|input|button|textarea|select)\b[^>]*>/gi, '')
    .replace(/\s+contenteditable\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+contenteditable\s*=\s*'[^']*'/gi, '')
    .replace(/\s+contenteditable\s*=\s*[^\s>]+/gi, '')
    .replace(/\s+spellcheck\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+spellcheck\s*=\s*'[^']*'/gi, '')
    .replace(/\s+spellcheck\s*=\s*[^\s>]+/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s+(href|src)\s*=\s*"[^"]*(?:javascript|vbscript):[^"]*"/gi, '')
    .replace(/\s+(href|src)\s*=\s*'[^']*(?:javascript|vbscript):[^']*'/gi, '')
    .replace(/\s+(href|src)\s*=\s*[^\s>]*(?:javascript|vbscript):[^\s>]*/gi, '')
    .trim();
}

export function htmlFragmentToPlainText(html: string): string {
  if (!html) return '';

  const withBreaks = sanitizeDraftHtmlFragment(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<img\b[^>]*alt\s*=\s*"([^"]*)"[^>]*>/gi, ' $1 ')
    .replace(/<img\b[^>]*alt\s*=\s*'([^']*)'[^>]*>/gi, ' $1 ')
    .replace(/<img\b[^>]*>/gi, ' [image] ')
    .replace(/<[^>]+>/g, '');

  return decodeHtmlEntities(withBreaks)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripTrailingPlainSignature(
  bodyPlain: string,
  signaturePlain: string,
): { bodyPlain: string; stripped: boolean } {
  const normalizedBody = bodyPlain.replace(/\r\n?/g, '\n').trimEnd();
  const normalizedSignature = signaturePlain.replace(/\r\n?/g, '\n').trim();

  if (!normalizedBody || !normalizedSignature || !normalizedBody.endsWith(normalizedSignature)) {
    return { bodyPlain, stripped: false };
  }

  const signatureStart = normalizedBody.length - normalizedSignature.length;
  if (signatureStart > 0 && !/\n\s*$/.test(normalizedBody.slice(0, signatureStart))) {
    return { bodyPlain, stripped: false };
  }

  return {
    bodyPlain: normalizedBody.slice(0, signatureStart).trimEnd(),
    stripped: true,
  };
}

export function wrapHtmlBody(innerHtml: string): string {
  return `<html><body><div style="${DEFAULT_BODY_STYLE}">${innerHtml}</div></body></html>`;
}

function appendSignatureHtml(compiledHtml: string, signatureHtml: string): string {
  const signatureBlock = `<br/><div class="gmail_signature">${signatureHtml}</div>`;
  if (!compiledHtml) {
    return wrapHtmlBody(signatureBlock);
  }

  const closing = '</div></body></html>';
  if (compiledHtml.endsWith(closing)) {
    return `${compiledHtml.slice(0, -closing.length)}${signatureBlock}${closing}`;
  }

  return `${compiledHtml}${signatureBlock}`;
}

export function getComposeSignatureForAccount(
  compose: ComposeSettings,
  accountId?: string | null,
): ComposeSignatureSettings {
  const normalizedAccountId = accountId?.trim().toLowerCase() || '';
  const accountSignature = normalizedAccountId
    ? compose.signaturesByAccount?.[normalizedAccountId]
    : undefined;

  if (accountSignature) {
    return accountSignature;
  }

  return {
    signaturePlain: compose.defaultSignature || '',
    signatureHtml: compose.defaultSignatureHtml || '',
    signatureFormat: compose.signatureFormat || (compose.defaultSignatureHtml?.trim() ? 'html' : 'plain'),
  };
}

export function renderComposeSignaturePlain(
  compose: ComposeSettings,
  profile: ProfileSettings,
  accountId?: string | null,
): string {
  const signature = getComposeSignatureForAccount(compose, accountId);
  const plain = renderTokens(signature.signaturePlain || '', profile).trim();
  if (plain) return plain;

  const html = renderComposeSignatureHtmlFragment(compose, profile, accountId);
  return htmlFragmentToPlainText(html);
}

export function renderComposeSignatureHtmlFragment(
  compose: ComposeSettings,
  profile: ProfileSettings,
  accountId?: string | null,
): string {
  const signature = getComposeSignatureForAccount(compose, accountId);
  let signatureContent = '';

  if (signature.signatureFormat === 'html' && signature.signatureHtml.trim()) {
    signatureContent = sanitizeGmailSignatureHtml(renderTokensForHtml(signature.signatureHtml, profile));
  }

  if (!signatureContent) {
    const signaturePlain = renderTokens(signature.signaturePlain || '', profile).trim();
    signatureContent = signaturePlain ? plainTextToHtmlFragment(signaturePlain) : '';
  }

  if (!signatureContent.trim()) return '';

  const accountAttr = escapeHtml(accountId?.trim().toLowerCase() || '');
  return `<div class="gmail_signature" data-dumka-signature="true" data-dumka-signature-account="${accountAttr}">${signatureContent}</div>`;
}

function findComposeSignatureRange(html: string): { start: number; end: number } | null {
  const openTagPattern = /<div\b[^>]*(?:data-dumka-signature\s*=\s*["']?true["']?|class\s*=\s*["'][^"']*\bgmail_signature\b[^"']*["'])[^>]*>/ig;
  const openMatch = openTagPattern.exec(html);
  if (!openMatch) return null;

  const tagPattern = /<\/?div\b[^>]*>/ig;
  tagPattern.lastIndex = openMatch.index + openMatch[0].length;
  let depth = 1;

  for (let match = tagPattern.exec(html); match; match = tagPattern.exec(html)) {
    const tag = match[0];
    if (/^<\s*\/\s*div\b/i.test(tag)) {
      depth -= 1;
      if (depth === 0) {
        return { start: openMatch.index, end: tagPattern.lastIndex };
      }
    } else if (!/\/\s*>$/.test(tag)) {
      depth += 1;
    }
  }

  return { start: openMatch.index, end: openMatch.index + openMatch[0].length };
}

export function replaceComposeSignatureForAccount(
  bodyHtml: string | null | undefined,
  compose: ComposeSettings,
  profile: ProfileSettings,
  accountId?: string | null,
): string | null {
  const fragment = sanitizeDraftHtmlFragment(bodyHtml || '');
  const nextSignature = renderComposeSignatureHtmlFragment(compose, profile, accountId);
  const existingRange = findComposeSignatureRange(fragment);

  if (existingRange) {
    const nextHtml = `${fragment.slice(0, existingRange.start)}${nextSignature}${fragment.slice(existingRange.end)}`.trim();
    return nextHtml || null;
  }

  if (!nextSignature) {
    return fragment || null;
  }

  if (!htmlFragmentToPlainText(fragment).trim()) {
    return `<p><br></p>${nextSignature}`;
  }

  return `${fragment}<br>${nextSignature}`;
}

export function buildInitialDraftBodyWithSignature(
  bodyPlain: string,
  compose: ComposeSettings,
  profile: ProfileSettings,
  accountId?: string | null,
  bodyHtml?: string | null,
): { bodyPlain: string; bodyHtml: string | null } {
  const normalizedBody = bodyPlain.replace(/\r\n?/g, '\n');
  const normalizedBodyHtml = sanitizeDraftHtmlFragment(bodyHtml || '');
  const renderedBodyHtml = normalizedBodyHtml || plainTextToHtmlFragment(normalizedBody);
  const signaturePlain = renderComposeSignaturePlain(compose, profile, accountId);
  const signatureHtml = renderComposeSignatureHtmlFragment(compose, profile, accountId);
  const signatureFragment = signatureHtml || plainTextToHtmlFragment(signaturePlain);
  const hasBody = normalizedBody.trim().length > 0 || normalizedBodyHtml.trim().length > 0;

  if (!signaturePlain && !signatureHtml) {
    return {
      bodyPlain: normalizedBody,
      bodyHtml: renderedBodyHtml || null,
    };
  }

  if (!hasBody) {
    return {
      bodyPlain: signaturePlain,
      bodyHtml: signatureHtml ? `<p><br></p>${signatureHtml}` : plainTextToHtmlFragment(signaturePlain),
    };
  }

  return {
    bodyPlain: `${signaturePlain}${normalizedBody.startsWith('\n') ? '' : '\n\n'}${normalizedBody}`,
    bodyHtml: `<p><br></p>${signatureFragment}${renderedBodyHtml}`,
  };
}

export function compileDraftBodyHtml(
  bodyPlain: string,
  compose: ComposeSettings,
  accountId?: string | null,
  bodyHtml?: string | null,
): string {
  if (bodyHtml?.trim()) {
    return wrapHtmlBody(sanitizeDraftHtmlFragment(bodyHtml));
  }

  const signature = getComposeSignatureForAccount(compose, accountId);
  const signatureHtml = sanitizeGmailSignatureHtml(signature.signatureHtml || '');
  const signaturePlain = signature.signaturePlain || '';

  if (signature.signatureFormat !== 'html' || !signatureHtml || !signaturePlain.trim()) {
    return compileMarkdownToHtml(bodyPlain);
  }

  const stripped = stripTrailingPlainSignature(bodyPlain, signaturePlain);
  const compiled = compileMarkdownToHtml(stripped.bodyPlain);
  return stripped.stripped ? appendSignatureHtml(compiled, signatureHtml) : compiled;
}
