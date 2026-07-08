import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAppStore } from '../../../stores/AppStore';
import { RuleSimulatorPanel } from '../../automation/RuleSimulatorPanel';
import { Toggle } from '../SettingsControls';
import { labelDefinitionsForAccount, labelDisplayName } from '../../../../../shared/labels';
import type { MailAutomationRule, MailCategoryRule, MailRuleAction, MailRuleActionType } from '../../../../../shared/types';
import { GLOBAL_CLASSIFICATION_SCOPE, normalizeClassificationScope, scopeDisplayLabel } from './classificationScope';

interface MailRulesSettingsSectionProps {
  selectedScope: string;
}

function createRuleId(title: string, existing: MailAutomationRule[]): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'mail-rule';
  const existingIds = new Set(existing.map(rule => rule.id));
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function actionLabel(action: MailRuleAction): string {
  switch (action.type) {
    case 'archive':
      return 'Archive';
    case 'applyLabel':
      return `Apply label ${action.labelId || ''}`.trim();
    case 'moveToLabel':
      return `Move to label ${action.labelId || ''}`.trim();
    case 'forward':
      return `Forward to ${action.forwardTo || ''}`.trim();
    case 'autoReply':
      return 'Auto reply';
    default:
      return action.type;
  }
}

export function MailRulesSettingsSection({ selectedScope }: MailRulesSettingsSectionProps) {
  const store = useAppStore();
  const normalizedScope = normalizeClassificationScope(selectedScope);
  const scopeLabel = scopeDisplayLabel(normalizedScope, store.accounts, { compactGlobal: true });
  const scopedRules = store.settings.mailRules.rules.filter(rule => (
    normalizeClassificationScope(rule.accountId) === normalizedScope
  ));
  const labelOptions = useMemo(() => (
    normalizedScope === GLOBAL_CLASSIFICATION_SCOPE
      ? []
      : labelDefinitionsForAccount(store.labelDefinitions, normalizedScope).filter(label => label.type === 'user')
  ), [store.labelDefinitions, normalizedScope]);

  const [conditionField, setConditionField] = useState<MailCategoryRule['field']>('from');
  const [conditionOperation, setConditionOperation] = useState<MailCategoryRule['operation']>('contains');
  const [conditionValue, setConditionValue] = useState('');
  const [actionType, setActionType] = useState<MailRuleActionType>('archive');
  const [labelId, setLabelId] = useState('');
  const [forwardTo, setForwardTo] = useState('');
  const [replyBody, setReplyBody] = useState('');

  const addRule = () => {
    const value = conditionValue.trim();
    if (!value) return;

    let action: MailRuleAction;
    if (actionType === 'archive') {
      action = { id: 'archive', type: 'archive' };
    } else if ((actionType === 'applyLabel' || actionType === 'moveToLabel') && labelId) {
      action = { id: actionType, type: actionType, labelId };
    } else if (actionType === 'forward' && forwardTo.trim()) {
      action = { id: 'forward', type: 'forward', forwardTo: forwardTo.trim() };
    } else if (actionType === 'autoReply' && replyBody.trim()) {
      action = { id: 'auto-reply', type: 'autoReply', replyBody: replyBody.trim() };
    } else {
      return;
    }

    const title = `${conditionField} ${conditionOperation} ${value}`;
    store.updateSettings(settings => {
      const rule: MailAutomationRule = {
        id: createRuleId(title, settings.mailRules.rules),
        title,
        isEnabled: true,
        accountId: normalizedScope,
        matchMode: 'all',
        conditions: [{
          id: crypto.randomUUID(),
          field: conditionField,
          operation: conditionOperation,
          value,
          isNegated: false,
          accountId: normalizedScope,
        }],
        actions: [action],
      };
      settings.mailRules.enabled = true;
      settings.mailRules.rules = [...settings.mailRules.rules, rule];
    });

    setConditionValue('');
    if (actionType === 'autoReply') setReplyBody('');
  };

  const updateRule = (id: string, updater: (rule: MailAutomationRule) => MailAutomationRule) => {
    store.updateSettings(settings => {
      settings.mailRules.rules = settings.mailRules.rules.map(rule => (
        rule.id === id ? updater(rule) : rule
      ));
    });
  };

  const deleteRule = (id: string) => {
    store.updateSettings(settings => {
      settings.mailRules.rules = settings.mailRules.rules.filter(rule => rule.id !== id);
    });
  };

  return (
    <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Automatic Mail Actions</span>
          <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Apply archive, label, forward, or auto-reply actions when synced threads match rules.</span>
        </div>
        <Toggle
          checked={store.settings.mailRules.enabled}
          onChange={(enabled) => store.updateSettings(settings => { settings.mailRules.enabled = enabled; })}
        />
      </div>

      <div className="grid grid-cols-1 gap-2">
        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <select
            value={conditionField}
            onChange={(event) => setConditionField(event.target.value as MailCategoryRule['field'])}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]"
          >
            <option value="from">From</option>
            <option value="senderDomain">Sender domain</option>
            <option value="subject">Subject</option>
            <option value="systemSignal">System signal</option>
          </select>
          <select
            value={conditionOperation}
            onChange={(event) => setConditionOperation(event.target.value as MailCategoryRule['operation'])}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]"
          >
            <option value="contains">Contains</option>
            <option value="equals">Equals</option>
            <option value="startsWith">Starts with</option>
            <option value="endsWith">Ends with</option>
          </select>
        </div>
        <input
          type="text"
          value={conditionValue}
          onChange={(event) => setConditionValue(event.target.value)}
          placeholder={conditionField === 'systemSignal' ? 'purchase, automation, unread, attachment' : 'Value to match'}
          className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
        />
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <select
            value={actionType}
            onChange={(event) => setActionType(event.target.value as MailRuleActionType)}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]"
          >
            <option value="archive">Archive</option>
            {labelOptions.length > 0 && <option value="applyLabel">Apply label</option>}
            {labelOptions.length > 0 && <option value="moveToLabel">Move to label</option>}
            <option value="forward">Forward</option>
            <option value="autoReply">Auto reply</option>
          </select>
          {actionType === 'applyLabel' || actionType === 'moveToLabel' ? (
            <select
              value={labelId}
              onChange={(event) => setLabelId(event.target.value)}
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]"
            >
              <option value="">Choose label</option>
              {labelOptions.map(label => (
                <option key={label.id} value={label.id}>{labelDisplayName(label.name || label.id)}</option>
              ))}
            </select>
          ) : actionType === 'autoReply' ? (
            <input
              type="text"
              value="Threaded reply"
              disabled
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] outline-none disabled:opacity-70"
            />
          ) : (
            <input
              type="email"
              value={forwardTo}
              onChange={(event) => setForwardTo(event.target.value)}
              disabled={actionType !== 'forward'}
              placeholder={actionType === 'forward' ? 'forward@example.com' : scopeLabel}
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none disabled:opacity-50"
            />
          )}
          <button
            type="button"
            onClick={addRule}
            className="px-4 py-1 bg-[var(--accent)] text-white rounded font-medium text-[calc(11px*var(--font-scale))] hover:bg-[var(--accent)]/90"
          >
            Add
          </button>
        </div>
        {actionType === 'autoReply' && (
          <textarea
            value={replyBody}
            onChange={(event) => setReplyBody(event.target.value)}
            placeholder="Reply body"
            rows={3}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none resize-none"
          />
        )}
      </div>

      {scopedRules.length === 0 ? (
        <div className="bg-[var(--panel-bg)] border border-dashed border-[var(--border)] rounded-md px-3 py-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
          No automatic action rules for {scopeLabel}.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {scopedRules.map(rule => (
            <div key={rule.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2">
              <div className="min-w-0 flex flex-col gap-0.5 text-[calc(10px*var(--font-scale))]">
                <span className="truncate text-[var(--text-primary)]">{rule.title}</span>
                <span className="truncate text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
                  {rule.actions.map(actionLabel).join(', ')} · {scopeLabel}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Toggle
                  checked={rule.isEnabled}
                  onChange={(enabled) => updateRule(rule.id, current => ({ ...current, isEnabled: enabled }))}
                />
                <button
                  type="button"
                  title="Delete rule"
                  onClick={() => deleteRule(rule.id)}
                  className="p-1 rounded hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--danger)]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <RuleSimulatorPanel compact />
    </div>
  );
}
