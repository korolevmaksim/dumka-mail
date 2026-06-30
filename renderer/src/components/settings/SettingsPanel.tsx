import { useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import {
  Key, User, Settings, Inbox, ListPlus, SquarePen, Keyboard, FileText, Bell, Sparkles, Cpu, Shield, Palette, Info, Tags, Users, CalendarDays
} from 'lucide-react';
import { MCPAndSearchSettingsPanel } from './MCPAndSearchSettingsPanel';
import { AccountsTab, ProfileTab, GeneralTab, InboxTab, ComposeTab, ShortcutsTab, SnippetsTab, NotificationsTab, PrivacyTab } from './tabs/BasicSettingsTabs';
import { AboutTab } from './tabs/AboutTab';
import { AppearanceSettingsTab } from './tabs/AppearanceSettingsTab';
import { ClassificationSettingsTab } from './tabs/ClassificationSettingsTab';
import { AISettingsTab } from './tabs/AISettingsTab';
import { CalendarSettingsTab, ContactsTab, LabelsTab } from './tabs/WorkspaceSettingsTabs';

export function SettingsPanel() {
  const store = useAppStore();
  const [activeTab, setActiveTab] = useState<'accounts' | 'profile' | 'general' | 'inbox' | 'classification' | 'labels' | 'contacts' | 'calendar' | 'compose' | 'shortcuts' | 'snippets' | 'notifications' | 'ai' | 'mcp' | 'privacy' | 'appearance' | 'about'>('accounts');
  
  const tabsList = [
    { id: 'accounts', name: 'Accounts', icon: Key },
    { id: 'profile', name: 'Profile', icon: User },
    { id: 'general', name: 'General', icon: Settings },
    { id: 'inbox', name: 'Inbox', icon: Inbox },
    { id: 'classification', name: 'Classification', icon: ListPlus },
    { id: 'labels', name: 'Labels', icon: Tags },
    { id: 'contacts', name: 'Contacts', icon: Users },
    { id: 'calendar', name: 'Calendar', icon: CalendarDays },
    { id: 'compose', name: 'Compose', icon: SquarePen },
    { id: 'shortcuts', name: 'Shortcuts', icon: Keyboard },
    { id: 'snippets', name: 'Snippets', icon: FileText },
    { id: 'notifications', name: 'Notifications', icon: Bell },
    { id: 'ai', name: 'AI Config', icon: Sparkles },
    { id: 'mcp', name: 'MCP & Search', icon: Cpu },
    { id: 'privacy', name: 'Privacy', icon: Shield },
    { id: 'appearance', name: 'Appearance', icon: Palette },
    { id: 'about', name: 'About', icon: Info },
  ] as const;

  return (
    <div className="flex-1 flex bg-[var(--panel-bg)] select-none h-full overflow-hidden">
      {/* Sidebar Navigation */}
      <div className="w-[180px] border-r border-[var(--border)] bg-[var(--rail-bg)] p-3 flex flex-col gap-1 overflow-y-auto">
        <h2 className="font-semibold text-[var(--text-secondary)] text-[calc(10px*var(--font-scale))] px-2 mb-2 uppercase tracking-wider">Preferences</h2>
        {tabsList.map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-2.5 px-2.5 rounded-[6px] transition-colors text-[calc(12px*var(--font-scale))] font-medium text-left cursor-pointer h-[var(--settings-sidebar-row-h)] min-h-[28px] ${
                active
                  ? 'bg-[var(--hover-row)] text-[var(--text-primary)] font-semibold'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className={`w-[14px] h-[14px] ${active ? 'text-[var(--accent)]' : ''}`} />
              <span>{tab.name}</span>
            </button>
          );
        })}
        
        <div className="mt-auto pt-3 border-t border-[var(--border)]/40 flex flex-col gap-1.5">
          <button
            onClick={() => store.setSettingsOpen(false)}
            className="w-full text-center py-1.5 border border-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--strong-border)] text-[calc(11px*var(--font-scale))] font-medium cursor-pointer transition-colors"
          >
            Close Settings
          </button>
        </div>
      </div>

      {/* Pane Content */}
      <div className="flex-1 flex flex-col overflow-y-auto p-6 bg-[var(--panel-bg)]">
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
        {activeTab === 'about' && <AboutTab />}
      </div>
    </div>
  );
}
