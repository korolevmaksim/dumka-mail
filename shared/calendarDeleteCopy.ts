import type { CalendarMutationScope } from './types';

export type CalendarDeleteConfirmPhase = 'idle' | 'confirm' | 'deleting';

export interface CalendarDeleteScopeOption {
  value: CalendarMutationScope;
  label: string;
}

/** Explicit scope choices for recurring delete/update. Order matches Google Calendar UX. */
export const CALENDAR_DELETE_SCOPE_OPTIONS: readonly CalendarDeleteScopeOption[] = [
  { value: 'single', label: 'This event only' },
  { value: 'following', label: 'This and following events' },
  { value: 'series', label: 'Entire series' },
] as const;

export function calendarDeleteScopeChooserLabel(): string {
  return 'Delete scope';
}

export function calendarDeleteScopeOptionLabel(scope: CalendarMutationScope): string {
  return CALENDAR_DELETE_SCOPE_OPTIONS.find(option => option.value === scope)?.label
    ?? 'This event only';
}

/**
 * User-visible delete control copy.
 * Recurring confirm never uses bare "Confirm delete" — it always names the scope outcome.
 */
export function calendarDeleteButtonLabel(
  isRecurring: boolean,
  scope: CalendarMutationScope,
  phase: CalendarDeleteConfirmPhase,
): string {
  if (phase === 'deleting') return 'Deleting...';
  if (phase === 'idle') return 'Delete';
  if (!isRecurring) return 'Confirm delete';
  switch (scope) {
    case 'single':
      return 'Delete this event only';
    case 'following':
      return 'Delete this and following';
    case 'series':
      return 'Delete entire series';
  }
}

/** Success toast after a completed delete, distinguishing occurrence vs series outcomes. */
export function calendarDeleteSuccessMessage(
  isRecurring: boolean,
  scope: CalendarMutationScope = 'single',
): string {
  if (!isRecurring) return 'Event deleted.';
  switch (scope) {
    case 'single':
      return 'This occurrence deleted. The rest of the series is unchanged.';
    case 'following':
      return 'This and following events deleted.';
    case 'series':
      return 'Entire series deleted.';
  }
}
