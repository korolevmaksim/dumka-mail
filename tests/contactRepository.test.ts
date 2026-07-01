import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ContactCard } from '../shared/types';

const require = createRequire(import.meta.url);

function canLoadNativeSqlite(): boolean {
  try {
    const Database = require('better-sqlite3') as {
      new (filename: string): { close: () => void };
    };
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const repositoryIt = canLoadNativeSqlite() ? it : it.skip;

function syncedContact(partial: Partial<ContactCard> = {}): ContactCard {
  return {
    id: partial.id || 'ada',
    accountId: partial.accountId || 'me@example.com',
    resourceName: partial.resourceName || 'people/ada',
    etag: partial.etag || 'etag-1',
    displayName: partial.displayName || 'Google Ada',
    email: partial.email || 'ada@example.com',
    photoUrl: partial.photoUrl || null,
    phoneNumbers: partial.phoneNumbers || [],
    organizations: partial.organizations || [],
    notes: partial.notes || null,
    groupIds: partial.groupIds || [],
    updatedAt: partial.updatedAt || '2026-07-01T00:00:00.000Z',
  };
}

async function withIsolatedDatabase<T>(
  run: (databaseModule: typeof import('../main/database')) => Promise<T> | T,
): Promise<T> {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-contact-repo-'));
  let databaseModule: typeof import('../main/database') | null = null;

  vi.resetModules();
  process.env.HOME = home;

  try {
    databaseModule = await import('../main/database');
    return await run(databaseModule);
  } finally {
    if (databaseModule) {
      databaseModule.getDatabase().close();
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  }
}

describe('contact repository', () => {
  repositoryIt('preserves local contact edits across Google Contacts sync refreshes', async () => {
    await withIsolatedDatabase(async ({ ContactGroupsRepo, ContactsRepo, EmailSuggestionsRepo }) => {
      const accountId = 'me@example.com';

      ContactGroupsRepo.save({
        id: 'g1',
        accountId,
        name: 'Core Team',
        memberCount: 1,
        updatedAt: '2026-07-01T00:00:00.000Z',
      });

      ContactsRepo.saveMany([syncedContact({ accountId })]);
      ContactsRepo.updateLocal(accountId, 'ada', {
        displayName: 'Ada Local',
        notes: 'Met at the planning review',
        phoneNumbers: ['+44 20 7946 0958'],
        organizations: ['Local Advisory Board'],
        groupIds: ['g1'],
      });

      ContactsRepo.saveMany([
        syncedContact({
          accountId,
          displayName: 'Google Ada Updated',
          etag: 'etag-2',
          phoneNumbers: ['+1 555 0101'],
          organizations: ['Analytical Engine'],
          groupIds: [],
          updatedAt: '2026-07-02T00:00:00.000Z',
        }),
      ]);

      const [contact] = ContactsRepo.list(accountId);
      expect(contact).toMatchObject({
        displayName: 'Ada Local',
        notes: 'Met at the planning review',
        phoneNumbers: ['+44 20 7946 0958'],
        organizations: ['Local Advisory Board'],
        groupIds: ['g1'],
      });

      const suggestions = EmailSuggestionsRepo.list(accountId);
      const contactSuggestion = suggestions.find(item => item.kind === 'contact' && item.email === 'ada@example.com');
      const groupSuggestion = suggestions.find(item => item.kind === 'group' && item.groupId === 'g1');

      expect(contactSuggestion?.name).toBe('Ada Local');
      expect(groupSuggestion?.members).toEqual([{ name: 'Ada Local', email: 'ada@example.com' }]);
    });
  });
});
