import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAppStore } from '../../../stores/AppStore';
import { AddModelForm } from '../AddModelSheet';
import { BackgroundWorkSection } from '../BackgroundWorkSection';
import { AISettingsTab } from './AISettingsTab';
import { isAIModelMissing, isAIProviderUnavailable } from '../../../../../shared/aiErrors';

/**
 * Settings → AI model: the short "Add a model" form first, then the opt-in
 * background work with its own model; the existing long AI configuration
 * stays intact below a `More options` disclosure.
 */
export function AIModelTab() {
  const store = useAppStore();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  const headingId = useId();
  const descriptor = store.aiProviderDesc;
  const connected = !isAIProviderUnavailable(descriptor);

  return (
    <div data-settings-page="ai" className="flex w-full max-w-[600px] flex-col gap-4 select-text">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-[calc(18px*var(--font-scale))] font-semibold leading-tight text-[var(--text-primary)]">AI model</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
          {!descriptor
            ? 'Connect a provider with your own API key.'
            : isAIModelMissing(descriptor)
              ? `A key for ${descriptor.displayName} is saved, but no model is chosen. Choose one below: Dumka has no built-in model.`
              : connected
              ? `Using ${descriptor.displayName}${descriptor.model ? ` · ${descriptor.model}` : ''}. Add a different provider or key below.`
              : 'No model yet. Dumka sorts mail on this Mac by rules; summaries, drafts and Ask Dumka need a model.'}
        </p>
      </div>

      <section aria-labelledby={headingId} className="rounded-lg border border-[var(--border)] bg-[var(--rail-bg)] p-4">
        <AddModelForm />
      </section>

      <BackgroundWorkSection />

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setMoreOpen(open => !open)}
          aria-expanded={moreOpen}
          aria-controls={moreId}
          className="flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--rail-bg)] px-4 py-3 text-left cursor-pointer hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2"
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">More options</span>
            <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">All providers, fallback order, embeddings, prompts and agent rules</span>
          </span>
          <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-[var(--text-secondary)] transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
        </button>
        {moreOpen && (
          <div id={moreId}>
            <AISettingsTab />
          </div>
        )}
      </div>
    </div>
  );
}
