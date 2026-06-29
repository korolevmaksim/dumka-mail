import { compileMarkdownToHtml } from './markdown';
import type { ComposeSettings, ComposeSignatureSettings } from './types';
import { decodeHtmlEntities, sanitizeGmailSignatureHtml } from './textNormalizer';

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
