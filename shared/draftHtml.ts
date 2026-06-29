import { compileMarkdownToHtml } from './markdown';
import type { ComposeSettings, ComposeSignatureSettings } from './types';
import { sanitizeGmailSignatureHtml } from './textNormalizer';

const DEFAULT_BODY_STYLE = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; color: #1f2937;";

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

function wrapHtmlBody(innerHtml: string): string {
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

export function compileDraftBodyHtml(bodyPlain: string, compose: ComposeSettings, accountId?: string | null): string {
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
