// Human-readable mail-action failures. Raw IPC / SQLite / HTTP text
// ("Error invoking remote method 'api:modifyLabels': SqliteError: database is
// locked") must never reach a toast; it stays in the action log and system log.

export const LOCAL_SAVE_FAILED_MESSAGE = "Couldn't save that change. Try again.";
export const REMOTE_ACTION_FAILED_MESSAGE = "Couldn't complete that change in Gmail. Try again.";
export const SEND_FAILED_MESSAGE = "Couldn't send the message. Try again.";

const LOCAL_SAVE_MARKER = '[[dumka-local-save-failed]]';

/** Main process: the error thrown when a local write failed after the busy retries. */
export function localSaveFailedErrorMessage(): string {
  return `${LOCAL_SAVE_MARKER} ${LOCAL_SAVE_FAILED_MESSAGE}`;
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return '';
}

/** Strips Electron's "Error invoking remote method '<channel>': <Name>: " wrapper. */
export function unwrapIpcErrorMessage(message: string): string {
  let text = message.trim();
  const ipc = /^Error invoking remote method '[^']*':\s*/i;
  if (ipc.test(text)) text = text.replace(ipc, '');
  // Leading "Error: " / "SqliteError: " / "TypeError: " class prefixes.
  text = text.replace(/^(?:[A-Za-z]*Error:\s*)+/, '');
  return text.trim();
}

export function isLocalSaveFailure(error: unknown): boolean {
  const message = rawMessage(error);
  return message.includes(LOCAL_SAVE_MARKER)
    || /SqliteError|SQLITE_(?:BUSY|LOCKED)|database is locked|database table is locked/i.test(message);
}

/** Text that looks technical (exception classes, HTTP codes, JSON bodies, stack frames). */
function looksTechnical(text: string): boolean {
  return /Error invoking remote method|SqliteError|SQLITE_|TypeError|ReferenceError|HTTP \d{3}|\b[45]\d\d\b|[{}[\]]|\bat .+:\d+:\d+|ECONN|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(text)
    || text.length > 160;
}

/**
 * The sentence a toast may show for a failed mail action. Our own short,
 * human sentences (validation messages thrown on purpose) pass through;
 * anything technical is replaced.
 */
export function mailActionFailureMessage(error: unknown, kind?: string): string {
  if (isLocalSaveFailure(error)) return LOCAL_SAVE_FAILED_MESSAGE;
  const text = unwrapIpcErrorMessage(rawMessage(error));
  const isSend = kind === 'send' || kind === 'sendDraft';
  if (!text || looksTechnical(text)) return isSend ? SEND_FAILED_MESSAGE : REMOTE_ACTION_FAILED_MESSAGE;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
