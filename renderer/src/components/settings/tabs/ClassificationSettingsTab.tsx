import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../stores/AppStore';
import { Trash2, GripVertical, Pencil } from 'lucide-react';
import { emitToast } from '../../../lib/toastBus';

export function ClassificationSettingsTab() {
  const store = useAppStore();
  const [draggedSettingId, setDraggedSettingId] = useState<string | null>(null);
  const [dragOverSettingId, setDragOverSettingId] = useState<string | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<any | null>(null);
  const [categoryToEdit, setCategoryToEdit] = useState<any | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const editDialogRef = useRef<HTMLDivElement>(null);
  const editNameInputRef = useRef<HTMLInputElement>(null);

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
      const draggedIndex = store.tabCategories.findIndex(c => c.id === draggedSettingId);
      const targetIndex = store.tabCategories.findIndex(c => c.id === targetId);
      if (draggedIndex !== -1 && targetIndex !== -1) {
        const newCategories = [...store.tabCategories];
        const [removed] = newCategories.splice(draggedIndex, 1);
        newCategories.splice(targetIndex, 0, removed);
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
            className="bg-[var(--panel-bg)] border border-[var(--border)] rounded-xl shadow-2xl p-5 max-w-[340px] w-full flex flex-col gap-4 scale-up-in select-text"
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
            className="bg-[var(--panel-bg)] border border-[var(--border)] rounded-xl shadow-2xl p-5 max-w-[360px] w-full flex flex-col gap-4 scale-up-in select-text"
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
                  <label htmlFor="edit-category-account" className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Account:</label>
                  <select
                    id="edit-category-account"
                    value={categoryToEdit.accountId || 'global'}
                    onChange={(e) => setCategoryToEdit({ ...categoryToEdit, accountId: e.target.value })}
                    className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer w-full h-[26px]"
                  >
                    <option value="global">Global</option>
                    {store.accounts.map(acc => (
                      <option key={acc.id} value={acc.email}>{acc.displayName || acc.email}</option>
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
                    accountId: categoryToEdit.isSystem ? undefined : categoryToEdit.accountId
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

      {/* Manage Inbox Tabs */}
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Manage Inbox Tabs</span>
        <div className="flex flex-col gap-2 p-3 bg-[var(--panel-bg)] border border-[var(--border)] rounded-md">
          <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Create Custom Tab</span>
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
            <div className="w-[130px] flex flex-col gap-1 shrink-0">
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Account:</span>
              <select
                id="new-tab-account-pref"
                className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer w-full h-[26px]"
              >
                <option value="global">Global</option>
                {store.accounts.map(acc => (
                  <option key={acc.id} value={acc.email}>{acc.displayName || acc.email}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                const nameEl = document.getElementById('new-tab-name-pref') as HTMLInputElement;
                const colorEl = document.getElementById('new-tab-color-pref') as HTMLSelectElement;
                const accountEl = document.getElementById('new-tab-account-pref') as HTMLSelectElement;
                if (!nameEl.value.trim()) return;
                store.addTabCategory(nameEl.value.trim(), colorEl.value, accountEl ? accountEl.value : 'global');
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
          {store.tabCategories.map((category) => (
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
                      • Account: <strong>{(!category.accountId || category.accountId === 'global') ? 'Global' : category.accountId}</strong>
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

      {/* Create Custom Rule */}
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Add Custom Classification Rule</span>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Match Field:</span>
            <select
              id="new-rule-field-pref"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] cursor-pointer"
            >
              <option value="from">Sender Email (From)</option>
              <option value="subject">Subject Line</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Condition:</span>
            <select
              id="new-rule-condition-pref"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] cursor-pointer"
            >
              <option value="contains">Contains</option>
              <option value="equals">Equals</option>
              <option value="startsWith">Starts With</option>
              <option value="endsWith">Ends With</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Match Value:</span>
          <input
            id="new-rule-value-pref"
            type="text"
            placeholder="e.g. no-reply, billing@, notification"
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Target Split:</span>
            <select
              id="new-rule-target-pref"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] cursor-pointer"
            >
              {store.tabCategories.filter(c => c.active).map(c => (
                <option key={c.id} value={c.id}>{c.displayName}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Apply to Account:</span>
            <select
              id="new-rule-account-pref"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] cursor-pointer"
            >
              <option value="global">Global (All Accounts)</option>
              {store.accounts.map(acc => (
                <option key={acc.id} value={acc.email}>{acc.displayName || acc.email}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            const field = document.getElementById('new-rule-field-pref') as HTMLSelectElement;
            const cond = document.getElementById('new-rule-condition-pref') as HTMLSelectElement;
            const val = document.getElementById('new-rule-value-pref') as HTMLInputElement;
            const target = document.getElementById('new-rule-target-pref') as HTMLSelectElement;
            const account = document.getElementById('new-rule-account-pref') as HTMLSelectElement;
            if (!val.value.trim()) return;
            store.addCustomClassifierRule({
              field: field.value as any,
              condition: cond.value as any,
              value: val.value.trim(),
              targetCategory: target.value,
              active: true,
              accountId: account ? account.value : 'global'
            });
            val.value = '';
          }}
          className="w-fit px-4 py-1 bg-[var(--accent)] text-white rounded font-medium text-[calc(11px*var(--font-scale))] cursor-pointer hover:bg-[var(--accent)]/90 h-[26px]"
        >
          Add Rule
        </button>
      </div>

      {/* Custom Rules list */}
      {store.customClassifierRules.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Configured Rules ({store.customClassifierRules.length})</span>
          {store.customClassifierRules.map(rule => (
            <div key={rule.id} className="flex justify-between items-center bg-[var(--rail-bg)] border border-[var(--border)] rounded-md px-3 py-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rule.active}
                  onChange={(e) => store.updateCustomClassifierRule(rule.id, { active: e.target.checked })}
                  className="w-3.5 h-3.5 text-[var(--accent)] bg-[var(--app-bg)] border border-[var(--border)] rounded cursor-pointer accent-[var(--accent)]"
                />
                <div className="flex flex-col text-[calc(10px*var(--font-scale))]">
                  <span>If <strong>{rule.field}</strong> {rule.condition} "{rule.value}"</span>
                  <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] flex items-center gap-1.5">
                    <span>Route: <strong className="uppercase">{rule.targetCategory}</strong></span>
                    <span>•</span>
                    <span>Account: <strong>{(!rule.accountId || rule.accountId === 'global') ? 'Global' : rule.accountId}</strong></span>
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => store.deleteCustomClassifierRule(rule.id)}
                className="p-1 rounded hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--danger)] cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
