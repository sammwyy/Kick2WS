import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import type { OAuthFlow, Subscription, Token, User } from './types.js';

export const dbAbsolutePath = path.resolve(config.dbPath);
fs.mkdirSync(path.dirname(dbAbsolutePath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    channel_id     TEXT,
    username       TEXT,
    scopes         TEXT NOT NULL DEFAULT '',
    access_token   TEXT,
    refresh_token  TEXT,
    expires_at     INTEGER,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    hash         TEXT NOT NULL,
    label        TEXT NOT NULL DEFAULT '',
    permissions  TEXT NOT NULL DEFAULT '',
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at   INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    event_name  TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS oauth_flows (
    state         TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    scopes        TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
`);

type NewUser = Omit<User, 'created_at' | 'updated_at'>;

export function upsertUser(user: NewUser): User {
  const now = Date.now();
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(user.id);
  if (exists) {
    db.prepare(
      `UPDATE users SET channel_id=@channel_id, username=@username, scopes=@scopes,
        access_token=@access_token, refresh_token=@refresh_token, expires_at=@expires_at,
        updated_at=@updated_at WHERE id=@id`,
    ).run({ ...user, updated_at: now });
  } else {
    db.prepare(
      `INSERT INTO users (id, channel_id, username, scopes, access_token, refresh_token,
        expires_at, created_at, updated_at)
       VALUES (@id, @channel_id, @username, @scopes, @access_token, @refresh_token,
        @expires_at, @created_at, @updated_at)`,
    ).run({ ...user, created_at: now, updated_at: now });
  }
  return getUser(user.id) as User;
}

export function getUser(id: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function deleteUser(id: string): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function updateUserTokens(
  id: string,
  tokens: { access_token: string; refresh_token: string | null; expires_at: number },
): void {
  db.prepare(
    'UPDATE users SET access_token=?, refresh_token=?, expires_at=?, updated_at=? WHERE id=?',
  ).run(tokens.access_token, tokens.refresh_token, tokens.expires_at, Date.now(), id);
}

export function insertToken(
  token: Omit<Token, 'created_at' | 'last_used_at' | 'revoked_at'>,
): void {
  db.prepare(
    `INSERT INTO tokens (id, user_id, hash, label, permissions, created_at)
     VALUES (@id, @user_id, @hash, @label, @permissions, @created_at)`,
  ).run({ ...token, created_at: Date.now() });
}

export function getTokenById(id: string): Token | undefined {
  return db.prepare('SELECT * FROM tokens WHERE id = ?').get(id) as Token | undefined;
}

export function listTokensForUser(userId: string): Token[] {
  return db
    .prepare('SELECT * FROM tokens WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Token[];
}

export function revokeToken(id: string): void {
  db.prepare('UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(
    Date.now(),
    id,
  );
}

export function touchToken(id: string): void {
  db.prepare('UPDATE tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), id);
}

export function insertSubscription(sub: Omit<Subscription, 'created_at'>): void {
  db.prepare(
    `INSERT OR REPLACE INTO subscriptions (id, user_id, event_name, version, created_at)
     VALUES (@id, @user_id, @event_name, @version, @created_at)`,
  ).run({ ...sub, created_at: Date.now() });
}

export function listSubscriptions(userId: string): Subscription[] {
  return db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').all(userId) as Subscription[];
}

export function deleteSubscriptionsForUser(userId: string): void {
  db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(userId);
}

export function findChannelBySubscription(subscriptionId: string): string | null {
  const row = db
    .prepare(
      `SELECT u.channel_id AS channel_id FROM subscriptions s
       JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(subscriptionId) as { channel_id: string | null } | undefined;
  return row?.channel_id ?? null;
}

export function saveOAuthFlow(flow: Omit<OAuthFlow, 'created_at'>): void {
  db.prepare(
    'INSERT OR REPLACE INTO oauth_flows (state, code_verifier, scopes, created_at) VALUES (?, ?, ?, ?)',
  ).run(flow.state, flow.code_verifier, flow.scopes, Date.now());
}

export function takeOAuthFlow(state: string): OAuthFlow | undefined {
  const row = db.prepare('SELECT * FROM oauth_flows WHERE state = ?').get(state) as
    | OAuthFlow
    | undefined;
  if (row) db.prepare('DELETE FROM oauth_flows WHERE state = ?').run(state);
  return row;
}

export function gcOAuthFlows(): void {
  db.prepare('DELETE FROM oauth_flows WHERE created_at < ?').run(Date.now() - 10 * 60 * 1000);
}

/** Row counts and resolved path, for the startup log and /api/debug. */
export function dbStats(): {
  path: string;
  users: number;
  tokens: number;
  subscriptions: number;
} {
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return {
    path: dbAbsolutePath,
    users: count('users'),
    tokens: count('tokens'),
    subscriptions: count('subscriptions'),
  };
}
