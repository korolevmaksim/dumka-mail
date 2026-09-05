import { parseSearchQuery, type ParsedSearchQuery } from './search';
import type { SavedMailSearch } from './productivity';

function quoted(value: string): string { return `"${value.replace(/"/g, '""')}"`; }
export function serializeSearchQuery(parsed: ParsedSearchQuery): string {
  return [
    parsed.from ? `from:${quoted(parsed.from)}` : '',
    parsed.domain ? `domain:${quoted(parsed.domain)}` : '',
    parsed.hasAttachment === undefined ? '' : `has:${parsed.hasAttachment ? 'attachment' : 'noattachment'}`,
    parsed.isUnread === undefined ? '' : `is:${parsed.isUnread ? 'unread' : 'read'}`,
    parsed.label ? `label:${quoted(parsed.label)}` : '',
    parsed.inSplit ? `in:${quoted(parsed.inSplit)}` : '',
    parsed.after ? `after:${parsed.after}` : '', parsed.before ? `before:${parsed.before}` : '',
    ...parsed.textTerms.map(quoted),
  ].filter(Boolean).join(' ');
}
export function updateSearchFilters(query: string, patch: Partial<ParsedSearchQuery>): string {
  return serializeSearchQuery({ ...parseSearchQuery(query), ...patch });
}
export function resolveSavedSearch(saved: SavedMailSearch, now = new Date()): string {
  if (saved.period === 'fixed') return saved.query;
  const date = new Date(now);
  date.setDate(date.getDate() - 30);
  const after = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return updateSearchFilters(saved.query, { after, before: undefined });
}
