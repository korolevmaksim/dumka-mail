import { useAppStore } from '../../../stores/AppStore';
import { Toggle } from '../SettingsControls';

export function AppearanceSettingsTab() {
  const store = useAppStore();

  return (
    <div className="flex flex-col gap-4 max-w-[600px]">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Appearance Settings</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Choose an interface style, color mode, spacing density, and reading scale.</p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Interface Style</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Switch the visual system without changing navigation or behavior</span>
          </div>
          <div className="flex rounded-lg bg-[var(--app-bg)] p-1" role="group" aria-label="Interface style">
            {([
              { value: 'classic', label: 'Classic' },
              { value: 'soft', label: 'Soft' },
            ] as const).map(option => {
              const selected = store.settings.appearance.interfaceStyle === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => store.updateSettings(settings => { settings.appearance.interfaceStyle = option.value; })}
                  className={`min-w-[72px] rounded-md px-3 py-1.5 text-[calc(10px*var(--font-scale))] font-semibold transition-[background-color,color,box-shadow] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1 ${
                    selected
                      ? 'bg-[var(--raised-surface)] text-[var(--text-primary)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">App Theme Mode</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Select light, dark, or system matching settings</span>
          </div>
          <select
            value={store.settings.appearance.theme}
            onChange={(e) => {
              const val = e.target.value as any;
              store.updateSettings(s => { s.appearance.theme = val; });
              store.setTheme(val);
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="light">Light Mode</option>
            <option value="dark">Dark Mode</option>
            <option value="system">System Theme</option>
          </select>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Spacing Layout Density</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Choose compact row spacing or comfortable padding</span>
          </div>
          <select
            value={store.settings.appearance.density}
            onChange={(e) => {
              const val = e.target.value as any;
              store.updateSettings(s => { s.appearance.density = val; });
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="compact">Compact (Dense)</option>
            <option value="comfortable">Comfortable (Balanced)</option>
            <option value="spacious">Spacious (Open)</option>
          </select>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Font Size</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Scale all text proportionally (layout stays fixed)</span>
          </div>
          <select
            value={store.settings.appearance.fontScale ?? 1.0}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              store.updateSettings(s => { s.appearance.fontScale = val; });
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value={0.85}>85% (Small)</option>
            <option value={0.9}>90% (Compact)</option>
            <option value={1.0}>100% (Default)</option>
            <option value={1.1}>110% (Large)</option>
            <option value={1.15}>115% (Extra Large)</option>
            <option value={1.2}>120% (Maximum)</option>
          </select>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Custom Accent Color</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Primary highlight colors used on borders and buttons</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              className="w-20 bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] font-mono outline-none"
              value={store.settings.appearance.accentColorHex}
              onChange={(e) => {
                const val = e.target.value;
                store.updateSettings(s => { s.appearance.accentColorHex = val; });
              }}
            />
            <input
              type="color"
              className="w-6 h-6 border-0 bg-transparent cursor-pointer rounded-md overflow-hidden shrink-0"
              value={store.settings.appearance.accentColorHex.startsWith('#') ? store.settings.appearance.accentColorHex : '#668FEA'}
              onChange={(e) => {
                const val = e.target.value;
                store.updateSettings(s => { s.appearance.accentColorHex = val; });
              }}
            />
          </div>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Email Reader Max Width</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Limit email width for better readability on large screens</span>
          </div>
          <select
            value={store.settings.appearance.readerMaxWidth ?? 'standard'}
            onChange={(e) => {
              const val = e.target.value as any;
              store.updateSettings(s => { s.appearance.readerMaxWidth = val; });
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="full">Full Width</option>
            <option value="wide">Wide (1000px)</option>
            <option value="standard">Standard (800px)</option>
            <option value="narrow">Narrow (600px)</option>
          </select>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        {[
          { key: 'showAvatars', title: 'Display User Avatars', desc: 'Load avatar images or show fallback abbreviations in sidebar' },
          { key: 'useTranslucentPanels', title: 'Translucent Window Panels', desc: 'Enable macOS native backdrop filter vibrancy (requires restart)' },
          { key: 'enablePreviewPane', title: 'Enable Preview Pane', desc: 'Show inline thread reader alongside the mail list' },
        ].map(item => (
          <div key={item.key} className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{item.title}</span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{item.desc}</span>
            </div>
            <Toggle checked={(store.settings.appearance as any)[item.key]} onChange={(val) => store.updateSettings(s => { (s.appearance as any)[item.key] = val; })} />
          </div>
        ))}
      </div>
    </div>
  );
}
