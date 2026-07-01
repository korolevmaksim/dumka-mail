import { describe, expect, it } from 'vitest';
import {
  contactGroupMembershipCounts,
  contactInitials,
  contactRecipient,
  filterContacts,
  groupRecipients,
  toggledContactGroupIds,
} from '../shared/contacts';
import type { ContactCard } from '../shared/types';

function contact(partial: Partial<ContactCard>): ContactCard {
  return {
    id: partial.id || partial.email || 'contact',
    accountId: 'me@example.com',
    displayName: partial.displayName || '',
    email: partial.email || 'contact@example.com',
    photoUrl: null,
    phoneNumbers: partial.phoneNumbers || [],
    organizations: partial.organizations || [],
    notes: partial.notes || null,
    groupIds: partial.groupIds || [],
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('contact helpers', () => {
  it('builds stable initials from display name or email', () => {
    expect(contactInitials(contact({ displayName: 'Ada Lovelace' }))).toBe('AL');
    expect(contactInitials(contact({ displayName: '', email: 'team@example.com' }))).toBe('TE');
  });

  it('filters contacts across email, phone, organization and notes', () => {
    const contacts = [
      contact({ displayName: 'Ada Lovelace', email: 'ada@example.com', organizations: ['Research'] }),
      contact({ displayName: 'Grace Hopper', email: 'grace@example.com', phoneNumbers: ['+1 555 0101'], notes: 'Compiler pioneer' }),
    ];

    expect(filterContacts(contacts, 'research').map(item => item.email)).toEqual(['ada@example.com']);
    expect(filterContacts(contacts, '0101').map(item => item.email)).toEqual(['grace@example.com']);
    expect(filterContacts(contacts, 'compiler').map(item => item.email)).toEqual(['grace@example.com']);
  });

  it('counts mailing group memberships', () => {
    const counts = contactGroupMembershipCounts([
      contact({ groupIds: ['g1', 'g2'] }),
      contact({ groupIds: ['g1'] }),
    ]);

    expect(counts.get('g1')).toBe(2);
    expect(counts.get('g2')).toBe(1);
  });

  it('toggles group membership without mutating the source array', () => {
    const source = ['g1'];

    expect(toggledContactGroupIds(source, 'g2')).toEqual(['g1', 'g2']);
    expect(toggledContactGroupIds(source, 'g1')).toEqual([]);
    expect(source).toEqual(['g1']);
  });

  it('maps contacts and local mailing groups into compose recipients', () => {
    const ada = contact({ displayName: 'Ada Lovelace', email: 'ada@example.com', groupIds: ['g1'] });
    const grace = contact({ displayName: 'Grace Hopper', email: 'grace@example.com', groupIds: ['g2'] });

    expect(contactRecipient(ada)).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(groupRecipients([ada, grace], 'g1')).toEqual([{ name: 'Ada Lovelace', email: 'ada@example.com' }]);
  });
});
