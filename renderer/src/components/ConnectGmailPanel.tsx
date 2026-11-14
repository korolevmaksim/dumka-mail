import { AlertTriangle, LoaderCircle, Mail } from 'lucide-react';
import { useAppStore } from '../stores/AppStore';
import { googleSignInErrorCopy } from '../../../shared/googleSignInErrors';

export function ConnectGmailPanel() {
  const store = useAppStore();
  const error = store.signInError;
  const copy = error ? googleSignInErrorCopy(error) : null;
  const connect = () => void store.onboardAccount('');

  if (error && copy) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[var(--panel-bg)] p-8 text-center">
        <AlertTriangle aria-hidden="true" className="h-12 w-12 text-[var(--warning-solid)] opacity-80" />
        <div role="alert" className="max-w-md">
          <h1 className="text-[calc(18px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
            {copy.title}
          </h1>
          <p className="mt-2 text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)]">
            {copy.body}
          </p>
          {error.expectedPath && (
            <div className="mt-3 text-left">
              <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
                {error.code === 'GOOGLE_OAUTH_CLIENT_MISSING' ? 'Expected file:' : 'File:'}
              </p>
              <code className="mt-1 block select-text break-all rounded-md border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]">
                {error.expectedPath}
              </code>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={connect}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-fill)] px-4 py-2 text-[calc(13px*var(--font-scale))] font-semibold text-[var(--on-accent)] hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {store.signInBusy && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[var(--panel-bg)] p-8 text-center">
      <Mail aria-hidden="true" className="h-12 w-12 text-[var(--accent-ink)] opacity-80" />
      <div className="max-w-md">
        <h1 className="text-[calc(18px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
          Connect Gmail to start
        </h1>
        <p className="mt-2 text-[calc(13px*var(--font-scale))] leading-relaxed text-[var(--text-secondary)]">
          Dumka keeps your mail on this Mac and sorts the inbox by what each message needs from you:
          a reply, a read, an answer to an invitation, or nothing, so routine mail is cleared in one step.
        </p>
        <ul className="mx-auto mt-3 flex max-w-sm flex-col gap-1 text-left text-[calc(12px*var(--font-scale))] leading-snug text-[var(--text-secondary)]" data-first-run-points>
          <li className="flex gap-2"><span aria-hidden="true" className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[var(--text-tertiary)]" />Archiving and moving can be undone with one key.</li>
          <li className="flex gap-2"><span aria-hidden="true" className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[var(--text-tertiary)]" />Nothing is sent, deleted or unsubscribed without you.</li>
          <li className="flex gap-2"><span aria-hidden="true" className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[var(--text-tertiary)]" />An AI model is optional; without one, mail is sorted by rules on this Mac.</li>
        </ul>
      </div>
      <button
        type="button"
        onClick={connect}
        className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-fill)] px-4 py-2 text-[calc(13px*var(--font-scale))] font-semibold text-[var(--on-accent)] hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        {store.signInBusy && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
        {store.signInBusy ? 'Waiting for Google… (click to restart)' : 'Connect Gmail'}
      </button>
    </div>
  );
}
