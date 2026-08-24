export const RENDERER_CRASH_RELOAD_LIMIT = 3;
export const RENDERER_CRASH_WINDOW_MS = 60_000;

const CLEAN_RENDERER_EXIT = 'clean-exit';

export function shouldReloadAfterRendererCrash(options: {
  reason: string;
  reloadCountInWindow: number;
  maxReloads?: number;
  windowClosing: boolean;
}): boolean {
  if (options.windowClosing) return false;
  if (options.reason === CLEAN_RENDERER_EXIT) return false;
  const maxReloads = options.maxReloads ?? RENDERER_CRASH_RELOAD_LIMIT;
  return options.reloadCountInWindow < maxReloads;
}
