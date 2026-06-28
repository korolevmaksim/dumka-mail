import { useAppStore } from '../../../stores/AppStore';
import { Plus } from 'lucide-react';
import { SettingsAccountAvatar } from '../../AccountAvatar';
import { Toggle } from '../SettingsControls';
import { emitToast } from '../../../lib/toastBus';

export function AccountsTab() {
  const store = useAppStore();

  return (
    <div className="flex flex-col gap-5 max-w-[600px] select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Accounts & Credentials</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Manage connected email accounts and remote credentials.</p>
      </div>
      
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Gmail Accounts</span>
        <div className="flex flex-col gap-2">
          {store.accounts.length === 0 ? (
            <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] italic">No accounts onboarded.</span>
          ) : (
            store.accounts.map(acc => (
              <div key={acc.id} className="flex justify-between items-center bg-[var(--panel-bg)] border border-[var(--border)] rounded-md px-3 py-2">
                <div className="flex items-center gap-2">
                  <SettingsAccountAvatar acc={acc} />
                  <div className="flex flex-col">
                    <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{acc.displayName || acc.email}</span>
                    <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">{acc.email}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => store.onboardAccount(acc.email)}
                    className="text-[calc(10px*var(--font-scale))] text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    Reconnect
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      emitToast({
                        type: 'warning',
                        message: `Disconnect ${acc.email}?`,
                        actionLabel: 'Disconnect',
                        onAction: () => store.disconnectAccount(acc.id),
                        duration: 6000,
                      });
                    }}
                    className="text-[calc(10px*var(--font-scale))] text-[var(--danger)] hover:underline cursor-pointer"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <button
          type="button"
          onClick={() => store.onboardAccount('')}
          className="w-full py-1.5 border border-dashed border-[var(--border)] rounded-lg text-[calc(11px*var(--font-scale))] font-medium hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all cursor-pointer bg-[var(--panel-bg)] flex items-center justify-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Onboard Gmail Account
        </button>
      </div>
    </div>
  );
}

export function ProfileTab() {
  const store = useAppStore();

  return (
    <div className="flex flex-col gap-4 max-w-[600px] select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">User Profile</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Personalize templates, AI signatures, and scheduling context.</p>
      </div>
      
      <div className="flex flex-col gap-3.5 bg-[var(--rail-bg)] border border-[var(--border)] rounded-lg p-4">
        <div className="flex flex-col gap-1">
          <label className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Full Name:</label>
          <input
            type="text"
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            value={store.settings.profile.fullName}
            onChange={(e) => {
              const val = e.target.value;
              store.updateSettings(s => { s.profile.fullName = val; });
            }}
          />
        </div>
        
        <div className="flex flex-col gap-1">
          <label className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Professional Role:</label>
          <input
            type="text"
            placeholder="e.g. Lead Software Architect"
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            value={store.settings.profile.role}
            onChange={(e) => {
              const val = e.target.value;
              store.updateSettings(s => { s.profile.role = val; });
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Company / Organization:</label>
          <input
            type="text"
            placeholder="e.g. Google DeepMind"
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            value={store.settings.profile.company}
            onChange={(e) => {
              const val = e.target.value;
              store.updateSettings(s => { s.profile.company = val; });
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Timezone Context:</label>
          <input
            type="text"
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none font-mono"
            value={store.settings.profile.timezone}
            onChange={(e) => {
              const val = e.target.value;
              store.updateSettings(s => { s.profile.timezone = val; });
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function GeneralTab() {
  const store = useAppStore();

  return (
    <div className="flex flex-col gap-4 max-w-[600px]">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">General Preferences</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Configure startup behavior, links, and workspace defaults.</p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Startup Behavior</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Choose screen displayed on application launch</span>
          </div>
          <select
            value={store.settings.general.startupBehavior}
            onChange={(e) => {
              const val = e.target.value as any;
              store.updateSettings(s => { s.general.startupBehavior = val; });
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="inbox">Focus Inbox Split</option>
            <option value="lastSelectedAccount">Last Selected Account</option>
            <option value="commandPalette">Launch Command Palette</option>
          </select>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Default Inbox Split</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Active category category on startup</span>
          </div>
          <select
            value={store.settings.general.defaultSplitInbox}
            onChange={(e) => {
              const val = e.target.value;
              store.updateSettings(s => { s.general.defaultSplitInbox = val; });
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer uppercase"
          >
            {store.tabCategories.map(c => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </select>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        {[
          { key: 'showBottomShortcutBar', title: 'Show Bottom Shortcut Bar', desc: 'Display quick reference labels at bottom' },
          { key: 'showRightContextPanel', title: 'Show Right Context Panel', desc: 'Display diagnostics, health and action ledger sidebar' },
          { key: 'openLinksInBackground', title: 'Open Links in Background', desc: 'Prevent browser focus stealing' },
          { key: 'confirmBeforeQuitting', title: 'Confirm Before Quitting', desc: 'Prompt before closing process' },
          { key: 'keepDraftsAcrossLaunches', title: 'Restore Drafts on Launch', desc: 'Save un-sent composer details locally' },
        ].map(item => (
          <div key={item.key} className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{item.title}</span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{item.desc}</span>
            </div>
            <Toggle
              checked={(store.settings.general as any)[item.key]}
              onChange={(val) => store.updateSettings(s => { (s.general as any)[item.key] = val; })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function InboxTab() {
  const store = useAppStore();

  return (
    <div className="flex flex-col gap-4 max-w-[600px]">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Inbox Settings</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Optimize triage logic, split tabs, follow-ups, and markers.</p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        {[
          { key: 'enableSplitInbox', title: 'Enable Split Inbox Layout', desc: 'Enable multiple system & custom tab categories' },
          { key: 'showUnreadFirst', title: 'Show Unread First', desc: 'Force unread threads to display at top of list' },
          { key: 'autoMarkReadOnOpen', title: 'Auto Mark Read on Open', desc: 'Mark threads read automatically' },
          { key: 'openNextThreadAfterDone', title: 'Open Next Thread After Done', desc: 'Navigate to next available thread on archive' },
          { key: 'archiveOnDoneShortcut', title: 'Archive on E Shortcut', desc: 'Removes Inbox label when pressing E' },
          { key: 'enableReminders', title: 'Enable Reminders', desc: 'Support local snooze and reminder alerts' },
          { key: 'enableFollowUps', title: 'Enable Follow-ups Detection', desc: 'Query sent messages lacking replies' },
          { key: 'showPurchasesSplit', title: 'Include Purchases Split Tab', desc: 'Parse receipt and bill signals' },
          { key: 'showLinkedInSplit', title: 'Include LinkedIn Split Tab', desc: 'Route professional connections separately' },
          { key: 'collapseReadThreads', title: 'Collapse Read Threads', desc: 'Minimize read threads in detail viewer' },
        ].map(item => (
          <div key={item.key} className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{item.title}</span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{item.desc}</span>
            </div>
            <Toggle
              checked={(store.settings.inbox as any)[item.key]}
              onChange={(val) => store.updateSettings(s => { (s.inbox as any)[item.key] = val; })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ComposeTab() {
  const store = useAppStore();

  return (
    <div className="flex flex-col gap-4 max-w-[600px] select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Compose Preferences</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Customize font styles, default signature, drafts, and undo delays.</p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Default Email Signature:</span>
          <textarea
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none min-h-[60px] font-mono leading-normal resize-none"
            value={store.settings.compose.defaultSignature}
            onChange={(e) => {
              const val = e.target.value;
              store.updateSettings(s => { s.compose.defaultSignature = val; });
            }}
            placeholder="e.g. Best regards, Max"
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Composer Font Size</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Default reading/writing size</span>
          </div>
          <select
            value={store.settings.compose.defaultFontSize}
            onChange={(e) => {
              const val = e.target.value as any;
              store.updateSettings(s => { s.compose.defaultFontSize = val; });
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="compact">Compact (11px)</option>
            <option value="normal">Normal (12px)</option>
            <option value="large">Large (14px)</option>
          </select>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Send Undo Window (Seconds)</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Grace delay duration to cancel send action</span>
          </div>
          <input
            type="number"
            min="0"
            max="30"
            className="w-16 bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            value={store.settings.compose.sendUndoDelay}
            onChange={(e) => {
              const val = Math.max(0, Math.min(30, parseInt(e.target.value) || 0));
              store.updateSettings(s => { s.compose.sendUndoDelay = val; });
            }}
          />
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        {[
          { key: 'autoSaveDrafts', title: 'Auto Save Drafts', desc: 'Sync draft changes to SQLite cache asynchronously' },
          { key: 'spellCheck', title: 'Enable Spell Check', desc: 'Perform system native spelling diagnostics' },
          { key: 'autocorrect', title: 'Enable Autocorrect', desc: 'Capitalize and correct text corrections' },
          { key: 'smartCompose', title: 'Enable Smart Compose', desc: 'Query AI autocomplete suggestions inline' },
          { key: 'alwaysReplyAll', title: 'Default to Reply All', desc: 'Preserves CC recipients in thread reply views' },
        ].map(item => (
          <div key={item.key} className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{item.title}</span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{item.desc}</span>
            </div>
            <Toggle
              checked={(store.settings.compose as any)[item.key]}
              onChange={(val) => store.updateSettings(s => { (s.compose as any)[item.key] = val; })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ShortcutsTab() {
  const store = useAppStore();

  return (
    <div className="flex flex-col gap-4 max-w-[600px]">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Keyboard Shortcuts</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Optimize keystrokes and navigation schemes.</p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Preset Mode</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Choose preset keyboard mapping</span>
          </div>
          <select
            value={store.settings.shortcuts.mode}
            onChange={(e) => {
              const val = e.target.value as any;
              store.updateSettings(s => { s.shortcuts.mode = val; });
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="superhuman">Superhuman</option>
            <option value="gmail">Gmail</option>
            <option value="appleMail">Apple Mail</option>
          </select>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        {[
          { key: 'singleKeyShortcuts', title: 'Enable Single-key Navigation Shortcuts', desc: 'Press C to compose, E to archive, R to reply, Z to undo' },
          { key: 'commandPaletteEnabled', title: 'Enable Command Palette (Cmd+K)', desc: 'Access global commands from search modal' },
          { key: 'vimNavigation', title: 'Enable Vim Navigation keys', desc: 'Use J/K to move down/up in mail thread list' },
          { key: 'composeShortcutEnabled', title: 'Enable Compose shortcut', desc: 'C key binding opens composer' },
          { key: 'reminderShortcutEnabled', title: 'Enable Snooze/Reminder shortcut', desc: 'H key binding triggers snooze planner' },
        ].map(item => (
          <div key={item.key} className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{item.title}</span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{item.desc}</span>
            </div>
            <Toggle
              checked={(store.settings.shortcuts as any)[item.key]}
              onChange={(val) => store.updateSettings(s => { (s.shortcuts as any)[item.key] = val; })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SnippetsTab() {
  const store = useAppStore();

  return (
    <div className="flex flex-col gap-4 max-w-[600px] select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Snippet Templates</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Create text snippets that expand automatically when writing.</p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3.5">
        {[
          { key: 'enabled', title: 'Enable Snippet Expansion', desc: 'Enable matching keyword expansions' },
          { key: 'expandWithTab', title: 'Expand using Tab Key', desc: 'Trigger text expansions when pressing Tab' },
          { key: 'includeSignature', title: 'Attach Signature inside Snippet', desc: 'Append profile email signature' },
        ].map(item => (
          <div key={item.key} className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{item.title}</span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{item.desc}</span>
            </div>
            <Toggle
              checked={(store.settings.snippets as any)[item.key]}
              onChange={(val) => store.updateSettings(s => { (s.snippets as any)[item.key] = val; })}
            />
          </div>
        ))}

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex flex-col gap-1">
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Default Snippet Keyword Trigger:</span>
          <input
            type="text"
            placeholder="e.g. ;thanks"
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            value={store.settings.snippets.defaultSnippetTrigger}
            onChange={(e) => {
              const val = e.target.value;
              store.updateSettings(s => { s.snippets.defaultSnippetTrigger = val; });
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Default Expansion Content:</span>
          <textarea
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none min-h-[60px] font-mono resize-none leading-normal"
            value={store.settings.snippets.defaultSnippet}
            onChange={(e) => {
              const val = e.target.value;
              store.updateSettings(s => { s.snippets.defaultSnippet = val; });
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function NotificationsTab() {
  const store = useAppStore();

  return (
    <div className="flex flex-col gap-4 max-w-[600px] select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Mail Notifications</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Tune desktop notifications, alerts, sound triggers, and quiet hours.</p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        {[
          { key: 'desktopNotifications', title: 'Enable Desktop Notifications', desc: 'Display OS system alert cards' },
          { key: 'sound', title: 'Play notification sound', desc: 'Audible chime upon receiving incoming messages' },
          { key: 'notifyImportantOnly', title: 'Notify Important Only', desc: 'Filter alerts for Primary inbox category only' },
          { key: 'reminderNotifications', title: 'Snooze/Reminder notifications', desc: 'Alert when reminder timer triggers' },
          { key: 'quietHoursEnabled', title: 'Enable Quiet Hours', desc: 'Suppress notifications during specified timeframe' },
        ].map(item => (
          <div key={item.key} className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{item.title}</span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{item.desc}</span>
            </div>
            <Toggle
              checked={(store.settings.notifications as any)[item.key]}
              onChange={(val) => store.updateSettings(s => { (s.notifications as any)[item.key] = val; })}
            />
          </div>
        ))}

        {store.settings.notifications.quietHoursEnabled && (
          <>
            <div className="w-full h-[1px] bg-[var(--border)]" />
            <div className="grid grid-cols-2 gap-3.5">
              <div className="flex flex-col gap-1">
                <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Quiet Hours Start:</span>
                <input
                  type="text"
                  placeholder="22:00"
                  className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                  value={store.settings.notifications.quietHoursStart}
                  onChange={(e) => {
                    const val = e.target.value;
                    store.updateSettings(s => { s.notifications.quietHoursStart = val; });
                  }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Quiet Hours End:</span>
                <input
                  type="text"
                  placeholder="08:00"
                  className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                  value={store.settings.notifications.quietHoursEnd}
                  onChange={(e) => {
                    const val = e.target.value;
                    store.updateSettings(s => { s.notifications.quietHoursEnd = val; });
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function PrivacyTab() {
  const store = useAppStore();

  return (
    <div className="flex flex-col gap-4 max-w-[600px]">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Privacy & Security</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Manage log redactions, keychain credentials, local indices, and image loader.</p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        {[
          { key: 'loadRemoteImages', title: 'Load Remote Images', desc: 'Enable fetching external assets in HTML viewer' },
          { key: 'includeBodiesInSearchIndex', title: 'Index Email Message Bodies', desc: 'Perform offline SQL FTS indexing on content text' },
          { key: 'redactLogs', title: 'Redact Logs', desc: 'Omit usernames/tokens in debugging terminal outputs' },
          { key: 'useKeychainForSecrets', title: 'Use System Keychain for Secrets', desc: 'Encrypt oauth tokens and API credentials' },
          { key: 'clearCacheOnDisconnect', title: 'Purge SQLite Cache on Disconnect', desc: 'Evict local SQLite records when account is removed' },
          { key: 'diagnosticsEnabled', title: 'Enable Anonymous Diagnostics', desc: 'Share telemetry logs to improve triage classifications' },
        ].map(item => (
          <div key={item.key} className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{item.title}</span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{item.desc}</span>
            </div>
            <Toggle
              checked={(store.settings.privacy as any)[item.key]}
              onChange={(val) => store.updateSettings(s => { s.privacy[item.key as keyof typeof s.privacy] = val; })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
