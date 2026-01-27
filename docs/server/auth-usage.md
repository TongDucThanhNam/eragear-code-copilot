# Auth Usage (Dashboard + API + Client)

This doc explains how authentication works for the server dashboard and for
external clients connecting over WebSocket or HTTP.

## Quick start

1) Start the server
```
cd apps/server
bun run dev
```

2) Open the dashboard and log in
- Visit `http://<host>:<port>/` (redirects to `/login`).
- If this is the first run and you did not set `AUTH_ADMIN_PASSWORD`, read:
  - `~/.config/Eragear/admin.credentials.json`
  - or `$XDG_CONFIG_HOME/Eragear/admin.credentials.json`
- Use the `username` and `password` values from that file.

3) Create an API key
- Dashboard → Auth tab → Create Key
- Copy the key (shown once) and store it securely.

## Connection requirements

The client must satisfy two checks before it can use the server:

1) **Server health**
- Health endpoint: `GET /api/health`
- Expected response: `200 { "ok": true, "ts": <number> }`

2) **Access check (API key)**
- Verify endpoint: `POST /api/auth/api-key/verify`
- Body: `{ "key": "<api_key>" }`
- Expected response: `{ valid: true, key: { userId: "...", ... } }`

## Client auth usage

### WebSocket (browser)
The client sends the API key via tRPC WebSocket `connectionParams`:

```
connectionParams: { apiKey: "<api_key>" }
```

WebSocket URL:
```
ws://<host>:<port>
```

### HTTP (non-browser)
Either header is accepted:
```
x-api-key: <key>
Authorization: Bearer <key>
```

## Admin endpoints (dashboard only)
These endpoints require a logged-in dashboard session (cookie-based):

```
GET    /api/admin/api-keys
POST   /api/admin/api-keys
DELETE /api/admin/api-keys
GET    /api/admin/device-sessions
POST   /api/admin/device-sessions/revoke
POST   /api/admin/device-sessions/activate
```

## Troubleshooting

### Login fails
- Make sure the password has no leading/trailing whitespace.
- If the credentials file exists but login still fails, the DB may be out of sync:
  1) Stop the server.
  2) Delete `~/.config/Eragear/auth.sqlite` and `~/.config/Eragear/admin.credentials.json`.
  3) Start the server again to re-bootstrap credentials.

### Health check CORS error
- If the client cannot call `/api/health`, verify CORS headers are present.
- The server should allow cross-origin requests to `/api/health`.

### API key verify fails
- Confirm the key format (starts with the configured prefix, default `eg_`).
- Ensure the key is not revoked (create a new one in the dashboard if unsure).

## API examples (curl)

List API keys:
```
curl -s http://localhost:3000/api/admin/api-keys \
  -H "Cookie: better-auth.session-token=<cookie>"
```

Create API key:
```
curl -s http://localhost:3000/api/admin/api-keys \
  -H "Content-Type: application/json" \
  -H "Cookie: better-auth.session-token=<cookie>" \
  -d '{"name":"Default","prefix":"eg_","expiresIn":2592000}'
```

Revoke API key:
```
curl -s http://localhost:3000/api/admin/api-keys \
  -X DELETE \
  -H "Content-Type: application/json" \
  -H "Cookie: better-auth.session-token=<cookie>" \
  -d '{"id":"api_key_id"}'
```

List device sessions:
```
curl -s http://localhost:3000/api/admin/device-sessions \
  -H "Cookie: better-auth.session-token=<cookie>"
```

Revoke a device session:
```
curl -s http://localhost:3000/api/admin/device-sessions/revoke \
  -H "Content-Type: application/json" \
  -H "Cookie: better-auth.session-token=<cookie>" \
  -d '{"sessionToken":"session_token"}'
```

Set active session:
```
curl -s http://localhost:3000/api/admin/device-sessions/activate \
  -H "Content-Type: application/json" \
  -H "Cookie: better-auth.session-token=<cookie>" \
  -d '{"sessionToken":"session_token"}'
```
