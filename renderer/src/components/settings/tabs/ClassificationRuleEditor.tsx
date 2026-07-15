import { useEffect, useState } from 'react';
import type {
  Account,
  CustomClassifierRule,
  EmailAddressSuggestion,
  MailTextRuleField,
  TabCategory,
} from '../../../../../shared/types';
import {
  canonicalRuleValueFields,
  normalizeRuleValues,
  parseRuleValueInput,
  ruleValues,
  supportsMultipleRuleValues,
} from '../../../../../shared/classificationRules';
import { GLOBAL_CLASSIFICATION_SCOPE, categoryRouteLabel } from './classificationScope';
import { RuleValuesCombobox } from './RuleValuesCombobox';

type RuleCondition = CustomClassifierRule['condition'];

interface ClassificationRuleEditorProps {
  selectedScope: string;
  selectedScopeLabel: string;
  routeTargetCategories: TabCategory[];
  allCategories: TabCategory[];
  accounts: Account[];
  editingRule: CustomClassifierRule | null;
  onCreate: (rule: Omit<CustomClassifierRule, 'id'>) => void;
  onUpdate: (id: string, rule: Partial<CustomClassifierRule>) => void;
  onCancelEdit: () => void;
}

export function ClassificationRuleEditor({
  selectedScope,
  selectedScopeLabel,
  routeTargetCategories,
  allCategories,
  accounts,
  editingRule,
  onCreate,
  onUpdate,
  onCancelEdit,
}: ClassificationRuleEditorProps) {
  const [field, setField] = useState<MailTextRuleField>(() => editingRule?.field || 'from');
  const [condition, setCondition] = useState<RuleCondition>(() => editingRule?.condition || 'contains');
  const [values, setValues] = useState<string[]>(() => editingRule ? ruleValues(editingRule) : []);
  const [pendingValue, setPendingValue] = useState('');
  const [targetCategory, setTargetCategory] = useState(
    () => editingRule?.targetCategory || routeTargetCategories[0]?.id || 'other',
  );
  const [suggestions, setSuggestions] = useState<EmailAddressSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const multiValue = supportsMultipleRuleValues(field);
  const routeTargetKey = routeTargetCategories.map(category => category.id).join('|');

  useEffect(() => {
    if (!routeTargetCategories.some(category => category.id === targetCategory)) {
      setTargetCategory(routeTargetCategories[0]?.id || 'other');
    }
  }, [routeTargetKey, targetCategory]);

  useEffect(() => {
    let active = true;
    setSuggestionsLoading(true);
    const accountId = selectedScope === GLOBAL_CLASSIFICATION_SCOPE ? undefined : selectedScope;
    void window.electronAPI.listEmailSuggestions(accountId, 500)
      .then(items => {
        if (active) setSuggestions(items);
      })
      .catch(error => {
        console.error('Classification email suggestions failed:', error);
        if (active) setSuggestions([]);
      })
      .finally(() => {
        if (active) setSuggestionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedScope]);

  const pendingValues = multiValue ? parseRuleValueInput(pendingValue) : [];
  const normalizedValues = normalizeRuleValues(field, '', [...values, ...pendingValues]);
  const canSave = normalizedValues.length > 0 && Boolean(targetCategory);

  const save = () => {
    if (!canSave) return;
    const valueFields = canonicalRuleValueFields(field, normalizedValues);
    const draft: Omit<CustomClassifierRule, 'id'> = {
      field,
      condition,
      ...valueFields,
      targetCategory,
      active: editingRule?.active ?? true,
      accountId: selectedScope,
    };

    if (editingRule) {
      onUpdate(editingRule.id, draft);
      onCancelEdit();
      return;
    }

    onCreate(draft);
    setValues([]);
    setPendingValue('');
  };

  return (
    <div className={`border rounded-lg p-4 flex flex-col gap-3 ${
      editingRule
        ? 'border-[var(--accent)] bg-[var(--accent)]/[0.04]'
        : 'border-[var(--border)] bg-[var(--rail-bg)]'
    }`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
          {editingRule ? 'Edit Classification Rule' : 'Add Custom Classification Rule'}
        </span>
        <span className="max-w-[260px] truncate text-[calc(8px*var(--font-scale))] text-[var(--text-secondary)]">
          {selectedScopeLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
          Match Field:
          <select
            value={field}
            onChange={event => {
              const nextField = event.currentTarget.value as MailTextRuleField;
              setField(nextField);
              setPendingValue('');
              if (!supportsMultipleRuleValues(nextField) && values.length > 1) {
                setValues(values.slice(0, 1));
              }
            }}
            className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            <option value="from">Sender Email (From)</option>
            <option value="senderDomain">Sender Domain</option>
            <option value="to">Recipient Email (To)</option>
            <option value="cc">Carbon Copy Email (Cc)</option>
            <option value="subject">Subject Line</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
          Condition:
          <select
            value={condition}
            onChange={event => setCondition(event.currentTarget.value as RuleCondition)}
            className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            <option value="contains">Contains</option>
            <option value="equals">Equals</option>
            <option value="startsWith">Starts With</option>
            <option value="endsWith">Ends With</option>
          </select>
        </label>
      </div>

      {multiValue ? (
        <RuleValuesCombobox
          values={values}
          inputValue={pendingValue}
          suggestions={suggestions}
          suggestionsLoading={suggestionsLoading}
          onChange={setValues}
          onInputChange={setPendingValue}
        />
      ) : (
        <label className="flex flex-col gap-1 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
          Match Value:
          <input
            value={values[0] || ''}
            onChange={event => setValues([event.currentTarget.value])}
            placeholder={field === 'senderDomain' ? 'e.g. github.com' : 'e.g. invoice'}
            className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)]"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
        Target Split:
        <select
          value={targetCategory}
          onChange={event => setTargetCategory(event.currentTarget.value)}
          className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        >
          {routeTargetCategories.map(category => (
            <option key={category.id} value={category.id}>
              {categoryRouteLabel(category.id, allCategories, accounts)}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className="h-[26px] rounded bg-[var(--accent)] px-4 text-[calc(11px*var(--font-scale))] font-medium text-white hover:bg-[var(--accent)]/90 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {editingRule ? 'Save Changes' : 'Add Rule'}
        </button>
        {editingRule && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="h-[26px] rounded border border-[var(--border)] px-3 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
