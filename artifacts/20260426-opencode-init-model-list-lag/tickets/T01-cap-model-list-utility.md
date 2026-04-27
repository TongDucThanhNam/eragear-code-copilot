---
artifact_type: ticket
session_id: 20260426-opencode-init-model-list-lag
task_id: T01
producer: team-architect
status: ACTIVE
created_at: 2026-04-26
consumers:
  - team-builder
---

# T01 — Cap Model List Utility

## Title

Cap Model List Utility

## Objective

Create a pure exported `capModelList()` function in `apps/server/src/shared/utils/session-config-options.util.ts` and define `DEFAULT_MAX_VISIBLE_MODEL_COUNT = 100` in `apps/server/src/config/constants.ts`, plus comprehensive unit tests.

## Scope / Allowed Files

| File | Action |
|------|--------|
| `apps/server/src/config/constants.ts` | Add `DEFAULT_MAX_VISIBLE_MODEL_COUNT = 100` |
| `apps/server/src/shared/utils/session-config-options.util.ts` | Add `capModelList()`, `CapModelListParams`, `CapModelListResult` |
| `apps/server/src/shared/utils/session-config-options.util.test.ts` | Create comprehensive unit tests |

**Do NOT modify any other files.**

## Requirements

### Constant (`apps/server/src/config/constants.ts`)
- Export `DEFAULT_MAX_VISIBLE_MODEL_COUNT` with value `100`.
- Add a JSDoc comment explaining the purpose: server-side cap for model/config-option lists sent to clients.

### Utility (`apps/server/src/shared/utils/session-config-options.util.ts`)

Export the following:

```typescript
export interface CapModelListParams {
  models?: ModelOption[] | null;
  configOptions?: ConfigOption[] | null;
  currentModelId?: string | null;
  maxVisible?: number; // defaults to DEFAULT_MAX_VISIBLE_MODEL_COUNT
}

export interface CapModelListResult {
  models: ModelOption[];
  configOptions: ConfigOption[];
  truncated: boolean;
  truncatedCount: number;
}
```

#### `capModelList(params: CapModelListParams): CapModelListResult`

Behavior:
1. Return a **capped copy** — never mutate the input arrays.
2. Preserve the **current/default model**: if `currentModelId` is set and the corresponding model is in the input list, it **must** appear in the output, even if it falls beyond the cap boundary. The current model replaces the last item in the capped list.
3. Preserve **config option `currentValue`**: for each `ConfigOption`, ensure the option whose value matches `currentValue` is retained in the capped output.
4. **Flatten grouped model options**: if `ModelOption` has nested groups, flatten them into a single flat list in the returned capped copy.
5. Handle **absent/null inputs**: if `models` is null/undefined, return empty array; same for `configOptions`.
6. Report truncation: set `truncated: true` and `truncatedCount` to the number of items dropped.
7. Cap is applied per-list: `models` capped to `maxVisible`, `configOptions` capped independently to `maxVisible`.

## Invariants

- No mutation of input arrays or objects.
- Current/default model always present in output (if present in input).
- Config option currentValue always present in output (if present in input).
- Flatten nested grouped model options in the returned capped copy.
- Handle absent/null inputs gracefully.
- Export `CapModelListParams` and `CapModelListResult` interfaces.

## Acceptance Criteria

1. **200 models → output 100, current at end included**: given 200 models with `currentModelId` set to the 150th model, output has 100 models with the current model at position 99 (last).
2. **Current in first 100**: given 200 models with `currentModelId` in the first 100, output has 100 models, no special repositioning needed.
3. **No current model**: given 200 models with no `currentModelId`, output has first 100 models, `truncated: true`, `truncatedCount: 100`.
4. **Null/undefined inputs**: `models: null` → `models: []`; `configOptions: null` → `configOptions: []`.
5. **Nested groups**: model options with nested `groups` are flattened.
6. **No model option unchanged**: if models is already ≤ max, return as-is (copy), `truncated: false`.
7. **Max larger than list**: no truncation, `truncated: false`, `truncatedCount: 0`.
8. **Max = 0**: documented behavior — returns empty arrays.
9. **Server typecheck**: `cd apps/server && bun run check-types` passes.
10. **Unit tests pass**: `cd apps/server && bun test src/shared/utils/session-config-options.util.test.ts`.
11. **Biome checks pass**: `cd apps/server && bunx biome check` on modified files.

## Validation Commands

```bash
cd apps/server && bun run check-types
cd apps/server && bun test src/shared/utils/session-config-options.util.test.ts
cd apps/server && bunx biome check src/shared/utils/session-config-options.util.ts src/shared/utils/session-config-options.util.test.ts src/config/constants.ts
```

## Recommended Executor

team-builder
