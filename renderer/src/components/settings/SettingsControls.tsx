import React from 'react';

// Premium iOS-style switch (replaces raw <input type=checkbox>).
export function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-full transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 active:scale-95 ${
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--strong-border)]'
      }`}
    >
      <span
        className={`inline-block h-[14px] w-[14px] transform rounded-full bg-white shadow-sm transition-transform duration-150 ${
          checked ? 'translate-x-[14px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

// A labelled settings row with a trailing switch, density-aware height.
export function SettingsToggleRow({
  title,
  desc,
  checked,
  onChange,
  disabled = false,
}: {
  title: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 min-h-[var(--settings-row-min-h)] py-[var(--settings-row-py)]">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[calc(12px*var(--font-scale))] font-medium text-[var(--text-primary)]">{title}</span>
        {desc && <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{desc}</span>}
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

// Accent-icon pane header (18px icon + title + subtitle).
export function SettingsPaneHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 mb-1">
      <span className="flex items-center justify-center w-[26px] h-[26px] rounded-[7px] bg-[var(--accent)]/12 shrink-0 mt-0.5">
        <Icon className="w-[15px] h-[15px] text-[var(--accent)]" />
      </span>
      <div className="flex flex-col">
        <h2 className="text-[calc(16px*var(--font-scale))] font-semibold text-[var(--text-primary)] leading-tight">{title}</h2>
        {subtitle && <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}
