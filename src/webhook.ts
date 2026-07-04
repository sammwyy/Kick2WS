import type { Request, Response } from 'express';
import { config } from './config.js';
import { findChannelBySubscription } from './db.js';
import { broadcast } from './hub.js';
import { verifyWebhookSignature } from './kick.js';
import { debug, error, warn } from './logger.js';

interface WebhookRequest extends Request {
  rawBody?: Buffer;
}

/** Locate the channel an event belongs to across Kick's varying payload shapes. */
function resolveChannelId(
  data: Record<string, unknown>,
  subscriptionId: string | null,
): { channelId: string | null; source: string } {
  const broadcaster = data.broadcaster as Record<string, unknown> | undefined;
  const channel = data.channel as Record<string, unknown> | undefined;
  const sources: [string, unknown][] = [
    ['broadcaster.channel_id', broadcaster?.channel_id],
    ['broadcaster.user_id', broadcaster?.user_id],
    ['broadcaster_user_id', data.broadcaster_user_id],
    ['channel_id', data.channel_id],
    ['channel.id', channel?.id],
  ];
  for (const [source, value] of sources) {
    if (value !== undefined && value !== null) {
      return { channelId: String(value), source };
    }
  }
  if (subscriptionId) {
    const channelId = findChannelBySubscription(subscriptionId);
    if (channelId) return { channelId, source: 'subscription-map' };
  }
  return { channelId: null, source: 'none' };
}

/** Express handler for `POST /webhook`. Requires `req.rawBody` for verification. */
export async function handleWebhook(req: WebhookRequest, res: Response): Promise<Response> {
  const messageId = req.get('Kick-Event-Message-Id');
  const timestamp = req.get('Kick-Event-Message-Timestamp');
  const signature = req.get('Kick-Event-Signature');
  const eventType = req.get('Kick-Event-Type') ?? 'unknown';
  const eventVersion = Number(req.get('Kick-Event-Version') ?? 1);
  const subscriptionId = req.get('Kick-Event-Subscription-Id') ?? null;
  const rawBody = req.rawBody?.toString('utf8') ?? '';

  debug(
    'webhook',
    `received type=${eventType} v${eventVersion} msg=${messageId} sub=${subscriptionId} bytes=${rawBody.length} signed=${Boolean(signature)}`,
  );

  if (!config.skipWebhookVerify) {
    if (!messageId || !timestamp || !signature) {
      warn('webhook', `rejected: missing signature headers for type=${eventType}`);
      return res.status(400).json({ error: 'missing signature headers' });
    }
    try {
      const ok = await verifyWebhookSignature({ messageId, timestamp, signature, rawBody });
      if (!ok) {
        warn('webhook', `rejected: invalid signature for type=${eventType} msg=${messageId}`);
        return res.status(401).json({ error: 'invalid signature' });
      }
      debug('webhook', `signature ok msg=${messageId}`);
    } catch (err) {
      error('webhook', 'verification threw:', (err as Error).message);
      return res.status(401).json({ error: 'signature verification failed' });
    }
  } else {
    debug('webhook', 'signature verification skipped (INSECURE_SKIP_WEBHOOK_VERIFY=1)');
  }

  let data: Record<string, unknown>;
  try {
    data = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    warn('webhook', `rejected: invalid JSON for type=${eventType}`);
    return res.status(400).json({ error: 'invalid json' });
  }

  const { channelId, source } = resolveChannelId(data, subscriptionId);
  debug('webhook', `channel resolved=${channelId} via=${source} payload=`, rawBody);

  if (!channelId) {
    warn('webhook', `unresolved channel for type=${eventType}. payload keys: ${Object.keys(data)}`);
    return res.status(202).json({ ok: true, delivered: 0, note: 'channel unresolved' });
  }

  const delivered = broadcast(channelId, {
    id: messageId ?? null,
    type: eventType,
    version: eventVersion,
    timestamp: timestamp ?? null,
    data,
  });
  debug('webhook', `done type=${eventType} channel=${channelId} delivered=${delivered}`);
  return res.status(200).json({ ok: true, delivered });
}
