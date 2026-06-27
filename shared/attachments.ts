// Pure, dependency-free attachment classification logic.
//
// Ported from the macOS/Swift "Personal Mail Client":
//   - Models/MailAttachment.swift           (MailAttachmentPreviewKind, canOpenExternally,
//                                             symbolName, displaySize, unsafe/safe sets)
//   - UI/Thread/AttachmentChip.swift         (icon / safety presentation)
//
// The Swift preview enum only had four cases (image / pdf / text / unsupported). This port
// keeps those exact rules where they overlap, but exposes a richer set of display kinds so the
// renderer can pick a more specific lucide-react icon. Safety gating (`canOpenExternally`,
// `isPotentiallyUnsafe`) mirrors the Swift behavior exactly via an internal four-state classifier,
// so widening the display kinds never loosens the safety decision.
//
// This file must stay pure: no electron / node / fs / react / DOM imports.

export type AttachmentPreviewKind =
  | 'image'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'audio'
  | 'video'
  | 'code'
  | 'text'
  | 'calendar'
  | 'generic';

// --- Constant sets (verbatim from MailAttachment.swift unless noted) ---------------------------

// MailAttachmentPreviewKind.imageExtensions (Swift lines 255–257).
const IMAGE_EXT = new Set([
  'avif', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'tif', 'tiff', 'webp',
]);

// MailAttachmentPreviewKind.textExtensions (Swift lines 259–261).
const TEXT_EXT = new Set([
  'csv', 'ics', 'json', 'log', 'md', 'rtf', 'text', 'txt', 'xml', 'yaml', 'yml',
]);

// MailAttachment.unsafeExternalOpenExtensions (Swift lines 87–92), plus 'jar' (executable archive
// explicitly called out as unsafe by the porting spec).
const UNSAFE_EXT = new Set([
  'app', 'applescript', 'bash', 'bat', 'cmd', 'command', 'com', 'csh', 'exe',
  'dmg', 'gadget', 'hta', 'inf', 'ins', 'iso', 'jar', 'js', 'jse', 'ksh', 'lnk',
  'msc', 'msi', 'msp', 'pif', 'pkg', 'ps1', 'reg', 'run', 'scpt', 'scr',
  'sh', 'terminal', 'vb', 'vbe', 'vbs', 'workflow', 'ws', 'wsf', 'zsh',
]);

// MailAttachment.unsafeExternalOpenMIMETypes (Swift lines 94–101).
const UNSAFE_MIME = new Set([
  'application/octet-stream',
  'application/x-apple-diskimage',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-sh',
  'application/x-shellscript',
]);

// MailAttachment.safeExternalOpenExtensions (Swift lines 103–105).
const SAFE_EXT = new Set([
  'doc', 'docx', 'key', 'numbers', 'pages', 'ppt', 'pptx', 'rtf', 'xls', 'xlsx', 'zip',
]);

// MailAttachment.safeExternalOpenMIMETypes (Swift lines 107–119).
const SAFE_MIME = new Set([
  'application/msword',
  'application/rtf',
  'application/vnd.apple.keynote',
  'application/vnd.apple.numbers',
  'application/vnd.apple.pages',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
]);

// --- Extra display categories (no Swift ground truth; used only for icon selection) ------------

const AUDIO_EXT = new Set([
  'aac', 'aiff', 'aif', 'flac', 'm4a', 'mp3', 'oga', 'ogg', 'opus', 'wav', 'wma',
]);

const VIDEO_EXT = new Set([
  'avi', 'flv', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm', 'wmv',
]);

const ARCHIVE_EXT = new Set([
  '7z', 'bz2', 'gz', 'rar', 'tar', 'tgz', 'xz', 'zip',
]);
const ARCHIVE_MIME = new Set([
  'application/zip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-tar',
  'application/gzip',
  'application/x-bzip2',
]);

const SPREADSHEET_EXT = new Set(['numbers', 'ods', 'xls', 'xlsx']);
const SPREADSHEET_MIME = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.apple.numbers',
  'application/vnd.oasis.opendocument.spreadsheet',
]);

const PRESENTATION_EXT = new Set(['key', 'odp', 'ppt', 'pptx']);
const PRESENTATION_MIME = new Set([
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.apple.keynote',
  'application/vnd.oasis.opendocument.presentation',
]);

const DOCUMENT_EXT = new Set(['doc', 'docx', 'odt', 'pages']);
const DOCUMENT_MIME = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.apple.pages',
  'application/vnd.oasis.opendocument.text',
]);

const CODE_EXT = new Set([
  'bash', 'c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'htm', 'html', 'java',
  'jsx', 'kt', 'less', 'mjs', 'cjs', 'php', 'py', 'rb', 'rs', 'scss', 'sh', 'sql',
  'swift', 'toml', 'ts', 'tsx', 'vue', 'zsh',
]);
const CODE_MIME = new Set([
  'text/html',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/json',
  'application/xml',
  'application/x-sh',
]);

// --- Helpers -----------------------------------------------------------------------------------

/**
 * Lowercased file extension, mirroring `(filename as NSString).pathExtension.lowercased()`.
 * Returns '' for names with no extension, hidden dot-files (".bashrc"), or a trailing dot.
 */
export function fileExtension(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Strip MIME parameters (everything after the first ';'), trim, lowercase. */
function normalizeMime(mimeType: string): string {
  const semi = mimeType.indexOf(';');
  const head = semi >= 0 ? mimeType.slice(0, semi) : mimeType;
  return head.trim().toLowerCase();
}

/**
 * Faithful port of Swift `MailAttachmentPreviewKind(mimeType:fileExtension:)`
 * (MailAttachment.swift lines 241–253) — the four-state classifier used for safety gating.
 * Uses the raw lowercased MIME (not param-stripped) exactly like Swift.
 */
function swiftPreviewKind(mimeType: string, ext: string): 'image' | 'pdf' | 'text' | 'unsupported' {
  const m = mimeType.toLowerCase();
  const e = ext.toLowerCase();
  if (m.startsWith('image/') || IMAGE_EXT.has(e)) return 'image';
  if (m === 'application/pdf' || e === 'pdf') return 'pdf';
  if (m.startsWith('text/') || TEXT_EXT.has(e)) return 'text';
  return 'unsupported';
}

// --- Public API --------------------------------------------------------------------------------

/**
 * Classify an attachment into a display kind for icon selection.
 * Preserves the Swift image/pdf/text rules where they overlap, and refines the Swift
 * "unsupported" bucket into more specific categories (document / spreadsheet / archive / …).
 */
export function previewKind(mimeType: string, filename: string): AttachmentPreviewKind {
  const m = normalizeMime(mimeType);
  const ext = fileExtension(filename);

  if (m.startsWith('image/') || IMAGE_EXT.has(ext)) return 'image';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (m.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio';
  if (m.startsWith('video/') || VIDEO_EXT.has(ext)) return 'video';
  if (m === 'text/calendar' || ext === 'ics' || ext === 'ical') return 'calendar';
  if (ARCHIVE_MIME.has(m) || ARCHIVE_EXT.has(ext)) return 'archive';
  if (SPREADSHEET_MIME.has(m) || SPREADSHEET_EXT.has(ext)) return 'spreadsheet';
  if (PRESENTATION_MIME.has(m) || PRESENTATION_EXT.has(ext)) return 'presentation';
  if (DOCUMENT_MIME.has(m) || DOCUMENT_EXT.has(ext)) return 'document';
  if (CODE_MIME.has(m) || CODE_EXT.has(ext)) return 'code';
  if (m.startsWith('text/') || TEXT_EXT.has(ext)) return 'text';
  return 'generic';
}

/**
 * Map a preview kind to a lucide-react icon component name (PascalCase, as exported by lucide-react).
 */
export function attachmentIconName(kind: AttachmentPreviewKind): string {
  switch (kind) {
    case 'image':
      return 'Image';
    case 'pdf':
      return 'FileText';
    case 'document':
      return 'FileText';
    case 'spreadsheet':
      return 'FileSpreadsheet';
    case 'presentation':
      return 'Presentation';
    case 'archive':
      return 'FileArchive';
    case 'audio':
      return 'FileAudio';
    case 'video':
      return 'FileVideo';
    case 'code':
      return 'FileCode';
    case 'text':
      return 'FileText';
    case 'calendar':
      return 'Calendar';
    case 'generic':
    default:
      return 'File';
  }
}

/**
 * Whether the attachment may be handed to the OS "open in default app" path.
 * Faithful port of Swift `MailAttachment.canOpenExternally` (MailAttachment.swift lines 53–65):
 *   1. blocked outright for unsafe extensions / unsafe MIME types;
 *   2. allowed for recognized previewable types (image / pdf / text);
 *   3. otherwise allowed only for the explicit safe-extension / safe-MIME allowlist.
 */
export function canOpenExternally(mimeType: string, filename: string): boolean {
  const ext = fileExtension(filename);
  const nmime = normalizeMime(mimeType);

  if (UNSAFE_EXT.has(ext) || UNSAFE_MIME.has(nmime)) return false;
  if (swiftPreviewKind(mimeType, ext) !== 'unsupported') return true;
  return SAFE_EXT.has(ext) || SAFE_MIME.has(nmime);
}

/**
 * Whether a filename looks like an executable / script that should never be auto-launched
 * (.exe, .scr, .bat, .cmd, .js, .vbs, .jar, …). Extension-only check, matching the Swift
 * unsafe-extension set.
 */
export function isPotentiallyUnsafe(filename: string): boolean {
  return UNSAFE_EXT.has(fileExtension(filename));
}

/**
 * Human-readable byte size, approximating macOS `ByteCountFormatter(.file)` (decimal, 1000-based):
 * e.g. "5 KB", "1.2 MB", "999 bytes", "1 byte", "Zero KB" for 0/invalid.
 * Units below a megabyte and whole values drop the fractional part; otherwise one decimal is shown.
 */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Zero KB';

  if (bytes < 1000) {
    const n = Math.round(bytes);
    return n === 1 ? '1 byte' : `${n} bytes`;
  }

  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1000;
    unitIndex += 1;
  } while (value >= 1000 && unitIndex < units.length - 1);

  // One decimal place, trailing ".0" stripped (parseFloat normalizes "5.0" -> 5).
  const rendered = parseFloat(value.toFixed(1)).toString();
  return `${rendered} ${units[unitIndex]}`;
}
