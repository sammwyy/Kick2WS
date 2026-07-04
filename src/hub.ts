import type { WebSocket } from 'ws';
import { tokenAllowsEvent } from './auth.js';
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

/** Deliver an event to a channel's subscribers; returns the number reached. */
export function broadcast(channelId: string, event: StreamEvent): number {
  const set = channels.get(channelId);
  if (!set || set.size === 0) return 0;
  const payload = JSON.stringify({ kind: 'event', ...event });
  let sent = 0;
  for (const ctx of set) {
    if (ctx.token && !tokenAllowsEvent(ctx.token, event.type)) continue;
    if (ctx.ws.readyState === ctx.ws.OPEN) {
      ctx.ws.send(payload);
      sent += 1;
    }
  }
  return sent;
}
