import { Mail, ShieldCheck, Sparkles } from 'lucide-react';
import appIconUrl from '../../../assets/icon.png';
import { CalendarScene } from './CalendarScene';
import { CleanupScene } from './CleanupScene';
import { InboxScene } from './InboxScene';
import { TodayScene } from './TodayScene';
import { demoScenes, type DemoScene } from './marketingDemoData';
import './marketing-demo.css';
import './marketing-mailbox.css';

function isDemoScene(value: string): value is DemoScene {
  return demoScenes.some(scene => scene === value);
}

function getScene(): DemoScene {
  const requested = new URLSearchParams(window.location.search).get('scene');
  return requested && isDemoScene(requested) ? requested : 'inbox';
}

function CoverScene() {
  return (
    <div className="demo-cover" data-theme="dark" data-interface-style="soft">
      <div className="demo-cover-copy">
        <img src={appIconUrl} alt="" />
        <div className="demo-cover-wordmark"><Mail size={18} /> Dumka Mail</div>
        <h1>Your inbox, schedule, and next action — kept local.</h1>
        <p>A keyboard-first Gmail client with explainable AI, reviewable automation, and a local SQLite cache.</p>
        <div className="demo-cover-pills"><span><ShieldCheck size={14} /> Local-first</span><span><Sparkles size={14} /> Review before action</span></div>
      </div>
      <div className="demo-cover-stage" aria-label="Dumka Mail inbox preview">
        <InboxScene />
      </div>
      <div className="demo-cover-caption">Electron · React · TypeScript · SQLite</div>
    </div>
  );
}

export default function MarketingDemo() {
  const scene = getScene();
  document.title = `Dumka Mail marketing demo — ${scene}`;

  if (scene === 'cover') return <CoverScene />;
  if (scene === 'today') return <TodayScene />;
  if (scene === 'calendar') return <CalendarScene />;
  if (scene === 'cleanup') return <CleanupScene />;
  return <InboxScene />;
}
