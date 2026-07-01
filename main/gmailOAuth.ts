import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { shell } from 'electron';

export interface GoogleClientConfig {
  installed: {
    client_id: string;
    project_id: string;
    auth_uri: string;
    token_uri: string;
    client_secret?: string;
    redirect_uris: string[];
  }
}

export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
] as const;

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy'
] as const;

export const GOOGLE_CONTACTS_SCOPES = [
  'https://www.googleapis.com/auth/contacts.readonly'
] as const;

export type GoogleOAuthScope = typeof GOOGLE_OAUTH_SCOPES[number]
  | typeof GOOGLE_CALENDAR_SCOPES[number]
  | typeof GOOGLE_CONTACTS_SCOPES[number];

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

export function base64urlSafe(buf: Buffer): string {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64urlSafe(hash);
}

export function startOAuthFlow(
  emailHint?: string,
  scopes: readonly string[] = GOOGLE_OAUTH_SCOPES
): Promise<{ email: string; refreshToken?: string; displayName?: string; avatarUrl?: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    
    const timeoutId = setTimeout(() => {
      server.close();
      reject(new Error('OAuth flow timed out after 5 minutes.'));
    }, 5 * 60 * 1000);

    const cleanResolve = (val: { email: string; refreshToken?: string; displayName?: string; avatarUrl?: string }) => {
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
        const redirectUri = `http://127.0.0.1:${port}/`;

        server.on('request', async (req, res) => {
          try {
            const parsedUrl = url.parse(req.url || '', true);
            const pathName = parsedUrl.pathname;
            
            if (pathName === '/') {
              const query = parsedUrl.query;
              if (query.error) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(`<h1>Auth failed: ${query.error}</h1>`);
                server.close();
                cleanReject(new Error(`Consent failed: ${query.error}`));
                return;
              }

              if (query.state !== state) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end('<h1>Auth state mismatch</h1>');
                server.close();
                cleanReject(new Error('OAuth state mismatch'));
                return;
              }

              const code = query.code as string;
              
              // Exchange code for token
              const params = new URLSearchParams();
              params.append('client_id', config.client_id);
              if (config.client_secret) {
                params.append('client_secret', config.client_secret);
              }
              params.append('code', code);
              params.append('code_verifier', codeVerifier);
              params.append('grant_type', 'authorization_code');
              params.append('redirect_uri', redirectUri);

              const tokenRes = await fetch(config.token_uri, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
              });

              if (!tokenRes.ok) {
                const text = await tokenRes.text();
                throw new Error(`Token exchange failed: ${text}`);
              }

              const tokens = await tokenRes.json();
              const accessToken = tokens.access_token;
              const refreshToken = tokens.refresh_token;

              if (!refreshToken && scopes.every(scope => GOOGLE_OAUTH_SCOPES.includes(scope as any))) {
                throw new Error('No refresh token returned. Revoke permissions first.');
              }

              // Fetch user profile info
              const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
              });

              if (!profileRes.ok) {
                throw new Error('Failed to fetch user info profile');
              }

              const profile = await profileRes.json();
              if (typeof profile.email !== 'string' || profile.email.trim().length === 0) {
                throw new Error('Google profile response did not include an email address.');
              }

              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end('<h1>Dumka Mail Authentication Successful!</h1><p>You can close this tab and return to the app.</p>');
              
              server.close();
              cleanResolve({
                email: profile.email,
                refreshToken,
                displayName: profile.name || undefined,
                avatarUrl: profile.picture || undefined
              });
            }
          } catch (e: any) {
            console.error('Error in OAuth server handler:', e);
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<h1>Internal Error: ${e.message}</h1>`);
            server.close();
            cleanReject(e);
          }
        });

        // Open user browser
        const authUrl = `${config.auth_uri}?` + new URLSearchParams({
                  client_id: config.client_id,
                  redirect_uri: redirectUri,
                  response_type: 'code',
          scope: scopes.join(' '),
                  state,
                  code_challenge: codeChallenge,
                  code_challenge_method: 'S256',
                  access_type: 'offline',
                  prompt: 'consent',
                  include_granted_scopes: 'true',
                  login_hint: emailHint || ''
                }).toString();

        shell.openExternal(authUrl);
      });
    } catch (e) {
      server.close();
      cleanReject(e);
    }
  });
}
