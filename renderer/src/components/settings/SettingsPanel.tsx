import { useMemo, useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import {
  Key, User, Settings, Inbox, ListPlus, SquarePen, Keyboard, FileText, Bell, Sparkles, Cpu, Shield, Palette, Info, Tags, Users, CalendarDays, ScrollText, Database
} from 'lucide-react';
import { MCPAndSearchSettingsPanel } from './MCPAndSearchSettingsPanel';
import { AccountsTab, ProfileTab, GeneralTab, InboxTab, ComposeTab, ShortcutsTab, SnippetsTab, NotificationsTab, PrivacyTab } from './tabs/BasicSettingsTabs';
import { AboutTab } from './tabs/AboutTab';
import { AppearanceSettingsTab } from './tabs/AppearanceSettingsTab';
import { ClassificationSettingsTab } from './tabs/ClassificationSettingsTab';
import { AISettingsTab } from './tabs/AISettingsTab';
import { ContactsTab } from './tabs/ContactsSettingsTab';
import { CalendarSettingsTab, LabelsTab } from './tabs/WorkspaceSettingsTabs';
import { DataBackupTab } from './tabs/DataBackupTab';
import { LoggingSettingsTab } from './LoggingSettingsTab';
import { createTranslator } from '../../../../shared/i18n';
import {
  filterSettingsNavItems,
  groupSettingsNavItems,
  type SettingsTabId,
} from '../../../../shared/settingsNav';

const TAB_ICONS: Record<SettingsTabId, typeof Settings> = {
  accounts: Key,
  profile: User,
  general: Settings,
  inbox: Inbox,
  classification: ListPlus,
  labels: Tags,
  contacts: Users,
  calendar: CalendarDays,
  compose: SquarePen,
  shortcuts: Keyboard,
  snippets: FileText,
  notifications: Bell,
  ai: Sparkles,
  mcp: Cpu,
  privacy: Shield,
  appearance: Palette,
  logging: ScrollText,
  data: Database,
  about: Info,
};

export function SettingsPanel() {
  const store = useAppStore();
  const t = createTranslator(store.settings.general.language);
  const [activeTab, setActiveTab] = useState<SettingsTabId>('accounts');
  const [settingsQuery, setSettingsQuery] = useState('');
  const groupedTabs = useMemo(
    () => groupSettingsNavItems(filterSettingsNavItems(settingsQuery)),
    [settingsQuery],
  );

  return (
    <div className="dm-settings flex-1 flex bg-[var(--panel-bg)] select-none h-full overflow-hidden">
      <div className="dm-settings-sidebar w-[180px] border-r border-[var(--border)] bg-[var(--rail-bg)] p-3 flex flex-col gap-1 overflow-y-auto">
        <h2 className="font-semibold text-[var(--text-secondary)] text-[calc(10px*var(--font-scale))] px-2 mb-2 uppercase tracking-wider">{t('settings.panel.title')}</h2>
        <input
          type="search"
          value={settingsQuery}
          onChange={event => setSettingsQuery(event.target.value)}
          placeholder="Search settings"
          className="mb-2 w-full rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
        />
        {groupedTabs.length === 0 ? (
          <p className="px-2 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">No matching settings.</p>
        ) : groupedTabs.map(section => (
          <div key={section.group} className="mb-2">
            <div className="px-2 pb-1 text-[calc(10px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              {section.group}
            </div>
            {section.items.map(tab => {
              const Icon = TAB_ICONS[tab.id];
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`w-full flex items-center gap-2.5 px-2.5 rounded-[6px] transition-colors text-[calc(12px*var(--font-scale))] font-medium text-left cursor-pointer h-[var(--settings-sidebar-row-h)] min-h-[28px] ${
                    active
                      ? 'bg-[var(--hover-row)] text-[var(--text-primary)] font-semibold'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon className={`w-[14px] h-[14px] ${active ? 'text-[var(--accent)]' : ''}`} />
                  <span>{t(`settings.tabs.${tab.id}` as 'settings.tabs.accounts')}</span>
                </button>
              );
            })}
          </div>
        ))}

        <div className="mt-auto pt-3 border-t border-[var(--border)]/40 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => store.setSettingsOpen(false)}
            className="w-full text-center py-1.5 border border-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--strong-border)] text-[calc(11px*var(--font-scale))] font-medium cursor-pointer transition-colors"
          >
            {t('settings.panel.close')}
          </button>
        </div>
      </div>

      <div className="dm-settings-content flex min-h-0 flex-1 flex-col overflow-y-auto bg-[var(--panel-bg)] p-6">
        {activeTab === 'accounts' && <AccountsTab />}
        {activeTab === 'profile' && <ProfileTab />}
        {activeTab === 'general' && <GeneralTab />}
        {activeTab === 'inbox' && <InboxTab />}
        {activeTab === 'classification' && <ClassificationSettingsTab />}
        {activeTab === 'labels' && <LabelsTab />}
        {activeTab === 'contacts' && <ContactsTab />}
        {activeTab === 'calendar' && <CalendarSettingsTab />}
        {activeTab === 'compose' && <ComposeTab />}
        {activeTab === 'shortcuts' && <ShortcutsTab />}
        {activeTab === 'snippets' && <SnippetsTab />}
        {activeTab === 'notifications' && <NotificationsTab />}
        {activeTab === 'ai' && <AISettingsTab />}
        {activeTab === 'mcp' && <MCPAndSearchSettingsPanel />}
        {activeTab === 'privacy' && <PrivacyTab />}
        {activeTab === 'appearance' && <AppearanceSettingsTab />}
        {activeTab === 'logging' && <LoggingSettingsTab />}
        {activeTab === 'data' && <DataBackupTab />}
        {activeTab === 'about' && <AboutTab />}
      </div>
    </div>
  );
}
