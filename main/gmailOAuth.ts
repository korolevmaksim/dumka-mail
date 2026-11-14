import http from 'http';
import url from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { shell } from 'electron';
import { resolveConfigFile } from './appPaths';
import { parseGrantedScopes, type GoogleSignInErrorCode } from '../shared/googleSignInErrors';

/** A sign-in failure the renderer can explain (see shared/googleSignInErrors.ts). */
export class GoogleSignInFailure extends Error {
  readonly code: GoogleSignInErrorCode;
  readonly expectedPath?: string;

  constructor(code: GoogleSignInErrorCode, message: string, expectedPath?: string) {
    super(message);
    this.name = 'GoogleSignInFailure';
    this.code = code;
    this.expectedPath = expectedPath;
  }
}

export interface OAuthFlowResult {
  email: string;
  refreshToken?: string;
  displayName?: string;
  avatarUrl?: string;
  /** Scopes Google actually granted (token response `scope`); empty when Google did not say. */
  grantedScopes: string[];
}

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
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
] as const;

export const GOOGLE_CONTACTS_SCOPES = [
  'https://www.googleapis.com/auth/contacts.readonly'
] as const;

export type GoogleOAuthScope = typeof GOOGLE_OAUTH_SCOPES[number]
  | typeof GOOGLE_CALENDAR_SCOPES[number]
  | typeof GOOGLE_CONTACTS_SCOPES[number];

export function loadGoogleConfig(): GoogleClientConfig {
  const config = resolveConfigFile('google-oauth-client.json');
  const configPath = config.path;

  if (!configPath) {
    throw new GoogleSignInFailure(
      'GOOGLE_OAUTH_CLIENT_MISSING',
      `Google OAuth Client credentials not found at ${config.candidates.join(' or ')}`,
      config.primaryPath,
    );
  }

  let parsed: GoogleClientConfig;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as GoogleClientConfig;
  } catch (error) {
    throw new GoogleSignInFailure(
      'GOOGLE_OAUTH_CLIENT_INVALID',
      `Google OAuth Client credentials at ${configPath} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      configPath,
    );
  }
  if (!parsed?.installed?.client_id || !parsed.installed.auth_uri || !parsed.installed.token_uri) {
    throw new GoogleSignInFailure(
      'GOOGLE_OAUTH_CLIENT_INVALID',
      `Google OAuth Client credentials at ${configPath} are not a desktop ("installed") client.`,
      configPath,
    );
  }
  return parsed;
}

export function base64urlSafe(buf: Buffer): string {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/** Escapes text for the loopback page's HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The loopback page: fixed sentences only; any detail is escaped and short. */
export function oauthCallbackPage(title: string, detail?: string): string {
  const body = detail ? `<p>${escapeHtml(detail.slice(0, 120))}</p>` : '';
  return `<!doctype html><meta charset="utf-8"><title>Dumka Mail</title><h1>${escapeHtml(title)}</h1>${body}`;
}

/** Only these `?error=` values are named on the page; anything else is a generic failure. */
const KNOWN_OAUTH_ERRORS = new Set(['access_denied', 'invalid_scope', 'invalid_request', 'unauthorized_client', 'server_error', 'temporarily_unavailable']);

function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return base64urlSafe(hash);
}

export function startOAuthFlow(
  emailHint?: string,
  scopes: readonly string[] = GOOGLE_OAUTH_SCOPES
): Promise<OAuthFlowResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    
    const timeoutId = setTimeout(() => {
      server.close();
      reject(new GoogleSignInFailure('GOOGLE_OAUTH_TIMEOUT', 'OAuth flow timed out after 5 minutes.'));
    }, 5 * 60 * 1000);

    const cleanResolve = (val: OAuthFlowResult) => {
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
            
            if (pathName !== '/') {
              res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(oauthCallbackPage('Not found'));
              return;
            }
            {
              const query = parsedUrl.query;
              // The state is checked before anything else, `?error=` included:
              // a request without this flow's state is not Google's redirect
              // and must neither end nor cancel the sign-in.
              if (typeof query.state !== 'string' || query.state !== state) {
                res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(oauthCallbackPage('This sign-in link is not valid.', 'Return to Dumka Mail and try again.'));
                return;
              }

              if (query.error) {
                const errorCode = typeof query.error === 'string' && KNOWN_OAUTH_ERRORS.has(query.error) ? query.error : 'unknown';
                res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(oauthCallbackPage(
                  errorCode === 'access_denied' ? 'Sign-in was cancelled.' : 'Sign-in did not complete.',
                  'You can close this tab and return to Dumka Mail.',
                ));
                server.close();
                cleanReject(new GoogleSignInFailure(
                  errorCode === 'access_denied' ? 'GOOGLE_OAUTH_CANCELLED' : 'GOOGLE_OAUTH_FAILED',
                  `Consent failed: ${errorCode}`,
                ));
                return;
              }

              const code = typeof query.code === 'string' ? query.code : '';
              if (!code) throw new Error('Google redirect carried no authorization code.');
              
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
                // Only the OAuth error code goes to the log; the page shows a fixed sentence.
                const text = await tokenRes.text().catch(() => '');
                let errorCode = '';
                try {
                  const parsed = JSON.parse(text) as { error?: unknown };
                  errorCode = typeof parsed?.error === 'string' ? parsed.error.slice(0, 60) : '';
                } catch {
                  errorCode = '';
                }
                throw new Error(`Token exchange failed: HTTP ${tokenRes.status}${errorCode ? ` (${errorCode})` : ''}`);
              }

              const tokens = await tokenRes.json();
              const accessToken = tokens.access_token;
              const refreshToken = tokens.refresh_token;

              const grantedScopes = parseGrantedScopes(tokens.scope);

              if (!refreshToken && scopes.every(scope => GOOGLE_OAUTH_SCOPES.includes(scope as any))) {
                throw new GoogleSignInFailure('GOOGLE_OAUTH_NO_REFRESH_TOKEN', 'No refresh token returned. Revoke permissions first.');
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
              res.end(oauthCallbackPage('Dumka Mail is connected.', 'You can close this tab and return to the app.'));
              
              server.close();
              cleanResolve({
                email: profile.email,
                refreshToken,
                displayName: profile.name || undefined,
                avatarUrl: profile.picture || undefined,
                grantedScopes,
              });
            }
          } catch (e: unknown) {
            // The detail goes to the caller (and from there to the system log), never into the page.
            console.error('Error in OAuth server handler:', e instanceof Error ? e.message : String(e));
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(oauthCallbackPage('Sign-in did not complete.', 'Return to Dumka Mail and try again.'));
            }
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
