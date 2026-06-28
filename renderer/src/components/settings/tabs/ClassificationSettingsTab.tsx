import React, { useState } from 'react';
import { useAppStore } from '../../../stores/AppStore';
import { Trash2, GripVertical } from 'lucide-react';
import { emitToast } from '../../../lib/toastBus';

export function ClassificationSettingsTab() {
  const store = useAppStore();
  const [draggedSettingId, setDraggedSettingId] = useState<string | null>(null);
  const [dragOverSettingId, setDragOverSettingId] = useState<string | null>(null);

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
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Classification Rules</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Create custom routing rules to sort mail based on headers or domains.</p>
      </div>

      {/* Manage Inbox Tabs */}
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Manage Inbox Tabs</span>
        <div className="flex flex-col gap-2 p-3 bg-[var(--panel-bg)] border border-[var(--border)] rounded-md">
          <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Create Custom Tab</span>
          <div className="flex gap-2 items-end">
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Tab Name:</span>
              <input
                id="new-tab-name-pref"
                type="text"
                placeholder="e.g. Work, Github, Family"
                className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Color:</span>
              <select
                id="new-tab-color-pref"
                className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
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
                store.addTabCategory(nameEl.value.trim(), colorEl.value);
                nameEl.value = '';
              }}
              className="px-3 py-1 bg-[var(--accent)] text-white rounded font-medium text-[calc(11px*var(--font-scale))] cursor-pointer hover:bg-[var(--accent)]/90 transition-colors h-[26px]"
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
                <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">
                  {category.displayName} {category.isSystem && <span className="text-[calc(8px*var(--font-scale))] opacity-40 uppercase">(System)</span>}
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
                {!category.isSystem && (
                  <button
                    type="button"
                    onClick={() => {
                      emitToast({
                        type: 'warning',
                        message: `Delete the “${category.displayName}” tab?`,
                        actionLabel: 'Delete',
                        onAction: () => store.deleteTabCategory(category.id),
                        duration: 6000,
                      });
                    }}
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

        <button
          type="button"
          onClick={() => {
            const field = document.getElementById('new-rule-field-pref') as HTMLSelectElement;
            const cond = document.getElementById('new-rule-condition-pref') as HTMLSelectElement;
            const val = document.getElementById('new-rule-value-pref') as HTMLInputElement;
            const target = document.getElementById('new-rule-target-pref') as HTMLSelectElement;
            if (!val.value.trim()) return;
            store.addCustomClassifierRule({
              field: field.value as any,
              condition: cond.value as any,
              value: val.value.trim(),
              targetCategory: target.value,
              active: true
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
                  <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Route: <strong className="uppercase">{rule.targetCategory}</strong></span>
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
