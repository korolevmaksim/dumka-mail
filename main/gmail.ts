import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { shell } from 'electron';
import { MailThread, MailMessage, Recipient, AttachmentMetadata } from '../shared/types';
import { getRefreshToken, saveRefreshToken } from './keychain';
import { compileMarkdownToHtml } from '../shared/markdown';

// Scopes required for email triage, drafting, and profile information
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.profile'
];

interface GoogleClientConfig {
  installed: {
    client_id: string;
    project_id: string;
    auth_uri: string;
    token_uri: string;
    client_secret?: string;
    redirect_uris: string[];
  }
}

export function loadGoogleConfig(): GoogleClientConfig {
  const primaryPath = path.join(process.env.HOME || '', '.config', 'dumka-mail-agy', 'google-oauth-client.json');
  const fallbackPath = path.join(process.env.HOME || '', '.config', 'personal-mail-client', 'google-oauth-client.json');

  let configPath = primaryPath;
  if (!fs.existsSync(primaryPath) && fs.existsSync(fallbackPath)) {
    configPath = fallbackPath;
  }

  if (!fs.existsSync(configPath)) {
    throw new Error(`Google OAuth Client credentials not found at ${primaryPath} or ${fallbackPath}`);
  }

  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as GoogleClientConfig;
}

// Helpers for PKCE (Code Challenge)
function base64urlSafe(buf: Buffer): string {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64urlSafe(hash);
}

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

// Onboarding: OAuth browser consent flow with loopback listener
export function startOAuthFlow(emailHint?: string): Promise<{ email: string; refreshToken: string; displayName?: string; avatarUrl?: string }> {
  return new Promise((resolve, reject) => {
    // Start loopback HTTP server on random port
    const server = http.createServer();
    
    // 5-minute timeout to close the server and reject the promise to prevent port leaks
    const timeoutId = setTimeout(() => {
      server.close();
      reject(new Error('OAuth flow timed out after 5 minutes.'));
    }, 5 * 60 * 1000);

    const cleanResolve = (val: { email: string; refreshToken: string; displayName?: string; avatarUrl?: string }) => {
      clearTimeout(timeoutId);
      resolve(val);
    };

    const cleanReject = (err: any) => {
      clearTimeout(timeoutId);
      reject(err);
    };

    try {
      const config = loadGoogleConfig().installed;
      const state = base64urlSafe(crypto.randomBytes(32));
      const codeVerifier = base64urlSafe(crypto.randomBytes(64));
      const codeChallenge = generateCodeChallenge(codeVerifier);

      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as any;
        const port = address.port;
        const redirectURI = `http://localhost:${port}/`;

        // Build Auth URL
        const authUrlObj = new URL(config.auth_uri);
        authUrlObj.searchParams.set('client_id', config.client_id);
        authUrlObj.searchParams.set('redirect_uri', redirectURI);
        authUrlObj.searchParams.set('response_type', 'code');
        authUrlObj.searchParams.set('scope', SCOPES.join(' '));
        authUrlObj.searchParams.set('access_type', 'offline');
        authUrlObj.searchParams.set('prompt', 'consent');
        authUrlObj.searchParams.set('state', state);
        authUrlObj.searchParams.set('code_challenge', codeChallenge);
        authUrlObj.searchParams.set('code_challenge_method', 'S256');
        if (emailHint) {
          authUrlObj.searchParams.set('login_hint', emailHint);
        }

        // Open browser
        shell.openExternal(authUrlObj.toString()).catch(cleanReject);

        // Handle OAuth callback
        server.on('request', async (req, res) => {
          try {
            const reqUrl = url.parse(req.url || '', true);
            const { code, state: returnedState, error } = reqUrl.query;

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Authentication denied by user.');
              server.close();
              cleanReject(new Error(`OAuth Denied: ${error}`));
              return;
            }

            if (returnedState !== state) {
              res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('CSRF State mismatch.');
              server.close();
              cleanReject(new Error('OAuth Error: CSRF State mismatch.'));
              return;
            }

            if (!code || typeof code !== 'string') {
              res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
              res.end('Missing code in redirect parameters.');
              server.close();
              cleanReject(new Error('OAuth Error: Missing authorization code.'));
              return;
            }

            // Exhange code for tokens
            const tokenParams = new URLSearchParams();
            tokenParams.set('client_id', config.client_id);
            if (config.client_secret) tokenParams.set('client_secret', config.client_secret);
            tokenParams.set('code', code);
            tokenParams.set('grant_type', 'authorization_code');
            tokenParams.set('redirect_uri', redirectURI);
            tokenParams.set('code_verifier', codeVerifier);

            const tokenRes = await fetchWithTimeout(config.token_uri, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: tokenParams.toString()
            });

            if (!tokenRes.ok) {
              throw new Error(`Token exchange HTTP ${tokenRes.status}: ${await tokenRes.text()}`);
            }

            const tokens = await tokenRes.json() as any;
            const { access_token, refresh_token } = tokens;

            if (!refresh_token) {
              throw new Error('OAuth Error: Google did not return a refresh token. Revoke app permissions and retry onboarding.');
            }

            // Fetch profile to verify email
            const profileRes = await fetchWithTimeout('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
              headers: { 'Authorization': `Bearer ${access_token}` }
            });

            if (!profileRes.ok) {
              throw new Error(`Failed to fetch profile: ${await profileRes.text()}`);
            }

            const profile = await profileRes.json() as any;
            const email = profile.emailAddress;

            if (emailHint && email.toLowerCase() !== emailHint.toLowerCase()) {
              throw new Error(`OAuth Email Mismatch: Onboarded ${email} does not match expected ${emailHint}`);
            }

            // Fetch extra profile details (name, picture)
            let displayName = '';
            let avatarUrl = '';
            try {
              const userInfoRes = await fetchWithTimeout('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { 'Authorization': `Bearer ${access_token}` }
              });
              if (userInfoRes.ok) {
                const userInfo = await userInfoRes.json() as any;
                if (userInfo.name) displayName = userInfo.name;
                if (userInfo.picture) avatarUrl = userInfo.picture;
              }
            } catch (err) {
              console.error('Failed to fetch userinfo from Google:', err);
            }

            // Save refresh token securely in Keychain
            await saveRefreshToken(email, refresh_token);

            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Authentication complete for ${email}. You can close this tab.`);
            server.close();

            cleanResolve({ email, refreshToken: refresh_token, displayName, avatarUrl });
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Authentication failed: ${err.message}`);
            server.close();
            cleanReject(err);
          }
        });
      });
    } catch (e) {
      cleanReject(e);
    }
  });
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
    const bodyStr = data ? Buffer.from(data, 'base64url').toString('utf-8') : '';

    if (mimeType === 'text/plain' && bodyStr) {
      bodyPlain = bodyStr;
    } else if (mimeType === 'text/html' && bodyStr) {
      bodyHtml = bodyStr;
    } else if (part.filename && part.body?.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType,
        sizeBytes: part.body.size || 0
      });
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
    const mixedBoundary = `----=_Part_Mixed_${crypto.randomBytes(8).toString('hex')}`;
    const hasAttachments = draft.attachments && draft.attachments.length > 0;

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
    
    if (hasAttachments) {
      headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
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

    if (hasAttachments) {
      bodyParts.push(`\r\n--${mixedBoundary}`);
      bodyParts.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"\r\n`);
    }

    // text/plain part
    bodyParts.push(`--${alternativeBoundary}`);
    bodyParts.push('Content-Type: text/plain; charset=UTF-8');
    bodyParts.push('Content-Transfer-Encoding: 7bit\r\n');
    bodyParts.push(draft.bodyPlain);

    // text/html part
    const bodyHtml = draft.bodyHtml || compileMarkdownToHtml(draft.bodyPlain);
    bodyParts.push(`\r\n--${alternativeBoundary}`);
    bodyParts.push('Content-Type: text/html; charset=UTF-8');
    bodyParts.push('Content-Transfer-Encoding: 7bit\r\n');
    bodyParts.push(bodyHtml);

    bodyParts.push(`\r\n--${alternativeBoundary}--`);

    if (hasAttachments) {
      for (const att of draft.attachments || []) {
        if (!att.base64Data) continue;
        let cleanBase64 = att.base64Data;
        const dataUrlPrefixIdx = cleanBase64.indexOf(';base64,');
        if (dataUrlPrefixIdx !== -1) {
          cleanBase64 = cleanBase64.substring(dataUrlPrefixIdx + 8);
        }

        bodyParts.push(`\r\n--${mixedBoundary}`);
        bodyParts.push(`Content-Type: ${att.mimeType}; name="${att.filename}"`);
        bodyParts.push(`Content-Disposition: attachment; filename="${att.filename}"`);
        bodyParts.push('Content-Transfer-Encoding: base64\r\n');
        bodyParts.push(cleanBase64);
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
