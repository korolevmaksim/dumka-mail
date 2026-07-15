import { AccountsRepo, CalendarEventsRepo } from './database';
import {
  CALENDAR_ASSISTANT_PRIVACY_NOTE,
  calendarAssistantSource,
  findCalendarFreeSlots,
} from '../shared/calendarAssistant';

function accountScope(accountId: string | null | undefined): string[] {
  const available = AccountsRepo.list().map(account => account.email);
  const requested = (accountId || '').trim().toLowerCase();
  if (!requested || requested === 'all' || requested === 'unified') return available;
  return available.filter(email => email.trim().toLowerCase() === requested);
}

export async function executeCalendarAssistantTool(name: string, args: Record<string, unknown>) {
  const accountId = typeof args.accountId === 'string' ? args.accountId : null;
  const accountIds = accountScope(accountId);
  if (name === 'searchCalendar') {
    const query = (typeof args.query === 'string' ? args.query : '').replace(/\s+/g, ' ').trim();
    const limit = Math.max(1, Math.min(20, Math.floor(typeof args.limit === 'number' ? args.limit : 8)));
    return {
      query,
      privacyNote: CALENDAR_ASSISTANT_PRIVACY_NOTE,
      sources: query ? CalendarEventsRepo.search(accountIds, query, limit).map(calendarAssistantSource) : [],
    };
  }
  if (name === 'findCalendarFreeSlots') {
    const startAt = typeof args.startAt === 'string' ? args.startAt : '';
    const endAt = typeof args.endAt === 'string' ? args.endAt : '';
    const durationMinutes = typeof args.durationMinutes === 'number' ? args.durationMinutes : 30;
    const events = accountIds.flatMap(accountId => CalendarEventsRepo.listBetween(accountId, startAt, endAt));
    return {
      privacyNote: CALENDAR_ASSISTANT_PRIVACY_NOTE,
      accountIds,
      startAt,
      endAt,
      durationMinutes,
      slots: findCalendarFreeSlots(events, startAt, endAt, durationMinutes),
    };
  }
  throw new Error(`Unknown local calendar tool: ${name}`);
}
