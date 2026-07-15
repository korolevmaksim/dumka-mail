import type { ContactCard, ContactGroup } from '../shared/types';
import { fetchWithTimeout, getAccessToken } from './gmail';

function googleContactsError(prefix: string, responseText: string): Error {
  return new Error(`${prefix}: ${responseText}`);
}

interface GoogleContactPerson {
  resourceName?: string;
  etag?: string;
  emailAddresses?: Array<{ value?: string }>;
  names?: Array<{ displayName?: string }>;
  photos?: Array<{ url?: string }>;
  phoneNumbers?: Array<{ value?: string }>;
  organizations?: Array<{ title?: string; name?: string }>;
  biographies?: Array<{ value?: string }>;
  memberships?: Array<{ contactGroupMembership?: { contactGroupResourceName?: string } }>;
}

interface GoogleContactGroup {
  resourceName?: string;
  name?: string;
  formattedName?: string;
  memberCount?: number;
}

function presentStrings(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function mapContact(person: GoogleContactPerson, accountId: string): ContactCard | null {
  const email = person.emailAddresses?.find(entry => entry.value)?.value;
  if (!email) return null;
  const displayName = person.names?.find(entry => entry.displayName)?.displayName || email;
  const phoneNumbers = presentStrings((person.phoneNumbers || []).map(entry => entry.value));
  const organizations = (person.organizations || [])
    .map(entry => presentStrings([entry.title, entry.name]).join(' · '))
    .filter(Boolean);
  const groupIds = presentStrings((person.memberships || [])
    .map(entry => entry.contactGroupMembership?.contactGroupResourceName));

  return {
    id: person.resourceName || email,
    accountId,
    resourceName: person.resourceName || null,
    etag: person.etag || null,
    displayName,
    email,
    photoUrl: person.photos?.find(entry => entry.url)?.url || null,
    phoneNumbers,
    organizations,
    notes: person.biographies?.find(entry => entry.value)?.value || null,
    groupIds,
    updatedAt: new Date().toISOString(),
  };
}

export const GoogleContactsService = {
  async listContacts(email: string): Promise<{ contacts: ContactCard[]; groups: ContactGroup[] }> {
    const accessToken = await getAccessToken(email);
    const contacts: ContactCard[] = [];
    let pageToken = '';

    do {
      const params = new URLSearchParams({
        personFields: 'names,emailAddresses,photos,phoneNumbers,organizations,biographies,memberships',
        pageSize: '500',
        sortOrder: 'FIRST_NAME_ASCENDING',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const response = await fetchWithTimeout(`https://people.googleapis.com/v1/people/me/connections?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (!response.ok) throw googleContactsError('Google Contacts fetch error', await response.text());
      const data = await response.json() as { connections?: GoogleContactPerson[]; nextPageToken?: string };
      for (const person of data.connections || []) {
        const contact = mapContact(person, email);
        if (contact) contacts.push(contact);
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);

    const groupsResponse = await fetchWithTimeout('https://people.googleapis.com/v1/contactGroups?pageSize=200', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!groupsResponse.ok) throw googleContactsError('Google Contact groups fetch error', await groupsResponse.text());
    const groupsData = await groupsResponse.json() as { contactGroups?: GoogleContactGroup[] };
    const groups: ContactGroup[] = (groupsData.contactGroups || [])
      .filter((group): group is GoogleContactGroup & { resourceName: string } => Boolean(group.resourceName))
      .map(group => ({
      id: group.resourceName,
      accountId: email,
      name: group.name || group.formattedName || group.resourceName,
      memberCount: Number(group.memberCount || 0),
      updatedAt: new Date().toISOString(),
      }));

    return { contacts, groups };
  },
};
