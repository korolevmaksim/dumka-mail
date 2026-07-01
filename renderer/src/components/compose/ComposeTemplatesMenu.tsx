import { Braces, Save } from 'lucide-react';

interface ComposeTemplatesMenuProps {
  onInsertDefaultSnippet: () => void;
  onSaveBodyAsSnippet: () => void;
}

export function ComposeTemplatesMenu({
  onInsertDefaultSnippet,
  onSaveBodyAsSnippet,
}: ComposeTemplatesMenuProps) {
  return (
    <div className="absolute bottom-10 right-8 z-50 w-[230px] rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-1.5 shadow-xl">
      <button
        type="button"
        onClick={onInsertDefaultSnippet}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
      >
        <Braces className="h-3.5 w-3.5" />
        Insert default snippet
      </button>
      <button
        type="button"
        onClick={onSaveBodyAsSnippet}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
      >
        <Save className="h-3.5 w-3.5" />
        Save body as snippet
      </button>
    </div>
  );
}
