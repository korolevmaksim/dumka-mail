import type { ProfileSettings } from './types';

function firstName(fullName: string): string {
  const parts = fullName.split(/\s+/).filter((part) => part.length > 0);
  return parts.length > 0 ? parts[0] : fullName;
}

function replaceAllLiteral(input: string, search: string, replacement: string): string {
  return input.split(search).join(replacement);
}

function escapeHtmlValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tokenValues(profile: ProfileSettings): Record<string, string> {
  return {
    '{full_name}': profile.fullName,
    '{first_name}': firstName(profile.fullName),
    '{role}': profile.role,
    '{company}': profile.company,
  };
}

export function renderTokens(template: string, profile: ProfileSettings): string {
  let result = template;
  for (const [token, value] of Object.entries(tokenValues(profile))) {
    result = replaceAllLiteral(result, token, value);
  }
  return result;
}

export function renderTokensForHtml(template: string, profile: ProfileSettings): string {
  let result = template;
  for (const [token, value] of Object.entries(tokenValues(profile))) {
    result = replaceAllLiteral(result, token, escapeHtmlValue(value));
  }
  return result;
}
