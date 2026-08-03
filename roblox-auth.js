const crypto = require('crypto');

const ROBLOX_AUTHORIZE_URL = 'https://apis.roblox.com/oauth/v1/authorize';
const ROBLOX_TOKEN_URL = 'https://apis.roblox.com/oauth/v1/token';
const ROBLOX_USERINFO_URL = 'https://apis.roblox.com/oauth/v1/userinfo';
const DEFAULT_CLIENT_ID = '1467861509529011675';
const OAUTH_SCOPES = 'openid profile';
const COOKIE_OAUTH_STATE = 'dgg_oauth_state';
const COOKIE_OAUTH_VERIFIER = 'dgg_oauth_verifier';
const COOKIE_SESSION = 'dgg_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function getClientId() {
  return process.env.ROBLOX_CLIENT_ID || DEFAULT_CLIENT_ID;
}

function getClientSecret() {
  return process.env.ROBLOX_CLIENT_SECRET || '';
}

function getSessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.ROBLOX_CLIENT_SECRET ||
    'demandgg-dev-session-secret'
  );
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

function createCodeVerifier() {
  return base64UrlEncode(crypto.randomBytes(32));
}

function createCodeChallenge(verifier) {
  return base64UrlEncode(crypto.createHash('sha256').update(verifier).digest());
}

function createState() {
  return base64UrlEncode(crypto.randomBytes(24));
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  String(header)
    .split(';')
    .forEach((part) => {
      const index = part.indexOf('=');
      if (index === -1) return;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (!key) return;
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    });
  return cookies;
}

function cookieOptions({ maxAgeMs, httpOnly = true } = {}) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
  const parts = [
    'Path=/',
    'SameSite=Lax',
    httpOnly ? 'HttpOnly' : '',
    secure ? 'Secure' : '',
  ].filter(Boolean);

  if (typeof maxAgeMs === 'number') {
    parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  }

  return parts.join('; ');
}

function setCookie(res, name, value, options) {
  const existing = res.getHeader('Set-Cookie');
  const next = `${name}=${encodeURIComponent(value)}; ${cookieOptions(options)}`;
  if (!existing) {
    res.setHeader('Set-Cookie', [next]);
    return;
  }
  const list = Array.isArray(existing) ? existing : [existing];
  res.setHeader('Set-Cookie', [...list, next]);
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAgeMs: 0 });
}

function signSession(payload) {
  const body = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', getSessionSecret()).update(body).digest(),
  );
  return `${body}.${signature}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = base64UrlEncode(
    crypto.createHmac('sha256', getSessionSecret()).update(body).digest(),
  );

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(body).toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function getRequestOrigin(req) {
  const configured = process.env.SITE_URL || process.env.ROBLOX_REDIRECT_ORIGIN;
  if (configured) return configured.replace(/\/$/, '');

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) ||
    (req.secure ? 'https' : 'http');
  return `${proto}://${host}`;
}

function getRedirectUri(req) {
  if (process.env.ROBLOX_REDIRECT_URI) {
    return process.env.ROBLOX_REDIRECT_URI;
  }
  return `${getRequestOrigin(req)}/api/auth/roblox/callback`;
}

function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const payload = verifySession(cookies[COOKIE_SESSION]);
  if (!payload || !payload.sub) return null;
  return {
    id: String(payload.sub),
    username: payload.preferred_username || payload.nickname || payload.name || 'Player',
    name: payload.name || payload.preferred_username || payload.nickname || 'Player',
    profile: payload.profile || null,
    picture: payload.picture || null,
  };
}

async function exchangeCodeForTokens({ code, codeVerifier, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: getClientId(),
    code_verifier: codeVerifier,
  });

  const secret = getClientSecret();
  if (secret) {
    body.set('client_secret', secret);
  }

  const response = await fetch(ROBLOX_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error_description || data.error || 'Token exchange failed.';
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function fetchUserInfo(accessToken) {
  const response = await fetch(ROBLOX_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error_description || data.error || 'Failed to load Roblox profile.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

function htmlErrorPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — demand.gg</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1220; color: #e8eefc; font-family: system-ui, sans-serif; }
    .card { max-width: 28rem; padding: 1.5rem; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; background: rgba(255,255,255,.04); }
    a { color: #7dd3fc; }
  </style>
</head>
<body>
  <div class="card">
    <h1 style="margin:0 0 .75rem;font-size:1.25rem;">${title}</h1>
    <p style="margin:0 0 1rem;line-height:1.5;opacity:.9;">${message}</p>
    <a href="/">Back to demand.gg</a>
  </div>
</body>
</html>`;
}

function registerRobloxAuth(app) {
  app.get('/api/auth/roblox', (req, res) => {
    const state = createState();
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);
    const redirectUri = getRedirectUri(req);

    setCookie(res, COOKIE_OAUTH_STATE, state, { maxAgeMs: 1000 * 60 * 10 });
    setCookie(res, COOKIE_OAUTH_VERIFIER, codeVerifier, { maxAgeMs: 1000 * 60 * 10 });

    const url = new URL(ROBLOX_AUTHORIZE_URL);
    url.searchParams.set('client_id', getClientId());
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', OAUTH_SCOPES);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    res.redirect(url.toString());
  });

  app.get('/api/auth/roblox/callback', async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const { code, state, error, error_description: errorDescription } = req.query;

    clearCookie(res, COOKIE_OAUTH_STATE);
    clearCookie(res, COOKIE_OAUTH_VERIFIER);

    if (error) {
      res
        .status(400)
        .send(htmlErrorPage('Login cancelled', String(errorDescription || error)));
      return;
    }

    if (!code || !state) {
      res.status(400).send(htmlErrorPage('Login failed', 'Missing authorization code from Roblox.'));
      return;
    }

    if (!cookies[COOKIE_OAUTH_STATE] || cookies[COOKIE_OAUTH_STATE] !== String(state)) {
      res.status(400).send(htmlErrorPage('Login failed', 'Invalid OAuth state. Try logging in again.'));
      return;
    }

    const codeVerifier = cookies[COOKIE_OAUTH_VERIFIER];
    if (!codeVerifier) {
      res
        .status(400)
        .send(htmlErrorPage('Login failed', 'Login session expired. Try logging in again.'));
      return;
    }

    try {
      const tokens = await exchangeCodeForTokens({
        code: String(code),
        codeVerifier,
        redirectUri: getRedirectUri(req),
      });

      const profile = await fetchUserInfo(tokens.access_token);
      const session = {
        sub: profile.sub,
        name: profile.name,
        nickname: profile.nickname,
        preferred_username: profile.preferred_username,
        profile: profile.profile,
        picture: profile.picture,
        exp: Date.now() + SESSION_MAX_AGE_MS,
      };

      setCookie(res, COOKIE_SESSION, signSession(session), { maxAgeMs: SESSION_MAX_AGE_MS });
      res.redirect('/');
    } catch (err) {
      const hint = !getClientSecret()
        ? ' Set ROBLOX_CLIENT_SECRET in your environment if your Roblox app is a confidential client.'
        : '';
      res
        .status(err.status || 500)
        .send(htmlErrorPage('Login failed', `${err.message || 'Could not finish Roblox login.'}${hint}`));
    }
  });

  app.get('/api/auth/me', (req, res) => {
    const user = getSessionUser(req);
    res.json({ user });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearCookie(res, COOKIE_SESSION);
    res.status(204).end();
  });

  app.get('/api/auth/logout', (req, res) => {
    clearCookie(res, COOKIE_SESSION);
    res.redirect('/');
  });
}

module.exports = {
  registerRobloxAuth,
  getSessionUser,
  getRedirectUri,
};
