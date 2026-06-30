import { useMemo, useState } from 'react';
import { CalendarDays, FolderPlus, Pencil, RefreshCw, Trash2, Users, UserPlus } from 'lucide-react';
import { useAppStore } from '../../../stores/AppStore';
import { emitToast } from '../../../lib/toastBus';

function activeEmailLabel(email?: string): string {
  return email || 'No account selected';
}

export function LabelsTab() {
  const store = useAppStore();
  const [newLabelName, setNewLabelName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const userLabels = store.labelDefinitions.filter(label => label.type !== 'system');
  const systemLabels = store.labelDefinitions.filter(label => label.type === 'system');
  const activeEmail = store.activeAccount && store.activeAccount.id !== 'unified'
    ? store.activeAccount.email
    : store.accounts[0]?.email;

  const create = async () => {
    if (!newLabelName.trim()) return;
    try {
      await store.createLabel(newLabelName);
      setNewLabelName('');
      emitToast({ type: 'success', message: 'Label created.' });
    } catch (err) {
      console.error('Label create failed:', err);
      emitToast({ type: 'error', message: 'Could not create Gmail label.' });
    }
  };

  const saveEdit = async () => {
    if (!editingId || !editingName.trim()) return;
    try {
      await store.updateLabel(editingId, { name: editingName.trim() });
      setEditingId(null);
      setEditingName('');
      emitToast({ type: 'success', message: 'Label renamed.' });
    } catch (err) {
      console.error('Label rename failed:', err);
      emitToast({ type: 'error', message: 'Could not rename Gmail label.' });
    }
  };

  return (
    <div className="flex max-w-[720px] flex-col gap-4 select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Labels & Folders</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Gmail labels are shown as folders. Use Parent/Child names for nested folders.</p>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--rail-bg)] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{activeEmailLabel(activeEmail)}</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Synced from Gmail labels API.</span>
          </div>
          <button
            type="button"
            onClick={() => void store.syncLabels()}
            className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--strong-border)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Sync
          </button>
        </div>

        <div className="flex gap-2">
          <input
            value={newLabelName}
            onChange={(event) => setNewLabelName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
            placeholder="e.g. Clients/Acme"
            className="flex-1 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
          />
          <button
            type="button"
            onClick={() => void create()}
            className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-white"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Create
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {userLabels.length === 0 ? (
            <span className="text-[calc(11px*var(--font-scale))] italic text-[var(--text-secondary)]">No custom labels cached yet.</span>
          ) : userLabels.map(label => (
            <div key={label.id} className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
              {editingId === label.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveEdit();
                    if (event.key === 'Escape') setEditingId(null);
                  }}
                  className="min-w-0 flex-1 bg-transparent text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                />
              ) : (
                <span className="min-w-0 truncate text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{label.name}</span>
              )}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title={editingId === label.id ? 'Save label name' : 'Rename label'}
                  onClick={() => {
                    if (editingId === label.id) void saveEdit();
                    else {
                      setEditingId(label.id);
                      setEditingName(label.name);
                    }
                  }}
                  className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Delete label"
                  onClick={() => {
                    emitToast({
                      type: 'warning',
                      message: `Delete ${label.name}?`,
                      actionLabel: 'Delete',
                      onAction: () => void store.deleteLabel(label.id),
                      duration: 6000,
                    });
                  }}
                  className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--danger)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {systemLabels.length > 0 && (
          <div className="border-t border-[var(--border)] pt-3">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold uppercase text-[var(--text-secondary)]">System labels</span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {systemLabels.map(label => (
                <span key={label.id} className="rounded-md border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                  {label.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ContactsTab() {
  const store = useAppStore();
  const [query, setQuery] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const activeEmail = store.activeAccount && store.activeAccount.id !== 'unified'
    ? store.activeAccount.email
    : store.accounts[0]?.email;
  const enabled = store.googleIntegrationStatus?.contactsEnabled === true;
  const filteredContacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return store.contacts.slice(0, 200);
    return store.contacts.filter(contact => [
      contact.displayName,
      contact.email,
      contact.phoneNumbers.join(' '),
      contact.organizations.join(' '),
      contact.notes || ''
    ].join(' ').toLowerCase().includes(needle)).slice(0, 200);
  }, [query, store.contacts]);

  return (
    <div className="flex max-w-[760px] flex-col gap-4 select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Address Book</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Sync Google Contacts, keep local notes, and prepare mailing groups.</p>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--rail-bg)] p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
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

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search contacts"
          className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
        />

        <div className="grid grid-cols-[1fr_220px] gap-3">
          <div className="max-h-[420px] overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--panel-bg)]">
            {filteredContacts.length === 0 ? (
              <div className="p-4 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">No contacts cached.</div>
            ) : filteredContacts.map(contact => (
              <div key={contact.id} className="flex items-start gap-2 border-b border-[var(--border)] px-3 py-2 last:border-b-0">
                {contact.photoUrl ? (
                  <img src={contact.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-[calc(11px*var(--font-scale))] font-bold text-white">
                    {(contact.displayName || contact.email).slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{contact.displayName}</div>
                  <div className="truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{contact.email}</div>
                  {contact.organizations.length > 0 && (
                    <div className="truncate text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">{contact.organizations[0]}</div>
                  )}
                  <input
                    value={contact.notes || ''}
                    onChange={(event) => void store.updateContactLocal(contact.id, { notes: event.target.value })}
                    placeholder="Local note"
                    className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold uppercase text-[var(--text-secondary)]">Groups</span>
            <div className="flex gap-1.5">
              <input
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void store.saveContactGroup(newGroupName);
                    setNewGroupName('');
                  }
                }}
                placeholder="New group"
                className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              />
              <button
                type="button"
                title="Create group"
                onClick={() => {
                  void store.saveContactGroup(newGroupName);
                  setNewGroupName('');
                }}
                className="rounded border border-[var(--border)] p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <UserPlus className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {store.contactGroups.map(group => (
                <div key={group.id} className="flex items-center justify-between rounded bg-[var(--app-bg)] px-2 py-1 text-[calc(10px*var(--font-scale))]">
                  <span className="truncate text-[var(--text-primary)]">{group.name}</span>
                  <button
                    type="button"
                    title="Delete group"
                    onClick={() => void store.deleteContactGroup(group.id)}
                    className="rounded p-1 text-[var(--text-secondary)] hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CalendarSettingsTab() {
  const store = useAppStore();
  const activeEmail = store.activeAccount && store.activeAccount.id !== 'unified'
    ? store.activeAccount.email
    : store.accounts[0]?.email;
  const enabled = store.googleIntegrationStatus?.calendarEnabled === true;

  return (
    <div className="flex max-w-[680px] flex-col gap-4 select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Calendar & Scheduling</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Enable Calendar scope, sync agenda, and configure one-click call links.</p>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--rail-bg)] p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{enabled ? 'Calendar enabled' : 'Calendar not enabled'}</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">{activeEmailLabel(activeEmail)}</span>
          </div>
          <div className="flex items-center gap-2">
            {!enabled && (
              <button
                type="button"
                onClick={() => void store.authorizeGoogleIntegration('calendar')}
                className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-white"
              >
                <CalendarDays className="h-3.5 w-3.5" />
                Enable Calendar
              </button>
            )}
            <button
              type="button"
              onClick={() => void store.syncCalendarAgenda()}
              disabled={!enabled}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--strong-border)] disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sync Agenda
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Calendly URL</span>
            <input
              value={store.settings.calendar.calendlyUrl}
              onChange={(event) => {
                const value = event.target.value;
                store.updateSettings(s => { s.calendar.calendlyUrl = value; });
              }}
              placeholder="https://calendly.com/you"
              className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Cal.com URL</span>
            <input
              value={store.settings.calendar.calComUrl}
              onChange={(event) => {
                const value = event.target.value;
                store.updateSettings(s => { s.calendar.calComUrl = value; });
              }}
              placeholder="https://cal.com/you"
              className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Default duration</span>
            <input
              type="number"
              min={15}
              max={180}
              value={store.settings.calendar.defaultMeetingDurationMinutes}
              onChange={(event) => {
                const value = Math.max(15, Math.min(180, Number(event.target.value) || 30));
                store.updateSettings(s => { s.calendar.defaultMeetingDurationMinutes = value; });
              }}
              className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Default link</span>
            <select
              value={store.settings.calendar.defaultConferenceProvider}
              onChange={(event) => {
                const value = event.target.value as any;
                store.updateSettings(s => { s.calendar.defaultConferenceProvider = value; });
              }}
              className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            >
              <option value="googleMeet">Google Meet</option>
              <option value="calendly">Calendly</option>
              <option value="calCom">Cal.com</option>
              <option value="none">None</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
