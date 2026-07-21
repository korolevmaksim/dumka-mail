import { useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import {
  Key, User, Settings, Inbox, ListPlus, SquarePen, Keyboard, FileText, Bell, Sparkles, Cpu, Shield, Palette, Info, Tags, Users, CalendarDays, ScrollText
} from 'lucide-react';
import { MCPAndSearchSettingsPanel } from './MCPAndSearchSettingsPanel';
import { AccountsTab, ProfileTab, GeneralTab, InboxTab, ComposeTab, ShortcutsTab, SnippetsTab, NotificationsTab, PrivacyTab } from './tabs/BasicSettingsTabs';
import { AboutTab } from './tabs/AboutTab';
import { AppearanceSettingsTab } from './tabs/AppearanceSettingsTab';
import { ClassificationSettingsTab } from './tabs/ClassificationSettingsTab';
import { AISettingsTab } from './tabs/AISettingsTab';
import { ContactsTab } from './tabs/ContactsSettingsTab';
import { CalendarSettingsTab, LabelsTab } from './tabs/WorkspaceSettingsTabs';
import { LoggingSettingsTab } from './LoggingSettingsTab';
import { createTranslator } from '../../../../shared/i18n';

export function SettingsPanel() {
  const store = useAppStore();
  const t = createTranslator(store.settings.general.language);
  const [activeTab, setActiveTab] = useState<'accounts' | 'profile' | 'general' | 'inbox' | 'classification' | 'labels' | 'contacts' | 'calendar' | 'compose' | 'shortcuts' | 'snippets' | 'notifications' | 'ai' | 'mcp' | 'privacy' | 'appearance' | 'logging' | 'about'>('accounts');
  
  const tabsList = [
    { id: 'accounts', nameKey: 'settings.tabs.accounts', icon: Key },
    { id: 'profile', nameKey: 'settings.tabs.profile', icon: User },
    { id: 'general', nameKey: 'settings.tabs.general', icon: Settings },
    { id: 'inbox', nameKey: 'settings.tabs.inbox', icon: Inbox },
    { id: 'classification', nameKey: 'settings.tabs.classification', icon: ListPlus },
    { id: 'labels', nameKey: 'settings.tabs.labels', icon: Tags },
    { id: 'contacts', nameKey: 'settings.tabs.contacts', icon: Users },
    { id: 'calendar', nameKey: 'settings.tabs.calendar', icon: CalendarDays },
    { id: 'compose', nameKey: 'settings.tabs.compose', icon: SquarePen },
    { id: 'shortcuts', nameKey: 'settings.tabs.shortcuts', icon: Keyboard },
    { id: 'snippets', nameKey: 'settings.tabs.snippets', icon: FileText },
    { id: 'notifications', nameKey: 'settings.tabs.notifications', icon: Bell },
    { id: 'ai', nameKey: 'settings.tabs.ai', icon: Sparkles },
    { id: 'mcp', nameKey: 'settings.tabs.mcp', icon: Cpu },
    { id: 'privacy', nameKey: 'settings.tabs.privacy', icon: Shield },
    { id: 'appearance', nameKey: 'settings.tabs.appearance', icon: Palette },
    { id: 'logging', nameKey: 'settings.tabs.logging', icon: ScrollText },
    { id: 'about', nameKey: 'settings.tabs.about', icon: Info },
  ] as const;

  return (
    <div className="dm-settings flex-1 flex bg-[var(--panel-bg)] select-none h-full overflow-hidden">
      {/* Sidebar Navigation */}
      <div className="dm-settings-sidebar w-[180px] border-r border-[var(--border)] bg-[var(--rail-bg)] p-3 flex flex-col gap-1 overflow-y-auto">
        <h2 className="font-semibold text-[var(--text-secondary)] text-[calc(10px*var(--font-scale))] px-2 mb-2 uppercase tracking-wider">{t('settings.panel.title')}</h2>
        {tabsList.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-current={active ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-2.5 rounded-[6px] transition-colors text-[calc(12px*var(--font-scale))] font-medium text-left cursor-pointer h-[var(--settings-sidebar-row-h)] min-h-[28px] ${
                active
                  ? 'bg-[var(--hover-row)] text-[var(--text-primary)] font-semibold'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className={`w-[14px] h-[14px] ${active ? 'text-[var(--accent)]' : ''}`} />
              <span>{t(tab.nameKey)}</span>
            </button>
          );
        })}
        
        <div className="mt-auto pt-3 border-t border-[var(--border)]/40 flex flex-col gap-1.5">
          <button
            onClick={() => store.setSettingsOpen(false)}
            className="w-full text-center py-1.5 border border-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--strong-border)] text-[calc(11px*var(--font-scale))] font-medium cursor-pointer transition-colors"
          >
            {t('settings.panel.close')}
          </button>
        </div>
      </div>

      {/* Pane Content */}
      <div className="dm-settings-content flex-1 flex flex-col overflow-y-auto p-6 bg-[var(--panel-bg)]">
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
        {activeTab === 'about' && <AboutTab />}
      </div>
    </div>
  );
}
