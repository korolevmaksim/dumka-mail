import { useEffect, useState } from 'react';
import { useAppStore } from '../../../stores/AppStore';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { SettingsAccountAvatar } from '../../AccountAvatar';
import { Toggle } from '../SettingsControls';
import { emitToast } from '../../../lib/toastBus';
import { sanitizeGmailSignatureHtml } from '../../../../../shared/textNormalizer';
import { createSnippetTemplateId } from '../../../../../shared/snippets';
import { APP_LANGUAGES, createTranslator } from '../../../../../shared/i18n';
import type { AppLanguage, TranslationKey } from '../../../../../shared/i18n';
import type { ComposeSignatureSettings, PrivacySettings, SnippetTemplate } from '../../../../../shared/types';
import type { AutoUpdateStatus } from '../../../../../shared/autoUpdate';

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
                    <span className="flex items-center gap-1.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
                      {acc.email}
                      {store.googleAuthIssues.some(issue => issue.accountId === acc.email) && (
                        <span className="rounded bg-[var(--warning)]/15 px-1 py-0.5 font-semibold text-[var(--warning-solid)]">
                          Needs reconnect
                        </span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void store.authorizeGoogleIntegration('calendar', acc.email)}
                    className="text-[calc(10px*var(--font-scale))] text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    Enable Calendar
                  </button>
                  <button
                    type="button"
                    onClick={() => void store.authorizeGoogleIntegration('contacts', acc.email)}
                    className="text-[calc(10px*var(--font-scale))] text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    Enable Contacts
                  </button>
                  <button
                    type="button"
                    onClick={() => void store.reauthorizeAccount(acc.email)}
                    disabled={store.reauthorizingAccountId !== null}
                    className="text-[calc(10px*var(--font-scale))] text-[var(--accent)] hover:underline cursor-pointer disabled:cursor-wait disabled:opacity-50"
                  >
                    {store.reauthorizingAccountId === acc.email ? 'Reconnecting…' : 'Reconnect'}
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
  const t = createTranslator(store.settings.general.language);
  const [systemDownloadsPath, setSystemDownloadsPath] = useState('');
  const generalToggleItems: Array<{ key: keyof typeof store.settings.general; title: TranslationKey; desc: TranslationKey }> = [
    { key: 'showBottomShortcutBar', title: 'settings.general.showBottomShortcutBar.title', desc: 'settings.general.showBottomShortcutBar.description' },
    { key: 'showRightContextPanel', title: 'settings.general.showRightContextPanel.title', desc: 'settings.general.showRightContextPanel.description' },
    { key: 'openLinksInBackground', title: 'settings.general.openLinksInBackground.title', desc: 'settings.general.openLinksInBackground.description' },
    { key: 'confirmBeforeQuitting', title: 'settings.general.confirmBeforeQuitting.title', desc: 'settings.general.confirmBeforeQuitting.description' },
    { key: 'keepDraftsAcrossLaunches', title: 'settings.general.keepDraftsAcrossLaunches.title', desc: 'settings.general.keepDraftsAcrossLaunches.description' },
  ];
  const languageLabels: Record<AppLanguage, TranslationKey> = {
    system: 'settings.general.language.system',
    en: 'settings.general.language.english',
    pseudo: 'settings.general.language.pseudo',
  };

  useEffect(() => {
    let cancelled = false;
    void window.electronAPI.getSystemDownloadsPath().then(path => {
      if (!cancelled) setSystemDownloadsPath(path);
    }).catch(() => {
      if (!cancelled) setSystemDownloadsPath('');
    });
    return () => { cancelled = true; };
  }, []);

  const configuredFolder = store.settings.general.attachmentDownloadFolder?.trim() || '';
  const folderDisplay = configuredFolder || systemDownloadsPath || t('settings.general.attachmentDownloadFolder.systemDownloads');

  return (
    <div className="flex flex-col gap-4 max-w-[600px]">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">{t('settings.general.title')}</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">{t('settings.general.description')}</p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{t('settings.general.language.title')}</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{t('settings.general.language.description')}</span>
          </div>
          <select
            value={store.settings.general.language}
            onChange={(e) => {
              const val = e.target.value as AppLanguage;
              store.updateSettings(s => { s.general.language = val; });
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            {APP_LANGUAGES.map(language => (
              <option key={language} value={language}>{t(languageLabels[language])}</option>
            ))}
          </select>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{t('settings.general.startup.title')}</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{t('settings.general.startup.description')}</span>
          </div>
          <select
            value={store.settings.general.startupBehavior}
            onChange={(e) => {
              const val = e.target.value as any;
              store.updateSettings(s => { s.general.startupBehavior = val; });
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="today">{t('settings.general.startup.today')}</option>
            <option value="inbox">{t('settings.general.startup.inbox')}</option>
            <option value="lastSelectedAccount">{t('settings.general.startup.lastSelectedAccount')}</option>
            <option value="commandPalette">{t('settings.general.startup.commandPalette')}</option>
          </select>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{t('settings.general.defaultSplit.title')}</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{t('settings.general.defaultSplit.description')}</span>
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

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{t('settings.general.attachmentDownloadFolder.title')}</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{t('settings.general.attachmentDownloadFolder.description')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex-1 min-w-0 px-2.5 py-1.5 bg-[var(--app-bg)] border border-[var(--border)] rounded text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] font-mono truncate"
              title={folderDisplay}
            >
              {folderDisplay}
              {!configuredFolder && (
                <span className="ml-1.5 text-[var(--text-tertiary)] font-sans">
                  ({t('settings.general.attachmentDownloadFolder.systemDownloads')})
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                void window.electronAPI.chooseAttachmentDownloadFolder().then(selected => {
                  if (!selected) return;
                  store.updateSettings(s => { s.general.attachmentDownloadFolder = selected; });
                });
              }}
              className="shrink-0 px-2.5 py-1.5 border border-[var(--border)] rounded text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] cursor-pointer bg-[var(--panel-bg)]"
            >
              {t('settings.general.attachmentDownloadFolder.choose')}
            </button>
            {configuredFolder && (
              <button
                type="button"
                onClick={() => {
                  store.updateSettings(s => { s.general.attachmentDownloadFolder = ''; });
                }}
                className="shrink-0 px-2.5 py-1.5 border border-[var(--border)] rounded text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer bg-[var(--panel-bg)]"
              >
                {t('settings.general.attachmentDownloadFolder.reset')}
              </button>
            )}
          </div>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        {generalToggleItems.map(item => (
          <div key={item.key} className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{t(item.title)}</span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{t(item.desc)}</span>
            </div>
            <Toggle
              checked={Boolean(store.settings.general[item.key])}
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

        <div className="border-t border-[var(--border)] pt-3 flex flex-col gap-2">
          <div className="text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)]">Follow-up Radar window</div>
          <p className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] leading-snug">
            Only unanswered sent mail older than the min wait and younger than the lookback is shown. Old archaeology stays out of the radar.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'followUpThresholdHours', title: 'Min wait', suffix: 'hours', min: 1, max: 720, hint: 'How long to wait before a sent mail becomes a follow-up' },
              { key: 'followUpMaxAgeDays', title: 'Lookback', suffix: 'days', min: 1, max: 365, hint: 'Ignore sent mail older than this (default 30 days)' },
              { key: 'followUpMaxItems', title: 'Radar limit', suffix: 'items', min: 1, max: 50, hint: 'Max candidates listed at once' },
              { key: 'followUpSnoozeHours', title: 'Snooze', suffix: 'hours', min: 1, max: 720, hint: 'How long Snooze hides an item' },
            ].map(item => (
              <label key={item.key} className="flex min-w-0 flex-col gap-1 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]" title={item.hint}>
                <span>{item.title}</span>
                <span className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1">
                  <input
                    type="number"
                    min={item.min}
                    max={item.max}
                    value={Number((store.settings.inbox as any)[item.key]) || item.min}
                    onChange={(event) => {
                      const rawValue = Number(event.target.value);
                      const nextValue = Math.max(item.min, Math.min(item.max, Number.isFinite(rawValue) ? Math.floor(rawValue) : item.min));
                      store.updateSettings(settings => { (settings.inbox as any)[item.key] = nextValue; });
                    }}
                    className="min-w-0 flex-1 bg-transparent text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                  />
                  <span className="shrink-0 text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">{item.suffix}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ComposeTab() {
  const store = useAppStore();
  const [signatureSyncing, setSignatureSyncing] = useState(false);
  const [selectedSignatureEmail, setSelectedSignatureEmail] = useState('');
  const accountOptions = store.accounts;
  const preferredSignatureAccount = store.activeAccount && store.activeAccount.id !== 'unified'
    ? store.activeAccount
    : store.accounts[0] || null;

  useEffect(() => {
    setSelectedSignatureEmail(current => {
      if (current && accountOptions.some(acc => acc.email === current)) return current;
      return preferredSignatureAccount?.email || '';
    });
  }, [accountOptions, preferredSignatureAccount?.email]);

  const normalizedSignatureEmail = selectedSignatureEmail.trim().toLowerCase();
  const selectedSignatureAccount = accountOptions.find(acc => acc.email.toLowerCase() === normalizedSignatureEmail) || null;
  const selectedAccountSignature = normalizedSignatureEmail
    ? store.settings.compose.signaturesByAccount?.[normalizedSignatureEmail]
    : undefined;
  const signaturePlain = selectedAccountSignature?.signaturePlain ?? store.settings.compose.defaultSignature;
  const signatureHtml = selectedAccountSignature?.signatureHtml ?? store.settings.compose.defaultSignatureHtml;
  const hasHtmlSignature = Boolean(signatureHtml.trim());

  const updateSelectedSignature = (updater: (entry: ComposeSignatureSettings) => ComposeSignatureSettings) => {
    if (!normalizedSignatureEmail) return;

    store.updateSettings(s => {
      const existing = s.compose.signaturesByAccount?.[normalizedSignatureEmail] || {
        signaturePlain: s.compose.defaultSignature || '',
        signatureHtml: s.compose.defaultSignatureHtml || '',
        signatureFormat: s.compose.signatureFormat || (s.compose.defaultSignatureHtml.trim() ? 'html' : 'plain'),
      };

      s.compose.signaturesByAccount = {
        ...(s.compose.signaturesByAccount || {}),
        [normalizedSignatureEmail]: updater(existing),
      };
    });
  };

  const handleSyncGmailSignature = async () => {
    if (!selectedSignatureAccount) {
      emitToast({ type: 'warning', message: 'Connect a Gmail account before syncing the signature.' });
      return;
    }

    setSignatureSyncing(true);
    try {
      const result = await store.syncGmailSignature(selectedSignatureAccount.email);
      if (result.found) {
        emitToast({ type: 'success', message: `Gmail signature synced for ${selectedSignatureAccount.email}.` });
      } else {
        emitToast({ type: 'info', message: `No Gmail signature found for ${selectedSignatureAccount.email}.` });
      }
    } catch (err) {
      console.error('Gmail signature sync failed:', err);
      emitToast({ type: 'error', message: 'Failed to sync Gmail signature.' });
    } finally {
      setSignatureSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-[600px] select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Compose Preferences</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Customize font styles, default signature, drafts, and undo delays.</p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Gmail Signature</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">
              {selectedSignatureAccount
                ? (hasHtmlSignature ? `HTML signature for ${selectedSignatureAccount.email}` : `No imported signature for ${selectedSignatureAccount.email}`)
                : 'Connect a Gmail account first'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedSignatureEmail}
              onChange={(e) => setSelectedSignatureEmail(e.target.value)}
              disabled={accountOptions.length === 0 || signatureSyncing}
              className="max-w-[220px] bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer disabled:opacity-50"
            >
              {accountOptions.length === 0 ? (
                <option value="">No accounts</option>
              ) : accountOptions.map(acc => (
                <option key={acc.email} value={acc.email}>{acc.email}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleSyncGmailSignature}
              disabled={signatureSyncing || !selectedSignatureAccount}
              className="flex items-center gap-1.5 px-2.5 py-1 border border-[var(--border)] text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--strong-border)] rounded cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] active:translate-y-px"
            >
              <RefreshCw className={`w-3 h-3 ${signatureSyncing ? 'animate-spin' : ''}`} />
              {signatureSyncing ? 'Syncing' : 'Sync from Gmail'}
            </button>
          </div>
        </div>

        {hasHtmlSignature && (
          <div className="flex flex-col gap-2">
            <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">HTML Preview:</span>
            <div className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-3 py-2 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] min-h-[52px] overflow-auto">
              <div dangerouslySetInnerHTML={{ __html: sanitizeGmailSignatureHtml(signatureHtml) }} />
            </div>
            <textarea
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none min-h-[84px] font-mono leading-normal resize-y"
              value={signatureHtml}
              onChange={(e) => {
                const val = e.target.value;
                updateSelectedSignature(entry => ({
                  ...entry,
                  signatureHtml: val,
                  signatureFormat: val.trim() ? 'html' : 'plain',
                }));
              }}
              disabled={!selectedSignatureAccount}
              placeholder="<div>Best regards,<br>Alex</div>"
            />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">
            {hasHtmlSignature ? 'Plain-text Fallback:' : 'Default Email Signature:'}
          </span>
          <textarea
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none min-h-[60px] font-mono leading-normal resize-none"
            value={signaturePlain}
            onChange={(e) => {
              const val = e.target.value;
              updateSelectedSignature(entry => ({
                ...entry,
                signaturePlain: val,
                signatureFormat: entry.signatureHtml.trim() ? 'html' : 'plain',
              }));
            }}
            disabled={!selectedSignatureAccount}
            placeholder="e.g. Best regards, Alex"
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
  const updateTemplate = (id: string, updater: (template: SnippetTemplate) => SnippetTemplate) => {
    store.updateSettings(s => {
      s.snippets.templates = s.snippets.templates.map(template => (
        template.id === id ? updater(template) : template
      ));
    });
  };
  const addTemplate = () => {
    store.updateSettings(s => {
      const title = `Snippet ${s.snippets.templates.length + 1}`;
      s.snippets.templates = [
        ...s.snippets.templates,
        {
          id: createSnippetTemplateId(title, s.snippets.templates),
          title,
          trigger: '',
          body: '',
          includeSignature: s.snippets.includeSignature,
        },
      ];
    });
  };
  const deleteTemplate = (id: string) => {
    store.updateSettings(s => {
      s.snippets.templates = s.snippets.templates.filter(template => template.id !== id);
    });
  };

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

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Template Library</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Named snippets available from the composer menu.</span>
          </div>
          <button
            type="button"
            onClick={addTemplate}
            className="flex h-7 items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--panel-bg)] px-2 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>

        {store.settings.snippets.templates.length === 0 ? (
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] italic">No saved snippet templates.</span>
        ) : (
          <div className="flex flex-col gap-2">
            {store.settings.snippets.templates.map(template => (
              <div key={template.id} className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label="Snippet template title"
                    value={template.title}
                    onChange={(event) => updateTemplate(template.id, current => ({ ...current, title: event.target.value }))}
                    className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1 text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)] outline-none"
                  />
                  <button
                    type="button"
                    title="Delete template"
                    aria-label={`Delete snippet template ${template.title || template.id}`}
                    onClick={() => deleteTemplate(template.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--border)] hover:text-[var(--danger)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  type="text"
                  aria-label="Snippet template trigger"
                  placeholder="Trigger, e.g. ;followup"
                  value={template.trigger}
                  onChange={(event) => updateTemplate(template.id, current => ({ ...current, trigger: event.target.value }))}
                  className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                />
                <textarea
                  aria-label="Snippet template body"
                  value={template.body}
                  onChange={(event) => updateTemplate(template.id, current => ({ ...current, body: event.target.value }))}
                  className="min-h-[72px] resize-y rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1.5 font-mono text-[calc(11px*var(--font-scale))] leading-normal text-[var(--text-primary)] outline-none"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">Include signature</span>
                  <Toggle
                    checked={template.includeSignature}
                    onChange={(value) => updateTemplate(template.id, current => ({ ...current, includeSignature: value }))}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
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

function autoUpdateStatusText(status: AutoUpdateStatus | null, t: (key: TranslationKey) => string): string {
  if (!status) return t('settings.updates.loadingStatus');
  if (status.errorMessage) return `${status.message} ${status.errorMessage}`;
  return status.message;
}

function canCheckForUpdates(status: AutoUpdateStatus | null): boolean {
  return Boolean(status?.isSupported && status.isPackaged && status.isConfigured && status.state !== 'checking' && status.state !== 'downloaded');
}

export function PrivacyTab() {
  const store = useAppStore();
  const t = createTranslator(store.settings.general.language);
  const [autoUpdateStatus, setAutoUpdateStatus] = useState<AutoUpdateStatus | null>(null);
  const [autoUpdateBusy, setAutoUpdateBusy] = useState(false);
  const privacyItems: Array<{
    key: keyof PrivacySettings;
    titleKey: TranslationKey;
    descriptionKey: TranslationKey;
  }> = [
    {
      key: 'loadRemoteImages',
      titleKey: 'settings.privacy.loadRemoteImages.title',
      descriptionKey: 'settings.privacy.loadRemoteImages.description',
    },
    {
      key: 'includeBodiesInSearchIndex',
      titleKey: 'settings.privacy.includeBodiesInSearchIndex.title',
      descriptionKey: 'settings.privacy.includeBodiesInSearchIndex.description',
    },
    {
      key: 'redactLogs',
      titleKey: 'settings.privacy.redactLogs.title',
      descriptionKey: 'settings.privacy.redactLogs.description',
    },
    {
      key: 'useKeychainForSecrets',
      titleKey: 'settings.privacy.useKeychainForSecrets.title',
      descriptionKey: 'settings.privacy.useKeychainForSecrets.description',
    },
    {
      key: 'clearCacheOnDisconnect',
      titleKey: 'settings.privacy.clearCacheOnDisconnect.title',
      descriptionKey: 'settings.privacy.clearCacheOnDisconnect.description',
    },
    {
      key: 'diagnosticsEnabled',
      titleKey: 'settings.privacy.diagnosticsEnabled.title',
      descriptionKey: 'settings.privacy.diagnosticsEnabled.description',
    },
  ];

  useEffect(() => {
    let mounted = true;
    window.electronAPI.getAutoUpdateStatus()
      .then(status => {
        if (mounted) setAutoUpdateStatus(status);
      })
      .catch(err => {
        console.error('Failed to load auto-update status:', err);
      });
    const unsubscribe = window.electronAPI.onAutoUpdateStatus(status => {
      if (mounted) setAutoUpdateStatus(status);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const checkForUpdates = async () => {
    setAutoUpdateBusy(true);
    try {
      setAutoUpdateStatus(await window.electronAPI.checkForAppUpdates());
    } catch (err) {
      console.error('Failed to check for app updates:', err);
    } finally {
      setAutoUpdateBusy(false);
    }
  };

  const installUpdate = async () => {
    setAutoUpdateBusy(true);
    try {
      setAutoUpdateStatus(await window.electronAPI.installDownloadedAppUpdate());
    } catch (err) {
      console.error('Failed to install downloaded update:', err);
      setAutoUpdateBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-[600px]">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">{t('settings.privacy.title')}</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">{t('settings.privacy.description')}</p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        {privacyItems.map(item => (
          <div key={item.key} className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{t(item.titleKey)}</span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{t(item.descriptionKey)}</span>
            </div>
            <Toggle
              checked={store.settings.privacy[item.key]}
              onChange={(val) => store.updateSettings(s => { s.privacy[item.key] = val; })}
            />
          </div>
        ))}
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{t('settings.updates.title')}</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{autoUpdateStatusText(autoUpdateStatus, t)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {autoUpdateStatus?.state === 'downloaded' && (
              <button
                type="button"
                onClick={installUpdate}
                disabled={autoUpdateBusy}
                className="px-3 py-1 bg-[var(--accent)] text-white rounded font-medium text-[calc(10px*var(--font-scale))] disabled:opacity-50"
              >
                {t('settings.updates.restart')}
              </button>
            )}
            <button
              type="button"
              onClick={checkForUpdates}
              disabled={autoUpdateBusy || !canCheckForUpdates(autoUpdateStatus)}
              className="px-3 py-1 border border-[var(--border)] rounded text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--panel-bg)] disabled:opacity-50"
            >
              {autoUpdateStatus?.state === 'checking' || autoUpdateBusy ? t('settings.updates.checking') : t('settings.updates.check')}
            </button>
          </div>
        </div>
        {autoUpdateStatus?.feedURL && (
          <span className="truncate text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">{autoUpdateStatus.feedURL}</span>
        )}
      </div>
    </div>
  );
}
