import type { RefObject } from 'react';
import { ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Search, Upload, X } from 'lucide-react';
import type { CalendarEvent, CalendarWorkspaceView } from '../../../shared/types';
import { calendarWorkspaceTitle } from './calendarWorkspaceUtils';

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

export function CalendarHeader(props: CalendarHeaderProps) {
  return (
    <header className="flex min-h-[58px] shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--panel-bg)] px-3">
      <button type="button" onClick={props.onToggleSidebar} title={props.sidebarOpen ? 'Hide calendar sidebar' : 'Show calendar sidebar'} className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]">
        {props.sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
      </button>
      <div className="flex items-center rounded-md border border-[var(--border)] bg-[var(--app-bg)]">
        <button type="button" aria-label="Previous period" onClick={props.onPrevious} className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" onClick={props.onToday} className="border-x border-[var(--border)] px-3 py-2 text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Today</button>
        <button type="button" aria-label="Next period" onClick={props.onNext} className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><ChevronRight className="h-4 w-4" /></button>
      </div>
      <h1 className="min-w-[190px] truncate text-[calc(16px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{calendarWorkspaceTitle(props.anchor, props.view)}</h1>
      {props.secondaryTime && <span className="hidden text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)] 2xl:inline" title={`Secondary time zone: ${props.secondaryTimeZone}`}>{props.secondaryTime}</span>}
      <div className="ml-auto hidden items-center rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-0.5 lg:flex" aria-label="Calendar view">
        {CALENDAR_VIEW_OPTIONS.map(option => (
          <button key={option.id} type="button" onClick={() => props.onChangeView(option.id)} title={`${option.label} (${option.shortcut})`} className={`rounded-md px-2.5 py-1.5 text-[calc(10px*var(--font-scale))] font-medium ${props.view === option.id ? 'bg-[var(--raised-surface)] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}>{option.label}</button>
        ))}
      </div>
      <label className="relative hidden w-44 xl:block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <input ref={props.searchInputRef} value={props.query} onChange={event => props.onChangeQuery(event.target.value)} placeholder="Search events" aria-label="Search calendar events" className="w-full rounded-lg border border-[var(--border)] bg-[var(--app-bg)] py-2 pl-8 pr-7 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
        {props.query && <button type="button" onClick={() => props.onChangeQuery('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"><X className="h-3 w-3" /></button>}
        {props.query.trim().length >= 2 && (
          <div className="absolute right-0 top-[calc(100%+6px)] z-50 max-h-80 w-80 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-xl" role="listbox" aria-label="Calendar search results">
            {props.searchResults.length === 0 ? <div className="px-3 py-3 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">No cached events found.</div> : props.searchResults.slice(0, 20).map(event => (
              <button key={`${event.accountId}:${event.calendarId}:${event.id}`} type="button" role="option" onClick={() => props.onSelectSearchResult(event)} className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-[var(--hover-row)]">
                <span className="block truncate text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{event.summary}</span>
                <span className="block text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">{event.isAllDay ? `${event.startDate || new Date(event.startAt).toLocaleDateString()} · All day` : new Date(event.startAt).toLocaleString()} · {event.accountId}</span>
              </button>
            ))}
          </div>
        )}
      </label>
      <button type="button" onClick={props.onRefresh} disabled={props.isSyncing} title="Refresh calendars" className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${props.isSyncing ? 'animate-spin' : ''}`} /></button>
      <button type="button" onClick={props.onImport} title="Import .ics file" className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"><Upload className="h-4 w-4" /></button>
      <button type="button" onClick={props.onCreate} className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-[calc(10px*var(--font-scale))] font-semibold text-white shadow-sm"><Plus className="h-3.5 w-3.5" />New event</button>
    </header>
  );
}
