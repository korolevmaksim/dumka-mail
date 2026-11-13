// Model picker for the settings: the provider's own list (newest first) and
// `Other…` for typing an id. No model is built into the app, so nothing is
// suggested or preselected here; the list is what the provider returns for
// the user's key (see shared/aiModelCatalog.ts).
import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { SETTINGS_BUTTON_CLASS, SETTINGS_INPUT_CLASS, SETTINGS_SELECT_CLASS } from './SettingsControls';
import { buildModelChoices } from '../../../../shared/aiModelCatalog';
import { getAIProviderConfig, type ConfigurableAIProvider } from '../../../../shared/aiProviders';
import type { ProviderModelsStatus } from '../../hooks/useProviderModels';

// Select values that cannot be model ids.
const OTHER = '::other::';
const DEFAULT = '::default::';
const UNSET = '::unset::';

interface ModelPickerProps {
  id: string;
  provider: ConfigurableAIProvider;
  /** The chosen model id; '' means "not chosen" (or the inherited model, when `defaultLabel` is given). */
  value: string;
  onChange: (model: string) => void;
  /** The provider's loaded model list; empty when it was not loaded. */
  catalog: readonly string[];
  status: ProviderModelsStatus;
  /** Reloads the provider's list; omitted when it cannot be loaded (no key yet). */
  onRefresh?: () => void;
  /** Offers '' as a named choice, e.g. `Same as for chat (…)`. */
  defaultLabel?: string;
  describedBy?: string;
  disabled?: boolean;
}

export function ModelPicker({ id, provider, value, onChange, catalog, status, onRefresh, defaultLabel, describedBy, disabled }: ModelPickerProps) {
  const name = getAIProviderConfig(provider).displayName;
  const choices = useMemo(() => buildModelChoices(catalog, value), [catalog, value]);
  const hasList = choices.models.length > 0;
  const listed = choices.models.includes(value);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    setTyping(false);
  }, [provider]);

  // With nothing to list (before the first load) the id is typed.
  const showInput = typing || !hasList;
  const selectValue = typing ? OTHER : value === '' ? (defaultLabel ? DEFAULT : UNSET) : value;

  const choose = (next: string) => {
    if (next === OTHER) {
      setTyping(true);
      return;
    }
    setTyping(false);
    if (next === UNSET) return;
    onChange(next === DEFAULT ? '' : next);
  };

  const statusText = status === 'loading'
    ? `Loading models from ${name}…`
    : status === 'error'
      ? `Could not load the list from ${name}. You can still type a model name.`
      : choices.currentMissing
        ? `${name} does not list ${value}. Requests with it may fail.`
        : hasList
          ? `${choices.models.length} ${choices.models.length === 1 ? 'model' : 'models'} from ${name}, newest first.`
          : onRefresh
            ? `The list from ${name} is not loaded yet.`
            : 'Test the connection to load the list of models.';
  const statusTone = status === 'error' || choices.currentMissing ? 'text-[var(--danger-solid)]' : 'text-[var(--text-secondary)]';

  return (
    <div className="flex flex-col gap-1.5" data-model-picker={provider}>
      {hasList && (
        <select
          id={id}
          value={selectValue}
          onChange={event => choose(event.target.value)}
          aria-describedby={describedBy}
          disabled={disabled}
          className={`${SETTINGS_SELECT_CLASS} w-full`}
        >
          {defaultLabel && <option value={DEFAULT}>{defaultLabel}</option>}
          {!defaultLabel && value === '' && !typing && <option value={UNSET} disabled>Choose a model</option>}
          {value !== '' && !listed && <option value={value}>{value}</option>}
          {choices.models.map(model => <option key={model} value={model}>{model}</option>)}
          <option value={OTHER}>Other… (type a model name)</option>
        </select>
      )}
      {showInput && (
        <input
          id={hasList ? undefined : id}
          type="text"
          value={value}
          onChange={event => onChange(event.target.value.trim())}
          placeholder="Model name, exactly as the provider spells it"
          aria-label={hasList ? 'Model name' : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className={SETTINGS_INPUT_CLASS}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span role="status" aria-live="polite" data-model-picker-status className={`text-[calc(11px*var(--font-scale))] ${statusTone}`}>{statusText}</span>
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={status === 'loading' || disabled} className={SETTINGS_BUTTON_CLASS}>
            <RefreshCw aria-hidden="true" className={`h-3 w-3 ${status === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
            Refresh list
          </button>
        )}
      </div>
    </div>
  );
}
