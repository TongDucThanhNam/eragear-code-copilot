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

### User profile (for UI)
Use the `auth.getMe` tRPC query to fetch the user profile
associated with the API key. This is used by the sidebar NavUser UI.

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

## Dynamic domains (Cloudflare Tunnel / reverse proxy)

If users host the server themselves and access it through a tunnel or
reverse proxy with a **dynamic domain**, the auth system can adapt at runtime.

### How it works
- The server derives the request origin from these headers (in order):
  - `Origin`
  - `X-Forwarded-Host` or `Host` + `X-Forwarded-Proto` (or `CF-Visitor`)
- When the origin matches the host (same-origin), it is **auto‑trusted**
  for `/api/auth/*` and `authConfig.baseURL` is updated on the fly.
- This allows arbitrary user domains without hardcoding `AUTH_BASE_URL`.

### Required proxy headers
Your tunnel/proxy **must** forward these headers for HTTPS to work correctly:
- `Host` (or `X-Forwarded-Host`)
- `X-Forwarded-Proto` = `https`
  - Cloudflare Tunnel also sends `CF-Visitor: {"scheme":"https"}`.

If these headers are missing, cookies may be set as non‑secure and login can fail.

### When you still need env config
Dynamic auto‑trust only covers **same‑origin** UI → API calls.  
If the UI and API are on **different origins**, set:

```
AUTH_BASE_URL=https://api.your-domain.tld
AUTH_TRUSTED_ORIGINS=https://app.your-domain.tld,https://api.your-domain.tld
```

### Recommended (tunnel) checklist
1) Open DevTools → Network → `/api/auth/sign-in/username`
2) Check response headers for `Set-Cookie`
3) Confirm request headers include `Origin`, `Host`, and `X-Forwarded-Proto`

## Troubleshooting

### Login fails
- Make sure the password has no leading/trailing whitespace.
- If the credentials file exists but login still fails, the DB may be out of sync:
  1) Stop the server.
  2) Delete `~/.config/Eragear/auth.sqlite` and `~/.config/Eragear/admin.credentials.json`.
  3) Start the server again to re-bootstrap credentials.
 - If using a tunnel/reverse proxy, verify forwarded headers and HTTPS scheme
   (see “Dynamic domains” section above).

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
