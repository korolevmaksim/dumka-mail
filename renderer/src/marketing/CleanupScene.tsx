import { Archive, Check, Eye, Inbox, RotateCcw, ShieldCheck, Sparkles, UserMinus } from 'lucide-react';
import { MarketingShell, PanelHeading } from './MarketingShell';
import { demoSenders } from './marketingDemoData';

function CleanupContext() {
  return (
    <>
      <PanelHeading icon={<Eye size={14} />} title="Recent messages" meta="Synthetic preview" />
      <div className="demo-preview-mail"><span>Product Brief Daily</span><strong>Five product lessons from this week</strong><p>A compact digest of launches, experiments, and product decisions…</p><time>Today, 07:14</time></div>
      <div className="demo-preview-mail"><span>Product Brief Daily</span><strong>How teams are planning Q3</strong><p>New benchmarks and planning templates from product teams…</p><time>Yesterday</time></div>
      <div className="demo-context-rule" />
      <div className="demo-safety-note"><ShieldCheck size={15} /><div><strong>Dry run first</strong><span>Dumka shows the exact sender, message count, and proposed result before anything changes.</span></div></div>
    </>
  );
}

export function CleanupScene() {
  return (
    <MarketingShell scene="cleanup" context={<CleanupContext />}>
      <div className="demo-cleanup-head">
        <div><span><ShieldCheck size={15} /> Privacy & Cleanup</span><h1>Reduce inbox noise with a reviewable plan.</h1><p>Signals are computed locally. Every archive or unsubscribe action waits for your approval.</p></div>
        <button type="button"><Sparkles size={14} /> Refresh analysis</button>
      </div>
      <div className="demo-cleanup-summary">
        <span><strong>91</strong> messages reviewed</span><span><strong>3</strong> suggested senders</span><span><strong>0</strong> actions executed</span>
        <div><ShieldCheck size={14} /> Local analysis</div>
      </div>
      <section className="demo-cleanup-table">
        <div className="demo-cleanup-table-head"><span>Sender</span><span>Messages</span><span>Signal</span><span>Proposed action</span><span /></div>
        {demoSenders.map((item, index) => (
          <article key={item.email} className={index === 0 ? 'is-selected' : ''}>
            <div className="demo-cleanup-sender"><span className={`demo-avatar small ${index === 1 ? 'orange' : index === 2 ? 'green' : ''}`}>{item.sender.split(' ').map(word => word[0]).slice(0, 2).join('')}</span><div><strong>{item.sender}</strong><span>{item.email}</span></div></div>
            <div><strong>{item.messages}</strong><span>{item.unread} unread</span></div>
            <div><span className={`demo-risk ${item.risk === 'Keep' ? 'is-keep' : ''}`}>{item.risk}</span></div>
            <div className="demo-proposed"><span>{item.action.includes('Unsubscribe') ? <UserMinus size={14} /> : item.action.includes('Archive') ? <Archive size={14} /> : <RotateCcw size={14} />}</span>{item.action}</div>
            <button type="button">{index === 3 ? 'Exclude' : 'Review'}</button>
          </article>
        ))}
      </section>
      <div className="demo-cleanup-footer">
        <span><Inbox size={14} /> Preview: 79 messages would be archived</span>
        <button type="button" className="is-secondary">Edit selection</button>
        <button type="button"><Check size={14} /> Review 3 actions</button>
      </div>
    </MarketingShell>
  );
}
