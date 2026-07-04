import 'dotenv/config';

export interface KickEvent {
  name: string;
  version: number;
}

// The full catalog of Kick webhook events (https://docs.kick.com/events/event-types).
// Hardcoded on purpose: it's a fixed platform catalog, not deployment config.
const KICK_EVENTS: KickEvent[] = [
  { name: 'chat.message.sent', version: 1 },
  { name: 'channel.followed', version: 1 },
  { name: 'channel.subscription.new', version: 1 },
  { name: 'channel.subscription.renewal', version: 1 },
  { name: 'channel.subscription.gifts', version: 1 },
  { name: 'channel.reward.redemption.updated', version: 1 },
  { name: 'livestream.status.updated', version: 1 },
  { name: 'livestream.metadata.updated', version: 1 },
  { name: 'moderation.banned', version: 1 },
  { name: 'kicks.gifted', version: 1 },
];

function trimUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const publicUrl = trimUrl(process.env.PUBLIC_URL ?? 'http://localhost:3000');

export const config = {
  publicUrl,
  port: Number(process.env.PORT ?? 3000),
  appSecret: required('APP_SECRET', 'dev-insecure-secret-change-me'),
  dbPath: process.env.DB_PATH ?? './data/kick2ws.db',
  skipWebhookVerify: process.env.INSECURE_SKIP_WEBHOOK_VERIFY === '1',
  logsEnabled: process.env.LOGS_ENABLED === '1',
  kick: {
    clientId: process.env.KICK_CLIENT_ID ?? '',
    clientSecret: process.env.KICK_CLIENT_SECRET ?? '',
    redirectUri: `${publicUrl}/oauth/callback`,
    webhookUrl: `${publicUrl}/webhook`,
    defaultScopes: (
      process.env.KICK_DEFAULT_SCOPES ??
      'user:read channel:read events:subscribe channel:rewards:read'
    )
      .split(/\s+/)
      .filter(Boolean),
    events: KICK_EVENTS,
    authorizeUrl: 'https://id.kick.com/oauth/authorize',
    tokenUrl: 'https://id.kick.com/oauth/token',
    apiBase: 'https://api.kick.com/public/v1',
  },
} as const;

/** Throw early if OAuth cannot work with the current environment. */
export function assertKickConfigured(): void {
  if (!config.kick.clientId || !config.kick.clientSecret) {
    throw new Error('Kick OAuth not configured: set KICK_CLIENT_ID and KICK_CLIENT_SECRET');
  }
}
