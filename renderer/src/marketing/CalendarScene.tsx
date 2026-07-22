import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, Plus, Search, Sparkles, Users, Video } from 'lucide-react';
import { MarketingShell, PanelHeading } from './MarketingShell';
import { demoEvents } from './marketingDemoData';

const days = ['Mon 20', 'Tue 21', 'Wed 22', 'Thu 23', 'Fri 24'];
const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

function CalendarAssistant() {
  return (
    <>
      <div className="demo-assistant-head"><Sparkles size={15} /> Ask Dumka <span>Calendar</span></div>
      <div className="demo-assistant-body">
        <div className="demo-ai-prompt">Find 45 minutes for Maya, Theo, and me this week.</div>
        <div className="demo-ai-answer">
          <span className="demo-ai-mark"><Sparkles size={12} /></span>
          <p><strong>Three open windows</strong> match everyone’s working hours:</p>
          <div className="demo-slot"><span>Wed 22</span><strong>15:00–15:45</strong></div>
          <div className="demo-slot is-best"><span>Thu 23</span><strong>12:30–13:15</strong><em>Best</em></div>
          <div className="demo-slot"><span>Fri 24</span><strong>11:00–11:45</strong></div>
          <div className="demo-source-row"><span>3 calendars</span><span>Read-only search</span></div>
        </div>
        <div className="demo-calendar-note"><CalendarDays size={14} /><span>Creating an event remains a visible, user-reviewed action.</span></div>
      </div>
      <div className="demo-assistant-input"><span>Ask about availability…</span><kbd>⌘ ↵</kbd></div>
    </>
  );
}

function CalendarContext() {
  return (
    <>
      <PanelHeading icon={<Clock3 size={14} />} title="Selected event" />
      <div className="demo-event-detail">
        <span className="demo-event-color" />
        <h2>Launch workshop</h2>
        <p><Clock3 size={13} /> Thu, 09:30–11:30</p>
        <p><MapPin size={13} /> Project room</p>
        <p><Users size={13} /> 6 participants</p>
        <p><Video size={13} /> Google Meet</p>
        <button type="button">Open event</button>
      </div>
      <div className="demo-context-rule" />
      <PanelHeading icon={<Search size={14} />} title="Related mail" meta="2 threads" />
      <div className="demo-related-mail"><strong>Launch brief — final notes</strong><span>Maya Chen · 09:42</span></div>
      <div className="demo-related-mail"><strong>Workshop prep checklist</strong><span>Theo Grant · Tuesday</span></div>
    </>
  );
}

export function CalendarScene() {
  return (
    <MarketingShell scene="calendar" assistant={<CalendarAssistant />} context={<CalendarContext />}>
      <div className="demo-calendar-toolbar">
        <div><button type="button"><ChevronLeft size={14} /></button><button type="button"><ChevronRight size={14} /></button><button type="button" className="is-today">Today</button><strong>20–24 July 2026</strong></div>
        <div><button type="button" className="is-view">Week</button><button type="button"><Plus size={14} /> New event</button></div>
      </div>
      <div className="demo-calendar-grid">
        <div className="demo-calendar-corner" />
        {days.map(day => <div key={day} className={`demo-calendar-day ${day.includes('23') ? 'is-today' : ''}`}><span>{day.split(' ')[0]}</span><strong>{day.split(' ')[1]}</strong></div>)}
        {hours.map(hour => (
          <div key={hour} className="demo-calendar-hour" style={{ gridRow: (hour - 8) * 2 + 2 }}><span>{String(hour).padStart(2, '0')}:00</span></div>
        ))}
        <div className="demo-calendar-lines" />
        {demoEvents.map(event => (
          <article
            key={`${event.day}-${event.start}`}
            className="demo-calendar-event"
            style={{
              gridColumn: event.day + 1,
              gridRow: `${Math.round((event.start - 8) * 2) + 2} / span ${Math.round(event.duration * 2)}`,
              borderColor: event.color,
              background: `color-mix(in srgb, ${event.color} 14%, var(--raised-surface))`,
            }}
          >
            <strong>{event.title}</strong><span>{event.detail}</span>
          </article>
        ))}
        <div className="demo-now-line"><span>10:18</span></div>
      </div>
    </MarketingShell>
  );
}
