import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Mail, Pencil, RefreshCw, Trash2, UserPlus, Users } from 'lucide-react';
import type { Recipient } from '../../../../../shared/types';
import { useAppStore } from '../../../stores/AppStore';
import { emitToast } from '../../../lib/toastBus';
import {
  contactGroupMembershipCounts,
  contactInitials,
  contactListFieldToText,
  contactRecipient,
  contactTextToList,
  filterContacts,
  groupRecipients,
  toggledContactGroupIds,
} from '../../../../../shared/contacts';

function activeEmailLabel(email?: string): string {
  return email || 'No account selected';
}

function copyToClipboard(value: string) {
  void navigator.clipboard?.writeText(value);
  emitToast({ type: 'success', message: 'Copied to clipboard.' });
}

export function ContactsTab() {
  const store = useAppStore();
  const [query, setQuery] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [organizationDraft, setOrganizationDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const activeEmail = store.activeAccount && store.activeAccount.id !== 'unified'
    ? store.activeAccount.email
    : store.accounts[0]?.email;
  const enabled = store.googleIntegrationStatus?.contactsEnabled === true;
  const filteredContacts = useMemo(() => filterContacts(store.contacts, query), [query, store.contacts]);
  const selectedContact = filteredContacts.find(contact => contact.id === selectedContactId) || filteredContacts[0] || null;
  const groupMembershipCounts = useMemo(() => contactGroupMembershipCounts(store.contacts), [store.contacts]);
  const contactDirty = Boolean(selectedContact)
    && (
      nameDraft !== selectedContact.displayName
      || phoneDraft !== contactListFieldToText(selectedContact.phoneNumbers)
      || organizationDraft !== contactListFieldToText(selectedContact.organizations)
      || notesDraft !== (selectedContact.notes || '')
    );

  useEffect(() => {
    setNameDraft(selectedContact?.displayName || '');
    setPhoneDraft(contactListFieldToText(selectedContact?.phoneNumbers || []));
    setOrganizationDraft(contactListFieldToText(selectedContact?.organizations || []));
    setNotesDraft(selectedContact?.notes || '');
  }, [selectedContact?.id]);

  function startDraft(recipients: Recipient[]) {
    if (recipients.length === 0) return;
    const draft = store.startNewDraft(activeEmail, { to: recipients });
    if (!draft) {
      emitToast({ type: 'error', message: 'Connect an account before composing.' });
      return;
    }
    emitToast({ type: 'success', message: recipients.length === 1 ? 'Draft opened for contact.' : `Draft opened for ${recipients.length} contacts.` });
  }

  async function saveContactDraft() {
    if (!selectedContact || !contactDirty) return;
    await store.updateContactLocal(selectedContact.id, {
      displayName: nameDraft.trim() || selectedContact.email,
      phoneNumbers: contactTextToList(phoneDraft),
      organizations: contactTextToList(organizationDraft),
      notes: notesDraft,
    });
    emitToast({ type: 'success', message: 'Contact saved.' });
  }

  function toggleContactGroup(contactId: string, currentGroupIds: string[], groupId: string) {
    void store.updateContactLocal(contactId, { groupIds: toggledContactGroupIds(currentGroupIds, groupId) });
  }

  function createGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    void store.saveContactGroup(name);
    setNewGroupName('');
  }

  function startRenameGroup(groupId: string, name: string) {
    setEditingGroupId(groupId);
    setEditingGroupName(name);
  }

  function cancelRenameGroup() {
    setEditingGroupId(null);
    setEditingGroupName('');
  }

  async function saveGroupName() {
    const name = editingGroupName.trim();
    if (!editingGroupId || !name) return;
    await store.renameContactGroup(editingGroupId, name);
    cancelRenameGroup();
    emitToast({ type: 'success', message: 'Group renamed.' });
  }

  return (
    <div className="flex max-w-[1040px] flex-col gap-4 select-text">
      <div>
        <h2 className="mb-1 text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Address Book</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Sync Google Contacts, keep local notes, and prepare mailing groups.</p>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--rail-bg)] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{enabled ? 'Contacts enabled' : 'Contacts not enabled'}</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">{activeEmailLabel(activeEmail)}</span>
          </div>
          <div className="flex items-center gap-2">
            {!enabled && (
              <button
                type="button"
                onClick={() => void store.authorizeGoogleIntegration('contacts')}
                className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-white"
              >
                <Users className="h-3.5 w-3.5" />
                Enable Contacts
              </button>
            )}
            <button
              type="button"
              onClick={() => void store.syncContacts()}
              disabled={!enabled}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--strong-border)] disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sync
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[280px_minmax(0,1fr)_220px] gap-3">
          <div className="flex min-h-[460px] flex-col rounded-md border border-[var(--border)] bg-[var(--panel-bg)]">
            <div className="border-b border-[var(--border)] p-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search contacts"
                className="w-full rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredContacts.length === 0 ? (
                <div className="p-4 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">No contacts cached.</div>
              ) : filteredContacts.map(contact => {
                const selected = selectedContact?.id === contact.id;
                return (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => {
                      void saveContactDraft();
                      setSelectedContactId(contact.id);
                    }}
                    className={`flex w-full items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-left last:border-b-0 ${
                      selected ? 'bg-[var(--selected-row)]' : 'hover:bg-[var(--hover-row)]'
                    }`}
                  >
                    {contact.photoUrl ? (
                      <img src={contact.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[calc(11px*var(--font-scale))] font-bold text-white">
                        {contactInitials(contact)}
                      </div>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{contact.displayName || contact.email}</span>
                      <span className="block truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{contact.email}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-[460px] rounded-md border border-[var(--border)] bg-[var(--panel-bg)] p-4">
            {!selectedContact ? (
              <div className="flex h-full items-center justify-center text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Select a contact.</div>
            ) : (
              <div className="flex h-full flex-col gap-4">
                <div className="flex items-start gap-3">
                  {selectedContact.photoUrl ? (
                    <img src={selectedContact.photoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[calc(14px*var(--font-scale))] font-bold text-white">
                      {contactInitials(selectedContact)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <input
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      onBlur={() => void saveContactDraft()}
                      aria-label={`Display name for ${selectedContact.email}`}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[calc(15px*var(--font-scale))] font-semibold text-[var(--text-primary)] outline-none hover:border-[var(--border)] focus:border-[var(--accent)] focus:bg-[var(--app-bg)]"
                    />
                    <div className="mt-1 flex min-w-0 items-center gap-2">
                      <span className="truncate text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">{selectedContact.email}</span>
                      <button
                        type="button"
                        title="Copy email"
                        onClick={() => copyToClipboard(selectedContact.email)}
                        className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title="Compose email"
                        onClick={() => startDraft([contactRecipient(selectedContact)])}
                        className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--hover-row)] hover:text-[var(--accent)]"
                      >
                        <Mail className="h-3 w-3" />
                      </button>
                      {contactDirty && (
                        <button
                          type="button"
                          title="Save contact"
                          onClick={() => void saveContactDraft()}
                          className="rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--hover-row)] hover:text-[var(--accent)]"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[calc(10px*var(--font-scale))] font-semibold uppercase text-[var(--text-secondary)]">Phones</span>
                    <textarea
                      value={phoneDraft}
                      onChange={(event) => setPhoneDraft(event.target.value)}
                      onBlur={() => void saveContactDraft()}
                      placeholder="Phone numbers"
                      rows={3}
                      className="min-h-[76px] resize-none rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[calc(10px*var(--font-scale))] font-semibold uppercase text-[var(--text-secondary)]">Work</span>
                    <textarea
                      value={organizationDraft}
                      onChange={(event) => setOrganizationDraft(event.target.value)}
                      onBlur={() => void saveContactDraft()}
                      placeholder="Company / role"
                      rows={3}
                      className="min-h-[76px] resize-none rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                    />
                  </label>
                </div>

                <label className="flex min-h-0 flex-1 flex-col gap-1">
                  <span className="text-[calc(10px*var(--font-scale))] font-semibold uppercase text-[var(--text-secondary)]">Local notes</span>
                  <textarea
                    value={notesDraft}
                    onChange={(event) => setNotesDraft(event.target.value)}
                    onBlur={() => void saveContactDraft()}
                    placeholder="Relationship context, preferences, follow-up notes"
                    className="min-h-[110px] flex-1 resize-none rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-2 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </label>

                <div>
                  <span className="text-[calc(10px*var(--font-scale))] font-semibold uppercase text-[var(--text-secondary)]">Groups</span>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {store.contactGroups.length === 0 ? (
                      <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">Create a group to build mailing lists.</span>
                    ) : store.contactGroups.map(group => {
                      const selected = selectedContact.groupIds.includes(group.id);
                      return (
                        <button
                          key={group.id}
                          type="button"
                          title={`${selected ? 'Remove from' : 'Add to'} ${group.name}`}
                          onClick={() => toggleContactGroup(selectedContact.id, selectedContact.groupIds, group.id)}
                          className={`max-w-[180px] truncate rounded border px-2 py-1 text-[calc(10px*var(--font-scale))] ${
                            selected
                              ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                              : 'border-[var(--border)] bg-[var(--raised-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {group.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex min-h-[460px] flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold uppercase text-[var(--text-secondary)]">Mailing Groups</span>
            <div className="flex gap-1.5">
              <input
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') createGroup();
                }}
                placeholder="New group"
                className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              />
              <button
                type="button"
                title="Create group"
                onClick={createGroup}
                className="rounded border border-[var(--border)] p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <UserPlus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {store.contactGroups.length === 0 ? (
                <div className="rounded border border-dashed border-[var(--border)] px-3 py-4 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                  No groups yet.
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {store.contactGroups.map(group => (
                    <div key={group.id} className="flex items-center justify-between gap-1 rounded bg-[var(--app-bg)] px-2 py-1 text-[calc(10px*var(--font-scale))]">
                      {editingGroupId === group.id ? (
                        <input
                          autoFocus
                          value={editingGroupName}
                          onChange={(event) => setEditingGroupName(event.target.value)}
                          onBlur={() => void saveGroupName()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveGroupName();
                            if (event.key === 'Escape') cancelRenameGroup();
                          }}
                          className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--panel-bg)] px-1.5 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                        />
                      ) : (
                        <span className="truncate text-[var(--text-primary)]" title={group.name}>
                          {group.name}
                          <span className="ml-1 text-[var(--text-tertiary)]">{groupMembershipCounts.get(group.id) ?? group.memberCount}</span>
                        </span>
                      )}
                      <span className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          title="Rename group"
                          onClick={() => startRenameGroup(group.id, group.name)}
                          className="rounded p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title="Compose to group"
                          onClick={() => startDraft(groupRecipients(store.contacts, group.id))}
                          disabled={(groupMembershipCounts.get(group.id) ?? group.memberCount) === 0}
                          className="rounded p-1 text-[var(--text-secondary)] hover:text-[var(--accent)] disabled:opacity-40"
                        >
                          <Mail className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title="Delete group"
                          onClick={() => void store.deleteContactGroup(group.id)}
                          className="rounded p-1 text-[var(--text-secondary)] hover:text-[var(--danger)]"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
