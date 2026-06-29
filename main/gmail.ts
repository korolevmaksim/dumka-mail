import crypto from 'crypto';
import { GmailSignatureSyncResult, MailThread, MailMessage, Recipient, AttachmentMetadata } from '../shared/types';
import { getRefreshToken } from './keychain';
import { compileMarkdownToHtml } from '../shared/markdown';
import { gmailSignatureHtmlToPlainText, sanitizeGmailSignatureHtml } from '../shared/textNormalizer';
import { loadGoogleConfig, startOAuthFlow, base64urlSafe } from './gmailOAuth';

export { startOAuthFlow };

// Helper: Fetch with Timeout to prevent hung requests
async function fetchWithTimeout(url: string, options: any = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(id);
  }
}

// Token rotation service
export async function getAccessToken(email: string): Promise<string> {
  const refreshToken = await getRefreshToken(email);
  if (!refreshToken) {
    throw new Error(`No credentials found in Keychain for ${email}`);
  }

  const config = loadGoogleConfig().installed;
  const params = new URLSearchParams();
  params.set('client_id', config.client_id);
  if (config.client_secret) params.set('client_secret', config.client_secret);
  params.set('refresh_token', refreshToken);
  params.set('grant_type', 'refresh_token');

  const res = await fetchWithTimeout(config.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    throw new Error(`Failed to rotate access token for ${email}: ${await res.text()}`);
  }

  const data = await res.json() as any;
  return data.access_token;
}

// Bounded Concurrency Task Loader (size = 8)
async function poolConcurrentTasks<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const queue = items.map((item, index) => ({ item, index }));
  
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      try {
        results[task.index] = await worker(task.item);
      } catch (err) {
        console.error(`Concurrency pool error on item index ${task.index}:`, err);
        throw err;
      }
    }
  });

  await Promise.all(workers);
  return results;
}

// Parser for Recipient format "Name <email@domain.com>"
function parseHeaderRecipients(headerVal?: string): Recipient[] {
  if (!headerVal) return [];
  const results: Recipient[] = [];
  const parts = headerVal.split(',');
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    const match = trimmed.match(/^(.*?)\s*<([^>]+)>$/);
    if (match) {
      results.push({ name: match[1].replace(/['"]/g, '').trim(), email: match[2].trim() });
    } else {
      results.push({ name: '', email: trimmed });
    }
  }
  return results;
}

function findPartHeader(part: any, name: string): string {
  const headers = (part?.headers || []) as { name: string; value: string }[];
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function normalizeContentIdHeader(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutOpen = trimmed.startsWith('<') ? trimmed.slice(1) : trimmed;
  const withoutClose = withoutOpen.endsWith('>') ? withoutOpen.slice(0, -1) : withoutOpen;
  const normalized = withoutClose.trim();
  return normalized.length > 0 ? normalized : null;
}

function base64UrlToBase64(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = normalized.length % 4;
  return remainder === 0 ? normalized : `${normalized}${'='.repeat(4 - remainder)}`;
}

interface GmailSendAsAlias {
  sendAsEmail?: string;
  isDefault?: boolean;
  signature?: string;
}

function selectSignatureAlias(sendAs: GmailSendAsAlias[], accountEmail: string): GmailSendAsAlias | null {
  const normalizedAccountEmail = accountEmail.trim().toLowerCase();
  const aliasesWithSignature = sendAs.filter(alias => (alias.signature || '').trim().length > 0);

  return (
    aliasesWithSignature.find(alias => alias.sendAsEmail?.trim().toLowerCase() === normalizedAccountEmail) ||
    aliasesWithSignature.find(alias => alias.isDefault) ||
    aliasesWithSignature[0] ||
    sendAs.find(alias => alias.sendAsEmail?.trim().toLowerCase() === normalizedAccountEmail) ||
    sendAs.find(alias => alias.isDefault) ||
    sendAs[0] ||
    null
  );
}

// Maps Gmail API Message object to local MailMessage
export function mapMessage(gmailMsg: any, accountId: string): MailMessage {
  const headers = (gmailMsg.payload?.headers || []) as { name: string; value: string }[];
  const findHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  const subject = findHeader('subject');
  const fromVal = findHeader('from');
  const toVal = findHeader('to');
  const ccVal = findHeader('cc');
  const bccVal = findHeader('bcc');

  let senderName = '';
  let senderEmail = fromVal;
  const fromMatch = fromVal.match(/^(.*?)\s*<([^>]+)>$/);
  if (fromMatch) {
    senderName = fromMatch[1].replace(/['"]/g, '').trim();
    senderEmail = fromMatch[2].trim();
  }

  // Parse body parts
  let bodyPlain = '';
  let bodyHtml = '';
  const attachments: AttachmentMetadata[] = [];

  const extractBody = (part: any) => {
    if (!part) return;
    
    const mimeType = part.mimeType?.toLowerCase();
    const data = part.body?.data;
    const bodyStr = data && (mimeType === 'text/plain' || mimeType === 'text/html')
      ? Buffer.from(data, 'base64url').toString('utf-8')
      : '';

    if (mimeType === 'text/plain' && bodyStr) {
      bodyPlain = bodyStr;
    } else if (mimeType === 'text/html' && bodyStr) {
      bodyHtml = bodyStr;
    } else {
      const attachmentId = part.body?.attachmentId || null;
      const contentId = normalizeContentIdHeader(
        findPartHeader(part, 'content-id') || findPartHeader(part, 'x-attachment-id')
      );
      const disposition = findPartHeader(part, 'content-disposition').toLowerCase();
      const isInline = disposition.includes('inline') || Boolean(contentId);
      const hasAttachmentPayload = Boolean(attachmentId || (data && mimeType && !mimeType.startsWith('text/')));
      const shouldCaptureAttachment = hasAttachmentPayload && Boolean(part.filename || contentId);

      if (shouldCaptureAttachment) {
        const inlineData = !attachmentId && data ? base64UrlToBase64(data) : undefined;
        const id = attachmentId || part.partId || contentId || `${part.filename || 'attachment'}-${attachments.length + 1}`;
        const attachment: AttachmentMetadata = {
          id,
          filename: part.filename || (isInline ? 'inline' : 'attachment'),
          mimeType: part.mimeType,
          sizeBytes: part.body?.size || 0,
          attachmentId,
          partId: part.partId || null,
          contentId,
          isInline
        };
        if (inlineData) {
          attachment.base64Data = inlineData;
        }
        attachments.push(attachment);
      }
    }

    if (part.parts) {
      for (const subPart of part.parts) {
        extractBody(subPart);
      }
    }
  };

  extractBody(gmailMsg.payload);

  if (!bodyPlain && gmailMsg.snippet) {
    bodyPlain = gmailMsg.snippet;
  }

  const labelIds = (gmailMsg.labelIds || []).map((l: string) => l as string);

  return {
    id: gmailMsg.id,
    threadId: gmailMsg.threadId,
    accountId,
    senderName,
    senderEmail,
    subject,
    snippet: gmailMsg.snippet || '',
    receivedAt: new Date(parseInt(gmailMsg.internalDate, 10)).toISOString(),
    labelIds,
    hasAttachments: attachments.length > 0,
    isUnread: labelIds.includes('UNREAD'),
    to: parseHeaderRecipients(toVal),
    cc: parseHeaderRecipients(ccVal),
    bcc: parseHeaderRecipients(bccVal),
    bodyHtml,
    bodyPlain,
    attachments,
    rfcMessageId: findHeader('message-id'),
    rfcReferences: findHeader('references'),
    rfcInReplyTo: findHeader('in-reply-to')
  };
}

export const GmailSyncService = {
  async fetchDefaultSignature(email: string): Promise<GmailSignatureSyncResult> {
    const accessToken = await getAccessToken(email);
    const res = await fetchWithTimeout('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      throw new Error(`Gmail signature fetch error: ${await res.text()}`);
    }

    const data = await res.json() as { sendAs?: GmailSendAsAlias[] };
    const alias = selectSignatureAlias(Array.isArray(data.sendAs) ? data.sendAs : [], email);
    const signatureHtml = sanitizeGmailSignatureHtml(alias?.signature || '');
    const signaturePlain = gmailSignatureHtmlToPlainText(signatureHtml);

    return {
      accountId: email,
      sourceEmail: alias?.sendAsEmail || email,
      signatureHtml,
      signaturePlain,
      importedAt: new Date().toISOString(),
      found: signatureHtml.length > 0 || signaturePlain.length > 0
    };
  },

  // Sync Inbox: fetches up to 30 threads matching 'in:inbox'
  async syncInbox(email: string): Promise<{ threads: MailThread[]; messages: MailMessage[]; historyId: string }> {
    const accessToken = await getAccessToken(email);
    
    // Fetch thread IDs list
    const listRes = await fetchWithTimeout('https://gmail.googleapis.com/gmail/v1/users/me/threads?q=in:inbox&maxResults=30', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!listRes.ok) {
      throw new Error(`syncInbox list error: ${await listRes.text()}`);
    }

    const listData = await listRes.json() as any;
    const threadSummaries = listData.threads || [];
    
    // Fetch details for each thread in parallel (up to 8 concurrent fetches)
    const threadDetailsRaw = await poolConcurrentTasks(threadSummaries, 8, async (tSummary: any) => {
      try {
        const detailRes = await fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${tSummary.id}`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!detailRes.ok) {
          console.warn(`Thread detail fetch error for ${tSummary.id}: status ${detailRes.status}`);
          return null;
        }
        return await detailRes.json();
      } catch (err) {
        console.warn(`Thread detail fetch error for ${tSummary.id}:`, err);
        return null;
      }
    });

    const threadDetails = threadDetailsRaw.filter(t => t !== null);

    const threads: MailThread[] = [];
    const messages: MailMessage[] = [];
    let latestHistoryId = '0';

    for (const detail of threadDetails) {
      const msgs = (detail.messages || []).map((m: any) => mapMessage(m, email));
      messages.push(...msgs);

      if (msgs.length > 0) {
        // Latest message in thread
        const lastMsg = msgs[msgs.length - 1];
        
        // Accumulate historyId
        const detailHistId = detail.messages[detail.messages.length - 1].historyId;
        if (BigInt(detailHistId) > BigInt(latestHistoryId)) {
          latestHistoryId = detailHistId;
        }

        const senderNames = Array.from(new Set(msgs.map((m: any) => m.senderName || m.senderEmail))) as string[];

        threads.push({
          id: detail.id,
          accountId: email,
          subject: lastMsg.subject,
          snippet: lastMsg.snippet,
          lastMessageAt: lastMsg.receivedAt,
          senderNames,
          senderEmail: lastMsg.senderEmail,
          labelIds: Array.from(new Set(msgs.flatMap((m: any) => m.labelIds))),
          hasAttachments: msgs.some((m: any) => m.hasAttachments),
          isUnread: msgs.some((m: any) => m.isUnread)
        });
      }
    }

    return { threads, messages, historyId: latestHistoryId };
  },

  // Incremental history sync: requests updates since historyId
  async syncIncremental(email: string, startHistoryId: string): Promise<{ updatedThreadIds: string[]; deletedThreadIds: string[]; historyId: string }> {
    const accessToken = await getAccessToken(email);
    const endpoint = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${startHistoryId}&maxResults=100`;

    const res = await fetchWithTimeout(endpoint, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    // If history cursor is invalid/expired (Google returns HTTP 404)
    if (res.status === 404) {
      throw new Error('HISTORY_EXPIRED');
    }

    if (!res.ok) {
      throw new Error(`syncIncremental error: ${await res.text()}`);
    }

    const data = await res.json() as any;
    const historyRecords = data.history || [];
    const updatedThreadIds = new Set<string>();
    const deletedThreadIds = new Set<string>();

    for (const record of historyRecords) {
      if (record.messagesAdded) {
        record.messagesAdded.forEach((m: any) => updatedThreadIds.add(m.message.threadId));
      }
      if (record.labelsAdded) {
        record.labelsAdded.forEach((l: any) => updatedThreadIds.add(l.message.threadId));
      }
      if (record.labelsRemoved) {
        record.labelsRemoved.forEach((l: any) => updatedThreadIds.add(l.message.threadId));
      }
      if (record.messagesDeleted) {
        record.messagesDeleted.forEach((m: any) => deletedThreadIds.add(m.message.threadId));
      }
    }

    // Latest history id
    const latestHistoryId = data.historyId || startHistoryId;

    return {
      updatedThreadIds: Array.from(updatedThreadIds),
      deletedThreadIds: Array.from(deletedThreadIds),
      historyId: latestHistoryId
    };
  },

  // Backfill: pages through all mail
  async syncBackfillPage(email: string, pageToken?: string): Promise<{ threads: MailThread[]; messages: MailMessage[]; nextPageToken?: string }> {
    const accessToken = await getAccessToken(email);
    let endpoint = 'https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=100&q=-in:spam+-in:trash';
    if (pageToken) {
      endpoint += `&pageToken=${pageToken}`;
    }

    const listRes = await fetchWithTimeout(endpoint, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!listRes.ok) {
      throw new Error(`Backfill list error: ${await listRes.text()}`);
    }

    const data = await listRes.json() as any;
    const threadSummaries = data.threads || [];
    const nextPageToken = data.nextPageToken;

    // Fetch details (concurrency = 8)
    const threadDetailsRaw = await poolConcurrentTasks(threadSummaries, 8, async (tSummary: any) => {
      try {
        const detailRes = await fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${tSummary.id}`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!detailRes.ok) {
          console.warn(`Thread backfill detail error for ${tSummary.id}: status ${detailRes.status}`);
          return null;
        }
        return await detailRes.json();
      } catch (err) {
        console.warn(`Thread backfill detail error for ${tSummary.id}:`, err);
        return null;
      }
    });

    const threadDetails = threadDetailsRaw.filter(t => t !== null);

    const threads: MailThread[] = [];
    const messages: MailMessage[] = [];

    for (const detail of threadDetails) {
      const msgs = (detail.messages || []).map((m: any) => mapMessage(m, email));
      messages.push(...msgs);

      if (msgs.length > 0) {
        const lastMsg = msgs[msgs.length - 1];
        const senderNames = Array.from(new Set(msgs.map((m: any) => m.senderName || m.senderEmail))) as string[];

        threads.push({
          id: detail.id,
          accountId: email,
          subject: lastMsg.subject,
          snippet: lastMsg.snippet,
          lastMessageAt: lastMsg.receivedAt,
          senderNames,
          senderEmail: lastMsg.senderEmail,
          labelIds: Array.from(new Set(msgs.flatMap((m: any) => m.labelIds))),
          hasAttachments: msgs.some((m: any) => m.hasAttachments),
          isUnread: msgs.some((m: any) => m.isUnread)
        });
      }
    }

    return { threads, messages, nextPageToken };
  },

  // Hydrate thread details lazily from Gmail
  async fetchThreadDetail(email: string, threadId: string): Promise<MailMessage[]> {
    const accessToken = await getAccessToken(email);
    const res = await fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      throw new Error(`fetchThreadDetail error for ${threadId}: ${await res.text()}`);
    }

    const data = await res.json() as any;
    return (data.messages || []).map((m: any) => mapMessage(m, email));
  },

  // Fetch message attachment raw base64 data
  async fetchAttachment(email: string, messageId: string, attachmentId: string): Promise<string> {
    const accessToken = await getAccessToken(email);
    const endpoint = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`;
    const res = await fetchWithTimeout(endpoint, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      throw new Error(`fetchAttachment error: ${await res.text()}`);
    }

    const data = await res.json() as any;
    return data.data;
  },

  // Fetch raw RFC822 mail source
  async fetchRawMessage(email: string, messageId: string): Promise<string> {
    const accessToken = await getAccessToken(email);
    const endpoint = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=raw`;
    const res = await fetchWithTimeout(endpoint, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      throw new Error(`fetchRawMessage error: ${await res.text()}`);
    }

    const data = await res.json() as any;
    if (!data.raw) {
      throw new Error('No raw message field returned from Gmail API');
    }
    return Buffer.from(data.raw, 'base64url').toString('utf-8');
  },

  // Mutation: Modify labels on thread
  async modifyLabels(email: string, threadId: string, addLabelIds: string[], removeLabelIds: string[]): Promise<void> {
    const accessToken = await getAccessToken(email);
    const res = await fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        addLabelIds,
        removeLabelIds
      })
    });

    if (!res.ok) {
      throw new Error(`Label modification failed for thread ${threadId}: ${await res.text()}`);
    }
  },

  // Outgoing Send: Builds MIME payload and submits
  async sendDraft(email: string, draft: { to: Recipient[]; cc: Recipient[]; bcc: Recipient[]; subject: string; bodyPlain: string; bodyHtml?: string | null; attachments?: AttachmentMetadata[]; threadId?: string | null; replyMessageId?: string | null; replyReferences?: string | null }): Promise<string> {
    const accessToken = await getAccessToken(email);
    
    // MIME Construction
    const alternativeBoundary = `----=_Part_Alt_${crypto.randomBytes(8).toString('hex')}`;
    const relatedBoundary = `----=_Part_Related_${crypto.randomBytes(8).toString('hex')}`;
    const mixedBoundary = `----=_Part_Mixed_${crypto.randomBytes(8).toString('hex')}`;
    const attachments = draft.attachments || [];
    const inlineAttachments = attachments.filter(att => att.isInline);
    const fileAttachments = attachments.filter(att => !att.isInline);
    const hasInlineAttachments = inlineAttachments.length > 0;
    const hasFileAttachments = fileAttachments.length > 0;

    const headers: string[] = [];
    headers.push(`From: ${email}`);
    headers.push(`To: ${draft.to.map(r => r.name ? `"${r.name}" <${r.email}>` : r.email).join(', ')}`);
    if (draft.cc && draft.cc.length > 0) {
      headers.push(`Cc: ${draft.cc.map(r => r.name ? `"${r.name}" <${r.email}>` : r.email).join(', ')}`);
    }
    if (draft.bcc && draft.bcc.length > 0) {
      headers.push(`Bcc: ${draft.bcc.map(r => r.name ? `"${r.name}" <${r.email}>` : r.email).join(', ')}`);
    }
    headers.push(`Subject: ${draft.subject}`);
    headers.push('MIME-Version: 1.0');
    
    if (hasFileAttachments) {
      headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    } else if (hasInlineAttachments) {
      headers.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"`);
    } else {
      headers.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`);
    }

    // Thread Headers
    if (draft.threadId) {
      if (draft.replyMessageId) {
        headers.push(`In-Reply-To: ${draft.replyMessageId}`);
        const refs = draft.replyReferences
          ? `${draft.replyReferences} ${draft.replyMessageId}`
          : draft.replyMessageId;
        headers.push(`References: ${refs}`);
      }
    }

    const bodyParts: string[] = [];
    const bodyHtml = draft.bodyHtml || compileMarkdownToHtml(draft.bodyPlain);

    const pushAlternativeBody = () => {
      // text/plain part
      bodyParts.push(`--${alternativeBoundary}`);
      bodyParts.push('Content-Type: text/plain; charset=UTF-8');
      bodyParts.push('Content-Transfer-Encoding: 7bit\r\n');
      bodyParts.push(draft.bodyPlain);

      // text/html part
      bodyParts.push(`\r\n--${alternativeBoundary}`);
      bodyParts.push('Content-Type: text/html; charset=UTF-8');
      bodyParts.push('Content-Transfer-Encoding: 7bit\r\n');
      bodyParts.push(bodyHtml);

      bodyParts.push(`\r\n--${alternativeBoundary}--`);
    };

    const appendAttachmentPart = (att: AttachmentMetadata, disposition: 'attachment' | 'inline') => {
      if (!att.base64Data) return;
      let cleanBase64 = att.base64Data;
      const dataUrlPrefixIdx = cleanBase64.indexOf(';base64,');
      if (dataUrlPrefixIdx !== -1) {
        cleanBase64 = cleanBase64.substring(dataUrlPrefixIdx + 8);
      }

      const safeFilename = att.filename.replace(/[\r\n"]/g, '_');
      bodyParts.push(`\r\n--${disposition === 'inline' ? relatedBoundary : mixedBoundary}`);
      bodyParts.push(`Content-Type: ${att.mimeType}; name="${safeFilename}"`);
      bodyParts.push(`Content-Disposition: ${disposition}; filename="${safeFilename}"`);
      if (disposition === 'inline') {
        const contentId = (att.contentId || `${att.id}@dumka-mail`).replace(/[\r\n<>]/g, '');
        bodyParts.push(`Content-ID: <${contentId}>`);
      }
      bodyParts.push('Content-Transfer-Encoding: base64\r\n');
      bodyParts.push(cleanBase64);
    };

    if (hasFileAttachments) {
      bodyParts.push(`\r\n--${mixedBoundary}`);
      if (hasInlineAttachments) {
        bodyParts.push(`Content-Type: multipart/related; boundary="${relatedBoundary}"\r\n`);
      } else {
        bodyParts.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"\r\n`);
      }
    }

    if (hasInlineAttachments) {
      bodyParts.push(`\r\n--${relatedBoundary}`);
      bodyParts.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"\r\n`);
      pushAlternativeBody();

      for (const att of inlineAttachments) {
        appendAttachmentPart(att, 'inline');
      }
      bodyParts.push(`\r\n--${relatedBoundary}--`);
    } else {
      pushAlternativeBody();
    }

    if (hasFileAttachments) {
      for (const att of fileAttachments) {
        appendAttachmentPart(att, 'attachment');
      }
      bodyParts.push(`\r\n--${mixedBoundary}--`);
    }

    const rawMime = `${headers.join('\r\n')}\r\n${bodyParts.join('\r\n')}`;
    const base64Mime = base64urlSafe(Buffer.from(rawMime, 'utf-8'));

    const body: any = { raw: base64Mime };
    if (draft.threadId) {
      body.threadId = draft.threadId;
    }

    const res = await fetchWithTimeout('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Gmail Send Message Error: ${await res.text()}`);
    }

    const data = await res.json() as any;
    return data.threadId;
  }
};
