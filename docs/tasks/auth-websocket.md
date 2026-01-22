# WebSocket auth enforcement via better-auth

## Goal
- [ ] Require `better-auth` checks before allowing users to subscribe to the tRPC/WebSocket endpoints so only authenticated users can open sessions.

## 1) Scope
- [ ] Identify current WS entry points (apps/web, apps/native, tRPC WebSocket server) and where auth is currently evaluated.
- [ ] Understand `better-auth` integration points (middleware, hooks) used elsewhere in the stack.

## 2) Pre-connection guard
- [ ] Add a `better-auth` middleware in the WebSocket handshake to verify tokens/session data before accepting the connection.
- [ ] If auth fails, reject the upgrade with a helpful status/message.
- [ ] Cache the auth result for the session lifetime to avoid repeated checks per event.

## 3) Post-auth enforcement
- [ ] Ensure ACL context flows to tRPC procedures (session list/create/subscribe) via session metadata.
- [ ] If the underlying request lacks valid auth, tear down the WS with a clean error.
- [ ] Update client to detect auth errors and prompt re-login/refresh.

## 4) Testing
- [ ] Simulate connection attempts with valid/invalid tokens to ensure guard works.
- [ ] Fuzz token expiration/revocation to confirm WS disconnects appropriately.
- [ ] Document steps for troubleshooting when auth fails during WS init.
