// The look of the account page (`AccountSettingsPage.tsx`), shared by the App
// settings pages: the same column, header, card, row and title / description
// typography. A row is a title, one line that says what the setting does in
// its current state, and the control on the right.
import { useId, type ReactNode } from 'react';
import { Toggle } from '../SettingsControls';

export const SETTING_TITLE_CLASS = 'text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]';
export const SETTING_DESC_CLASS = 'text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]';
export const SETTING_GROUP_TITLE_CLASS = 'px-1 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-secondary)]';
export const KEY_CAP_CLASS = 'inline-flex min-w-[20px] shrink-0 items-center justify-center rounded-[5px] border border-[var(--border)] bg-[var(--app-bg)] px-1.5 py-0.5 font-mono text-[calc(11px*var(--font-scale))] leading-none text-[var(--text-primary)]';

/** The page column: same width and spacing as the account page. */
export function SettingsPage({ title, description, actions, children, pageKey }: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  pageKey: string;
}) {
  const headingId = useId();
  return (
    <section
      data-settings-page={pageKey}
      aria-labelledby={headingId}
      className="flex w-full max-w-[760px] flex-col gap-4 select-text"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id={headingId} className="min-w-0 truncate text-[calc(18px*var(--font-scale))] font-semibold leading-tight text-[var(--text-primary)]">
            {title}
          </h2>
          <p className={`${SETTING_DESC_CLASS} max-w-[560px]`}>{description}</p>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function SettingsCard({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div
      role={label ? 'group' : undefined}
      aria-label={label}
      className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--rail-bg)]"
    >
      {children}
    </div>
  );
}

/** A small heading above a card, for pages with several groups. */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-1.5">
      <h3 id={titleId} className={SETTING_GROUP_TITLE_CLASS}>{title}</h3>
      {children}
    </div>
  );
}

export interface SettingRowProps {
  rowKey: string;
  title: string;
  description: ReactNode;
  /** Renders the control; receives ids so it can be labelled and described. */
  control?: (ids: { titleId: string; descriptionId: string; controlId: string }) => ReactNode;
  /** Title becomes a `<label>` for the control (selects, inputs). */
  labelForControl?: boolean;
  children?: ReactNode;
}

export function SettingRow({ rowKey, title, description, control, labelForControl = false, children }: SettingRowProps) {
  const titleId = useId();
  const descriptionId = useId();
  const controlId = useId();
  return (
    <div
      data-setting-row={rowKey}
      role="group"
      aria-labelledby={titleId}
      className="flex flex-col gap-3 px-4 py-[max(var(--settings-row-py),10px)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-[240px] flex-col gap-0.5">
          {labelForControl ? (
            <label id={titleId} htmlFor={controlId} className={SETTING_TITLE_CLASS}>{title}</label>
          ) : (
            <span id={titleId} className={SETTING_TITLE_CLASS}>{title}</span>
          )}
          <span id={descriptionId} className={SETTING_DESC_CLASS}>{description}</span>
        </div>
        {control && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {control({ titleId, descriptionId, controlId })}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/** A row whose control is a switch; `description` must describe the state the switch is in. */
export function SettingToggleRow({ rowKey, title, description, checked, onChange, disabled = false }: {
  rowKey: string;
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SettingRow
      rowKey={rowKey}
      title={title}
      description={description}
      control={({ titleId, descriptionId, controlId }) => (
        <Toggle
          id={controlId}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          ariaLabelledBy={titleId}
          ariaDescribedBy={descriptionId}
        />
      )}
    />
  );
}

/** Key caps for a binding such as `⌘⇧E / E` (alternatives) or `G/⇧G`. */
export function KeyCaps({ keys }: { keys: string }) {
  const alternatives = keys.split(' / ');
  return (
    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {alternatives.map((alternative, index) => (
        <span key={`${alternative}-${index}`} className="flex items-center gap-1">
          {index > 0 && <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">or</span>}
          <kbd className={KEY_CAP_CLASS}>{alternative}</kbd>
        </span>
      ))}
    </span>
  );
}
