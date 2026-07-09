const LONG_TASK_THRESHOLD_MS = 50;

export function startRendererLongTaskMonitor(): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => undefined;
  if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return () => undefined;

  const observer = new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (entry.duration < LONG_TASK_THRESHOLD_MS) continue;
      console.warn('[Performance] Renderer long task', {
        durationMs: Math.round(entry.duration),
        startedAtMs: Math.round(entry.startTime),
      });
    }
  });
  observer.observe({ type: 'longtask', buffered: true });
  return () => observer.disconnect();
}
