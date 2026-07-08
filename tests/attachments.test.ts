import { describe, it, expect } from 'vitest';
import {
  AttachmentPreviewKind,
  fileExtension,
  previewKind,
  attachmentIconName,
  canOpenExternally,
  isPotentiallyUnsafe,
  formatByteSize,
  sanitizeAttachmentFilename,
  allocateUniqueFilename,
} from '../shared/attachments';

describe('fileExtension', () => {
  it('returns the lowercased extension', () => {
    expect(fileExtension('Report.PDF')).toBe('pdf');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
    expect(fileExtension('IMAGE.JPEG')).toBe('jpeg');
  });

  it('returns empty for names without a usable extension', () => {
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('.bashrc')).toBe('');
    expect(fileExtension('trailingdot.')).toBe('');
  });

  it('ignores directory separators', () => {
    expect(fileExtension('/some/path/to/file.docx')).toBe('docx');
    expect(fileExtension('C:\\dir\\photo.png')).toBe('png');
  });
});

describe('previewKind', () => {
  it('classifies images by MIME prefix or extension (Swift parity)', () => {
    expect(previewKind('image/png', 'a.png')).toBe('image');
    expect(previewKind('application/octet-stream', 'photo.heic')).toBe('image');
    expect(previewKind('', 'avatar.webp')).toBe('image');
  });

  it('classifies PDFs', () => {
    expect(previewKind('application/pdf', 'doc')).toBe('pdf');
    expect(previewKind('application/pdf; charset=binary', 'invoice')).toBe('pdf');
    expect(previewKind('', 'scan.pdf')).toBe('pdf');
  });

  it('classifies plain text and Swift text extensions', () => {
    expect(previewKind('text/plain', 'note')).toBe('text');
    expect(previewKind('', 'data.csv')).toBe('text');
    expect(previewKind('', 'config.yaml')).toBe('text');
    expect(previewKind('', 'log.log')).toBe('text');
  });

  it('classifies calendar invites before generic text', () => {
    expect(previewKind('text/calendar', 'invite')).toBe('calendar');
    expect(previewKind('', 'meeting.ics')).toBe('calendar');
  });

  it('classifies office document types', () => {
    expect(previewKind('', 'memo.docx')).toBe('document');
    expect(previewKind('application/msword', 'memo')).toBe('document');
    expect(previewKind('', 'budget.xlsx')).toBe('spreadsheet');
    expect(
      previewKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'q3'),
    ).toBe('spreadsheet');
    expect(previewKind('', 'deck.pptx')).toBe('presentation');
  });

  it('classifies archives, audio, video, and code', () => {
    expect(previewKind('application/zip', 'bundle.zip')).toBe('archive');
    expect(previewKind('', 'backup.tar.gz')).toBe('archive');
    expect(previewKind('audio/mpeg', 'song')).toBe('audio');
    expect(previewKind('', 'clip.mp4')).toBe('video');
    expect(previewKind('', 'main.py')).toBe('code');
    expect(previewKind('text/html', 'page')).toBe('code');
  });

  it('falls back to generic for unknown types', () => {
    expect(previewKind('application/octet-stream', 'blob')).toBe('generic');
    expect(previewKind('', 'mystery.xyz')).toBe('generic');
  });
});

describe('attachmentIconName', () => {
  it('maps each kind to a lucide-react icon name', () => {
    const cases: Record<AttachmentPreviewKind, string> = {
      image: 'Image',
      pdf: 'FileText',
      document: 'FileText',
      spreadsheet: 'FileSpreadsheet',
      presentation: 'Presentation',
      archive: 'FileArchive',
      audio: 'FileAudio',
      video: 'FileVideo',
      code: 'FileCode',
      text: 'FileText',
      calendar: 'Calendar',
      generic: 'File',
    };
    for (const [kind, icon] of Object.entries(cases)) {
      expect(attachmentIconName(kind as AttachmentPreviewKind)).toBe(icon);
    }
  });
});

describe('canOpenExternally', () => {
  it('allows recognized previewable types', () => {
    expect(canOpenExternally('image/png', 'a.png')).toBe(true);
    expect(canOpenExternally('application/pdf', 'a.pdf')).toBe(true);
    expect(canOpenExternally('text/plain', 'a.txt')).toBe(true);
  });

  it('allows explicit safe office extensions and MIME types', () => {
    expect(canOpenExternally('', 'memo.docx')).toBe(true);
    expect(canOpenExternally('', 'sheet.xlsx')).toBe(true);
    expect(canOpenExternally('', 'bundle.zip')).toBe(true);
    expect(canOpenExternally('application/vnd.ms-powerpoint', 'deck')).toBe(true);
  });

  it('blocks unsafe executable extensions even if otherwise previewable', () => {
    expect(canOpenExternally('', 'setup.exe')).toBe(false);
    expect(canOpenExternally('', 'script.bat')).toBe(false);
    expect(canOpenExternally('text/javascript', 'evil.js')).toBe(false);
    expect(canOpenExternally('', 'macro.vbs')).toBe(false);
    expect(canOpenExternally('', 'app.jar')).toBe(false);
  });

  it('blocks unsafe MIME types', () => {
    expect(canOpenExternally('application/octet-stream', 'data.bin')).toBe(false);
    expect(canOpenExternally('application/x-msdownload', 'thing')).toBe(false);
    expect(canOpenExternally('application/x-sh', 'run')).toBe(false);
  });

  it('blocks unknown / unrecognized types', () => {
    expect(canOpenExternally('application/unknown', 'mystery.xyz')).toBe(false);
  });

  it('strips MIME parameters before matching the unsafe set', () => {
    expect(canOpenExternally('application/octet-stream; name=x', 'data.bin')).toBe(false);
  });

  it('blocks HTML/SVG markup even though text/* would otherwise preview', () => {
    expect(canOpenExternally('text/html', 'page.html')).toBe(false);
    expect(canOpenExternally('', 'index.htm')).toBe(false);
    expect(canOpenExternally('image/svg+xml', 'icon.svg')).toBe(false);
    expect(canOpenExternally('', 'chart.svg')).toBe(false);
  });
});

describe('isPotentiallyUnsafe', () => {
  it('flags executable / script extensions', () => {
    for (const name of ['a.exe', 'a.scr', 'a.bat', 'a.cmd', 'a.js', 'a.vbs', 'a.jar', 'a.sh', 'a.ps1']) {
      expect(isPotentiallyUnsafe(name)).toBe(true);
    }
  });

  it('treats ordinary documents as safe', () => {
    for (const name of ['a.pdf', 'a.png', 'a.docx', 'a.txt', 'noext']) {
      expect(isPotentiallyUnsafe(name)).toBe(false);
    }
  });

  it('is case-insensitive', () => {
    expect(isPotentiallyUnsafe('SETUP.EXE')).toBe(true);
  });
});

describe('sanitizeAttachmentFilename', () => {
  it('strips path components and control characters', () => {
    expect(sanitizeAttachmentFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeAttachmentFilename('C:\\Windows\\evil.exe')).toBe('evil.exe');
    expect(sanitizeAttachmentFilename('report\u0000.pdf')).toBe('report.pdf');
  });

  it('rejects empty / dot-only names', () => {
    expect(sanitizeAttachmentFilename('')).toBe('attachment');
    expect(sanitizeAttachmentFilename('...')).toBe('attachment');
    expect(sanitizeAttachmentFilename('.')).toBe('attachment');
    expect(sanitizeAttachmentFilename('..')).toBe('attachment');
  });

  it('caps extremely long names while preserving the extension', () => {
    const long = `${'a'.repeat(300)}.pdf`;
    const sanitized = sanitizeAttachmentFilename(long);
    expect(sanitized.length).toBeLessThanOrEqual(200);
    expect(sanitized.endsWith('.pdf')).toBe(true);
  });
});

describe('allocateUniqueFilename', () => {
  it('returns the original name when free', () => {
    expect(allocateUniqueFilename(new Set(), 'report.pdf')).toBe('report.pdf');
  });

  it('appends (n) before the extension on collision', () => {
    const existing = new Set(['report.pdf', 'report (1).pdf']);
    expect(allocateUniqueFilename(existing, 'report.pdf')).toBe('report (2).pdf');
  });

  it('is case-insensitive against existing names', () => {
    const existing = new Set(['photo.jpg']);
    expect(allocateUniqueFilename(existing, 'Photo.JPG')).toBe('Photo (1).JPG');
  });
});

describe('formatByteSize', () => {
  it('matches the documented examples', () => {
    expect(formatByteSize(5000)).toBe('5 KB');
    expect(formatByteSize(1_200_000)).toBe('1.2 MB');
  });

  it('formats sub-kilobyte sizes in bytes', () => {
    expect(formatByteSize(500)).toBe('500 bytes');
    expect(formatByteSize(999)).toBe('999 bytes');
    expect(formatByteSize(1)).toBe('1 byte');
  });

  it('uses decimal (1000-based) units with one decimal place, stripping ".0"', () => {
    expect(formatByteSize(1000)).toBe('1 KB');
    expect(formatByteSize(1500)).toBe('1.5 KB');
    expect(formatByteSize(5_000_000)).toBe('5 MB');
    expect(formatByteSize(2_500_000_000)).toBe('2.5 GB');
  });

  it('returns "Zero KB" for zero and invalid input', () => {
    expect(formatByteSize(0)).toBe('Zero KB');
    expect(formatByteSize(-10)).toBe('Zero KB');
    expect(formatByteSize(Number.NaN)).toBe('Zero KB');
  });
});
