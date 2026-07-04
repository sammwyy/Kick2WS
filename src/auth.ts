import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { getTokenById, getUser, insertToken, touchToken } from './db.js';
import type { Token, User } from './types.js';

const sha256 = (input: string): string => crypto.createHash('sha256').update(input).digest('hex');

export interface CreatedToken {
  id: string;
  plaintext: string;
  label: string;
  permissions: string;
}

export interface SessionClaims {
  sub: string;
  channel_id: string | null;
  username: string | null;
}

/**
 * Opaque, revocable API/WS tokens formatted as `k2ws_<id>.<secret>`.
 * The `.` separator is safe because both parts are base64url (which never
 * contains `.`). Only sha256(secret) is stored, so a leaked database cannot be
 * replayed.
 */
export function createToken(
  userId: string,
  opts: { label?: string; permissions?: string } = {},
): CreatedToken {
  const id = crypto.randomBytes(9).toString('base64url');
  const secret = crypto.randomBytes(24).toString('base64url');
  const label = opts.label ?? '';
  const permissions = opts.permissions ?? '*';
  insertToken({ id, user_id: userId, hash: sha256(secret), label, permissions });
  return { id, plaintext: `k2ws_${id}.${secret}`, label, permissions };
}

export interface VerifiedToken {
  token: Token;
  user: User;
}

/** Validate an opaque token string in constant time. */
export function verifyToken(plaintext: string | null | undefined): VerifiedToken | null {
  if (typeof plaintext !== 'string') return null;
  const match = /^k2ws_([^.]+)\.(.+)$/.exec(plaintext.trim());
  if (!match) return null;
  const [, id, secret] = match as unknown as [string, string, string];
  const token = getTokenById(id);
  if (!token || token.revoked_at) return null;

  const provided = Buffer.from(sha256(secret));
  const stored = Buffer.from(token.hash);
  if (provided.length !== stored.length || !crypto.timingSafeEqual(provided, stored)) {
    return null;
  }
  const user = getUser(token.user_id);
  if (!user) return null;
  touchToken(id);
  return { token, user };
}

/** A token receives an event when its permissions list includes it or is `*`. */
export function tokenAllowsEvent(token: Token, eventName: string): boolean {
  const perms = token.permissions.split(/\s+/).filter(Boolean);
  return perms.length === 0 || perms.includes('*') || perms.includes(eventName);
}

/** Short-lived dashboard session carrying the channel id and identity. */
export function issueSessionJwt(user: User): string {
  return jwt.sign(
    { sub: user.id, channel_id: user.channel_id, username: user.username },
    config.appSecret,
    { expiresIn: '7d' },
  );
}

export function verifySessionJwt(token: string): SessionClaims | null {
  try {
    return jwt.verify(token, config.appSecret) as SessionClaims;
  } catch {
    return null;
  }
}

/** Read the `k2ws_session` cookie from a raw Cookie header. */
export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === 'k2ws_session') {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/** Resolve the dashboard user from a session cookie header, or null. */
export function sessionUserFromCookie(cookieHeader: string | undefined): User | null {
  const raw = readSessionCookie(cookieHeader);
  const claims = raw ? verifySessionJwt(raw) : null;
  return claims ? (getUser(claims.sub) ?? null) : null;
}
