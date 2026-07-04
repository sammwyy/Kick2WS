import type { WebSocket } from 'ws';
import { tokenAllowsEvent } from './auth.js';
import { debug } from './logger.js';
import type { StreamEvent, Token } from './types.js';

export interface ClientContext {
  ws: WebSocket;
  // Null when the client authenticated with a dashboard session cookie, which
  // grants access to every event on the channel.
  token: Token | null;
  channelId: string;
  userId: string;
}

/**
 * In-memory pub/sub keyed by Kick channel id. A webhook event is fanned out to
 * every client of that channel whose token permits the event type.
 */
const channels = new Map<string, Set<ClientContext>>();

export function addClient(ctx: ClientContext): void {
  let set = channels.get(ctx.channelId);
  if (!set) {
    set = new Set();
    channels.set(ctx.channelId, set);
  }
  set.add(ctx);
}

export function removeClient(ctx: ClientContext): void {
  const set = channels.get(ctx.channelId);
  if (!set) return;
  set.delete(ctx);
  if (set.size === 0) channels.delete(ctx.channelId);
}

export function clientCount(channelId: string): number {
  return channels.get(channelId)?.size ?? 0;
}

/** Snapshot of every channel currently holding clients, for debugging. */
export function activeChannels(): { channelId: string; clients: number }[] {
  return [...channels.entries()].map(([channelId, set]) => ({
    channelId,
    clients: set.size,
  }));
}

/** Deliver an event to a channel's subscribers; returns the number reached. */
export function broadcast(channelId: string, event: StreamEvent): number {
  const set = channels.get(channelId);
  if (!set || set.size === 0) {
    debug(
      'hub',
      `no clients for channel=${channelId}. active channels:`,
      JSON.stringify(activeChannels()),
    );
    return 0;
  }
  const payload = JSON.stringify({ kind: 'event', ...event });
  let sent = 0;
  let filtered = 0;
  let closed = 0;
  for (const ctx of set) {
    if (ctx.token && !tokenAllowsEvent(ctx.token, event.type)) {
      filtered += 1;
      continue;
    }
    if (ctx.ws.readyState === ctx.ws.OPEN) {
      ctx.ws.send(payload);
      sent += 1;
    } else {
      closed += 1;
    }
  }
  debug(
    'hub',
    `broadcast channel=${channelId} type=${event.type} clients=${set.size} sent=${sent} filtered=${filtered} closed=${closed}`,
  );
  return sent;
}
