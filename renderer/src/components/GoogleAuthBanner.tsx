import { LoaderCircle, ShieldAlert } from 'lucide-react';
import { useAppStore } from '../stores/AppStore';

export function GoogleAuthBanner() {
  const store = useAppStore();
  const issue = store.googleAuthIssues[0];
  if (!issue) return null;

  const account = store.accounts.find(candidate => candidate.email === issue.accountId);
  const accountLabel = account?.displayName && account.displayName !== issue.accountId
    ? `${account.displayName} (${issue.accountId})`
    : issue.accountId;
  const extraIssueCount = store.googleAuthIssues.length - 1;
  const isReauthorizing = store.reauthorizingAccountId === issue.accountId;
  const explanation = issue.reason === 'missing_credentials'
    ? 'Saved Google credentials are missing.'
    : issue.reason === 'permissions_changed'
      ? 'The Google permissions granted to Dumka Mail have changed.'
      : 'Google no longer accepts the saved authorization.';

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="flex shrink-0 items-center gap-3 border-b border-[var(--warning)]/35 bg-[var(--warning)]/10 px-4 py-2 text-[var(--text-primary)]"
    >
      <ShieldAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--warning-solid)]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[calc(11px*var(--font-scale))] font-semibold">
          Reconnect Gmail for {accountLabel}
        </div>
        <div className="truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
          {explanation} Cached mail is still available, but sync and sending are paused.
          {extraIssueCount > 0 ? ` ${extraIssueCount} more ${extraIssueCount === 1 ? 'account also needs' : 'accounts also need'} attention.` : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void store.reauthorizeAccount(issue.accountId)}
        disabled={store.reauthorizingAccountId !== null}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--warning-solid)] px-3 py-1.5 text-[calc(10px*var(--font-scale))] font-semibold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--warning)] focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60"
      >
        {isReauthorizing && <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />}
        {isReauthorizing ? 'Opening Google…' : 'Reconnect account'}
      </button>
    </section>
  );
}
