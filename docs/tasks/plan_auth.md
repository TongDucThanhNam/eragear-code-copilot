# Auth Plan (Deferred)

Status: deferred. This document captures the agreed auth direction so we can implement later without re‑design.

## Goals
- One auth flow that works across Web, Tauri, and Mobile.
- No dependency on browser cookies for WS auth.
- tRPC WS and HTTP routes share the same user context.
- Minimal friction for future native clients.

## Decision: Token‑based Auth
- Use Better‑Auth to issue `accessToken` + `refreshToken` (or session token equivalent).
- Client includes token in WS handshake (query/header) and HTTP requests.
- Server verifies token in `createContext` and attaches `user` to context.

## Client Storage
- Web: memory + optional `localStorage` (decide at implementation time).
- Tauri: secure storage (OS keychain/credential store).
- Mobile: secure storage (Keychain/Keystore).

## WS Handshake Strategy
- Preferred: `Authorization: Bearer <token>` header if WS client supports headers.
- Fallback: `?token=<accessToken>` query param for environments that can’t set headers.
- Server should support both for flexibility.

## Refresh & Reconnect
- On WS unauthorized / token expiry:
  - Call refresh endpoint (HTTP) to obtain new tokens.
  - Reconnect WS with new token.
- Keep refresh logic shared across platforms.

## Server Touchpoints (Future Work)
- `apps/server/src/transport/trpc/context.ts`
  - Read token from WS connection (header/query) and HTTP request.
  - Verify via Better‑Auth.
  - Attach `user` to context.
- `apps/server/src/bootstrap/server.ts`
  - Pass request metadata to `createContext` for WS connections.

## Client Touchpoints (Future Work)
- `apps/web/src/lib/trpc.ts` (WS client + token injection).
- Tauri client: add token to WS handshake at connect time.
- Mobile client: same token injection as Tauri.

## Open Questions (To Resolve Later)
- Token lifetimes and rotation strategy.
- Whether to persist tokens in Web localStorage or memory‑only.
- Exact Better‑Auth API shape for verify/refresh.

