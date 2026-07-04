import 'dotenv/config';

export interface KickEvent {
  name: string;
  version: number;
}

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

function parseEvents(raw: string): KickEvent[] {
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [name, version] = pair.split(':');
      return { name: name as string, version: Number(version ?? 1) };
    });
}

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
    events: parseEvents(process.env.KICK_EVENTS ?? ''),
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
