# Kick2WS

**Turn Kick webhooks into a single authenticated WebSocket that any app can consume.**

Kick delivers channel events (follows, subs, gifts, chat, stream status) over HTTP
webhooks. That's great for servers, but painful for the things creators actually
want to wire up: overlays, games, bots, hardware, and tools that were never built
to receive inbound HTTP or verify signatures.

Kick2WS sits in the middle. You authorize your Kick channel **once**, and Kick2WS
issues tokens you can drop into any project. Each token opens an authenticated
WebSocket that streams your channel's live events in real time. No public
endpoints, no signature handling, no per-project OAuth.

```
Kick  ──webhook──▶  Kick2WS  ──WebSocket──▶  your overlay / game / bot / device
                       │
                       └── one OAuth, many revocable tokens
```

## Why

- **One OAuth for everything.** Connect Kick once and reuse it across every
  current and future project.
- **Seamless auth for clients.** Apps authenticate with a single opaque token.
  That's the entire integration.
- **Bring events to apps that don't support them.** Feed follows, subs and gifts
  into games, overlays or hardware that have no idea what a webhook is.
- **You stay in control.** Create scoped tokens, inspect them, revoke a leaked
  one, or regenerate with new permissions from a browser dashboard.

## Features

- Kick OAuth 2.1 with PKCE and per-login scope selection.
- Automatic webhook subscription creation on connect.
- Webhook authenticity verified against Kick's RSA public key.
- Opaque, revocable, database-backed tokens (only a hash is stored).
- Per-token event permissions (`*` or an explicit event allowlist).
- Authenticated WebSocket fan-out, scoped per channel.
- Built-in dashboard to manage identity, tokens and subscriptions.
- SQLite storage, zero external services. Ships as a single Docker image.

## Quick start (local)

Requirements: Node.js 22+ and [pnpm](https://pnpm.io).

```bash
pnpm install
cp .env.example .env      # then fill in your Kick credentials
pnpm dev
```

Open <http://localhost:3000> and click **Authorize with Kick**.

## Configuration

All configuration is via environment variables (see `.env.example`):

| Variable | Description |
| --- | --- |
| `PUBLIC_URL` | Public base URL. Must be HTTPS and reachable by Kick in production. |
| `PORT` | HTTP port (default `3000`). |
| `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` | Your Kick OAuth app credentials. |
| `KICK_DEFAULT_SCOPES` | Space-separated scopes requested by default. |
| `KICK_EVENTS` | Comma-separated `name:version` webhook events to subscribe to. |
| `APP_SECRET` | Secret used to sign dashboard session JWTs. |
| `DB_PATH` | SQLite file path (default `./data/kick2ws.db`). |
| `INSECURE_SKIP_WEBHOOK_VERIFY` | Set to `1` to skip signature checks. Local only. |

### Kick developer app setup

In your Kick developer settings, create an OAuth app and set:

- **Redirect URI**: `<PUBLIC_URL>/oauth/callback`
- **Webhook URL**: `<PUBLIC_URL>/webhook`

Then copy the client id and secret into your `.env`.

## Consuming events

Authenticate the WebSocket with a token generated in the dashboard. Any of these
work:

```js
// Query string
new WebSocket('wss://your-host/ws?token=k2ws_...');

// Or the Authorization header (non-browser clients)
// Authorization: Bearer k2ws_...

// Or a subprotocol: ['k2ws', 'k2ws_...']
```

Messages are JSON:

```jsonc
// On connect
{ "kind": "welcome", "channel_id": "12345", "permissions": "*", "subscribers": 1 }

// Per event
{
  "kind": "event",
  "type": "channel.followed",
  "version": 1,
  "id": "01J...",
  "timestamp": "2026-07-04T12:00:00Z",
  "data": { /* raw Kick event payload */ }
}
```

Send `ping` to receive `pong`; the server also sends WebSocket ping frames to
keep the connection healthy.

### HTTP API

The dashboard is powered by a small session-authenticated API:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/oauth/login?scopes=...` | Start the Kick OAuth flow. |
| `GET` | `/api/me` | Current identity, subscriptions and tokens. |
| `POST` | `/api/tokens` | Create a token (`{ label, permissions }`). |
| `DELETE` | `/api/tokens/:id` | Revoke a token. |
| `POST` | `/api/logout` | Destroy the session and revoke Kick subscriptions. |
| `POST` | `/webhook` | Kick webhook receiver (signature verified). |
| `GET` | `/healthz` | Health check. |

## Deployment

### Docker Compose (recommended)

```bash
cp .env.example .env    # set PUBLIC_URL to your public HTTPS URL and fill credentials
docker compose up -d --build
```

The SQLite database is stored in a named volume (`kick2ws-data`) so it survives
restarts and rebuilds.

### Docker

```bash
docker build -t kick2ws .
docker run -d --name kick2ws \
  --env-file .env \
  -p 3000:3000 \
  -v kick2ws-data:/data \
  kick2ws
```

### Behind a reverse proxy

Kick2WS speaks plain HTTP; terminate TLS at a proxy such as Caddy, Nginx or a
cloud load balancer, and make sure it forwards WebSocket upgrade headers for the
`/ws` path. Set `PUBLIC_URL` to the external HTTPS URL so OAuth redirects and the
webhook URL are generated correctly.

Example Caddyfile:

```
your-host.example.com {
    reverse_proxy localhost:3000
}
```

### From source

```bash
pnpm install
pnpm build
NODE_ENV=production pnpm start
```

## Debugging

Set `LOGS_ENABLED=1` to get verbose logs across the whole pipeline: webhook
receipt, signature verification, channel resolution, WebSocket connect/disconnect
and broadcast delivery (with per-channel client counts).

If events are not reaching your clients, the usual cause is a **channel id
mismatch**: the id stored at OAuth differs from the one in the webhook payload,
so the event lands on a channel with no subscribers. Log in and open
`GET /api/debug` (session-authenticated) to compare:

```jsonc
{
  "your_channel_id": "12345",
  "subscriptions": [ /* Kick subscriptions created for you */ ],
  "active_ws_channels": [ { "channelId": "12345", "clients": 1 } ]
}
```

If `your_channel_id` is not present in `active_ws_channels`, or a webhook log
shows `no clients for channel=<x>` with a different id, that is the mismatch.

## Security notes

- Tokens are shown **once** at creation. Only a SHA-256 hash is persisted, so a
  leaked database cannot be used to reconstruct tokens.
- Webhooks are rejected unless signed by Kick's published public key.
- Revoking a token or logging out takes effect immediately.
- Always run behind HTTPS in production and set a strong `APP_SECRET`.

## Development

```bash
pnpm dev         # watch mode
pnpm typecheck   # type check
pnpm lint        # Biome lint + format check
pnpm format      # apply formatting
```

## License

MIT
