# Desktop Remote Connect

Remote Connect exposes the Electron-owned desktop runtime through a narrow
loopback bridge and, optionally, a Cloudflare Tunnel. The canonical runtime stays
inside `apps/desktop`: renderer -> preload -> Electron main -> private
`desktop-service` stdio/IPC -> local agent runtime. The bridge is only a network
edge owned by Electron main.

```text
Remote client
  -> Cloudflare Tunnel / Access
  -> 127.0.0.1:<remote-connect-port> bridge owned by Electron main
  -> DesktopRuntimeHost trusted local auth
  -> private desktop-service stdio/IPC
  -> AppUseCases / local Agent CLI
```

The package runtime is the product runtime for this flow; legacy app-hosted
runtime code must not be used as the product path.

## Security Model

Remote Connect is disabled by default. When enabled, the bridge:

- binds only to a loopback host (`127.0.0.1`, `localhost`, or `::1`).
- requires `ERAGEAR_REMOTE_CONNECT_TOKEN` with at least 32 characters.
- can additionally require Cloudflare Access service-token headers.
- never sends the desktop local auth token to the remote caller.
- converts successful remote bridge auth into the local trusted IPC auth inside
  Electron main.

For production remote use, put Cloudflare Access in front of the public tunnel
hostname and configure service-token credentials on both host and client.

## Host Configuration

Start the desktop app in normal `main-thread` mode and enable the bridge:

```powershell
$env:ERAGEAR_REMOTE_CONNECT_ENABLED='1'
$env:ERAGEAR_REMOTE_CONNECT_TOKEN='replace-with-at-least-32-random-chars'
$env:ERAGEAR_REMOTE_CONNECT_TUNNEL_MODE='quick'
bun run dev:desktop
```

The bridge listens on `127.0.0.1:<random-port>` by default. To pin the local
port:

```powershell
$env:ERAGEAR_REMOTE_CONNECT_PORT='47831'
```

Optional Cloudflare Access service-token enforcement:

```powershell
$env:ERAGEAR_REMOTE_CONNECT_CF_ACCESS_CLIENT_ID='...'
$env:ERAGEAR_REMOTE_CONNECT_CF_ACCESS_CLIENT_SECRET='...'
```

Optional CORS allowlist for browser-based clients:

```powershell
$env:ERAGEAR_REMOTE_CONNECT_ALLOWED_ORIGINS='https://app.example.com,https://team.example.com'
```

If omitted, the bridge returns `Access-Control-Allow-Origin: *` because it does
not use cookies. The bearer token and Cloudflare Access headers remain required
for protected endpoints.

## Tunnel Modes

### Off

```powershell
$env:ERAGEAR_REMOTE_CONNECT_TUNNEL_MODE='off'
```

Use this when another process or external service owns the tunnel.

### Quick Tunnel

```powershell
$env:ERAGEAR_REMOTE_CONNECT_TUNNEL_MODE='quick'
$env:ERAGEAR_CLOUDFLARED_PATH='cloudflared'
```

Electron main runs:

```text
cloudflared tunnel --url http://127.0.0.1:<port> --no-autoupdate
```

Quick tunnels produce a random `https://*.trycloudflare.com` URL and are for
development/testing only.

### Named Tunnel

```powershell
$env:ERAGEAR_REMOTE_CONNECT_TUNNEL_MODE='named'
$env:ERAGEAR_CLOUDFLARED_TUNNEL_TOKEN='replace-with-cloudflare-tunnel-token'
$env:ERAGEAR_REMOTE_CONNECT_PUBLIC_URL='https://eragear.example.com'
```

Electron main runs:

```text
cloudflared tunnel --no-autoupdate run --token <redacted>
```

Use named tunnels for stable production hostnames. Configure the public
hostname in Cloudflare to route to the bridge service URL.

## Client-Only Configuration

On another desktop client, connect to the host with the same Remote Connect
token:

```powershell
$env:ERAGEAR_DESKTOP_MODE='client-only'
$env:ERAGEAR_REMOTE_SERVER_URL='https://eragear.example.com'
$env:ERAGEAR_REMOTE_CONNECT_TOKEN='replace-with-host-token'
$env:ERAGEAR_REMOTE_CONNECT_CF_ACCESS_CLIENT_ID='...'
$env:ERAGEAR_REMOTE_CONNECT_CF_ACCESS_CLIENT_SECRET='...'
bun run dev:desktop
```

When `ERAGEAR_REMOTE_CONNECT_TOKEN` is present in `client-only` mode, the
renderer uses the `desktop-remote-connect` transport. It sends runtime
operations through:

- `POST /api/remote-connect/request`
- `POST /api/remote-connect/subscribe` as NDJSON streaming
- `GET /api/remote-connect/status`

The client does not use the legacy tRPC/WebSocket server path for this mode.

## Diagnostics

Electron preload exposes:

- `eragearDesktop.getRemoteConnectStatus()`
- `eragearDesktop.getBootstrap()` with `remoteConnect` status

Status includes bridge state, local URL, tunnel mode/state, discovered quick
tunnel URL, and non-secret messages. Tokens and tunnel credentials are never
reported in diagnostics.

## Notes

- `cloudflared` must be installed and available on `PATH`, or set
  `ERAGEAR_CLOUDFLARED_PATH`.
- Quick Tunnel may fail if a Cloudflare config file is present in the user
  `.cloudflared` directory; use a named tunnel for stable production setups.
- The bridge currently supports Cloudflare Access service tokens, not JWT
  verification. JWT support can be added at the same bridge auth boundary.
