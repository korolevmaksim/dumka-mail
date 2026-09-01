export type StartupFailureAction = 'quit' | 'moveAside';
export type StartupFailurePhase = 'startup' | 'runtime';

export function startupFailureMessage(error: unknown, phase: StartupFailurePhase = 'startup'): string {
  const text = error instanceof Error ? error.message : String(error || 'Unknown startup error');
  const intro = phase === 'runtime'
    ? 'Dumka Mail hit a fatal database error while running.'
    : 'Dumka Mail could not open its local database.';
  return `${intro}\n\n${text}\n\nYou can quit, or move the damaged database aside and start again with an empty mailbox. A backup can be restored from Settings after relaunch.`;
}

export function fatalProcessFailureMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error || 'Unknown error');
  return `Dumka Mail encountered an unexpected error and needs to quit.\n\n${text}`;
}

export function isLikelyCorruptDatabaseError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error || '');
  return /SQLITE_(CORRUPT|NOTADB|CANTOPEN|IOERR)|database disk image is malformed|file is not a database/i.test(text);
}
