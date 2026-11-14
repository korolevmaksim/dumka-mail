import type { CSSProperties, KeyboardEvent, RefObject } from 'react';
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Upload, X } from 'lucide-react';
import type { CalendarEvent, CalendarWorkspaceView } from '../../../shared/types';
import { SETTINGS_SELECT_CLASS } from '../components/settings/SettingsControls';
import { calendarHeaderTitle, calendarEventWhenLabel } from './calendarDateLabels';
import { calendarEventColor } from './calendarEventColors';
import { CAL_BUTTON, CAL_FOCUS, CAL_ICON_BUTTON, CAL_PRIMARY_BUTTON, CalendarKeyCap, CalendarSegmented } from './calendarUi';

export const CALENDAR_VIEW_OPTIONS: Array<{ id: CalendarWorkspaceView; label: string; shortcut: string }> = [
  { id: 'day', label: 'Day', shortcut: '1' },
  { id: 'week', label: 'Week', shortcut: '2' },
  { id: 'month', label: 'Month', shortcut: '3' },
  { id: 'agenda', label: 'Agenda', shortcut: '4' },
  { id: 'quarter', label: 'Quarter', shortcut: '5' },
  { id: 'year', label: 'Year', shortcut: '6' },
];

interface CalendarHeaderProps {
  anchor: Date;
  view: CalendarWorkspaceView;
  weekStartsOn: 0 | 1;
  sidebarOpen: boolean;
  secondaryTime: string | null;
  secondaryTimeZone: string;
  query: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchResults: CalendarEvent[];
  isSyncing: boolean;
  onToggleSidebar: () => void;
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
  onChangeView: (view: CalendarWorkspaceView) => void;
  onChangeQuery: (query: string) => void;
  onSelectSearchResult: (event: CalendarEvent) => void;
  onRefresh: () => void;
  onImport: () => void;
  onCreate: () => void;
}

const PERIOD_NAMES: Record<CalendarWorkspaceView, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
  agenda: 'month',
  quarter: 'quarter',
  year: 'year',
};

export function CalendarHeader(props: CalendarHeaderProps) {
  const title = calendarHeaderTitle(props.anchor, props.view, props.weekStartsOn);
  const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties & { WebkitAppRegion: string };
  const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties & { WebkitAppRegion: string };
  const period = PERIOD_NAMES[props.view];
  const showResults = props.query.trim().length >= 2;

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && showResults) {
      event.preventDefault();
      document.querySelector<HTMLElement>('[data-calendar-search-result]')?.focus();
    }
  }

  function onResultKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    event.stopPropagation();
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-calendar-search-result]'));
    const index = items.indexOf(event.currentTarget);
    if (event.key === 'ArrowUp' && index <= 0) {
      props.searchInputRef.current?.focus();
      return;
    }
    items[Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))]?.focus();
  }

  return (
    <header
      className="dm-calendar-header dm-toolbar @container flex h-[calc(var(--top-chrome-h)+12px)] min-h-[48px] shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--panel-bg)] px-3"
      style={dragStyle}
    >
      <button
        style={noDragStyle}
        type="button"
        onClick={props.onToggleSidebar}
        title={props.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-label={props.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-pressed={props.sidebarOpen}
        className={CAL_ICON_BUTTON}
      >
        {props.sidebarOpen ? <PanelLeftClose aria-hidden="true" className="h-4 w-4" /> : <PanelLeftOpen aria-hidden="true" className="h-4 w-4" />}
      </button>
      <div style={noDragStyle} className="flex shrink-0 items-center gap-0.5">
        <button type="button" onClick={props.onToday} title="Today (T)" aria-keyshortcuts="T" className={CAL_BUTTON}>
          Today
          <span className="hidden @min-[1000px]:inline-flex"><CalendarKeyCap>T</CalendarKeyCap></span>
        </button>
        <button type="button" aria-label={`Previous ${period}`} title={`Previous ${period} (←)`} onClick={props.onPrevious} className={CAL_ICON_BUTTON}>
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <button type="button" aria-label={`Next ${period}`} title={`Next ${period} (→)`} onClick={props.onNext} className={CAL_ICON_BUTTON}>
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1 className="min-w-0 truncate text-[calc(16px*var(--font-scale))] font-semibold text-[var(--text-primary)]" aria-live="polite">
          {title}
        </h1>
        {props.secondaryTime && (
          <span className="hidden shrink-0 text-[calc(11px*var(--font-scale))] tabular-nums text-[var(--text-secondary)] @min-[1100px]:inline" title={`Second time zone: ${props.secondaryTimeZone}`}>
            {props.secondaryTime}
          </span>
        )}
      </div>

      <div style={noDragStyle} className="hidden @min-[960px]:flex">
        <CalendarSegmented
          label="Calendar view"
          options={CALENDAR_VIEW_OPTIONS.map(option => ({ id: option.id, label: option.label, title: `${option.label} (${option.shortcut})` }))}
          value={props.view}
          onChange={props.onChangeView}
        />
      </div>
      <select
        style={noDragStyle}
        value={props.view}
        onChange={event => props.onChangeView(event.target.value as CalendarWorkspaceView)}
        aria-label="Calendar view"
        className={`${SETTINGS_SELECT_CLASS} h-8 @min-[960px]:hidden`}
      >
        {CALENDAR_VIEW_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>

      <div style={noDragStyle} className="relative w-32 shrink-0 @min-[1100px]:w-48">
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <input
          ref={props.searchInputRef}
          value={props.query}
          onChange={event => props.onChangeQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search events"
          aria-label="Search events"
          aria-keyshortcuts="/"
          aria-expanded={showResults}
          aria-controls="calendar-search-results"
          className="dm-control h-8 w-full rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--app-bg)] pl-8 pr-7 text-[calc(12px*var(--font-scale))] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
        />
        {props.query && (
          <button
            type="button"
            onClick={() => { props.onChangeQuery(''); props.searchInputRef.current?.focus(); }}
            aria-label="Clear search"
            title="Clear search"
            className={`absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] ${CAL_FOCUS}`}
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        )}
        {showResults && (
          <div
            id="calendar-search-results"
            className="dm-overlay absolute right-0 top-[calc(100%+6px)] z-50 max-h-80 w-80 overflow-y-auto rounded-md border border-[var(--strong-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
            aria-label="Search results"
          >
            {props.searchResults.length === 0 ? (
              <div className="px-3 py-3 text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)]">No events found.</div>
            ) : props.searchResults.slice(0, 20).map(event => (
              <button
                key={`${event.accountId}:${event.calendarId}:${event.id}`}
                type="button"
                data-calendar-search-result
                onClick={() => props.onSelectSearchResult(event)}
                onKeyDown={onResultKeyDown}
                className={`flex w-full min-w-0 items-start gap-2 rounded px-2.5 py-2 text-left hover:bg-[var(--hover-row)] ${CAL_FOCUS}`}
              >
                <span aria-hidden="true" className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: calendarEventColor(event) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{event.summary || '(no title)'}</span>
                  <span className="block truncate text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">{calendarEventWhenLabel(event)} · {event.accountId}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button style={noDragStyle} type="button" onClick={props.onRefresh} disabled={props.isSyncing} title={props.isSyncing ? 'Refreshing…' : 'Refresh'} aria-label="Refresh" className={CAL_ICON_BUTTON}>
        <RefreshCw aria-hidden="true" className={`h-4 w-4 ${props.isSyncing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      </button>
      <button style={noDragStyle} type="button" onClick={props.onImport} title="Import an event file (.ics)" aria-label="Import an event file" className={CAL_ICON_BUTTON}>
        <Upload aria-hidden="true" className="h-4 w-4" />
      </button>
      <button style={noDragStyle} type="button" onClick={props.onCreate} title="New event (N)" aria-keyshortcuts="N" className={CAL_PRIMARY_BUTTON}>
        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
        <span className="hidden @min-[700px]:inline">New event</span>
        <span className="sr-only @min-[700px]:hidden">New event</span>
      </button>
    </header>
  );
}
