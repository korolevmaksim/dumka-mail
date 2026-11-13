// Render smoke test of the calendar views (server-side markup, no browser):
// they render with realistic data, show one date and time vocabulary, and keep
// the structural promises of the redesign (block heights, labelled answers,
// labelled form fields, a footer with Save and Cancel).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CalendarEvent, CalendarListEntry, CalendarSettings } from '../shared/types';
import { CalendarTimeGrid } from '../renderer/src/calendar/CalendarTimeGrid';
import { CalendarMonthView } from '../renderer/src/calendar/CalendarMonthView';
import { CalendarAgendaView, CalendarOverviewView } from '../renderer/src/calendar/CalendarOverviewViews';
import { CalendarHeader } from '../renderer/src/calendar/CalendarHeader';
import { CalendarEventDetails } from '../renderer/src/calendar/CalendarWorkspaceInspector';
import { CalendarEventEditor } from '../renderer/src/calendar/CalendarEventEditor';

const noop = () => undefined;
const ANCHOR = new Date(2026, 10, 12, 12);
const TWELVE_HOUR = /\b\d{1,2}:\d{2}\s?(AM|PM)\b/i;
const NUMERIC_DATE = /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/;
const SECONDS = /\b\d{1,2}:\d{2}:\d{2}\b/;

const calendar: CalendarListEntry = {
  id: 'primary',
  accountId: 'alex@work.example',
  summary: 'Work',
  primary: true,
  selected: true,
  accessRole: 'owner',
  backgroundColor: '#3f51b5',
  foregroundColor: '#ffffff',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

function event(id: string, summary: string, start: Date, end: Date, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    accountId: 'alex@work.example',
    calendarId: 'primary',
    summary,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    isAllDay: false,
    attendees: [],
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

const EVENTS: CalendarEvent[] = [
  event('standup', 'Rollouts stand-up', new Date(2026, 10, 12, 9, 30), new Date(2026, 10, 12, 9, 45)),
  event('focus', 'Focus: board deck numbers', new Date(2026, 10, 12, 10, 30), new Date(2026, 10, 12, 14, 30)),
  event('sync', 'Lumen Labs weekly sync', new Date(2026, 10, 12, 14, 0), new Date(2026, 10, 12, 14, 45), {
    attendees: [
      { email: 'alex@work.example', responseStatus: 'accepted' },
      { email: 'priya@lumen.example', displayName: 'Priya Raman', responseStatus: 'tentative' },
    ],
    organizerEmail: 'priya@lumen.example',
    selfResponseStatus: 'needsAction',
    location: 'Video call',
    timeZone: 'America/New_York',
  }),
  event('freeze', 'Deploy freeze', new Date(2026, 10, 13), new Date(2026, 10, 16), { isAllDay: true, startDate: '2026-11-13', endDate: '2026-11-16' }),
];

const settings = {
  weekStartsOn: 1,
  defaultReminderMinutes: 10,
  defaultCalendarId: 'primary',
  availabilityLookaheadDays: 5,
  eventTemplates: [],
} as unknown as CalendarSettings;

function assertVocabulary(html: string) {
  expect(html).not.toMatch(TWELVE_HOUR);
  expect(html).not.toMatch(NUMERIC_DATE);
  expect(html).not.toMatch(SECONDS);
}

describe('calendar views render', () => {
  it('week grid draws blocks as tall as the events', () => {
    const html = renderToStaticMarkup(
      <CalendarTimeGrid
        anchor={ANCHOR} mode="week" events={EVENTS} calendars={[calendar]} weekStartsOn={1} showWeekends
        workingDays={[1, 2, 3, 4, 5]} workingHoursStart="09:00" workingHoursEnd="17:00" selectedEventKey={null}
        onSelectDate={noop} onOpenDay={noop} onCreateRange={noop} onSelectEvent={noop} onMoveEvent={noop} onResizeEvent={noop}
      />,
    );
    // 56 px per hour: the 4-hour focus block is 224 px, the 15-minute stand-up the 24 px minimum.
    expect(html).toContain('height:224px');
    expect(html).toContain('height:24px');
    expect(html).toContain('14:00–14:45');
    expect(html).toContain('Deploy freeze');
    assertVocabulary(html);
  });

  it('month view repeats a multi-day title and uses the shared vocabulary', () => {
    const html = renderToStaticMarkup(
      <CalendarMonthView
        anchor={ANCHOR} selectedDate={ANCHOR} events={EVENTS} calendars={[calendar]} weekStartsOn={1} showWeekends
        selectedEventKey={null} onSelectDate={noop} onOpenDay={noop} onCreate={noop} onSelectEvent={noop} onMoveEvent={noop}
      />,
    );
    // Nov 13–15 sits in one week here, so the bar appears once with its title.
    expect(html.match(/>Deploy freeze</g)?.length).toBe(1);
    expect(html).toContain('>Mon<');
    assertVocabulary(html);
  });

  it('month view titles every week segment of a bar that crosses weeks', () => {
    const crossing = event('trip', 'Conference trip', new Date(2026, 10, 14), new Date(2026, 10, 18), { isAllDay: true, startDate: '2026-11-14', endDate: '2026-11-18' });
    const html = renderToStaticMarkup(
      <CalendarMonthView
        anchor={ANCHOR} selectedDate={ANCHOR} events={[crossing]} calendars={[calendar]} weekStartsOn={1} showWeekends
        selectedEventKey={null} onSelectDate={noop} onOpenDay={noop} onCreate={noop} onSelectEvent={noop} onMoveEvent={noop}
      />,
    );
    expect(html.match(/>Conference trip</g)?.length).toBe(2);
  });

  it('agenda, quarter and header use the shared vocabulary', () => {
    const agenda = renderToStaticMarkup(<CalendarAgendaView anchor={ANCHOR} events={EVENTS} calendars={[calendar]} selectedEventKey={null} onSelectDate={noop} onSelectEvent={noop} onCreate={noop} />);
    const quarter = renderToStaticMarkup(<CalendarOverviewView anchor={ANCHOR} events={EVENTS} mode="quarter" weekStartsOn={1} onSelectDate={noop} onCreate={noop} />);
    const header = renderToStaticMarkup(
      <CalendarHeader
        anchor={ANCHOR} view="week" weekStartsOn={1} sidebarOpen secondaryTime={null} secondaryTimeZone="" query="" searchInputRef={{ current: null }}
        searchResults={[]} isSyncing={false} onToggleSidebar={noop} onPrevious={noop} onToday={noop} onNext={noop} onChangeView={noop}
        onChangeQuery={noop} onSelectSearchResult={noop} onRefresh={noop} onImport={noop} onCreate={noop}
      />,
    );
    expect(header).toContain('Nov 9 – 15, 2026');
    expect(agenda).toContain('09:30–09:45');
    expect(quarter).toContain('November 2026');
    [agenda, quarter, header].forEach(assertVocabulary);
  });

  it('event details read first: heading, when, answers as words, Edit / Duplicate / Delete', () => {
    const html = renderToStaticMarkup(
      <CalendarEventDetails
        event={EVENTS[2]} calendar={calendar} writable isResponding={false} isDeleting={false} travelTimeMinutes={15} threads={[]}
        onClose={noop} onEdit={noop} onDuplicate={noop} onDelete={noop} onRespond={noop} onDraftFollowUp={noop} onAddTravel={noop} onOpenThread={noop}
      />,
    );
    expect(html).toMatch(/<h2[^>]*>Lumen Labs weekly sync<\/h2>/);
    expect(html).toContain('Thu, Nov 12, 14:00–14:45');
    expect(html).toContain('Work · alex@work.example');
    for (const label of ['>Yes<', '>Maybe<', '>No<', '>Edit<', '>Duplicate<', '>Delete<']) expect(html).toContain(label);
    expect(html).not.toContain('Event title');
    assertVocabulary(html);
  });

  it('event form labels every field and keeps Save and Cancel in its footer', () => {
    const html = renderToStaticMarkup(
      <CalendarEventEditor
        mode="edit" event={EVENTS[2]} selectedDate={ANCHOR} defaultDurationMinutes={30} defaultConferenceProvider="none"
        calendarSettings={settings} calendarEvents={EVENTS} calendars={[calendar]} defaultAccountId="alex@work.example"
        isSaving={false} onCancel={noop} onClose={noop} onSubmit={async () => undefined}
      />,
    );
    for (const label of ['Title', 'Calendar', 'Date', 'Start', 'Duration', 'Location', 'Notes']) expect(html).toContain(`>${label}</`);
    expect(html).toContain('>min<');
    expect(html).toContain('Ends 14:45');
    expect(html).toMatch(/>Cancel<\/button><button type="submit"[^>]*>Save<\/button><\/div><\/form>$/);
    assertVocabulary(html);
  });
});
