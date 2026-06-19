# ACP Native `turnId` Migration Plan

## Status

- `server`: repo-side migration scaffold is implemented.
- `web`: strict event filtering already consumes explicit `turnId` when present.
- `upstream ACP`: still blocked. Stable public ACP docs and `@agentclientprotocol/sdk@0.15.0` do not expose native `turnId` on `SessionUpdate` today.

## Goal

Move ACP turn correlation off `_meta` fallback and onto a first-class upstream `turnId` field without reopening stale-turn races, replay leaks, or permission mis-correlation.

Success criteria:

- live turn-scoped ACP ingress is resolved from one canonical server path
- strict fail-closed mode exists before fallback removal
- ops can see native-vs-meta usage and drop reasons in one dashboard snapshot
- deleting `_meta` fallback later is a small diff, not another refactor

## Issue Plan

### Issue 1: Canonical Turn-ID Resolver

Status: done

- Native-first resolver is centralized in `src/platform/acp/update-turn-id.ts`.
- `SessionUpdateContext` now carries `turnIdResolution` so downstream handlers stop re-parsing `_meta`.

Acceptance:

- no live ACP update handler re-implements `turnId` parsing
- resolver reports `native`, `meta`, or `missing`

### Issue 2: Strict Turn-ID Policy Switch

Status: done

- Added `ACP_TURN_ID_POLICY` with:
  - `compat` (default)
  - `require-native`
- In strict mode, live turn-scoped ACP updates without native `turnId` are dropped.

Acceptance:

- invalid policy values fail fast at boot
- strict mode blocks meta-only live updates before they mutate runtime state

### Issue 3: Permission Request Correlation

Status: done

- Permission requests now use the same resolver and telemetry path as session updates.
- Late or mismatched permission requests are cancelled instead of entering pending state.

Acceptance:

- stale permission requests never create `pendingPermissions` entries
- strict mode cancels meta-only permission ingress

### Issue 4: Migration Observability

Status: done

- Added counters for:
  - native resolution
  - meta fallback
  - missing turn id
  - strict-policy drops
  - stale-turn drops
  - late-after-stop drops
- Snapshot is exposed from `/api/dashboard/observability`.

Acceptance:

- one ops snapshot shows policy + counters
- test coverage exists for the snapshot contract

### Issue 5: SDK Version Alignment

Status: done

- Workspace ACP SDK versions are aligned to `0.15.0` in:
  - `apps/server`
  - `apps/web`
  - `apps/native`

Acceptance:

- no workspace ACP version skew
- lockfile resolves cleanly

### Issue 6: Delete `_meta` Fallback

Status: blocked by upstream

This issue does **not** happen until ACP upstream ships native `turnId` on the relevant payloads.

Required upstream scope:

- `SessionUpdate` native `turnId`
- permission/tool envelopes native `turnId`
- documented invariant for replay vs live payloads

Delete plan when upstream lands:

1. keep `ACP_TURN_ID_POLICY=require-native` in staging until meta fallback usage is zero
2. remove `_meta` parsing in `src/platform/acp/update-turn-id.ts`
3. delete compatibility tests
4. make missing native `turnId` a permanent hard drop for live turn-scoped ingress

## Rollout

### Phase 1: Dual Read

- Run with `ACP_TURN_ID_POLICY=compat`.
- Monitor `acp.turnIdMigration`.
- Expect current ACP traffic to resolve mostly through `metaFallback`.

### Phase 2: Upstream Validation

- Upgrade agents/server boundary to the ACP release that includes native `turnId`.
- Confirm `sessionUpdates.native` and `permissionRequests.native` rise while `metaFallback` drops.

### Phase 3: Strict Staging

- Set `ACP_TURN_ID_POLICY=require-native` in staging.
- Reject any live turn-scoped ingress that still depends on `_meta`.

### Phase 4: Fallback Deletion

- Remove `_meta` inference after fallback metrics stay at zero for a sustained window.

## Verification Commands

```bash
cd apps/server
bun run check-types
ALLOWED_AGENT_COMMAND_POLICIES='[{"command":"/usr/bin/env","allowAnyArgs":true}]' \
ALLOWED_TERMINAL_COMMAND_POLICIES='[{"command":"/usr/bin/env","allowAnyArgs":true}]' \
ALLOWED_ENV_KEYS='PATH,HOME,SHELL,USER,TMPDIR,TMP,TEMP' \
bun test src/platform/acp/update-turn-id.test.ts \
  src/platform/acp/permission.test.ts \
  src/platform/acp/update-stream.test.ts \
  src/platform/acp/update-plan.test.ts \
  src/platform/acp/update.test.ts \
  src/modules/ops/application/get-observability-snapshot.service.test.ts \
  src/config/environment.test.ts
```

## External References

- npmjs, `@agentclientprotocol/sdk`, https://www.npmjs.com/package/@agentclientprotocol/sdk, accessed 2026-03-06
- Agent Client Protocol, `Prompt Turn`, https://agentclientprotocol.com/protocol/prompt-turn, accessed 2026-03-06
- Agent Client Protocol, `Tool Calls`, https://agentclientprotocol.com/protocol/tool-calls, accessed 2026-03-06
