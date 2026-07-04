import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type WebSocket, WebSocketServer } from 'ws';
import { sessionUserFromCookie, verifyToken } from './auth.js';
import { config } from './config.js';
import { dbStats } from './db.js';
import { type ClientContext, addClient, clientCount, removeClient } from './hub.js';
import { debug } from './logger.js';
import { createApp } from './routes.js';
import type { Token, User } from './types.js';

interface WsAuth {
  user: User;
  // Null means the client used the browser dashboard session (full access).
  token: Token | null;
}

/**
 * Authenticate a WebSocket upgrade. An explicit opaque token (query string,
 * Authorization header or subprotocol) wins; otherwise the dashboard session
 * cookie is used so the browser needs no extra token.
 */
function authFromRequest(req: IncomingMessage): WsAuth | null {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let raw = url.searchParams.get('token');

  if (!raw) {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) raw = auth.slice(7);
  }
  if (!raw && req.headers['sec-websocket-protocol']) {
    const parts = req.headers['sec-websocket-protocol'].split(',').map((s) => s.trim());
    if (parts[0] === 'k2ws' && parts[1]) raw = parts[1];
  }

  if (raw) {
    const verified = verifyToken(raw);
    return verified ? { user: verified.user, token: verified.token } : null;
  }

  const user = sessionUserFromCookie(req.headers.cookie);
  return user ? { user, token: null } : null;
}

const app = createApp();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const auth = authFromRequest(req);
  if (!auth) {
    debug('ws', `upgrade rejected: no valid token or session (ip=${req.socket.remoteAddress})`);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, auth));
});

wss.on('connection', (ws: WebSocket, _req: IncomingMessage, auth: WsAuth) => {
  const ctx: ClientContext = {
    ws,
    token: auth.token,
    channelId: String(auth.user.channel_id),
    userId: auth.user.id,
  };
  addClient(ctx);
  debug(
    'ws',
    `connected user=${ctx.userId} channel=${ctx.channelId} auth=${auth.token ? 'token' : 'session'} subscribers=${clientCount(ctx.channelId)}`,
  );

  ws.send(
    JSON.stringify({
      kind: 'welcome',
      channel_id: ctx.channelId,
      username: auth.user.username,
      permissions: auth.token?.permissions ?? '*',
      auth: auth.token ? 'token' : 'session',
      subscribers: clientCount(ctx.channelId),
    }),
  );

  let alive = true;
  ws.on('pong', () => {
    alive = true;
  });
  ws.on('message', (buf) => {
    if (buf.toString() === 'ping') ws.send('pong');
  });
  ws.on('close', () => {
    removeClient(ctx);
    debug('ws', `disconnected user=${ctx.userId} channel=${ctx.channelId}`);
  });
  ws.on('error', () => removeClient(ctx));

  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, 30_000);
  ws.on('close', () => clearInterval(heartbeat));
});

server.listen(config.port, () => {
  const wsBase = config.publicUrl.replace(/^http/, 'ws');
  console.log(`Kick2WS listening on ${config.publicUrl} (port ${config.port})`);
  console.log(`  OAuth login: ${config.publicUrl}/oauth/login`);
  console.log(`  Webhook URL: ${config.kick.webhookUrl}`);
  console.log(`  WebSocket:   ${wsBase}/ws?token=...`);
  const stats = dbStats();
  console.log(
    `  Database:    ${stats.path} (users=${stats.users} tokens=${stats.tokens} subscriptions=${stats.subscriptions})`,
  );
  console.log(`  Events:      ${config.kick.events.length} configured`);
  console.log(`  Debug logs:  ${config.logsEnabled ? 'ON (LOGS_ENABLED=1)' : 'off'}`);
  if (!config.kick.clientId) console.warn('  Warning: KICK_CLIENT_ID not set, OAuth disabled.');
  if (config.skipWebhookVerify) console.warn('  Warning: webhook signature verification disabled.');
  if (stats.path.startsWith(process.cwd())) {
    console.warn(
      `  Warning: database lives inside the app directory (${stats.path}). On containers/PaaS ` +
        'this is EPHEMERAL and wiped on every redeploy. Set DB_PATH to a mounted persistent volume.',
    );
  }
});
