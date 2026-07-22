import { CalendarDays, Check, Clock3, FileText, Inbox, Reply, ShieldCheck, Sparkles } from 'lucide-react';
import { MarketingShell, PanelHeading } from './MarketingShell';

function TodayContext() {
  return (
    <>
      <PanelHeading icon={<CalendarDays size={14} />} title="Agenda" meta="Thursday" />
      <div className="demo-agenda-item is-current"><time>10:00</time><div><strong>Launch workshop</strong><span>Starts in 42 minutes</span></div></div>
      <div className="demo-agenda-item"><time>14:30</time><div><strong>Design critique</strong><span>Northstar Studio</span></div></div>
      <div className="demo-agenda-item"><time>16:00</time><div><strong>Weekly wrap</strong><span>Project room</span></div></div>
      <div className="demo-context-rule" />
      <PanelHeading icon={<ShieldCheck size={14} />} title="Mailbox health" />
      <div className="demo-health-line"><span>Pending sync</span><strong>0</strong></div>
      <div className="demo-health-line"><span>Review proposals</span><strong>3</strong></div>
      <div className="demo-health-line"><span>Cleanup candidates</span><strong>4</strong></div>
      <div className="demo-local-state"><ShieldCheck size={14} /><div><strong>Local cache ready</strong><span>Last synced 2 min ago</span></div></div>
    </>
  );
}

export function TodayScene() {
  return (
    <MarketingShell scene="today" context={<TodayContext />}>
      <div className="demo-today-head">
        <div><span>Thursday, 23 July</span><h1>Good morning, Avery.</h1><p>Four things need your attention. Everything below is prepared from the local cache.</p></div>
        <button type="button"><Sparkles size={14} /> Refresh briefing</button>
      </div>
      <div className="demo-today-grid">
        <section className="demo-briefing">
          <PanelHeading icon={<Sparkles size={14} />} title="Daily briefing" meta="14 local sources" />
          <div className="demo-briefing-lead">The launch brief is nearly ready. Your only blocker is confirming Tuesday’s rollout and the customer-update owner.</div>
          <div className="demo-priority-list">
            <article><span className="demo-priority-icon is-blue"><Reply size={14} /></span><div><strong>Reply to Maya Chen</strong><p>Confirm Tuesday at 10:00 and assign the customer-update owner.</p><span>Due in 42 min · Atlas Research</span></div><button type="button">Open</button></article>
            <article><span className="demo-priority-icon is-purple"><FileText size={14} /></span><div><strong>Review Q3 budget question</strong><p>The plan is approved; one research-cost line still needs context.</p><span>Due today · Northstar Studio</span></div><button type="button">Open</button></article>
            <article><span className="demo-priority-icon is-green"><CalendarDays size={14} /></span><div><strong>Design critique moved</strong><p>The meeting starts at 14:30 with the same attendees and room.</p><span>Calendar · 6 participants</span></div><button type="button">View</button></article>
          </div>
        </section>

        <div className="demo-today-stack">
          <section className="demo-reply-pipeline">
            <PanelHeading icon={<Clock3 size={14} />} title="Reply pipeline" meta="2 due" />
            <article><span className="demo-avatar small">MC</span><div><strong>Launch brief — final notes</strong><p>Maya Chen · due in 42 min</p></div><span className="demo-due is-soon">Soon</span></article>
            <article><span className="demo-avatar small purple">TG</span><div><strong>Q3 budget sign-off</strong><p>Theo Grant · due today</p></div><span className="demo-due">Today</span></article>
          </section>
          <section className="demo-review-queue">
            <PanelHeading icon={<Check size={14} />} title="Agent review queue" meta="3 proposals" />
            <div className="demo-queue-item"><span><Reply size={14} /></span><div><strong>Draft reply</strong><p>Confirm rollout details with Maya</p></div><button type="button">Review</button></div>
            <div className="demo-queue-item"><span><Inbox size={14} /></span><div><strong>Archive 3 digests</strong><p>Low-priority, already read</p></div><button type="button">Review</button></div>
            <div className="demo-queue-item"><span><ShieldCheck size={14} /></span><div><strong>Cleanup 2 senders</strong><p>Nothing executes without approval</p></div><button type="button">Review</button></div>
          </section>
        </div>
      </div>
    </MarketingShell>
  );
}
