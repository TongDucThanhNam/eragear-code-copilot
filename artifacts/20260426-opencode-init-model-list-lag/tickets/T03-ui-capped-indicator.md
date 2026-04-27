---
artifact_type: ticket
session_id: 20260426-opencode-init-model-list-lag
task_id: T03
producer: team-architect
status: ACTIVE
created_at: 2026-04-26
consumers:
  - team-builder
---

# T03 — UI Explicit About Capped Model List

## Title

UI Explicit About Capped Model List

## Objective

Add a subtle indicator in the chat input component when the received `availableModels` list length is ≥ 100, informing the user that the list is capped and suggesting they use search to find more models. No server roundtrip, no protocol changes, additive only.

## Scope / Allowed Files

| File | Action |
|------|--------|
| `apps/web/src/components/chat-ui/chat-input.tsx` | Add capped-list indicator |
| `apps/web/src/components/chat-ui/chat-interface.tsx` | Only if strictly necessary to pass data |

**Do NOT modify:**
- Any server files
- `packages/shared/**`
- Protocol / API definitions

## Requirements

### 1. Constant

Define within `chat-input.tsx` (or a nearby constants file if one already exists):

```typescript
/** Server-side cap for model list sent to clients. Must match DEFAULT_MAX_VISIBLE_MODEL_COUNT in apps/server/src/config/constants.ts */
const MODEL_LIST_SERVER_CAP = 100;
```

### 2. Indicator

When `availableModels.length >= MODEL_LIST_SERVER_CAP`:
- Display a subtle, non-intrusive indicator near the model selector.
- Suggested text: `"Showing top 100 models. Search to find more."`
- Use `aria-live="polite"` for accessibility.
- The indicator should not interfere with model selection behavior.

When `availableModels.length < MODEL_LIST_SERVER_CAP`:
- The indicator must be hidden.

### 3. Additive Only

- No changes to existing component behavior or layout beyond adding the indicator.
- No new server roundtrips.
- No protocol/schema changes.
- No changes to the model selector dropdown logic.

## Acceptance Criteria

1. **Indicator appears** when the model list has ≥ 100 entries.
2. **Indicator hidden** when the model list has < 100 entries.
3. **Selector behavior unchanged**: model selection, search, and dropdown continue to work as before.
4. **Web typecheck passes**: `cd apps/web && bun run check-types`.
5. **Biome check passes** on modified files.
6. **Optional**: visual/manual verification in the browser.
7. **Optional**: add a simple component test for the indicator visibility.

## Validation Commands

```bash
cd apps/web && bun run check-types
cd apps/web && bunx biome check src/components/chat-ui/chat-input.tsx
```

## Recommended Executor

team-builder
