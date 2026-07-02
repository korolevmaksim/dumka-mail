import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  escapeHtml,
  htmlFragmentToPlainText,
  plainTextToHtmlFragment,
  sanitizeDraftHtmlFragment,
} from '../../../../shared/draftHtml';

export interface RichTextEditorHandle {
  focus: () => void;
  focusAtStart: () => void;
  execute: (command: string, value?: string) => void;
  insertHtml: (html: string) => void;
  insertText: (text: string) => void;
  replaceHtml: (html: string) => void;
  getSelectedText: () => string;
  getSelectionRange: () => Range | null;
  restoreSelectionRange: (range: Range) => void;
}

interface RichTextEditorProps {
  draftId: string;
  bodyPlain: string;
  bodyHtml?: string | null;
  placeholder: string;
  spellCheck?: boolean;
  editorClassName?: string;
  collapseQuotedText?: boolean;
  onChange: (bodyPlain: string, bodyHtml: string) => void;
  onImageFile?: (file: File) => Promise<string | null>;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function htmlForInsertedText(text: string): string {
  return plainTextToHtmlFragment(text) || `<p>${escapeHtml(text)}</p>`;
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor({
  draftId,
  bodyPlain,
  bodyHtml,
  placeholder,
  spellCheck = true,
  editorClassName = '',
  collapseQuotedText = false,
  onChange,
  onImageFile,
}, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastDraftIdRef = useRef<string | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const sanitized = sanitizeDraftHtmlFragment(editor.innerHTML);
    const plain = htmlFragmentToPlainText(sanitized);
    setIsEmpty(plain.trim().length === 0);
    onChange(plain, sanitized);
  };

  const insertHtml = (html: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand('insertHTML', false, html);
    emitChange();
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (lastDraftIdRef.current === draftId) return;

    const initialHtml = bodyHtml?.trim()
      ? sanitizeDraftHtmlFragment(bodyHtml)
      : plainTextToHtmlFragment(bodyPlain);
    editor.innerHTML = initialHtml;
    setIsEmpty(htmlFragmentToPlainText(initialHtml).length === 0);
    lastDraftIdRef.current = draftId;
  }, [bodyHtml, bodyPlain, draftId]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    focusAtStart: () => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const range = document.createRange();
      range.setStart(editor, 0);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    execute: (command: string, value?: string) => {
      editorRef.current?.focus();
      document.execCommand(command, false, value);
      emitChange();
    },
    insertHtml,
    insertText: (text: string) => insertHtml(htmlForInsertedText(text)),
    replaceHtml: (html: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.innerHTML = sanitizeDraftHtmlFragment(html);
      emitChange();
      editor.focus();
    },
    getSelectedText: () => window.getSelection()?.toString() || '',
    getSelectionRange: () => {
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      const commonAncestor = range.commonAncestorContainer;
      const anchorNode = commonAncestor.nodeType === Node.ELEMENT_NODE ? commonAncestor : commonAncestor.parentNode;
      if (!(anchorNode instanceof Node) || !editor.contains(anchorNode)) {
        return null;
      }
      return range.cloneRange();
    },
    restoreSelectionRange: (range: Range) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
  }));

  const handleImageFiles = async (files: FileList | File[]) => {
    if (!onImageFile) return false;
    const imageFiles = Array.from(files).filter(isImageFile);
    if (imageFiles.length === 0) return false;

    for (const file of imageFiles) {
      const html = await onImageFile(file);
      if (html) insertHtml(html);
    }
    return true;
  };

  return (
    <div className="relative flex min-h-0 flex-1">
      {isEmpty && (
        <div className="pointer-events-none absolute left-5 top-4 text-[calc(13px*var(--font-scale))] text-[var(--text-tertiary)]">
          {placeholder}
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable
        spellCheck={spellCheck}
        role="textbox"
        aria-multiline="true"
        onInput={emitChange}
        onPaste={(event) => {
          if (!event.clipboardData?.files.length) return;
          const hasImage = Array.from(event.clipboardData.files).some(isImageFile);
          if (!hasImage) return;
          event.preventDefault();
          void handleImageFiles(event.clipboardData.files);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer?.files.length) return;
          event.preventDefault();
          void handleImageFiles(event.dataTransfer.files);
        }}
        className={`rich-compose-editor ${collapseQuotedText ? 'rich-compose-editor--quotes-collapsed' : ''} min-h-[300px] flex-1 overflow-y-auto px-5 py-4 text-[calc(13px*var(--font-scale))] leading-relaxed text-[var(--text-primary)] outline-none ${editorClassName}`}
      />
    </div>
  );
});
