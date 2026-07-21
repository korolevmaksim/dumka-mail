import { afterEach, describe, expect, it, vi } from 'vitest';
import { filesToAttachments } from '../renderer/src/lib/composeHtmlHelpers';

class StubFileReader {
  result: string | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;

  readAsDataURL(file: File): void {
    const payload = file.name === 'notes.txt' ? 'bm90ZXM=' : 'cGRm';
    this.result = `data:${file.type};base64,${payload}`;
    this.onload?.();
  }
}

describe('filesToAttachments', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('converts every dropped file into sendable attachment metadata', async () => {
    vi.stubGlobal('FileReader', StubFileReader);
    const files = [
      { name: 'notes.txt', type: 'text/plain', size: 5 },
      { name: 'report.pdf', type: '', size: 3 },
    ] as File[];

    const attachments = await filesToAttachments(files);

    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toMatchObject({
      filename: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      base64Data: 'bm90ZXM=',
    });
    expect(attachments[1]).toMatchObject({
      filename: 'report.pdf',
      mimeType: 'application/octet-stream',
      sizeBytes: 3,
      base64Data: 'cGRm',
    });
    expect(attachments[0].id).not.toBe(attachments[1].id);
  });
});
