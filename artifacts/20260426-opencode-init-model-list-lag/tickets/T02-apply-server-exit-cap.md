---
artifact_type: ticket
session_id: 20260426-opencode-init-model-list-lag
task_id: T02
producer: team-architect
status: ACTIVE
created_at: 2026-04-26
consumers:
  - team-heavy
depends_on:
  - T01
---

# T02 — Apply Cap at Server Exit Points

## Title

Apply Cap at Server Exit Points

## Objective

Apply `capModelList()` at the two server exit points where model/config-option lists are sent to clients: the `getSessionState` tRPC response and the `config_options_update` ACP broadcast. Keep `session.configOptions` and `session.models.availableModels` uncapped internally.

## Depends On

**T01** — Cap Model List Utility (must be merged first).

## Scope / Allowed Files

| File | Action |
|------|--------|
| `apps/server/src/modules/session/application/get-session-state.service.ts` | Apply `capModelList()` before returning tRPC response |
| `apps/server/src/platform/acp/update.ts` | Apply `capModelList()` on `config_options_update` before broadcast |
| `apps/server/src/platform/acp/update.test.ts` | Add/update tests for capped config_options_update |
| `apps/server/src/modules/session/application/__tests__/session-acp-bootstrap.service.test.ts` | Ensure existing tests pass after change |

**Do NOT modify:**
- `apps/server/src/shared/utils/session-config-options.util.ts` (created by T01)
- `apps/server/src/config/constants.ts` (created by T01)
- Any `set-model` or `set-config-option` service files
- Any bootstrap service files (except test)
- `packages/shared/**`
- `apps/web/**`

## Requirements

### 1. `get-session-state.service.ts`

In the method that builds the `getSessionState` response:
- Import `capModelList` from `~/shared/utils/session-config-options.util.ts`.
- Import `DEFAULT_MAX_VISIBLE_MODEL_COUNT` from `~/config/constants.ts`.
- Before returning the session state to the tRPC caller, wrap the model/config-option lists through `capModelList()`.
- The **server-side session object** (`session.models`, `session.configOptions`) must **not** be mutated.
- Pass `currentModelId` (from session's current model) to `capModelList` so the current model is preserved in the capped output.

Pseudocode:
```typescript
const capped = capModelList({
  models: session.models?.availableModels,
  configOptions: session.configOptions,
  currentModelId: session.currentModelId,
  maxVisible: DEFAULT_MAX_VISIBLE_MODEL_COUNT,
});

return {
  ...rest,
  models: { ...session.models, availableModels: capped.models },
  configOptions: capped.configOptions,
};
```

### 2. `apps/server/src/platform/acp/update.ts`

In the handler that processes `config_options_update` events from the ACP:
- Import `capModelList` and `DEFAULT_MAX_VISIBLE_MODEL_COUNT`.
- Apply `capModelList()` to the config options **before** broadcasting to UI clients via WebSocket.
- The ACP-internal representation must **not** be capped — only the broadcast copy.
- Apply the same cap to model list updates if broadcast here.

### 3. Tests

- Update `update.test.ts` to verify that `config_options_update` broadcasts are capped.
- Ensure `session-acp-bootstrap.service.test.ts` still passes.

## Invariants

- `session.configOptions` remains uncapped on the server session object.
- `session.models.availableModels` remains uncapped on the server session object.
- Current model is preserved in all capped outputs.
- `set-model` and `set-config-option` validation continues to work against uncapped internal state.
- Existing tests for `set-model`, `set-config-option`, bootstrap service, and ACP update all pass.

## Acceptance Criteria

1. `getSessionState` tRPC response returns **capped** models and configOptions (max 100 each).
2. `config_options_update` ACP broadcast sends **capped** configOptions/models to UI clients.
3. Server `session` object is **not mutated** — internal state stays uncapped.
4. Current model is preserved in all capped outputs.
5. All existing tests pass:
   - `cd apps/server && bun test src/platform/acp/update.test.ts`
   - `cd apps/server && bun test src/modules/session/application/__tests__/session-acp-bootstrap.service.test.ts`
   - Full test suite: `cd apps/server && bun test`
6. Server typecheck passes: `cd apps/server && bun run check-types`.
7. Biome checks pass on modified files.

## Validation Commands

```bash
# Typecheck
cd apps/server && bun run check-types

# Targeted tests
cd apps/server && bun test src/platform/acp/update.test.ts
cd apps/server && bun test src/modules/session/application/__tests__/session-acp-bootstrap.service.test.ts

# Full test suite
cd apps/server && bun test

# Lint
cd apps/server && bunx biome check src/modules/session/application/get-session-state.service.ts src/platform/acp/update.ts src/platform/acp/update.test.ts
```

## Recommended Executor

team-heavy
