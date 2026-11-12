import { afterEach, describe, expect, it, vi } from 'vitest';
import { escapeLayerCount, pushEscapeLayer } from '../renderer/src/hooks/useEscapeLayer';

type Listener = (event: KeyboardEvent) => void;

function fakeWindow() {
  const listeners = new Set<Listener>();
  return {
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    press(key: string) {
      const event = {
        key,
        isComposing: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      } as unknown as KeyboardEvent;
      for (const listener of [...listeners]) listener(event);
      return event;
    },
    get listenerCount() { return listeners.size; },
  };
}

describe('escape layers', () => {
  const original = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = original;
  });

  it('closes only the innermost open layer and stops the event', () => {
    const win = fakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const outer = vi.fn();
    const inner = vi.fn();
    const popOuter = pushEscapeLayer(outer);
    const popInner = pushEscapeLayer(inner);

    const event = win.press('Escape');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();

    popInner();
    win.press('Escape');
    expect(outer).toHaveBeenCalledTimes(1);

    win.press('a');
    expect(outer).toHaveBeenCalledTimes(1);

    popOuter();
    expect(escapeLayerCount()).toBe(0);
    expect(win.listenerCount).toBe(0);
  });
});
