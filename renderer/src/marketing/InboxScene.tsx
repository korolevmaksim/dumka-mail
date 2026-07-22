import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Command,
  Inbox,
  RefreshCw,
  RotateCcw,
  SquarePen,
} from 'lucide-react';
import { MarketingShell } from './MarketingShell';
import { demoThreads } from './marketingDemoData';

const calendarDays = [
  ['29', '30', '1', '2', '3', '4', '5'],
  ['6', '7', '8', '9', '10', '11', '12'],
  ['13', '14', '15', '16', '17', '18', '19'],
  ['20', '21', '22', '23', '24', '25', '26'],
  ['27', '28', '29', '30', '31', '1', '2'],
];

function MailboxContext() {
  return (
    <>
      <div className="demo-context-title"><span>AGENDA <RefreshCw size={11} /></span><i /></div>
      <div className="demo-agenda-date"><CalendarDays size={14} /><div><strong>Wed, Jul 23</strong><span>2 events</span></div><button type="button">Today</button></div>
      <div className="demo-mini-calendar">
        <header><button type="button">‹</button><strong>July 2026</strong><button type="button">›</button></header>
        <div className="demo-mini-week"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
        {calendarDays.flatMap((week, weekIndex) => week.map((day, dayIndex) => (
          <span key={`${weekIndex}-${dayIndex}`} className={`${day === '23' ? 'is-today' : ''} ${day === '22' ? 'is-selected' : ''}`}>{day}<i /></span>
        )))}
      </div>
      <div className="demo-quick-event"><span>Review brief tomorrow at 2 PM</span><button type="button"><CalendarDays size={13} /></button></div>
      <div className="demo-event-card"><strong>Launch workshop</strong><span><Clock3 size={11} /> 10:00 AM – 11:30 AM</span></div>
      <div className="demo-event-card"><strong>Design critique</strong><span><Clock3 size={11} /> 2:30 PM – 3:30 PM</span><a>Join call</a></div>
      <div className="demo-next-events"><strong>NEXT</strong><div><span>Partner sync</span><time>Thu, 2:00 PM</time></div><div><span>Weekly wrap</span><time>Fri, 4:00 PM</time></div></div>

      <div className="demo-context-title"><span>MAILBOX HEALTH <RefreshCw size={11} /></span><i /></div>
      <div className="demo-health-card"><div><strong>Verdict:</strong><b>Ready</b></div><span>Status: Ready</span><div><span>Archive indexed:</span><strong>100%</strong></div></div>

      <div className="demo-context-title"><span>SPEED PROOF</span></div>
      <div className="demo-speed-card"><div><span>Local cache startup:</span><b>182ms</b></div><div><span>Gmail sync check:</span><b>0ms</b></div><div><span>Local search index FTS:</span><b>4ms</b></div><div><span>Visible body coverage:</span><strong>Bodies load on open</strong></div><button type="button">Cache bodies</button></div>

      <div className="demo-context-title"><span>ACTION LEDGER</span><button type="button"><RotateCcw size={10} /> Undo (Z)</button></div>
      <div className="demo-ledger">
        {['Marked read', 'Archived', 'Marked read', 'Label applied', 'Archived'].map((label, index) => (
          <div key={`${label}-${index}`}><CheckCircle2 size={12} /><span>{label}</span><time>{index < 2 ? '18m ago' : '1h ago'}</time></div>
        ))}
      </div>
    </>
  );
}

export function InboxScene() {
  return (
    <MarketingShell scene="inbox" context={<MailboxContext />}>
      <div className="demo-mail-tabs">
        <button type="button" className="is-mailbox"><Inbox size={14} /> Inbox <span>64</span><ChevronDown size={12} /></button>
        <button type="button" className="is-active">Important <span>6</span></button>
        <button type="button">Purchases <span>3</span></button>
        <button type="button">LinkedIn <span>4</span></button>
        <button type="button">Automation <span>12</span></button>
        <button type="button">Other <span>18</span></button>
        <button type="button">Atlas <span>2</span></button>
        <button type="button">GitHub <span>5</span></button>
        <div className="demo-tab-actions"><SquarePen size={14} /><Command size={14} /></div>
      </div>

      <section className="demo-mail-list" aria-label="Synthetic mailbox">
        {demoThreads.map((thread, index) => (
          <article key={`${thread.email}-${thread.subject}`} className={`demo-mail-row ${index === 0 ? 'is-selected' : ''}`}>
            <div className="demo-mail-avatar" style={{ backgroundColor: thread.accent }}>
              {thread.sender.split(' ').map(word => word[0]).slice(0, 2).join('')}
              {thread.unread && <span />}
            </div>
            <div className="demo-mail-copy">
              <div><strong>{thread.sender}</strong><time>{thread.time}</time></div>
              <div><span style={{ color: thread.accent, backgroundColor: `color-mix(in srgb, ${thread.accent} 14%, transparent)` }}>{thread.label || 'inbox'}</span><b>{thread.subject}</b></div>
              <p>{thread.preview}</p>
            </div>
          </article>
        ))}
      </section>
    </MarketingShell>
  );
}
