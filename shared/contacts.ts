import type { ContactCard, Recipient } from './types';

export function contactInitials(contact: Pick<ContactCard, 'displayName' | 'email'>): string {
  const source = (contact.displayName || contact.email || '?').trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function contactSearchText(contact: ContactCard): string {
  return [
    contact.displayName,
    contact.email,
    contact.phoneNumbers.join(' '),
    contact.organizations.join(' '),
    contact.notes || '',
  ].join(' ').toLowerCase();
}

export function filterContacts(contacts: ContactCard[], query: string, limit = 200): ContactCard[] {
  const needle = query.trim().toLowerCase();
  const source = needle
    ? contacts.filter(contact => contactSearchText(contact).includes(needle))
    : contacts;
  return source.slice(0, limit);
}

export function contactGroupMembershipCounts(contacts: ContactCard[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const contact of contacts) {
    for (const groupId of contact.groupIds) {
      counts.set(groupId, (counts.get(groupId) || 0) + 1);
    }
  }
  return counts;
}

export function toggledContactGroupIds(currentGroupIds: string[], groupId: string): string[] {
  return currentGroupIds.includes(groupId)
    ? currentGroupIds.filter(id => id !== groupId)
    : [...currentGroupIds, groupId];
}

export function contactListFieldToText(values: string[]): string {
  return values.join('\n');
}

export function contactTextToList(value: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of value.split(/\r?\n/)) {
    const item = rawLine.trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function contactRecipient(contact: Pick<ContactCard, 'displayName' | 'email'>): Recipient {
  return {
    name: contact.displayName.trim(),
    email: contact.email.trim(),
  };
}

export function groupRecipients(contacts: ContactCard[], groupId: string): Recipient[] {
  return contacts
    .filter(contact => contact.groupIds.includes(groupId))
    .map(contactRecipient)
    .filter(recipient => recipient.email.length > 0);
}
