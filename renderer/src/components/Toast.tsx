import { useEffect, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import { subscribeToasts, ToastInput, ToastType } from '../lib/toastBus';

interface ToastItem extends ToastInput {
  id: string;
}

const TONE: Record<ToastType, { color: string; solidColor: string; Icon: typeof Info }> = {
  success: { color: 'var(--success)', solidColor: 'var(--success-solid)', Icon: CheckCircle },
  error: { color: 'var(--danger)', solidColor: 'var(--danger-solid)', Icon: AlertCircle },
  warning: { color: 'var(--warning)', solidColor: 'var(--warning-solid)', Icon: AlertCircle },
  info: { color: 'var(--accent-ink)', solidColor: 'var(--accent-solid)', Icon: Info },
};

export function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts((t) => {
      const id = crypto.randomUUID();
      const item: ToastItem = { duration: 4500, type: 'info', ...t, id };
      setToasts((prev) => [...prev, item]);
      if (item.duration && item.duration > 0) {
        setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), item.duration);
      }
    });
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((x) => x.id !== id));

  return (
    <div className="fixed bottom-10 right-5 z-[200] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => {
        const tone = TONE[t.type || 'info'];
        const Icon = tone.Icon;
        return (
          <div
            key={t.id}
            className="dm-overlay pointer-events-auto panel-surface bg-[var(--panel-bg)] border rounded-xl shadow-2xl px-3.5 py-2.5 flex items-center gap-3 min-w-[240px] max-w-[380px] fade-in-up select-none"
            style={{ borderColor: `color-mix(in srgb, ${tone.color} 40%, var(--border))` }}
          >
            <Icon className="w-4 h-4 shrink-0" style={{ color: tone.color }} />
            <span className="text-[calc(12px*var(--font-scale))] text-[var(--text-primary)] flex-1 leading-snug">{t.message}</span>
            {t.actionLabel && (
              <button
                onClick={() => { t.onAction?.(); dismiss(t.id); }}
                className="text-[calc(11px*var(--font-scale))] font-semibold px-2 py-1 rounded-lg text-white cursor-pointer hover:opacity-90 transition-opacity shrink-0"
                style={{ backgroundColor: tone.solidColor }}
              >
                {t.actionLabel}
              </button>
            )}
            <button onClick={() => dismiss(t.id)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
