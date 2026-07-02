import { Braces, Save } from 'lucide-react';
import type { SnippetTemplate } from '../../../../shared/types';

interface ComposeTemplatesMenuProps {
  templates: SnippetTemplate[];
  onInsertDefaultSnippet: () => void;
  onInsertTemplate: (template: SnippetTemplate) => void;
  onSaveBodyAsSnippet: () => void;
}

export function ComposeTemplatesMenu({
  templates,
  onInsertDefaultSnippet,
  onInsertTemplate,
  onSaveBodyAsSnippet,
}: ComposeTemplatesMenuProps) {
  return (
    <div className="absolute bottom-10 right-8 z-50 w-[280px] rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-1.5 shadow-xl">
      <button
        type="button"
        onClick={onInsertDefaultSnippet}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
      >
        <Braces className="h-3.5 w-3.5" />
        Insert default snippet
      </button>
      {templates.length > 0 && (
        <div className="my-1 border-t border-[var(--border)] pt-1">
          {templates.map(template => (
            <button
              key={template.id}
              type="button"
              onClick={() => onInsertTemplate(template)}
              className="flex w-full min-w-0 items-start gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
            >
              <Braces className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-medium">{template.title}</span>
                {template.trigger && (
                  <span className="truncate text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">{template.trigger}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="my-1 border-t border-[var(--border)] pt-1">
      <button
        type="button"
        onClick={onSaveBodyAsSnippet}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
      >
        <Save className="h-3.5 w-3.5" />
        Save body as new template
      </button>
      </div>
    </div>
  );
}
