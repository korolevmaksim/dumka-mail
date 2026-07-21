import type { AttachmentMetadata } from '../../../shared/types';
import { plainTextToHtmlFragment, sanitizeDraftHtmlFragment } from '../../../shared/draftHtml';

const IMAGE_MAX_WIDTH = 620;

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const marker = ';base64,';
      const markerIndex = result.indexOf(marker);
      resolve(markerIndex >= 0 ? result.slice(markerIndex + marker.length) : result);
    };
    reader.readAsDataURL(file);
  });
}

export async function filesToAttachments(files: readonly File[]): Promise<AttachmentMetadata[]> {
  return Promise.all(files.map(async file => ({
    id: crypto.randomUUID(),
    filename: file.name || 'attachment',
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    base64Data: await fileToBase64(file),
  })));
}

export function inlineImageHtml(attachment: AttachmentMetadata): string {
  const cid = attachment.contentId || `${attachment.id}@dumka-mail`;
  const alt = attachment.filename.replace(/[<>"']/g, '');
  return `<p><img src="cid:${cid}" alt="${alt}" style="max-width:${IMAGE_MAX_WIDTH}px; width:100%; height:auto; border-radius:6px;" /></p>`;
}

export function textOrHtmlToFragment(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    return sanitizeDraftHtmlFragment(trimmed);
  }
  return plainTextToHtmlFragment(trimmed);
}
