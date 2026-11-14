// The divider between the mailbox list and the reading area. Drag it, or
// focus it and use ← / → (Home resets). The width is remembered per layout:
// one for the inbox overview, one for when a conversation is open.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { LIST_MIN_WIDTH, LIST_WIDTH_KEY_STEP, READING_MIN_WIDTH, clampListWidth, type ListWidthMode } from '../../../../shared/listLayout';

interface ListResizeHandleProps {
  mode: ListWidthMode;
  /** The element whose width is being set (the list column). */
  listRef: React.RefObject<HTMLDivElement | null>;
  /** Called with a live width while dragging; `null` when the drag ends. */
  onPreview: (width: number | null) => void;
}

const SETTING_KEY: Record<ListWidthMode, 'listWidthHome' | 'listWidthReading'> = {
  home: 'listWidthHome',
  reading: 'listWidthReading',
};

export function ListResizeHandle({ mode, listRef, onPreview }: ListResizeHandleProps) {
  const store = useAppStore();
  const updateSettingsRef = useRef(store.updateSettings);
  updateSettingsRef.current = store.updateSettings;
  const [dragging, setDragging] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  // Each layout has its own width: nothing carries over when a conversation opens or closes.
  useEffect(() => setCurrent(null), [mode]);
  const drag = useRef<{ left: number; available: number; width: number; moved: boolean } | null>(null);

  /** The space the list and the reading area share: from the list's left edge to the window's right edge. */
  const measure = useCallback(() => {
    const rect = listRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { left: rect.left, available: window.innerWidth - rect.left, width: rect.width };
  }, [listRef]);

  const save = useCallback((width: number | null) => {
    void updateSettingsRef.current(settings => {
      if (width === null) delete settings.appearance[SETTING_KEY[mode]];
      else settings.appearance[SETTING_KEY[mode]] = width;
    });
  }, [mode]);

  useEffect(() => {
    if (!dragging) return undefined;
    const move = (event: PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      const width = clampListWidth(event.clientX - state.left, state.available);
      state.width = width;
      state.moved = true;
      setCurrent(width);
      onPreview(width);
    };
    const end = () => {
      const state = drag.current;
      drag.current = null;
      setDragging(false);
      onPreview(null);
      // A click without a move changes nothing: the default width stays responsive.
      if (state?.moved) save(Math.round(state.width));
      else setCurrent(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    // No text selection and a steady cursor while the divider follows the pointer.
    const previousSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      document.body.style.userSelect = previousSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [dragging, onPreview, save]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const measured = measure();
    if (!measured) return;
    event.preventDefault();
    drag.current = { ...measured, moved: false };
    setCurrent(Math.round(measured.width));
    setDragging(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const measured = measure();
    if (!measured) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === 'ArrowLeft' ? -LIST_WIDTH_KEY_STEP : LIST_WIDTH_KEY_STEP;
      const width = clampListWidth(measured.width + delta, measured.available);
      setCurrent(width);
      save(width);
    } else if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      setCurrent(null);
      save(null);
    }
  };

  const measured = measure();
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Width of the mailbox list. Arrow keys resize, Home resets."
      aria-valuemin={LIST_MIN_WIDTH}
      aria-valuemax={measured ? Math.max(LIST_MIN_WIDTH, Math.round(measured.available - READING_MIN_WIDTH)) : undefined}
      aria-valuenow={current ?? (measured ? Math.round(measured.width) : undefined)}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      data-list-resize-handle={mode}
      onPointerDown={startDrag}
      onDoubleClick={() => { setCurrent(null); save(null); }}
      onKeyDown={onKeyDown}
      className="group/handle absolute bottom-0 right-0 top-0 z-20 w-[6px] cursor-col-resize touch-none outline-none"
    >
      <span
        aria-hidden="true"
        className={`absolute bottom-0 right-0 top-0 w-px transition-colors group-hover/handle:w-[2px] group-hover/handle:bg-[var(--accent)] group-focus-visible/handle:w-[2px] group-focus-visible/handle:bg-[var(--accent)] ${dragging ? 'w-[2px] bg-[var(--accent)]' : 'bg-transparent'}`}
      />
    </div>
  );
}
