import { useEffect, useRef } from 'react';

/**
 * Escape closes the innermost open layer first (SPEC: popover / menu, then
 * sheet / dialog, then Ask Dumka, reply dock, reader, search).
 *
 * Popovers and menus register here while they are open. One capture-phase
 * window listener hands Escape to the most recently opened layer and stops
 * the event, so neither the global layer chain in `App.tsx` (a bubble
 * listener) nor `useDialogFocus` (document capture) sees it. Dialogs and the
 * rest of the chain are unchanged.
 */

interface EscapeLayer {
  readonly id: number;
  readonly close: () => void;
}

const layers: EscapeLayer[] = [];
let nextLayerId = 1;
let listening = false;

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing) return;
  const top = layers[layers.length - 1];
  if (!top) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  top.close();
}

function syncListener(): void {
  if (typeof window === 'undefined') return;
  if (layers.length > 0 && !listening) {
    window.addEventListener('keydown', handleKeyDown, true);
    listening = true;
  } else if (layers.length === 0 && listening) {
    window.removeEventListener('keydown', handleKeyDown, true);
    listening = false;
  }
}

/** Registers a layer; returns its unregister function. Exported for tests. */
export function pushEscapeLayer(close: () => void): () => void {
  const layer: EscapeLayer = { id: nextLayerId++, close };
  layers.push(layer);
  syncListener();
  return () => {
    const index = layers.findIndex(candidate => candidate.id === layer.id);
    if (index !== -1) layers.splice(index, 1);
    syncListener();
  };
}

/** Number of open layers (tests). */
export function escapeLayerCount(): number {
  return layers.length;
}

/**
 * While `active`, Escape calls `onEscape` before any outer layer. The latest
 * `onEscape` is used, so callers may pass an inline closure.
 */
export function useEscapeLayer(active: boolean, onEscape: (() => void) | undefined): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const enabled = active && Boolean(onEscape);
  useEffect(() => {
    if (!enabled) return;
    return pushEscapeLayer(() => onEscapeRef.current?.());
  }, [enabled]);
}
