import crypto from 'node:crypto';
import { type KickEvent, config } from './config.js';

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface KickSelf {
  user_id?: number | string;
  id?: number | string;
  channel_id?: number | string;
  name?: string;
  username?: string;
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function createPkce(): Pkce {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthorizeUrl(input: {
  state: string;
  challenge: string;
  scopes: string[];
}): string {
  const url = new URL(config.kick.authorizeUrl);
  url.searchParams.set('client_id', config.kick.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.kick.redirectUri);
  url.searchParams.set('scope', input.scopes.join(' '));
  url.searchParams.set('code_challenge', input.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', input.state);
  return url.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(config.kick.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kick token endpoint ${res.status}: ${text}`);
  return JSON.parse(text) as TokenResponse;
}

export function exchangeCode(input: {
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: 'authorization_code',
    client_id: config.kick.clientId,
    client_secret: config.kick.clientSecret,
    redirect_uri: config.kick.redirectUri,
    code_verifier: input.codeVerifier,
    code: input.code,
  });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: 'refresh_token',
    client_id: config.kick.clientId,
    client_secret: config.kick.clientSecret,
    refresh_token: refreshToken,
  });
}

/**
 * App access token via client_credentials. Kick's EventSub webhook management
 * (create/delete subscriptions) is done with an app token, not a user token.
 */
export async function getAppAccessToken(): Promise<string> {
  const tokens = await tokenRequest({
    grant_type: 'client_credentials',
    client_id: config.kick.clientId,
    client_secret: config.kick.clientSecret,
  });
  return tokens.access_token;
}

async function apiFetch<T>(
  accessToken: string,
  pathname: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${config.kick.apiBase}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kick API ${init.method ?? 'GET'} ${pathname} -> ${res.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** Return the token owner's Kick identity. */
export async function fetchSelf(accessToken: string): Promise<KickSelf> {
  const body = await apiFetch<{ data?: KickSelf[] | KickSelf }>(accessToken, '/users');
  const data = Array.isArray(body?.data) ? body.data[0] : body?.data;
  return (data ?? {}) as KickSelf;
}

export interface CreatedSubscription {
  subscription_id?: string;
  id?: string;
  name?: string;
  version?: number;
}

/**
 * Subscribe a broadcaster's channel to webhook events. The explicit
 * `callback_url` makes delivery independent of the app dashboard config.
 */
export async function createSubscriptions(
  appToken: string,
  broadcasterId: string,
  callbackUrl: string,
  events: readonly KickEvent[],
): Promise<{ data: CreatedSubscription[] }> {
  if (events.length === 0) return { data: [] };
  return apiFetch(appToken, '/events/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      broadcaster_user_id: Number(broadcasterId),
      method: 'webhook',
      callback_url: callbackUrl,
      events: events.map((event) => ({ name: event.name, version: event.version })),
    }),
  });
}

export function deleteSubscription(appToken: string, id: string): Promise<unknown> {
  return apiFetch(appToken, '/events/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  });
}

let cachedPublicKey: string | null = null;

/** Fetch and cache Kick's webhook signing public key. */
export async function getKickPublicKey(): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey;
  const res = await fetch(`${config.kick.apiBase}/public-key`);
  if (!res.ok) throw new Error(`Failed to fetch Kick public key: ${res.status}`);
  const body = (await res.json()) as { data?: { public_key?: string }; public_key?: string };
  const key = body?.data?.public_key ?? body?.public_key;
  if (!key) throw new Error('Kick public key missing in response');
  cachedPublicKey = key;
  return key;
}

/** Verify a webhook signature over `${messageId}.${timestamp}.${rawBody}`. */
export async function verifyWebhookSignature(input: {
  messageId: string;
  timestamp: string;
  signature: string;
  rawBody: string;
}): Promise<boolean> {
  const publicKey = await getKickPublicKey();
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${input.messageId}.${input.timestamp}.${input.rawBody}`);
  verifier.end();
  return verifier.verify(publicKey, Buffer.from(input.signature, 'base64'));
}
