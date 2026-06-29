import { Inbox, Plus, Sun, Moon, Monitor, Settings, Sparkles } from 'lucide-react';
import { useAppStore, UNIFIED_ACCOUNT } from '../../stores/AppStore';
import { AccountAvatar } from '../AccountAvatar';

export function LeftRail() {
  const store = useAppStore();

  return (
    <div className="flex flex-col items-center justify-between w-[84px] border-r border-[var(--border)] bg-[var(--rail-bg)] py-4 traffic-light-margin shrink-0">
      <div className="flex flex-col gap-3 items-center w-full">
        {store.accounts.length > 0 && (
          <>
            <button
              onClick={() => {
                store.setActiveAccount(UNIFIED_ACCOUNT);
                store.setSettingsOpen(false);
              }}
              title="Unified Inbox"
              className={`relative flex items-center justify-center w-10 h-10 rounded-xl border transition-[border-color,background-color,color,opacity] duration-150 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 active:translate-y-px ${
                store.activeAccount?.id === 'unified' 
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white shadow-sm' 
                  : 'border-[var(--border)] bg-[var(--panel-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] opacity-60 hover:opacity-100'
              }`}
            >
              <Inbox className="w-5 h-5" />
              <span className="absolute bottom-0 right-0 text-[calc(8px*var(--font-scale))] bg-black/40 text-white rounded-full px-1">
                ⌘0
              </span>
            </button>
            <div className="w-8 h-[1px] bg-[var(--border)] opacity-60" />
          </>
        )}

        {store.accounts.map((acc, index) => (
          <button
            key={acc.id}
            onClick={() => {
              store.setActiveAccount(acc);
              store.setSettingsOpen(false);
            }}
            title={acc.email}
            className={`relative flex items-center justify-center w-10 h-10 rounded-xl font-semibold border text-white transition-[border-color,opacity] duration-150 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 active:translate-y-px ${
              store.activeAccount?.id === acc.id 
                ? 'border-[var(--accent)] shadow-sm' 
                : 'border-[var(--border)] opacity-60 hover:opacity-100'
            }`}
            style={{ backgroundColor: acc.colorHex }}
          >
            <AccountAvatar acc={acc} showAvatars={store.settings.appearance.showAvatars} />
            <span className="absolute bottom-0 right-0 text-[calc(8px*var(--font-scale))] bg-black/40 text-white rounded-full px-1">
              ⌘{index + 1}
            </span>
          </button>
        ))}
        
        <button 
          onClick={() => store.onboardAccount('')}
          title="Connect Gmail Account"
          className="flex items-center justify-center w-10 h-10 rounded-xl border border-dashed border-[var(--strong-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] transition-[border-color,color] duration-150 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 active:translate-y-px"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <div className="flex flex-col gap-4 items-center">
        <button
          onClick={() => {
            const nextTheme = store.theme === 'system' ? 'light' : (store.theme === 'light' ? 'dark' : 'system');
            store.setTheme(nextTheme);
          }}
          title={
            store.theme === 'light' ? "Theme: Light (click to switch to Dark)" :
            store.theme === 'dark' ? "Theme: Dark (click to switch to System)" :
            "Theme: System (click to switch to Light)"
          }
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          {store.theme === 'light' ? <Sun className="w-4 h-4" /> :
           store.theme === 'dark' ? <Moon className="w-4 h-4" /> :
           <Monitor className="w-4 h-4" />}
        </button>
        <button
          onClick={() => store.setSettingsOpen(!store.settingsOpen)}
          title="Settings"
          className={`cursor-pointer ${store.settingsOpen ? 'text-[var(--accent)] scale-110' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          <Settings className="w-4.5 h-4.5" />
        </button>
        <button
          onClick={() => store.setAiPanelOpen(!store.aiPanelOpen)}
          title="Toggle AI Copilot"
          className={`cursor-pointer ${store.aiPanelOpen ? 'text-[var(--ai-accent)] scale-110' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          <Sparkles className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
