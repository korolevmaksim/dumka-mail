import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronRight, Folder, FolderPlus, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useAppStore } from '../../../stores/AppStore';
import { emitToast } from '../../../lib/toastBus';
import {
  buildLabelTree,
  composeNestedLabelName,
  flattenLabelTree,
  isDescendantLabel,
  labelDefinitionsForAccount,
  labelLeafName,
  labelParentName,
} from '../../../../../shared/labels';

function activeEmailLabel(email?: string): string {
  return email || 'No account selected';
}

export function LabelsTab() {
  const store = useAppStore();
  const preferredLabelEmail = store.activeAccount && store.activeAccount.id !== 'unified'
    ? store.activeAccount.email
    : store.accounts[0]?.email || '';
  const [selectedLabelEmail, setSelectedLabelEmail] = useState(preferredLabelEmail);
  const [newLabelName, setNewLabelName] = useState('');
  const [newParentName, setNewParentName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingParentName, setEditingParentName] = useState('');
  const [labelsSyncing, setLabelsSyncing] = useState(false);
  const accountLabels = useMemo(
    () => labelDefinitionsForAccount(store.labelDefinitions, selectedLabelEmail),
    [selectedLabelEmail, store.labelDefinitions],
  );
  const userLabels = accountLabels.filter(label => label.type !== 'system');
  const systemLabels = accountLabels.filter(label => label.type === 'system');
  const labelTree = useMemo(() => buildLabelTree(userLabels), [userLabels]);
  const flattenedLabels = useMemo(() => flattenLabelTree(labelTree), [labelTree]);
  const selectedAccount = store.accounts.find(account => account.email === selectedLabelEmail) || null;
  const parentOptions = useMemo(() => {
    const editingLabel = editingId ? userLabels.find(label => label.id === editingId) : null;
    return flattenedLabels
      .filter(node => !editingLabel || (node.label?.id !== editingId && !isDescendantLabel(node.fullName, editingLabel.name)))
      .map(node => node.fullName);
  }, [editingId, flattenedLabels, userLabels]);

  useEffect(() => {
    if (!selectedLabelEmail && preferredLabelEmail) {
      setSelectedLabelEmail(preferredLabelEmail);
      return;
    }

    if (
      selectedLabelEmail
      && store.accounts.length > 0
      && !store.accounts.some(account => account.email === selectedLabelEmail)
    ) {
      setSelectedLabelEmail(preferredLabelEmail);
    }
  }, [preferredLabelEmail, selectedLabelEmail, store.accounts]);

  useEffect(() => {
    if (!selectedLabelEmail) return;
    void store.loadLabels(selectedLabelEmail).catch(err => {
      console.error('Label cache load failed:', err);
    });
  }, [selectedLabelEmail, store.loadLabels]);

  useEffect(() => {
    setNewParentName('');
    setEditingId(null);
    setEditingName('');
    setEditingParentName('');
  }, [selectedLabelEmail]);

  const create = async () => {
    const labelName = composeNestedLabelName(newParentName, newLabelName);
    if (!selectedLabelEmail || !labelName) return;
    try {
      await store.createLabel(labelName, selectedLabelEmail);
      setNewLabelName('');
      emitToast({ type: 'success', message: 'Label created.' });
    } catch (err) {
      console.error('Label create failed:', err);
      emitToast({ type: 'error', message: 'Could not create Gmail label.' });
    }
  };

  const saveEdit = async () => {
    const labelName = composeNestedLabelName(editingParentName, editingName);
    if (!selectedLabelEmail || !editingId || !labelName) return;
    try {
      await store.updateLabel(editingId, { name: labelName }, selectedLabelEmail);
      setEditingId(null);
      setEditingName('');
      setEditingParentName('');
      emitToast({ type: 'success', message: 'Label renamed.' });
    } catch (err) {
      console.error('Label rename failed:', err);
      emitToast({ type: 'error', message: 'Could not rename Gmail label.' });
    }
  };

  const syncSelectedLabels = async () => {
    if (!selectedLabelEmail || labelsSyncing) return;
    setLabelsSyncing(true);
    try {
      await store.syncLabels(selectedLabelEmail);
      emitToast({ type: 'success', message: `Labels synced for ${selectedLabelEmail}.` });
    } catch (err) {
      console.error('Label sync failed:', err);
      emitToast({ type: 'error', message: `Could not sync labels for ${selectedLabelEmail}.` });
    } finally {
      setLabelsSyncing(false);
    }
  };

  return (
    <div className="flex max-w-[720px] flex-col gap-4 select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Labels & Folders</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Gmail labels are shown as folders. Use Parent/Child names for nested folders.</p>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--rail-bg)] p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{activeEmailLabel(selectedLabelEmail)}</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
              {selectedAccount ? 'Labels are cached separately for this Gmail account.' : 'Choose a Gmail account to manage labels.'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedLabelEmail}
              onChange={(event) => setSelectedLabelEmail(event.target.value)}
              disabled={store.accounts.length === 0}
              title="Gmail account"
              className="max-w-[260px] rounded-md border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            >
              {store.accounts.length === 0 ? (
                <option value="">No accounts</option>
              ) : store.accounts.map(account => (
                <option key={account.email} value={account.email}>{account.email}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void syncSelectedLabels()}
              disabled={!selectedLabelEmail || labelsSyncing}
              className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--strong-border)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${labelsSyncing ? 'animate-spin' : ''}`} />
              {labelsSyncing ? 'Syncing' : 'Sync'}
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <select
            value={newParentName}
            onChange={(event) => setNewParentName(event.target.value)}
            disabled={!selectedLabelEmail}
            title="Parent folder"
            className="max-w-[190px] rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">Top level</option>
            {parentOptions.map(parent => (
              <option key={parent} value={parent}>{parent}</option>
            ))}
          </select>
          <input
            value={newLabelName}
            onChange={(event) => setNewLabelName(event.target.value)}
            disabled={!selectedLabelEmail}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
            placeholder={newParentName ? 'Child folder' : 'e.g. Clients or Clients/Acme'}
            className="flex-1 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={!selectedLabelEmail || !newLabelName.trim()}
            className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Create
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {userLabels.length === 0 ? (
            <span className="text-[calc(11px*var(--font-scale))] italic text-[var(--text-secondary)]">No custom labels cached yet.</span>
          ) : flattenedLabels.map(node => (
            <div
              key={node.fullName}
              className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2"
              style={{ paddingLeft: `${12 + node.depth * 18}px` }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {node.depth > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />}
                <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
                {editingId === node.label?.id ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <select
                      value={editingParentName}
                      onChange={(event) => setEditingParentName(event.target.value)}
                      className="max-w-[150px] rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                    >
                      <option value="">Top level</option>
                      {parentOptions.map(parent => (
                        <option key={parent} value={parent}>{parent}</option>
                      ))}
                    </select>
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveEdit();
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                      className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                    />
                  </div>
                ) : (
                  <span className={`min-w-0 truncate text-[calc(11px*var(--font-scale))] ${node.label ? 'font-medium text-[var(--text-primary)]' : 'font-semibold text-[var(--text-secondary)]'}`}>
                    {node.segment}
                  </span>
                )}
              </div>
              {node.label ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title={editingId === node.label.id ? 'Save label name' : 'Rename label'}
                    onClick={() => {
                      if (!node.label) return;
                      if (editingId === node.label.id) void saveEdit();
                      else {
                        setEditingId(node.label.id);
                        setEditingName(labelLeafName(node.label.name));
                        setEditingParentName(labelParentName(node.label.name));
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
                      if (!node.label) return;
                      emitToast({
                        type: 'warning',
                        message: `Delete ${node.label.name}?`,
                        actionLabel: 'Delete',
                        onAction: () => {
                          if (!selectedLabelEmail) return;
                          void store.deleteLabel(node.label!.id, selectedLabelEmail).catch(err => {
                            console.error('Label delete failed:', err);
                            emitToast({ type: 'error', message: 'Could not delete Gmail label.' });
                          });
                        },
                        duration: 6000,
                      });
                    }}
                    className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <span className="rounded bg-[var(--app-bg)] px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">folder</span>
              )}
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

export function CalendarSettingsTab() {
  const store = useAppStore();
  const activeEmail = store.activeAccount && store.activeAccount.id !== 'unified'
    ? store.activeAccount.email
    : store.accounts[0]?.email;
  const enabled = store.googleIntegrationStatus?.calendarEnabled === true;
  const writableCalendars = store.calendarLists.filter(calendar =>
    calendar.accountId === activeEmail && (calendar.accessRole === 'owner' || calendar.accessRole === 'writer'));

  return (
    <div className="flex max-w-[680px] flex-col gap-4 select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Calendar & Scheduling</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Enable Calendar scope, sync agenda/free-busy data, and configure one-click call links.</p>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--rail-bg)] p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{enabled ? 'Calendar enabled' : 'Calendar not enabled'}</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">{activeEmailLabel(activeEmail)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void store.authorizeGoogleIntegration('calendar')}
              className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-white"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {enabled ? 'Refresh Calendar Access' : 'Enable Calendar'}
            </button>
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

        {writableCalendars.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Default calendar</span>
            <select value={store.settings.calendar.defaultCalendarId} onChange={event => { const value = event.target.value; store.updateSettings(s => { s.calendar.defaultCalendarId = value; }); }} className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none">
              {writableCalendars.map(calendar => <option key={`${calendar.accountId}:${calendar.id}`} value={calendar.id}>{calendar.summary}</option>)}
            </select>
          </label>
        )}

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

        <label className="flex flex-col gap-1">
          <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Secondary display time zone</span>
          <input value={store.settings.calendar.secondaryTimeZone} onChange={event => { const value = event.target.value; store.updateSettings(s => { s.calendar.secondaryTimeZone = value; }); }} placeholder="America/New_York" className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Favorite time zones</span>
            <input value={store.settings.calendar.favoriteTimeZones.join(', ')} onChange={event => { const values = event.target.value.split(',').map(value => value.trim()).filter(Boolean).slice(0, 8); store.updateSettings(s => { s.calendar.favoriteTimeZones = values; }); }} placeholder="Europe/London, Asia/Tokyo" className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Default travel block</span>
            <select value={store.settings.calendar.defaultTravelTimeMinutes} onChange={event => { const value = Number(event.target.value); store.updateSettings(s => { s.calendar.defaultTravelTimeMinutes = value; }); }} className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none">
              <option value={0}>Disabled</option><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>1 hour</option>
            </select>
          </label>
        </div>

        {store.settings.calendar.eventTemplates.length > 0 && (
          <div className="rounded-md border border-[var(--border)] bg-[var(--app-bg)] p-2">
            <div className="mb-1 text-[calc(9px*var(--font-scale))] font-semibold uppercase text-[var(--text-tertiary)]">Event templates</div>
            {store.settings.calendar.eventTemplates.map(template => (
              <div key={template.id} className="flex items-center justify-between gap-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                <span className="truncate">{template.name} · {template.durationMinutes} min</span>
                <button type="button" onClick={() => store.updateSettings(s => { s.calendar.eventTemplates = s.calendar.eventTemplates.filter(item => item.id !== template.id); })} className="text-[var(--danger)]">Delete</button>
              </div>
            ))}
          </div>
        )}

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
                const value = event.target.value as 'googleMeet' | 'calendly' | 'calCom' | 'none';
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

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Default workspace view</span>
            <select
              value={store.settings.calendar.defaultView}
              onChange={(event) => {
                const value = event.target.value as typeof store.settings.calendar.defaultView;
                store.updateSettings(s => { s.calendar.defaultView = value; });
              }}
              className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            >
              <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
              <option value="agenda">Agenda</option><option value="quarter">Quarter</option><option value="year">Year</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Default reminder</span>
            <select
              value={store.settings.calendar.defaultReminderMinutes}
              onChange={(event) => store.updateSettings(s => { s.calendar.defaultReminderMinutes = Number(event.target.value); })}
              className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            >
              <option value={0}>At start time</option><option value={5}>5 minutes</option><option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4 rounded-md border border-[var(--border)] bg-[var(--app-bg)] px-3 py-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
          <label className="flex items-center gap-2"><input type="checkbox" checked={store.settings.calendar.weekStartsOn === 1} onChange={event => store.updateSettings(s => { s.calendar.weekStartsOn = event.target.checked ? 1 : 0; })} className="accent-[var(--accent)]" />Week starts Monday</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={store.settings.calendar.showWeekends} onChange={event => store.updateSettings(s => { s.calendar.showWeekends = event.target.checked; })} className="accent-[var(--accent)]" />Show weekends</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={store.settings.calendar.showAgendaInRightPanel} onChange={event => store.updateSettings(s => { s.calendar.showAgendaInRightPanel = event.target.checked; })} className="accent-[var(--accent)]" />Mail sidebar agenda</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={store.settings.calendar.hideNotificationDetails} onChange={event => store.updateSettings(s => { s.calendar.hideNotificationDetails = event.target.checked; })} className="accent-[var(--accent)]" />Hide event details in notifications</label>
        </div>

        <button type="button" onClick={() => { store.setSettingsOpen(false); store.setWorkspaceView('calendar'); }} className="flex w-fit items-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-2 text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:border-[var(--accent)]">
          <CalendarDays className="h-3.5 w-3.5" />Open Calendar workspace
        </button>

        <div className="grid grid-cols-4 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Lookahead</span>
            <input
              type="number"
              min={1}
              max={14}
              value={store.settings.calendar.availabilityLookaheadDays}
              onChange={(event) => {
                const value = Math.max(1, Math.min(14, Number(event.target.value) || 5));
                store.updateSettings(s => { s.calendar.availabilityLookaheadDays = value; });
              }}
              className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Start</span>
            <input
              type="time"
              value={store.settings.calendar.availabilityStartTime}
              onChange={(event) => {
                const value = event.target.value || '09:00';
                store.updateSettings(s => { s.calendar.availabilityStartTime = value; });
              }}
              className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">End</span>
            <input
              type="time"
              value={store.settings.calendar.availabilityEndTime}
              onChange={(event) => {
                const value = event.target.value || '17:00';
                store.updateSettings(s => { s.calendar.availabilityEndTime = value; });
              }}
              className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Step</span>
            <input
              type="number"
              min={15}
              max={120}
              step={15}
              value={store.settings.calendar.availabilitySlotStepMinutes}
              onChange={(event) => {
                const value = Math.max(15, Math.min(120, Number(event.target.value) || 30));
                store.updateSettings(s => { s.calendar.availabilitySlotStepMinutes = value; });
              }}
              className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
