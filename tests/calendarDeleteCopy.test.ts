import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_DELETE_SCOPE_OPTIONS,
  calendarDeleteButtonLabel,
  calendarDeleteScopeChooserLabel,
  calendarDeleteScopeOptionLabel,
  calendarDeleteSuccessMessage,
} from '../shared/calendarDeleteCopy';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('calendarDeleteCopy', () => {
  it('lists explicit recurring delete scopes with plain-language outcomes', () => {
    expect(CALENDAR_DELETE_SCOPE_OPTIONS.map(option => option.value)).toEqual([
      'single',
      'following',
      'series',
    ]);
    expect(CALENDAR_DELETE_SCOPE_OPTIONS.map(option => option.label)).toEqual([
      'This event only',
      'This and following events',
      'Entire series',
    ]);
    expect(calendarDeleteScopeChooserLabel()).toBe('Delete scope');
    expect(calendarDeleteScopeOptionLabel('single')).toBe('This event only');
    expect(calendarDeleteScopeOptionLabel('following')).toBe('This and following events');
    expect(calendarDeleteScopeOptionLabel('series')).toBe('Entire series');
  });

  it('never uses bare Confirm delete for recurring events', () => {
    expect(calendarDeleteButtonLabel(true, 'single', 'idle')).toBe('Delete');
    expect(calendarDeleteButtonLabel(true, 'single', 'confirm')).toBe('Delete this event only');
    expect(calendarDeleteButtonLabel(true, 'following', 'confirm')).toBe('Delete this and following');
    expect(calendarDeleteButtonLabel(true, 'series', 'confirm')).toBe('Delete entire series');
    expect(calendarDeleteButtonLabel(true, 'single', 'deleting')).toBe('Deleting...');

    for (const scope of ['single', 'following', 'series'] as const) {
      const confirm = calendarDeleteButtonLabel(true, scope, 'confirm');
      expect(confirm).not.toBe('Confirm delete');
      expect(confirm.toLowerCase()).toMatch(/this event only|this and following|entire series/);
    }
  });

  it('keeps a simple two-step confirm for non-recurring events', () => {
    expect(calendarDeleteButtonLabel(false, 'single', 'idle')).toBe('Delete');
    expect(calendarDeleteButtonLabel(false, 'single', 'confirm')).toBe('Confirm delete');
    expect(calendarDeleteButtonLabel(false, 'series', 'confirm')).toBe('Confirm delete');
    expect(calendarDeleteButtonLabel(false, 'single', 'deleting')).toBe('Deleting...');
  });

  it('distinguishes success feedback by delete scope', () => {
    expect(calendarDeleteSuccessMessage(false, 'single')).toBe('Event deleted.');
    expect(calendarDeleteSuccessMessage(true, 'single')).toBe(
      'This occurrence deleted. The rest of the series is unchanged.',
    );
    expect(calendarDeleteSuccessMessage(true, 'following')).toBe('This and following events deleted.');
    expect(calendarDeleteSuccessMessage(true, 'series')).toBe('Entire series deleted.');
  });

  it('defaults recurring success copy to this-occurrence-only when scope omitted', () => {
    expect(calendarDeleteSuccessMessage(true)).toContain('occurrence');
    expect(calendarDeleteSuccessMessage(true)).not.toContain('Entire series');
  });

  it('wires the form and delete paths to the shipped copy helper', () => {
    const formSource = readFileSync(join(repoRoot, 'renderer/src/components/CalendarEventForm.tsx'), 'utf8');
    expect(formSource).toContain("from '../../../shared/calendarDeleteCopy'");
    expect(formSource).toContain('calendarDeleteButtonLabel(');
    expect(formSource).toContain('CALENDAR_DELETE_SCOPE_OPTIONS.map');
    expect(formSource).toContain("useState<CalendarMutationScope>('single')");
    expect(formSource).toContain('void onDelete(mutationScope)');
    // Recurring confirm must never hard-code ambiguous bare "Confirm delete" as the only label.
    expect(formSource).not.toMatch(/deletePending \? 'Confirm delete' : 'Delete'/);

    const workspaceSource = readFileSync(join(repoRoot, 'renderer/src/calendar/CalendarWorkspace.tsx'), 'utf8');
    expect(workspaceSource).toContain('calendarDeleteSuccessMessage(wasRecurring, mutationScope)');

    const agendaSource = readFileSync(join(repoRoot, 'renderer/src/components/CalendarAgendaPanel.tsx'), 'utf8');
    expect(agendaSource).toContain('calendarDeleteSuccessMessage(wasRecurring, mutationScope)');
    expect(agendaSource).toContain('mutationScope');
    expect(agendaSource).toContain('recurringEventId: editingEvent.recurringEventId');
  });
});
