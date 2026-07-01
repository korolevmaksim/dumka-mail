import { describe, expect, it } from 'vitest';
import { mapMessage } from '../main/gmail';

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function gmailMessage(parts: any[]) {
  return {
    id: 'msg-1',
    threadId: 'thread-1',
    internalDate: '1760000000000',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: 'snippet',
    payload: {
      headers: [
        { name: 'Subject', value: 'Inline offer' },
        { name: 'From', value: 'Sender <sender@example.com>' },
        { name: 'To', value: 'Alex <alex@example.com>' },
        { name: 'Message-ID', value: '<msg-1@example.com>' },
      ],
      parts,
    },
  };
}

describe('mapMessage', () => {
  it('keeps Gmail inline image metadata needed for cid hydration', () => {
    const message = mapMessage(gmailMessage([
      {
        partId: '1',
        mimeType: 'text/html',
        body: { data: b64url('<img src="cid:hero">') },
      },
      {
        partId: '2',
        filename: 'inline',
        mimeType: 'image/png',
        headers: [
          { name: 'Content-ID', value: '<hero>' },
          { name: 'Content-Disposition', value: 'inline; filename="inline"' },
        ],
        body: { attachmentId: 'ATTACHMENT_ID', size: 2048 },
      },
    ]), 'alex@example.com');

    expect(message.bodyHtml).toBe('<img src="cid:hero">');
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({
      id: 'ATTACHMENT_ID',
      attachmentId: 'ATTACHMENT_ID',
      partId: '2',
      contentId: 'hero',
      isInline: true,
      filename: 'inline',
      mimeType: 'image/png',
      sizeBytes: 2048,
    });
  });

  it('stores embedded inline image bytes when Gmail includes body data directly', () => {
    const message = mapMessage(gmailMessage([
      {
        partId: '1',
        mimeType: 'text/html',
        body: { data: b64url('<img src="cid:small">') },
      },
      {
        partId: '2',
        filename: 'small.png',
        mimeType: 'image/png',
        headers: [
          { name: 'Content-ID', value: '<small>' },
        ],
        body: { data: Buffer.from('image-bytes').toString('base64url'), size: 11 },
      },
    ]), 'alex@example.com');

    expect(message.attachments[0]).toMatchObject({
      id: '2',
      contentId: 'small',
      isInline: true,
      base64Data: Buffer.from('image-bytes').toString('base64'),
    });
  });

  it('does not treat Gmail snippet as a plain body when a full HTML body exists', () => {
    const message = mapMessage(gmailMessage([
      {
        partId: '1',
        mimeType: 'text/html',
        body: { data: b64url('<p>Full HTML body continues past the short preview.</p>') },
      },
    ]), 'alex@example.com');

    expect(message.snippet).toBe('snippet');
    expect(message.bodyPlain).toBe('');
    expect(message.bodyHtml).toContain('Full HTML body continues');
  });

  it('keeps snippet as a last-resort body when Gmail returns no readable body parts', () => {
    const message = mapMessage(gmailMessage([]), 'alex@example.com');

    expect(message.bodyPlain).toBe('snippet');
    expect(message.bodyHtml).toBe('');
  });
});
