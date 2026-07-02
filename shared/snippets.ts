import type { ProfileSettings, SnippetSettings, ComposeSettings, SnippetTemplate } from './types';
import {
  getComposeSignatureForAccount,
  plainTextToHtmlFragment,
  renderComposeSignatureHtmlFragment,
  sanitizeDraftHtmlFragment,
} from './draftHtml';
import { renderTokens, renderTokensForHtml } from './templateTokens';

export { renderTokens } from './templateTokens';

/**
 * Snippet rendering + Tab-expansion engine.
 *
 * Pure TypeScript port of the Swift `SnippetRenderer` and `SnippetExpansionEngine`
 * (PersonalMailClient/Models/AppSettings.swift). Lives in the dependency-free
 * `shared/` layer so both the Electron main process and the React renderer can
 * use it. No Node / Electron / DOM / React imports allowed here.
 */

function fallbackTemplateId(template: Partial<SnippetTemplate>, index: number): string {
  const seed = template.id || template.trigger || template.title || `snippet-${index + 1}`;
  const slug = String(seed)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `snippet-${index + 1}`;
}

export function createSnippetTemplateId(title: string, existingTemplates: Pick<SnippetTemplate, 'id'>[]): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'snippet';
  const existingIds = new Set(existingTemplates.map(template => template.id));
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function normalizeSnippetTemplates(value: unknown): SnippetTemplate[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((template, index): SnippetTemplate | null => {
      if (!template || typeof template !== 'object') return null;
      const raw = template as Partial<SnippetTemplate>;
      const body = String(raw.body ?? '').trim();
      if (!body) return null;

      const trigger = String(raw.trigger ?? '').trim();
      const title = String(raw.title ?? (trigger || `Snippet ${index + 1}`)).trim();
      return {
        id: fallbackTemplateId(raw, index),
        title,
        trigger,
        body,
        includeSignature: raw.includeSignature !== false,
      };
    })
    .filter((template): template is SnippetTemplate => Boolean(template));
}

function renderSnippetBody(template: string, profile: ProfileSettings): string | null {
  const body = renderTokens(template, profile).trim();
  return body === '' ? null : body;
}

function renderSnippetBodyHtml(template: string, profile: ProfileSettings): string | null {
  const bodyHtml = snippetBodyToHtml(template, profile);
  return bodyHtml === '' ? null : bodyHtml;
}

/**
 * Renders the default snippet body, optionally appending the rendered default
 * signature (separated by a blank line) when `includeSignature` is on.
 *
 * Returns `null` when snippets are disabled or the rendered body is empty.
 * Port of `SnippetRenderer.renderDefaultSnippet`.
 */
export function renderDefaultSnippet(
  snippets: SnippetSettings,
  compose: ComposeSettings,
  profile: ProfileSettings,
  accountId?: string | null,
): string | null {
  if (!snippets.enabled) return null;

  const body = renderSnippetBody(snippets.defaultSnippet, profile);
  if (body === null) return null;

  const accountSignature = getComposeSignatureForAccount(compose, accountId);
  const signature = renderTokens(accountSignature.signaturePlain, profile).trim();
  if (!snippets.includeSignature || signature === '') {
    return body;
  }
  return `${body}\n\n${signature}`;
}

export function renderSnippetTemplate(
  template: SnippetTemplate,
  snippets: SnippetSettings,
  compose: ComposeSettings,
  profile: ProfileSettings,
  accountId?: string | null,
): string | null {
  if (!snippets.enabled) return null;

  const body = renderSnippetBody(template.body, profile);
  if (body === null) return null;

  const accountSignature = getComposeSignatureForAccount(compose, accountId);
  const signature = renderTokens(accountSignature.signaturePlain, profile).trim();
  if (!template.includeSignature || signature === '') {
    return body;
  }
  return `${body}\n\n${signature}`;
}

function snippetBodyToHtml(template: string, profile: ProfileSettings): string {
  const body = renderTokens(template, profile).trim();
  if (!body) return '';
  if (/<[a-z][\s\S]*>/i.test(body)) {
    return sanitizeDraftHtmlFragment(renderTokensForHtml(template, profile).trim());
  }
  return plainTextToHtmlFragment(body);
}

export function renderDefaultSnippetHtml(
  snippets: SnippetSettings,
  compose: ComposeSettings,
  profile: ProfileSettings,
  accountId?: string | null,
): string | null {
  if (!snippets.enabled) return null;

  const bodyHtml = renderSnippetBodyHtml(snippets.defaultSnippet, profile);
  if (bodyHtml === null) return null;

  if (!snippets.includeSignature) {
    return bodyHtml;
  }

  const signatureHtml = renderComposeSignatureHtmlFragment(compose, profile, accountId);
  return signatureHtml ? `${bodyHtml}<br>${signatureHtml}` : bodyHtml;
}

export function renderSnippetTemplateHtml(
  template: SnippetTemplate,
  snippets: SnippetSettings,
  compose: ComposeSettings,
  profile: ProfileSettings,
  accountId?: string | null,
): string | null {
  if (!snippets.enabled) return null;

  const bodyHtml = renderSnippetBodyHtml(template.body, profile);
  if (bodyHtml === null) return null;

  if (!template.includeSignature) {
    return bodyHtml;
  }

  const signatureHtml = renderComposeSignatureHtmlFragment(compose, profile, accountId);
  return signatureHtml ? `${bodyHtml}<br>${signatureHtml}` : bodyHtml;
}

export interface SnippetExpansion {
  text: string;
  /** New caret location (UTF-16 offset) after the inserted text. */
  selection: number;
}

/**
 * Attempts to expand the default snippet at the given caret position.
 *
 * `cursor` is the caret offset (e.g. a textarea `selectionStart`). The caller is
 * responsible for ensuring the selection length is zero before invoking this
 * (the Swift engine guards `selectedRange.length == 0`).
 *
 * Expansion rules (mirroring `SnippetExpansionEngine.expandDefaultSnippet`):
 *  - Requires `snippets.enabled && snippets.expandWithTab`.
 *  - Rule 1 (trigger): if the trimmed trigger is non-empty, the line suffix is
 *    blank, and the trimmed line prefix exactly equals the trigger, replace the
 *    line prefix with the rendered snippet.
 *  - Rule 2 (blank line): otherwise, if the whole current line is blank, replace
 *    the entire body when the body is blank, else replace the (blank) prefix.
 *  - Otherwise no expansion (`null`).
 *
 * Returns `null` when nothing should change.
 */
export function expandSnippetAtCursor(
  body: string,
  cursor: number,
  snippets: SnippetSettings,
  compose: ComposeSettings,
  profile: ProfileSettings,
  accountId?: string | null,
): SnippetExpansion | null {
  if (!snippets.enabled || !snippets.expandWithTab) return null;
  if (cursor < 0 || cursor > body.length) return null;

  // currentLineContext: prefix = line start .. cursor, suffix = cursor .. line end.
  const lineStart = body.lastIndexOf('\n', cursor - 1) + 1; // 0 when no preceding newline
  const nextNewline = body.indexOf('\n', cursor);
  const lineEnd = nextNewline === -1 ? body.length : nextNewline;
  const prefix = body.slice(lineStart, cursor);
  const suffix = body.slice(cursor, lineEnd);

  const replaceRange = (from: number, to: number, replacement: string): SnippetExpansion => ({
    text: body.slice(0, from) + replacement + body.slice(to),
    selection: from + replacement.length,
  });

  const trigger = snippets.defaultSnippetTrigger.trim();
  const suffixBlank = suffix.trim() === '';

  // Rule 1: trigger token on its own.
  if (suffixBlank) {
    const seenTriggers = new Set<string>();
    const triggerCandidates = [
      {
        trigger,
        render: () => renderDefaultSnippet(snippets, compose, profile, accountId),
      },
      ...normalizeSnippetTemplates(snippets.templates).map(template => ({
        trigger: template.trigger.trim(),
        render: () => renderSnippetTemplate(template, snippets, compose, profile, accountId),
      })),
    ];

    for (const candidate of triggerCandidates) {
      if (!candidate.trigger || seenTriggers.has(candidate.trigger)) continue;
      seenTriggers.add(candidate.trigger);
      if (prefix.trim() !== candidate.trigger) continue;
      const replacement = candidate.render();
      if (replacement === null) return null;
      return replaceRange(lineStart, cursor, replacement);
    }
  }

  // Rule 2: blank line.
  const lineBlank = prefix.trim() === '' && suffixBlank;
  if (!lineBlank) return null;

  const replacement = renderDefaultSnippet(snippets, compose, profile, accountId);
  if (replacement === null) return null;

  if (body.trim() === '') {
    return replaceRange(0, body.length, replacement);
  }
  return replaceRange(lineStart, cursor, replacement);
}
