const crypto = require('crypto');
const {
  readStore,
  isBannedUser,
  isSiteOwner,
  isSiteModerator,
  isValueEditor,
} = require('./trade-store');

const DISCORD_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USER_URL = 'https://discord.com/api/users/@me';
const DISCORD_SCOPES = 'identify';
const DEFAULT_SITE_URL = 'https://d-seven-chi.vercel.app';
const COOKIE_OAUTH_STATE = 'dgg_oauth_state';
const COOKIE_OAUTH_VERIFIER = 'dgg_oauth_verifier';
const COOKIE_SESSION = 'dgg_session';
// Chrome caps persistent cookies around 400 days; sliding renewal keeps active users logged in.
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 400;

function getClientId() {
  return process.env.DISCORD_CLIENT_ID || '';
}

function getClientSecret() {
  return process.env.DISCORD_CLIENT_SECRET || '';
}

function getSessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.DISCORD_CLIENT_SECRET ||
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
    const maxAgeSeconds = Math.max(0, Math.floor(maxAgeMs / 1000));
    parts.push(`Max-Age=${maxAgeSeconds}`);
    const expiresAt = maxAgeMs > 0
      ? new Date(Date.now() + maxAgeMs)
      : new Date(0);
    parts.push(`Expires=${expiresAt.toUTCString()}`);
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
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();

  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) ||
    (req.secure ? 'https' : 'http');

  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return `${proto}://${host}`;
  }

  const configured = process.env.SITE_URL || '';
  if (configured) return configured.replace(/\/$/, '');

  // Keep production redirects stable even if a preview host is used.
  if (host.includes('vercel.app') || host === 'valuedex' || host === 'www.valuedex' || host === 'demand.gg' || host === 'www.demand.gg') {
    return DEFAULT_SITE_URL;
  }

  return DEFAULT_SITE_URL;
}

function getRedirectUri(req) {
  if (process.env.DISCORD_REDIRECT_URI) {
    return process.env.DISCORD_REDIRECT_URI;
  }
  return `${getRequestOrigin(req)}/api/auth/discord/callback`;
}

function getRequiredRedirectUris() {
  return [
    `${DEFAULT_SITE_URL}/api/auth/discord/callback`,
    'http://localhost:3000/api/auth/discord/callback',
  ];
}

function discordDefaultAvatar(userId) {
  try {
    const index = Number((BigInt(String(userId)) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  } catch {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
}

function discordAvatarUrl(user) {
  if (!user) return discordDefaultAvatar('');
  if (user.avatar && user.id) {
    const ext = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
  }
  return discordDefaultAvatar(user.id);
}

function getAvatarFallbackUrl(userId) {
  return discordDefaultAvatar(userId);
}

function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const payload = verifySession(cookies[COOKIE_SESSION]);
  return sessionPayloadToUser(payload);
}

function sessionPayloadToUser(payload) {
  if (!payload || !payload.sub) return null;
  const id = String(payload.sub);
  return {
    id,
    username: payload.preferred_username || payload.nickname || payload.name || 'Player',
    name: payload.name || payload.preferred_username || payload.nickname || 'Player',
    profile: payload.profile || null,
    picture: payload.picture || payload.avatarUrl || getAvatarFallbackUrl(id),
    avatarUrl: payload.avatarUrl || payload.picture || getAvatarFallbackUrl(id),
  };
}

function readSessionPayload(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySession(cookies[COOKIE_SESSION]);
}

function refreshSessionCookie(res, payload) {
  if (!payload || !payload.sub) return;
  const nextPayload = {
    ...payload,
    exp: Date.now() + SESSION_MAX_AGE_MS,
  };
  setCookie(res, COOKIE_SESSION, signSession(nextPayload), { maxAgeMs: SESSION_MAX_AGE_MS });
}

async function exchangeCodeForTokens({ code, redirectUri }) {
  const secret = getClientSecret();
  if (!secret || !getClientId()) {
    const error = new Error(
      'DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are not set. Add them in Vercel Environment Variables, then redeploy.',
    );
    error.status = 500;
    throw error;
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: getClientId(),
    client_secret: secret,
  });

  const response = await fetch(DISCORD_TOKEN_URL, {
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

async function fetchDiscordProfile(accessToken) {
  const response = await fetch(DISCORD_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error_description || data.message || data.error || 'Failed to load Discord profile.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function fetchDiscordUser(userId) {
  const token = process.env.DISCORD_BOT_TOKEN || '';
  if (!token || !userId) return null;
  try {
    const response = await fetch(`https://discord.com/api/v10/users/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const username = data.global_name || data.username || null;
    const avatarUrl = discordAvatarUrl(data);
    return {
      id: String(data.id),
      username,
      name: username,
      avatarUrl,
      picture: avatarUrl,
      profile: `https://discord.com/users/${data.id}`,
    };
  } catch {
    return null;
  }
}

function htmlErrorPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — valuedex</title>
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
    <a href="/">Back to valuedex</a>
  </div>
</body>
</html>`;
}

function startDiscordLogin(req, res) {
  if (!getClientId() || !getClientSecret()) {
    res
      .status(500)
      .send(
        htmlErrorPage(
          'Login not configured',
          'Add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in Vercel Environment Variables, then redeploy. In the Discord Developer Portal, add the redirect URLs from /api/auth/setup.',
        ),
      );
    return;
  }

  const state = createState();
  const redirectUri = getRedirectUri(req);
  setCookie(res, COOKIE_OAUTH_STATE, state, { maxAgeMs: 1000 * 60 * 10 });

  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set('client_id', getClientId());
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DISCORD_SCOPES);
  url.searchParams.set('state', state);

  res.redirect(url.toString());
}

function registerRobloxAuth(app) {
  app.get('/api/auth/setup', (req, res) => {
    const redirectUri = getRedirectUri(req);
    res.json({
      clientId: getClientId(),
      redirectUri,
      requiredRedirectUris: getRequiredRedirectUris(),
      instructions: [
        'Open https://discord.com/developers/applications and select the ValueDex application.',
        'OAuth2 → Redirects: add every URL in requiredRedirectUris exactly.',
        'Copy the Client Secret into DISCORD_CLIENT_SECRET.',
        'Set SITE_OWNER_ID to your Discord user ID so the owner tools stay yours.',
        'Save, redeploy, then try Log In again.',
      ],
      hasClientSecret: Boolean(getClientSecret()),
      hasClientId: Boolean(getClientId()),
    });
  });

  app.get('/api/auth/discord', startDiscordLogin);
  app.get('/api/auth/roblox', startDiscordLogin);

  app.get('/api/auth/discord/callback', async (req, res) => {
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
      res.status(400).send(htmlErrorPage('Login failed', 'Missing authorization code from Discord.'));
      return;
    }

    if (!cookies[COOKIE_OAUTH_STATE] || cookies[COOKIE_OAUTH_STATE] !== String(state)) {
      res.status(400).send(htmlErrorPage('Login failed', 'Invalid OAuth state. Try logging in again.'));
      return;
    }

    try {
      const tokens = await exchangeCodeForTokens({
        code: String(code),
        redirectUri: getRedirectUri(req),
      });

      const profile = await fetchDiscordProfile(tokens.access_token);
      const userId = String(profile.id);
      try {
        const store = await readStore();
        if (isBannedUser(store, userId)) {
          clearCookie(res, COOKIE_SESSION);
          res.redirect('/banned.html');
          return;
        }
      } catch {
        // Continue login if moderation lookup fails.
      }

      const displayName = profile.global_name || profile.username || 'Player';
      const avatarUrl = discordAvatarUrl(profile);
      const session = {
        sub: userId,
        name: displayName,
        preferred_username: profile.username || displayName,
        profile: `https://discord.com/users/${userId}`,
        picture: avatarUrl,
        avatarUrl,
        provider: 'discord',
        exp: Date.now() + SESSION_MAX_AGE_MS,
      };

      setCookie(res, COOKIE_SESSION, signSession(session), { maxAgeMs: SESSION_MAX_AGE_MS });
      res.redirect('/');
    } catch (err) {
      res
        .status(err.status || 500)
        .send(htmlErrorPage('Login failed', err.message || 'Could not finish Discord login.'));
    }
  });

  app.get('/api/auth/roblox/callback', (req, res) => {
    res.redirect('/api/auth/discord');
  });

  app.get('/api/auth/me', async (req, res) => {
    const payload = readSessionPayload(req);
    const user = sessionPayloadToUser(payload);
    if (!user) {
      res.json({ user: null });
      return;
    }

    try {
      const store = await readStore();
      if (isBannedUser(store, user.id)) {
        clearCookie(res, COOKIE_SESSION);
        res.json({ user: null, banned: true });
        return;
      }

      refreshSessionCookie(res, payload);
      res.json({
        user,
        roles: {
          isOwner: isSiteOwner(user.id),
          isModerator: isSiteModerator(store, user.id),
          isValueEditor: isValueEditor(store, user.id),
        },
      });
    } catch {
      refreshSessionCookie(res, payload);
      res.json({ user });
    }
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
  fetchDiscordUser,
  discordDefaultAvatar,
};
