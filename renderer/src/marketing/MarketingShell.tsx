import type { ReactNode } from 'react';
import {
  CalendarDays,
  Eraser,
  Home,
  Inbox,
  Monitor,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SquarePen,
} from 'lucide-react';
import type { DemoScene } from './marketingDemoData';

interface MarketingShellProps {
  scene: Exclude<DemoScene, 'cover'>;
  children: ReactNode;
  assistant?: ReactNode;
  context?: ReactNode;
}

export function MarketingShell({ scene, children, assistant, context }: MarketingShellProps) {
  return (
    <div className="demo-app" data-theme="light" data-interface-style="soft" data-density="spacious">
      <div className="demo-shell-body">
        <aside className="demo-rail">
          <div className="demo-traffic-lights" aria-hidden="true"><span /><span /><span /></div>
          <nav aria-label="Demo navigation">
            <div className={`demo-rail-item ${scene === 'today' ? 'is-active' : ''}`} title="Today"><Home size={17} /></div>
            <div className="demo-rail-divider" />
            <div className={`demo-rail-item ${scene === 'calendar' ? 'is-active' : ''}`} title="Calendar"><CalendarDays size={17} /></div>
            <div className="demo-rail-divider" />
            <div className="demo-rail-item" title="Unified Inbox"><Inbox size={17} /><span className="demo-key-badge">⌘0</span></div>
            <div className="demo-account is-active" title="avery@northstar.example">NS<span>⌘1</span></div>
            <div className="demo-account is-image" title="team@atlas-research.example">AT<span>⌘2</span></div>
            <div className="demo-account is-green" title="hello@common-ground.example">CG<span>⌘3</span></div>
            <div className="demo-rail-item is-add" title="Connect Gmail Account"><Plus size={17} /></div>
          </nav>
          <div className="demo-rail-bottom">
            <div className="demo-rail-icon" title="Theme"><Monitor size={15} /></div>
            <div className={`demo-rail-icon ${scene === 'cleanup' ? 'is-active' : ''}`} title="Privacy & Cleanup"><Eraser size={16} /></div>
            <div className="demo-rail-icon" title="Settings"><Settings size={16} /></div>
            <div className="demo-rail-icon" title="AI Copilot"><Sparkles size={17} /></div>
          </div>
        </aside>

        {assistant && <aside className="demo-assistant">{assistant}</aside>}

        <main className="demo-main">
          <header className="demo-searchbar">
            <div className="demo-search-field"><Search size={13} /><span>{scene === 'calendar' ? 'Search calendar: project launch' : 'Search mail: from: domain: has:attachment is:unread'}</span></div>
            <span className="demo-ready">Ready</span>
            <span className="demo-synthetic-badge"><ShieldCheck size={11} /> Demo · synthetic</span>
            <button type="button" title="Compose"><SquarePen size={14} /></button>
            <kbd>⌘K</kbd>
          </header>
          {children}
        </main>

        {context && <aside className="demo-context">{context}</aside>}
      </div>
      <footer className="demo-bottom-bar">
        <div><span><kbd>Z</kbd> undo</span><span><kbd>R</kbd> reply</span><span><kbd>A</kbd> reply all</span><span><kbd>F</kbd> forward</span><span><kbd>S</kbd> summarize</span><span><kbd>E</kbd> done</span><span><kbd>U</kbd> read/unread</span><span><kbd>C</kbd> compose</span><span><kbd>/</kbd> search</span><span><kbd>G/⇧G</kbd> mailbox</span><span><kbd>⌘⇧P</kbd> queue</span><span><kbd>⌘J</kbd> ask AI</span><span><kbd>J/K</kbd> move</span><span><kbd>↵/O</kbd> open</span></div>
        <span><kbd>⌘J</kbd> AI · <kbd>⌘K</kbd> Commands</span>
      </footer>
    </div>
  );
}

export function PanelHeading({ icon, title, meta }: { icon: ReactNode; title: string; meta?: string }) {
  return (
    <div className="demo-panel-heading">
      <span className="demo-panel-heading-icon">{icon}</span>
      <strong>{title}</strong>
      {meta && <span>{meta}</span>}
    </div>
  );
}
