export interface User {
  id: string;
  channel_id: string | null;
  username: string | null;
  scopes: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface Token {
  id: string;
  user_id: string;
  hash: string;
  label: string;
  permissions: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export interface Subscription {
  id: string;
  user_id: string;
  event_name: string;
  version: number;
  created_at: number;
}

export interface OAuthFlow {
  state: string;
  code_verifier: string;
  scopes: string;
  created_at: number;
}

/** Event pushed to WebSocket clients. */
export interface StreamEvent {
  id: string | null;
  type: string;
  version: number;
  timestamp: string | null;
  data: unknown;
}
