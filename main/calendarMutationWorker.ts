import crypto from 'crypto';
import type { BrowserWindow } from 'electron';
import type { CalendarEvent, CalendarEventCreateInput, CalendarEventDeleteOptions, CalendarEventUpdateInput, MailActionLog } from '../shared/types';
import { ActionLogRepo, CalendarEventsRepo, CalendarMutationsRepo, type CalendarMutationRecord } from './database';
import { isNetworkError } from './actionReconciler';
import { GoogleWorkspaceService } from './googleWorkspace';

interface CalendarMutationPayload {
  input?: CalendarEventCreateInput | CalendarEventUpdateInput;
  optimisticEventId?: string;
  previousEvent?: CalendarEvent | null;
  deletedEvent?: CalendarEvent | null;
  deleteOptions?: CalendarEventDeleteOptions;
}

export function optimisticCalendarEvent(accountId: string, input: CalendarEventCreateInput, id = `local-${crypto.randomUUID()}`): CalendarEvent {
  return {
    id,
    accountId,
    calendarId: input.calendarId || 'primary',
    summary: input.summary || '(No title)',
    description: input.description || null,
    location: input.location || null,
    startAt: input.startAt,
    endAt: input.endAt,
    isAllDay: input.isAllDay === true,
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    timeZone: input.timeZone || null,
    status: 'pending',
    transparency: input.transparency || 'opaque',
    visibility: input.visibility || 'default',
    colorId: input.colorId || null,
    reminders: input.reminders ? { useDefault: input.reminders.useDefault, overrides: input.reminders.overrides || [] } : null,
    attendees: (input.attendees || []).map(email => ({ email, responseStatus: 'needsAction' })),
    sourceMessageId: input.sourceMessageId || null,
    sourceThreadId: input.sourceThreadId || null,
    updatedAt: new Date().toISOString(),
  };
}

export function queueCalendarMutation(options: {
  actionId?: string;
  accountId: string;
  kind: CalendarMutationRecord['kind'];
  calendarId: string;
  eventId?: string | null;
  payload: CalendarMutationPayload;
  actionKind: MailActionLog['kind'];
}) {
  const id = options.actionId || crypto.randomUUID();
  const now = new Date().toISOString();
  CalendarMutationsRepo.save({
    id,
    accountId: options.accountId,
    kind: options.kind,
    calendarId: options.calendarId,
    eventId: options.eventId,
    payloadJson: JSON.stringify(options.payload),
    createdAt: now,
    attemptCount: 0,
  });
  ActionLogRepo.save({
    id,
    accountId: options.accountId,
    kind: options.actionKind,
    status: 'pending_sync',
    createdAt: now,
    payloadJson: JSON.stringify({ calendarId: options.calendarId, eventId: options.eventId || null }),
  });
  return id;
}

function finishAction(id: string, status: 'completed' | 'failed', failureMessage?: string) {
  const action = ActionLogRepo.get(id);
  if (!action) return;
  ActionLogRepo.save({
    ...action,
    status,
    completedAt: new Date().toISOString(),
    failureMessage: failureMessage || null,
  });
}

async function replayMutation(mutation: CalendarMutationRecord): Promise<void> {
  const payload = mutation.payloadJson ? JSON.parse(mutation.payloadJson) as CalendarMutationPayload : {};
  if (mutation.kind === 'create' && payload.input) {
    const event = await GoogleWorkspaceService.createCalendarEvent(mutation.accountId, payload.input as CalendarEventCreateInput);
    if (payload.optimisticEventId) CalendarEventsRepo.delete(mutation.accountId, mutation.calendarId, payload.optimisticEventId);
    CalendarEventsRepo.saveMany([event]);
  } else if (mutation.kind === 'update' && payload.input) {
    const input = payload.input as CalendarEventUpdateInput;
    const event = await GoogleWorkspaceService.updateCalendarEvent(mutation.accountId, input);
    const originalCalendarId = input.originalCalendarId || input.calendarId || mutation.calendarId;
    if (originalCalendarId !== event.calendarId) {
      CalendarEventsRepo.delete(mutation.accountId, originalCalendarId, input.eventId);
      CalendarEventsRepo.delete(mutation.accountId, event.calendarId, input.eventId);
    }
    CalendarEventsRepo.saveMany([event]);
  } else if (mutation.kind === 'delete' && mutation.eventId) {
    await GoogleWorkspaceService.deleteCalendarEvent(mutation.accountId, mutation.eventId, mutation.calendarId, payload.deleteOptions);
  } else {
    throw new Error('Calendar mutation payload is incomplete.');
  }
}

function rollbackMutation(mutation: CalendarMutationRecord) {
  const payload = mutation.payloadJson ? JSON.parse(mutation.payloadJson) as CalendarMutationPayload : {};
  if (mutation.kind === 'create' && payload.optimisticEventId) {
    CalendarEventsRepo.delete(mutation.accountId, mutation.calendarId, payload.optimisticEventId);
  } else if (mutation.kind === 'update') {
    const input = payload.input as CalendarEventUpdateInput | undefined;
    const destinationCalendarId = input?.calendarId || mutation.calendarId;
    if (mutation.eventId && destinationCalendarId !== mutation.calendarId) {
      CalendarEventsRepo.delete(mutation.accountId, destinationCalendarId, mutation.eventId);
    }
    if (payload.previousEvent) CalendarEventsRepo.saveMany([payload.previousEvent]);
    else if (mutation.eventId) CalendarEventsRepo.delete(mutation.accountId, mutation.calendarId, mutation.eventId);
  } else if (mutation.kind === 'delete' && payload.deletedEvent) {
    CalendarEventsRepo.saveMany([payload.deletedEvent]);
  }
}

let running = false;

export async function reconcileCalendarMutations(getWindow: () => BrowserWindow | null): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const mutation of CalendarMutationsRepo.list()) {
      try {
        await replayMutation(mutation);
        CalendarMutationsRepo.delete(mutation.id);
        finishAction(mutation.id, 'completed');
        getWindow()?.webContents.send('api:calendarChanged', { accountId: mutation.accountId });
      } catch (error) {
        if (isNetworkError(error)) {
          CalendarMutationsRepo.save({
            ...mutation,
            attemptCount: mutation.attemptCount + 1,
            lastError: error instanceof Error ? error.message : String(error),
          });
          break;
        }
        rollbackMutation(mutation);
        CalendarMutationsRepo.delete(mutation.id);
        finishAction(mutation.id, 'failed', error instanceof Error ? error.message : String(error));
        getWindow()?.webContents.send('api:calendarChanged', { accountId: mutation.accountId });
      }
    }
  } finally {
    running = false;
  }
}

export function startCalendarMutationWorker(getWindow: () => BrowserWindow | null, intervalMs = 15_000): NodeJS.Timeout {
  void reconcileCalendarMutations(getWindow);
  const timer = setInterval(() => void reconcileCalendarMutations(getWindow), intervalMs);
  timer.unref?.();
  return timer;
}
