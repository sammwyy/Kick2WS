import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createToken, issueSessionJwt, verifySessionJwt } from './auth.js';
import { assertKickConfigured, config } from './config.js';
import {
  deleteSubscriptionsForUser,
  deleteUser,
  gcOAuthFlows,
  getTokenById,
  getUser,
  insertSubscription,
  listSubscriptions,
  listTokensForUser,
  revokeToken,
  saveOAuthFlow,
  takeOAuthFlow,
  upsertUser,
} from './db.js';
import { activeChannels } from './hub.js';
import {
  buildAuthorizeUrl,
  createPkce,
  createSubscriptions,
  deleteSubscription,
  exchangeCode,
  fetchSelf,
} from './kick.js';
import { debug } from './logger.js';
import type { User } from './types.js';
import { handleWebhook } from './webhook.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

interface AuthedRequest extends Request {
  user?: User;
}

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setSessionCookie(res: Response, token: string): void {
  const secure = config.publicUrl.startsWith('https') ? '; Secure' : '';
  const maxAge = 7 * 24 * 3600;
  res.setHeader(
    'Set-Cookie',
    `k2ws_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  );
}

function requireSession(req: AuthedRequest, res: Response, next: NextFunction): void {
  const cookie = parseCookies(req).k2ws_session;
  const claims = cookie ? verifySessionJwt(cookie) : null;
  const user = claims ? getUser(claims.sub) : undefined;
  if (!user) {
    res.status(401).json({ error: 'not authenticated' });
    return;
  }
  req.user = user;
  next();
}

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // Log every inbound request before any parsing. This tells us whether Kick
  // (or the reverse proxy) is even reaching the app.
  app.use((req, _res, next) => {
    debug(
      'http',
      `${req.method} ${req.originalUrl} ct=${req.headers['content-type'] ?? '-'} ` +
        `kick-event=${req.headers['kick-event-type'] ?? '-'} ua="${req.headers['user-agent'] ?? '-'}" from=${req.ip}`,
    );
    next();
  });

  // Kick delivers to the webhook URL configured in the app dashboard; some
  // setups point it at the root path instead of /webhook, so both are accepted.
  const isWebhookTarget = (req: Request) =>
    req.method === 'POST' && (req.path === '/webhook' || req.path === '/');

  // The webhook needs the exact raw bytes for signature verification and must
  // work for any content-type Kick sends, so it gets a dedicated raw parser and
  // is excluded from the global JSON parser.
  const jsonParser = express.json();
  app.use((req, res, next) => (isWebhookTarget(req) ? next() : jsonParser(req, res, next)));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(publicDir));

  app.get('/oauth/login', (req, res) => {
    assertKickConfigured();
    gcOAuthFlows();
    const requested = String(req.query.scopes ?? '')
      .split(/[\s,+]+/)
      .filter(Boolean);
    const scopes = requested.length > 0 ? requested : [...config.kick.defaultScopes];

    const { verifier, challenge } = createPkce();
    const state = crypto.randomBytes(16).toString('hex');
    saveOAuthFlow({ state, code_verifier: verifier, scopes: scopes.join(' ') });
    res.redirect(buildAuthorizeUrl({ state, challenge, scopes }));
  });

  app.get('/oauth/callback', async (req, res) => {
    try {
      assertKickConfigured();
      const { code, state, error, error_description } = req.query;
      if (error) {
        return res.status(400).send(`Kick OAuth error: ${error} ${error_description ?? ''}`);
      }
      if (!code || !state) return res.status(400).send('Missing code/state');

      const flow = takeOAuthFlow(String(state));
      if (!flow) return res.status(400).send('Invalid or expired state');

      const tokens = await exchangeCode({ code: String(code), codeVerifier: flow.code_verifier });
      const expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
      const self = await fetchSelf(tokens.access_token);
      const userId = String(self.user_id ?? self.id);
      const channelId = String(self.channel_id ?? self.user_id ?? self.id);
      debug('oauth', 'fetchSelf returned:', JSON.stringify(self));
      debug('oauth', `stored user=${userId} channel_id=${channelId} scopes="${flow.scopes}"`);

      const user = upsertUser({
        id: userId,
        channel_id: channelId,
        username: self.name ?? self.username ?? null,
        scopes: flow.scopes,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at: expiresAt,
      });

      if (config.kick.events.length > 0 && flow.scopes.includes('events:subscribe')) {
        try {
          const resp = await createSubscriptions(tokens.access_token, config.kick.events);
          debug('oauth', 'createSubscriptions response:', JSON.stringify(resp));
          resp.data.forEach((item, index) => {
            const fallback = config.kick.events[index];
            insertSubscription({
              id: String(item.subscription_id ?? item.id ?? `${userId}:${fallback?.name}`),
              user_id: userId,
              event_name: item.name ?? fallback?.name ?? 'unknown',
              version: item.version ?? fallback?.version ?? 1,
            });
          });
        } catch (err) {
          console.error('[oauth] subscription creation failed:', (err as Error).message);
        }
      }

      setSessionCookie(res, issueSessionJwt(user));
      return res.redirect('/#connected');
    } catch (err) {
      console.error('[oauth] callback error:', err);
      return res.status(500).send(`OAuth callback failed: ${(err as Error).message}`);
    }
  });

  app.get('/api/me', requireSession, (req: AuthedRequest, res) => {
    const user = req.user as User;
    res.json({
      user: {
        id: user.id,
        channel_id: user.channel_id,
        username: user.username,
        scopes: user.scopes.split(/\s+/).filter(Boolean),
      },
      subscriptions: listSubscriptions(user.id),
      tokens: listTokensForUser(user.id).map((t) => ({
        id: t.id,
        label: t.label,
        permissions: t.permissions,
        created_at: t.created_at,
        last_used_at: t.last_used_at,
        revoked: t.revoked_at !== null,
      })),
      available_events: config.kick.events.map((event) => event.name),
      ws_url: `${config.publicUrl.replace(/^http/, 'ws')}/ws`,
    });
  });

  app.post('/api/tokens', requireSession, (req: AuthedRequest, res) => {
    const label = String(req.body?.label ?? '').slice(0, 80);
    const permissions = String(req.body?.permissions ?? '*').trim() || '*';
    res.status(201).json(createToken((req.user as User).id, { label, permissions }));
  });

  app.delete('/api/tokens/:id', requireSession, (req: AuthedRequest, res) => {
    const id = req.params.id ?? '';
    const token = getTokenById(id);
    if (!token || token.user_id !== (req.user as User).id) {
      return res.status(404).json({ error: 'not found' });
    }
    revokeToken(id);
    return res.json({ ok: true });
  });

  app.post('/api/logout', requireSession, async (req: AuthedRequest, res) => {
    const user = req.user as User;
    if (user.access_token) {
      for (const sub of listSubscriptions(user.id)) {
        try {
          await deleteSubscription(user.access_token, sub.id);
        } catch (err) {
          console.error('[logout] failed to delete subscription', sub.id, (err as Error).message);
        }
      }
    }
    deleteSubscriptionsForUser(user.id);
    deleteUser(user.id);
    res.setHeader('Set-Cookie', 'k2ws_session=; HttpOnly; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  // Diagnostics: compare your channel id against the channels that actually
  // have live WebSocket clients. A mismatch means webhook events land on a
  // different channel id than the one your clients subscribed with.
  app.get('/api/debug', requireSession, (req: AuthedRequest, res) => {
    const user = req.user as User;
    res.json({
      logs_enabled: config.logsEnabled,
      skip_webhook_verify: config.skipWebhookVerify,
      webhook_url: config.kick.webhookUrl,
      your_channel_id: user.channel_id,
      subscriptions: listSubscriptions(user.id),
      active_ws_channels: activeChannels(),
    });
  });

  const rawParser = express.raw({ type: () => true, limit: '2mb' });
  app.post('/webhook', rawParser, handleWebhook);
  app.post('/', rawParser, handleWebhook);
  app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  return app;
}
