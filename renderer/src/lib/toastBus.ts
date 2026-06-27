// Context-free toast bus so both the React tree and the (non-React) store can
// raise toasts. A single <ToastHost/> subscribes and renders them.

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastInput {
  type?: ToastType;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number; // ms; 0 = sticky until dismissed
}

type Listener = (t: ToastInput) => void;
const listeners = new Set<Listener>();

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitToast(t: ToastInput): void {
  listeners.forEach((fn) => fn(t));
}
