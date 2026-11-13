import { useAppStore } from '../../../stores/AppStore';
import { SETTINGS_INPUT_CLASS, SETTINGS_SELECT_CLASS } from '../SettingsControls';
import { SettingRow, SettingToggleRow, SettingsCard, SettingsPage } from './SettingsPageParts';
import {
  DENSITY_OPTIONS,
  INTERFACE_STYLE_OPTIONS,
  MESSAGE_WIDTH_OPTIONS,
  TEXT_SIZE_OPTIONS,
  THEME_OPTIONS,
  appearanceToggleCopy,
  optionFor,
  textSizeOption,
} from './settingsCopy';
import type { AppearanceSettings } from '../../../../../shared/types';

const DEFAULT_ACCENT = '#668FEA';
const APPEARANCE_TOGGLES = ['showAvatars', 'useTranslucentPanels', 'enablePreviewPane'] as const;

export function AppearanceSettingsTab() {
  const store = useAppStore();
  const appearance = store.settings.appearance;
  const style = optionFor(INTERFACE_STYLE_OPTIONS, appearance.interfaceStyle, 'classic');
  const theme = optionFor(THEME_OPTIONS, appearance.theme, 'system');
  const density = optionFor(DENSITY_OPTIONS, appearance.density, 'comfortable');
  const textSize = textSizeOption(appearance.fontScale);
  const width = optionFor(MESSAGE_WIDTH_OPTIONS, appearance.readerMaxWidth, 'standard');
  const accentIsHex = /^#[0-9a-f]{6}$/i.test(appearance.accentColorHex);

  return (
    <SettingsPage pageKey="appearance" title="Appearance" description="How Dumka Mail looks on this Mac. Changes apply right away.">
      <SettingsCard>
        <SettingRow
          rowKey="interfaceStyle"
          title="Style"
          description={style.summary}
          control={({ titleId, descriptionId }) => (
            <div className="flex rounded-[7px] border border-[var(--border)] bg-[var(--app-bg)] p-0.5" role="group" aria-labelledby={titleId} aria-describedby={descriptionId}>
              {INTERFACE_STYLE_OPTIONS.map(option => {
                const selected = appearance.interfaceStyle === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => store.updateSettings(settings => { settings.appearance.interfaceStyle = option.value; })}
                    className={`min-w-[64px] rounded-[5px] px-3 h-[calc(var(--settings-control-h)-4px)] min-h-[24px] text-[calc(11px*var(--font-scale))] font-medium transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1 ${
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
          )}
        />

        <SettingRow
          rowKey="theme"
          title="Light or dark"
          description={theme.summary}
          labelForControl
          control={({ descriptionId, controlId }) => (
            <select
              id={controlId}
              aria-describedby={descriptionId}
              value={theme.value}
              onChange={event => {
                const value = event.target.value as AppearanceSettings['theme'];
                store.updateSettings(settings => { settings.appearance.theme = value; });
                store.setTheme(value);
              }}
              className={SETTINGS_SELECT_CLASS}
            >
              {THEME_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
        />

        <SettingRow
          rowKey="accentColor"
          title="Accent color"
          description="Used for selection, switches and highlighted buttons"
          control={({ titleId, descriptionId }) => (
            <>
              <input
                type="text"
                aria-label="Accent color as a hex code"
                aria-describedby={descriptionId}
                spellCheck={false}
                value={appearance.accentColorHex}
                onChange={event => {
                  const value = event.target.value;
                  store.updateSettings(settings => { settings.appearance.accentColorHex = value; });
                }}
                className={`${SETTINGS_INPUT_CLASS} w-[92px] font-mono`}
              />
              <input
                type="color"
                aria-labelledby={titleId}
                title="Pick a color"
                value={accentIsHex ? appearance.accentColorHex : DEFAULT_ACCENT}
                onChange={event => {
                  const value = event.target.value;
                  store.updateSettings(settings => { settings.appearance.accentColorHex = value; });
                }}
                className="h-[var(--settings-control-h)] min-h-[24px] w-8 shrink-0 cursor-pointer overflow-hidden rounded-[6px] border border-[var(--border)] bg-transparent p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
              />
            </>
          )}
        />
      </SettingsCard>

      <SettingsCard>
        <SettingRow
          rowKey="density"
          title="Spacing"
          description={density.summary}
          labelForControl
          control={({ descriptionId, controlId }) => (
            <select
              id={controlId}
              aria-describedby={descriptionId}
              value={density.value}
              onChange={event => {
                const value = event.target.value as AppearanceSettings['density'];
                store.updateSettings(settings => { settings.appearance.density = value; });
              }}
              className={SETTINGS_SELECT_CLASS}
            >
              {DENSITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
        />

        <SettingRow
          rowKey="fontScale"
          title="Text size"
          description={textSize.summary}
          labelForControl
          control={({ descriptionId, controlId }) => (
            <select
              id={controlId}
              aria-describedby={descriptionId}
              value={textSize.value}
              onChange={event => {
                const value = parseFloat(event.target.value);
                store.updateSettings(settings => { settings.appearance.fontScale = value; });
              }}
              className={SETTINGS_SELECT_CLASS}
            >
              {TEXT_SIZE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
        />

        <SettingRow
          rowKey="readerMaxWidth"
          title="Message width"
          description={width.summary}
          labelForControl
          control={({ descriptionId, controlId }) => (
            <select
              id={controlId}
              aria-describedby={descriptionId}
              value={width.value}
              onChange={event => {
                const value = event.target.value as NonNullable<AppearanceSettings['readerMaxWidth']>;
                store.updateSettings(settings => { settings.appearance.readerMaxWidth = value; });
              }}
              className={SETTINGS_SELECT_CLASS}
            >
              {MESSAGE_WIDTH_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          )}
        />
      </SettingsCard>

      <SettingsCard>
        {APPEARANCE_TOGGLES.map(key => {
          const on = Boolean(appearance[key]);
          const copy = appearanceToggleCopy(key, on);
          return (
            <SettingToggleRow
              key={key}
              rowKey={key}
              title={copy.title}
              description={copy.description}
              checked={on}
              onChange={value => store.updateSettings(settings => { settings.appearance[key] = value; })}
            />
          );
        })}
      </SettingsCard>
    </SettingsPage>
  );
}
