import type { Request, Response } from 'express';
import { config } from './config.js';
import { findChannelBySubscription } from './db.js';
import { broadcast } from './hub.js';
import { verifyWebhookSignature } from './kick.js';

interface WebhookRequest extends Request {
  rawBody?: Buffer;
}

/** Locate the channel an event belongs to across Kick's varying payload shapes. */
function resolveChannelId(
  data: Record<string, unknown>,
  subscriptionId: string | null,
): string | null {
  const broadcaster = data.broadcaster as Record<string, unknown> | undefined;
  const channel = data.channel as Record<string, unknown> | undefined;
  const candidates = [
    broadcaster?.channel_id,
    broadcaster?.user_id,
    data.broadcaster_user_id,
    data.channel_id,
    channel?.id,
  ].filter((value) => value !== undefined && value !== null);

  if (candidates.length > 0) return String(candidates[0]);
  if (subscriptionId) return findChannelBySubscription(subscriptionId);
  return null;
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

  if (!config.skipWebhookVerify) {
    if (!messageId || !timestamp || !signature) {
      return res.status(400).json({ error: 'missing signature headers' });
    }
    try {
      const ok = await verifyWebhookSignature({ messageId, timestamp, signature, rawBody });
      if (!ok) return res.status(401).json({ error: 'invalid signature' });
    } catch (err) {
      console.error('[webhook] verification failed:', (err as Error).message);
      return res.status(401).json({ error: 'signature verification failed' });
    }
  }

  let data: Record<string, unknown>;
  try {
    data = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    return res.status(400).json({ error: 'invalid json' });
  }

  const channelId = resolveChannelId(data, subscriptionId);
  if (!channelId) {
    console.warn(`[webhook] unresolved channel for event ${eventType}`);
    return res.status(202).json({ ok: true, delivered: 0, note: 'channel unresolved' });
  }

  const delivered = broadcast(channelId, {
    id: messageId ?? null,
    type: eventType,
    version: eventVersion,
    timestamp: timestamp ?? null,
    data,
  });
  console.log(`[webhook] ${eventType} channel=${channelId} -> ${delivered} client(s)`);
  return res.status(200).json({ ok: true, delivered });
}
