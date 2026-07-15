import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../stores/AppStore';
import { Trash2, GripVertical, Pencil } from 'lucide-react';
import { emitToast } from '../../../lib/toastBus';
import type { MailTextRuleField, TabCategory } from '../../../../../shared/types';
import { ruleValues } from '../../../../../shared/classificationRules';
import { MailRulesSettingsSection } from './MailRulesSettingsSection';
import { ClassificationRuleEditor } from './ClassificationRuleEditor';
import {
  GLOBAL_CLASSIFICATION_SCOPE,
  accountDetail,
  accountLabel,
  accountMatchesScope,
  categoryBelongsToScope,
  categoryRouteLabel,
  categoryScope,
  normalizeClassificationScope,
  reorderCategoriesWithinScope,
  routeTargetBelongsToScope,
  ruleBelongsToScope,
  scopeDisplayLabel,
} from './classificationScope';

const CLASSIFICATION_FIELD_LABELS: Record<MailTextRuleField, string> = {
  from: 'Sender (From)',
  senderDomain: 'Sender Domain',
  to: 'Recipient (To)',
  cc: 'Carbon Copy (Cc)',
  subject: 'Subject Line',
};

export function ClassificationSettingsTab() {
  const store = useAppStore();
  const [selectedScope, setSelectedScope] = useState<string>(GLOBAL_CLASSIFICATION_SCOPE);
  const [draggedSettingId, setDraggedSettingId] = useState<string | null>(null);
  const [dragOverSettingId, setDragOverSettingId] = useState<string | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<TabCategory | null>(null);
  const [categoryToEdit, setCategoryToEdit] = useState<TabCategory | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const editDialogRef = useRef<HTMLDivElement>(null);
  const editNameInputRef = useRef<HTMLInputElement>(null);
  const normalizedSelectedScope = normalizeClassificationScope(selectedScope);
  const selectedScopeLabel = scopeDisplayLabel(normalizedSelectedScope, store.accounts);
  const scopeOptions = [
    { id: GLOBAL_CLASSIFICATION_SCOPE, label: 'Global', detail: 'All accounts', colorHex: '' },
    ...store.accounts.map(account => ({
      id: normalizeClassificationScope(account.email),
      label: accountLabel(store.accounts, account.email),
      detail: accountDetail(store.accounts, account.email),
      colorHex: account.colorHex,
    })),
  ];
  const visibleCategories = store.tabCategories.filter(category => categoryBelongsToScope(category, normalizedSelectedScope));
  const routeTargetCategories = store.tabCategories.filter(category => (
    category.active && routeTargetBelongsToScope(category, normalizedSelectedScope)
  ));
  const visibleRules = store.customClassifierRules.filter(rule => ruleBelongsToScope(rule, normalizedSelectedScope));
  const editingRule = visibleRules.find(rule => rule.id === editingRuleId) || null;

  useEffect(() => {
    if (normalizedSelectedScope === GLOBAL_CLASSIFICATION_SCOPE) return;
    if (!store.accounts.some(account => accountMatchesScope(account, normalizedSelectedScope))) {
      setSelectedScope(GLOBAL_CLASSIFICATION_SCOPE);
    }
  }, [normalizedSelectedScope, store.accounts]);

  const trapDialogTab = (event: KeyboardEvent, dialog: HTMLDivElement | null) => {
    if (event.key !== 'Tab' || !dialog) return;

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1);

    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    if (!categoryToDelete) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => deleteCancelRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setCategoryToDelete(null);
        return;
      }
      trapDialogTab(event, deleteDialogRef.current);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [categoryToDelete?.id]);

  useEffect(() => {
    if (!categoryToEdit) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => editNameInputRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setCategoryToEdit(null);
        return;
      }
      trapDialogTab(event, editDialogRef.current);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [categoryToEdit?.id]);

  const handleDragStartSetting = (e: React.DragEvent, id: string) => {
    setDraggedSettingId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverSetting = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragEnterSetting = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDragOverSettingId(id);
  };

  const handleDropSetting = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (draggedSettingId && draggedSettingId !== targetId) {
      const newCategories = reorderCategoriesWithinScope(
        store.tabCategories,
        draggedSettingId,
        targetId,
        normalizedSelectedScope,
      );
      if (newCategories !== store.tabCategories) {
        store.updateTabCategoriesOrder(newCategories);
      }
    }
    setDraggedSettingId(null);
    setDragOverSettingId(null);
  };

  const handleDragEndSetting = () => {
    setDraggedSettingId(null);
    setDragOverSettingId(null);
  };

  return (
    <div className="flex flex-col gap-5 max-w-[600px] select-text">
      {/* Delete Confirmation Modal */}
      {categoryToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[999] fade-in select-none">
          <div
            ref={deleteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-category-title"
            aria-describedby="delete-category-description"
            className="dm-overlay bg-[var(--panel-bg)] border border-[var(--border)] rounded-xl shadow-2xl p-5 max-w-[340px] w-full flex flex-col gap-4 scale-up-in select-text"
          >
            <div className="flex flex-col gap-1.5">
              <span id="delete-category-title" className="text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Delete Custom Tab?</span>
              <p id="delete-category-description" className="text-[calc(10.5px*var(--font-scale))] text-[var(--text-secondary)] leading-relaxed">
                Are you sure you want to delete the tab <strong className="text-[var(--text-primary)]">“{categoryToDelete.displayName}”</strong>?
                Any classification rules targeting this tab will be automatically routed to <strong className="text-[var(--text-primary)]">Other</strong>.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                ref={deleteCancelRef}
                type="button"
                onClick={() => setCategoryToDelete(null)}
                className="px-3 py-1.5 border border-[var(--border)] hover:bg-[var(--border)]/20 text-[var(--text-secondary)] rounded-lg font-medium text-[calc(11px*var(--font-scale))] cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  store.deleteTabCategory(categoryToDelete.id);
                  setCategoryToDelete(null);
                  emitToast({ type: 'success', message: `Deleted tab “${categoryToDelete.displayName}”` });
                }}
                className="px-3 py-1.5 bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90 rounded-lg font-semibold text-[calc(11px*var(--font-scale))] cursor-pointer transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Category Modal */}
      {categoryToEdit && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[999] fade-in select-none">
          <div
            ref={editDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-category-title"
            aria-describedby="edit-category-description"
            className="dm-overlay bg-[var(--panel-bg)] border border-[var(--border)] rounded-xl shadow-2xl p-5 max-w-[360px] w-full flex flex-col gap-4 scale-up-in select-text"
          >
            <div className="flex flex-col gap-1">
              <span id="edit-category-title" className="text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Edit Tab Category</span>
              <p id="edit-category-description" className="text-[calc(10.5px*var(--font-scale))] text-[var(--text-secondary)]">Modify settings for the selected tab category.</p>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="edit-category-name" className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Tab Name:</label>
                <input
                  ref={editNameInputRef}
                  id="edit-category-name"
                  type="text"
                  value={categoryToEdit.displayName}
                  onChange={(e) => setCategoryToEdit({ ...categoryToEdit, displayName: e.target.value })}
                  placeholder="e.g. Work, Github, Family"
                  className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none w-full h-[26px]"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="edit-category-color" className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Color:</label>
                <select
                  id="edit-category-color"
                  value={categoryToEdit.colorHex || '#8b5cf6'}
                  onChange={(e) => setCategoryToEdit({ ...categoryToEdit, colorHex: e.target.value })}
                  className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer w-full h-[26px]"
                >
                  <option value="#8b5cf6">Purple</option>
                  <option value="#10b981">Green</option>
                  <option value="#3b82f6">Blue</option>
                  <option value="#ef4444">Red</option>
                  <option value="#f59e0b">Yellow</option>
                  <option value="#ec4899">Pink</option>
                  <option value="#14b8a6">Teal</option>
                </select>
              </div>

              {!categoryToEdit.isSystem && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="edit-category-account" className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Scope:</label>
                  <select
                    id="edit-category-account"
                    value={normalizeClassificationScope(categoryToEdit.accountId)}
                    onChange={(e) => setCategoryToEdit({ ...categoryToEdit, accountId: normalizeClassificationScope(e.target.value) })}
                    className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer w-full h-[26px]"
                  >
                    <option value={GLOBAL_CLASSIFICATION_SCOPE}>Global</option>
                    {store.accounts.map(acc => (
                      <option key={acc.id} value={normalizeClassificationScope(acc.email)}>{acc.displayName || acc.email}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setCategoryToEdit(null)}
                className="px-3 py-1.5 border border-[var(--border)] hover:bg-[var(--border)]/20 text-[var(--text-secondary)] rounded-lg font-medium text-[calc(11px*var(--font-scale))] cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!categoryToEdit.displayName.trim()}
                onClick={() => {
                  if (!categoryToEdit.displayName.trim()) return;
                  store.updateTabCategory(categoryToEdit.id, {
                    displayName: categoryToEdit.displayName.trim(),
                    colorHex: categoryToEdit.colorHex,
                    accountId: categoryToEdit.isSystem ? undefined : normalizeClassificationScope(categoryToEdit.accountId)
                  });
                  setCategoryToEdit(null);
                  emitToast({ type: 'success', message: `Saved changes to “${categoryToEdit.displayName}”` });
                }}
                className="px-3 py-1.5 bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-semibold text-[calc(11px*var(--font-scale))] cursor-pointer transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Classification Rules</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Create custom routing rules to sort mail based on headers or domains.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[calc(9px*var(--font-scale))] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Scope</span>
        <div className="flex gap-1.5 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--rail-bg)] p-1">
          {scopeOptions.map(option => {
            const active = option.id === normalizedSelectedScope;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setEditingRuleId(null);
                  setSelectedScope(option.id);
                }}
                title={option.detail ? `${option.label} · ${option.detail}` : option.label}
                className={`min-w-[116px] max-w-[190px] h-[34px] px-2.5 rounded-md flex items-center gap-2 text-left shrink-0 transition-colors ${
                  active
                    ? 'bg-[var(--accent)] text-white shadow-sm'
                    : 'bg-[var(--panel-bg)] text-[var(--text-primary)] hover:bg-[var(--border)]/20'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${option.colorHex ? '' : 'border border-current opacity-70'}`}
                  style={option.colorHex ? { backgroundColor: option.colorHex } : undefined}
                />
                <span className="min-w-0 flex flex-col leading-tight">
                  <span className="truncate text-[calc(10px*var(--font-scale))] font-semibold">{option.label}</span>
                  {option.detail && (
                    <span className={`truncate text-[calc(8px*var(--font-scale))] ${active ? 'text-white/75' : 'text-[var(--text-secondary)]'}`}>{option.detail}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Manage Inbox Tabs */}
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Manage Inbox Tabs</span>
        <div className="flex flex-col gap-2 p-3 bg-[var(--panel-bg)] border border-[var(--border)] rounded-md">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Create Custom Tab</span>
            <span className="text-[calc(8px*var(--font-scale))] text-[var(--text-secondary)] truncate max-w-[260px]">{selectedScopeLabel}</span>
          </div>
          <div className="flex gap-2.5 items-end flex-wrap sm:flex-nowrap w-full">
            <div className="flex-1 min-w-[140px] flex flex-col gap-1">
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Tab Name:</span>
              <input
                id="new-tab-name-pref"
                type="text"
                placeholder="e.g. Work, Github, Family"
                className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none w-full h-[26px]"
              />
            </div>
            <div className="w-[100px] flex flex-col gap-1 shrink-0">
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Color:</span>
              <select
                id="new-tab-color-pref"
                className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer w-full h-[26px]"
              >
                <option value="#8b5cf6">Purple</option>
                <option value="#10b981">Green</option>
                <option value="#3b82f6">Blue</option>
                <option value="#ef4444">Red</option>
                <option value="#f59e0b">Yellow</option>
                <option value="#ec4899">Pink</option>
                <option value="#14b8a6">Teal</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                const nameEl = document.getElementById('new-tab-name-pref') as HTMLInputElement;
                const colorEl = document.getElementById('new-tab-color-pref') as HTMLSelectElement;
                if (!nameEl.value.trim()) return;
                store.addTabCategory(nameEl.value.trim(), colorEl.value, normalizedSelectedScope);
                nameEl.value = '';
              }}
              className="px-3.5 py-1 bg-[var(--accent)] text-white rounded font-medium text-[calc(11px*var(--font-scale))] cursor-pointer hover:bg-[var(--accent)]/90 transition-colors h-[26px] shrink-0"
            >
              Add
            </button>
          </div>
        </div>

        {/* Draggable tab list */}
        <div className="flex flex-col gap-1.5 mt-1.5">
          {visibleCategories.length === 0 ? (
            <div className="bg-[var(--panel-bg)] border border-dashed border-[var(--border)] rounded px-3 py-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
              No custom tabs for {selectedScopeLabel}.
            </div>
          ) : visibleCategories.map((category) => (
            <div
              key={category.id}
              draggable
              onDragStart={(e) => handleDragStartSetting(e, category.id)}
              onDragOver={handleDragOverSetting}
              onDragEnter={(e) => handleDragEnterSetting(e, category.id)}
              onDragEnd={handleDragEndSetting}
              onDrop={(e) => handleDropSetting(e, category.id)}
              className={`flex items-center justify-between bg-[var(--panel-bg)] border rounded px-3 py-1 transition-all ${
                draggedSettingId === category.id 
                  ? 'opacity-40 scale-[0.98]' 
                  : dragOverSettingId === category.id && draggedSettingId !== category.id
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                  : 'border-[var(--border)]'
              }`}
            >
              <div className="flex items-center gap-2">
                <GripVertical className="w-3.5 h-3.5 text-[var(--text-secondary)] cursor-grab active:cursor-grabbing shrink-0" />
                {category.colorHex ? (
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: category.colorHex }} />
                ) : (
                  <span className="w-2 h-2 rounded-full border border-[var(--border)] bg-[var(--app-bg)]" />
                )}
                <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)] flex items-center gap-1.5 flex-wrap">
                  <span>{category.displayName}</span>
                  {category.isSystem ? (
                    <span className="text-[calc(8px*var(--font-scale))] opacity-40 uppercase">(System)</span>
                  ) : (
                    <span className="text-[calc(8px*var(--font-scale))] text-[var(--text-secondary)] opacity-80">
                      • <strong>{scopeDisplayLabel(categoryScope(category), store.accounts, { compactGlobal: true })}</strong>
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">{category.active ? 'Visible' : 'Hidden'}</span>
                  <input
                    type="checkbox"
                    checked={category.active}
                    disabled={category.id === 'other'}
                    onChange={(e) => store.toggleTabCategory(category.id, e.target.checked)}
                    className="w-3.5 h-3.5 text-[var(--accent)] bg-[var(--app-bg)] border border-[var(--border)] rounded cursor-pointer accent-[var(--accent)]"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setCategoryToEdit(category)}
                  aria-label={`Edit ${category.displayName} tab category`}
                  className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--accent)] cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {!category.isSystem && (
                  <button
                    type="button"
                    onClick={() => setCategoryToDelete(category)}
                    aria-label={`Delete ${category.displayName} tab category`}
                    className="p-1 rounded text-[var(--text-secondary)] hover:text-[var(--danger)] cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <ClassificationRuleEditor
        key={`${normalizedSelectedScope}:${editingRuleId || 'new'}`}
        selectedScope={normalizedSelectedScope}
        selectedScopeLabel={selectedScopeLabel}
        routeTargetCategories={routeTargetCategories}
        allCategories={store.tabCategories}
        accounts={store.accounts}
        editingRule={editingRule}
        onCreate={store.addCustomClassifierRule}
        onUpdate={store.updateCustomClassifierRule}
        onCancelEdit={() => setEditingRuleId(null)}
      />

      {/* Custom Rules list */}
      <div className="flex flex-col gap-2">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Configured Rules ({visibleRules.length})</span>
        {visibleRules.length === 0 ? (
          <div className="bg-[var(--rail-bg)] border border-dashed border-[var(--border)] rounded-md px-3 py-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            No rules for {selectedScopeLabel}.
          </div>
        ) : visibleRules.map(rule => {
          const values = ruleValues(rule);
          const isEditing = editingRuleId === rule.id;
          return (
            <div
              key={rule.id}
              className={`flex justify-between items-start gap-3 border rounded-md px-3 py-2 ${
                isEditing
                  ? 'border-[var(--accent)] bg-[var(--accent)]/[0.04]'
                  : 'border-[var(--border)] bg-[var(--rail-bg)]'
              }`}
            >
              <div className="flex min-w-0 items-start gap-2">
                <input
                  type="checkbox"
                  checked={rule.active}
                  aria-label={`${rule.active ? 'Disable' : 'Enable'} classification rule`}
                  onChange={(e) => store.updateCustomClassifierRule(rule.id, { active: e.target.checked })}
                  className="mt-0.5 w-3.5 h-3.5 shrink-0 text-[var(--accent)] bg-[var(--app-bg)] border border-[var(--border)] rounded cursor-pointer accent-[var(--accent)]"
                />
                <div className="flex min-w-0 flex-col gap-1 text-[calc(10px*var(--font-scale))]">
                  <span>
                    If <strong>{CLASSIFICATION_FIELD_LABELS[rule.field]}</strong> {rule.condition}{values.length > 1 ? ' any of' : ''}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {values.map(value => (
                      <span
                        key={value.toLowerCase()}
                        className="max-w-full truncate rounded border border-[var(--border)] bg-[var(--app-bg)] px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] text-[var(--text-primary)]"
                        title={value}
                      >
                        {value}
                      </span>
                    ))}
                  </div>
                  <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] flex items-center gap-1.5">
                    <span>Route: <strong>{categoryRouteLabel(rule.targetCategory, store.tabCategories, store.accounts)}</strong></span>
                    <span>•</span>
                    <span>Scope: <strong>{scopeDisplayLabel(normalizeClassificationScope(rule.accountId), store.accounts, { compactGlobal: true })}</strong></span>
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditingRuleId(rule.id)}
                  aria-label={`Edit classification rule for ${values.join(', ')}`}
                  className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--accent)] cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (editingRuleId === rule.id) setEditingRuleId(null);
                    store.deleteCustomClassifierRule(rule.id);
                  }}
                  aria-label={`Delete classification rule for ${values.join(', ')}`}
                  className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--danger)] cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <MailRulesSettingsSection selectedScope={normalizedSelectedScope} />
    </div>
  );
}
