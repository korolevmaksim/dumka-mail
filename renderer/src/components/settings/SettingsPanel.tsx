import { consumeRequestedSettingsTarget, subscribeSettingsTargetRequests, type SettingsTarget } from '../../lib/settingsNavigation';
import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { SettingsAccountAvatar } from '../AccountAvatar';
import { MCPAndSearchSettingsPanel } from './MCPAndSearchSettingsPanel';
import { AccountSettingsPage } from './AccountSettingsPage';
import { AccountsTab, ProfileTab, GeneralTab, InboxTab, ComposeTab, ShortcutsTab, SnippetsTab, NotificationsTab, PrivacyTab } from './tabs/BasicSettingsTabs';
import { AboutTab } from './tabs/AboutTab';
import { AppearanceSettingsTab } from './tabs/AppearanceSettingsTab';
import { ClassificationSettingsTab } from './tabs/ClassificationSettingsTab';
import { AIModelTab } from './tabs/AIModelTab';
import { ContactsTab } from './tabs/ContactsSettingsTab';
import { CalendarSettingsTab, LabelsTab } from './tabs/WorkspaceSettingsTabs';
import { DataBackupTab } from './tabs/DataBackupTab';
import { LoggingSettingsTab } from './LoggingSettingsTab';
import { createTranslator } from '../../../../shared/i18n';
import { normalizeAccountId } from '../../../../shared/accountSettings';
import {
  accountMatchesSettingsQuery,
  filterSettingsNavItems,
  groupSettingsNavItems,
  settingsSectionForTab,
  type SettingsTabId,
} from '../../../../shared/settingsNav';
import type { Account } from '../../../../shared/types';

const SECTION_LABEL_CLASS = 'px-2 pb-1 pt-1 text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-tertiary)]';

function navRowClass(active: boolean): string {
  return `w-full flex items-center gap-2 px-2.5 rounded-[6px] transition-colors text-[calc(12px*var(--font-scale))] text-left cursor-pointer h-[var(--settings-sidebar-row-h)] min-h-[28px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:-outline-offset-2 ${
    active
      ? 'bg-[var(--hover-row)] text-[var(--text-primary)] font-semibold'
      : 'font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]'
  }`;
}

function TabContent({ tab }: { tab: SettingsTabId }) {
  switch (tab) {
    case 'accounts': return <AccountsTab />;
    case 'profile': return <ProfileTab />;
    case 'general': return <GeneralTab />;
    case 'inbox': return <InboxTab />;
    case 'classification': return <ClassificationSettingsTab />;
    case 'labels': return <LabelsTab />;
    case 'contacts': return <ContactsTab />;
    case 'calendar': return <CalendarSettingsTab />;
    case 'compose': return <ComposeTab />;
    case 'shortcuts': return <ShortcutsTab />;
    case 'snippets': return <SnippetsTab />;
    case 'notifications': return <NotificationsTab />;
    case 'ai': return <AIModelTab />;
    case 'mcp': return <MCPAndSearchSettingsPanel />;
    case 'privacy': return <PrivacyTab />;
    case 'appearance': return <AppearanceSettingsTab />;
    case 'logging': return <LoggingSettingsTab />;
    case 'data': return <DataBackupTab />;
    case 'about': return <AboutTab />;
  }
}

/** Where Settings opens: the active account's page, else the first account, else the account list. */
function fallbackTarget(accounts: Account[], activeAccount: Account | null): SettingsTarget {
  const active = activeAccount && activeAccount.id !== 'unified' ? activeAccount : null;
  const account = active || accounts[0];
  return account ? { kind: 'account', accountId: normalizeAccountId(account.email) } : { kind: 'tab', tab: 'accounts' };
}

export function SettingsPanel() {
  const store = useAppStore();
  const t = createTranslator(store.settings.general.language);
  const [requested, setRequested] = useState<SettingsTarget | null>(() => consumeRequestedSettingsTarget());
  const [settingsQuery, setSettingsQuery] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(() => requested?.kind === 'tab' && settingsSectionForTab(requested.tab) === 'Advanced');
  const advancedListId = useId();

  useEffect(() => subscribeSettingsTargetRequests(target => {
    consumeRequestedSettingsTarget();
    setRequested(target);
    if (target.kind === 'tab' && settingsSectionForTab(target.tab) === 'Advanced') setAdvancedOpen(true);
  }), []);

  const accounts = store.accounts.filter(account => account.id !== 'unified');
  // A requested account that is gone (e.g. just disconnected) falls back.
  const selection: SettingsTarget = requested && (requested.kind === 'tab'
    || accounts.some(account => normalizeAccountId(account.email) === requested.accountId))
    ? requested
    : fallbackTarget(accounts, store.activeAccount);
  const selectedAccount = selection.kind === 'account'
    ? accounts.find(account => normalizeAccountId(account.email) === selection.accountId) ?? null
    : null;

  const searching = settingsQuery.trim().length > 0;
  const groupedTabs = useMemo(() => groupSettingsNavItems(filterSettingsNavItems(settingsQuery)), [settingsQuery]);
  const visibleAccounts = accounts.filter(account => accountMatchesSettingsQuery(settingsQuery, account.email, account.displayName));
  const nothingFound = searching && groupedTabs.length === 0 && visibleAccounts.length === 0;

  const select = (target: SettingsTarget) => setRequested(target);

  return (
    <div className="dm-settings flex-1 flex bg-[var(--panel-bg)] select-none h-full overflow-hidden">
      <nav aria-label="Settings" className="dm-settings-sidebar w-[220px] shrink-0 border-r border-[var(--border)] bg-[var(--rail-bg)] p-3 flex flex-col gap-1 overflow-y-auto">
        <h2 className="px-2 mb-1 text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Settings</h2>
        <input
          type="search"
          value={settingsQuery}
          onChange={event => setSettingsQuery(event.target.value)}
          placeholder="Search settings"
          aria-label="Search settings"
          className="mb-2 w-full rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        />

        {nothingFound && (
          <p className="px-2 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">No matching settings.</p>
        )}

        {(!searching || visibleAccounts.length > 0) && (
          <div className="mb-2" role="group" aria-labelledby="settings-nav-accounts">
            <div id="settings-nav-accounts" className={SECTION_LABEL_CLASS}>Accounts</div>
            {visibleAccounts.map(account => {
              const accountId = normalizeAccountId(account.email);
              const active = selection.kind === 'account' && selection.accountId === accountId;
              return (
                <button
                  key={account.id}
                  type="button"
                  data-settings-account={accountId}
                  onClick={() => select({ kind: 'account', accountId })}
                  aria-current={active ? 'page' : undefined}
                  title={account.email}
                  className={navRowClass(active)}
                >
                  <span className="shrink-0 scale-[0.8]"><SettingsAccountAvatar acc={account} /></span>
                  <span className="min-w-0 truncate">{account.email}</span>
                </button>
              );
            })}
            {!searching && (
              <button
                type="button"
                data-settings-add-account
                onClick={() => void store.onboardAccount('')}
                className={navRowClass(false)}
              >
                <Plus aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span>Add account</span>
              </button>
            )}
          </div>
        )}

        {groupedTabs.map(group => {
          const isAdvanced = group.section === 'Advanced';
          const expanded = !isAdvanced || advancedOpen || searching;
          const labelId = `settings-nav-${group.section.toLowerCase()}`;
          return (
            <div key={group.section} className="mb-2" role="group" aria-labelledby={labelId}>
              {isAdvanced ? (
                <button
                  type="button"
                  id={labelId}
                  onClick={() => setAdvancedOpen(open => !open)}
                  aria-expanded={expanded}
                  aria-controls={advancedListId}
                  disabled={searching}
                  className={`${SECTION_LABEL_CLASS} flex w-full items-center gap-1 rounded-[6px] cursor-pointer hover:text-[var(--text-primary)] disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]`}
                >
                  <ChevronRight aria-hidden="true" className={`h-3 w-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                  Advanced
                </button>
              ) : (
                <div id={labelId} className={SECTION_LABEL_CLASS}>{group.section}</div>
              )}
              {expanded && (
                <div id={isAdvanced ? advancedListId : undefined} className="flex flex-col gap-0.5">
                  {group.items.map(tab => {
                    const active = selection.kind === 'tab' && selection.tab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        data-settings-tab={tab.id}
                        onClick={() => select({ kind: 'tab', tab: tab.id })}
                        aria-current={active ? 'page' : undefined}
                        className={`${navRowClass(active)} ${isAdvanced ? 'pl-6' : ''}`}
                      >
                        <span className="truncate">{tab.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <div className="mt-auto pt-3 border-t border-[var(--border)]/40 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => store.setSettingsOpen(false)}
            className="w-full text-center py-1.5 border border-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--strong-border)] text-[calc(11px*var(--font-scale))] font-medium cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            {t('settings.panel.close')}
          </button>
        </div>
      </nav>

      <div className="dm-settings-content flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--panel-bg)] p-6">
        {selectedAccount
          ? <AccountSettingsPage key={selectedAccount.id} account={selectedAccount} />
          : <TabContent tab={selection.kind === 'tab' ? selection.tab : 'accounts'} />}
      </div>
    </div>
  );
}
