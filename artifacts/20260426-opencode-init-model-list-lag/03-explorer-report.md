---
artifact_type: explorer_report
session_id: 20260426-opencode-init-model-list-lag
task_id: T00
producer: team-explorer
status: ACTIVE
created_at: 2026-04-26
source_commit: UNKNOWN
based_on:
  - 00-brief.md
  - 01-triage-report.md
  - 02-vault-context.md
consumers:
  - team-architect
  - orchestrator
freshness_rule: invalid_if_brief_triage_or_repo_shape_changes
---
# Explorer Report

## Objective interpreted

Optimize OpenCode (ACP agent) initialization when the agent returns an extremely large model list (hundreds/thousands of entries). The lag is caused by **payload size amplification** and **duplicate data propagation** across the ACP → server runtime → session-state broadcast → client React state → model selector rendering pipeline. Strategy B (chosen by user in RUN-INDEX.md) calls for **capping/summarizing at the server/session-state boundary** while preserving current/default model and providing an explicit search/expand path.

## Entry paths

- **path:** `apps/server/src/modules/session/application/session-acp-bootstrap.service.ts` — `createNewSession()` (L426-449) and `loadExistingSession()` (L345-424)
  **why_it_matters:** This is where `conn.newSession()` / `conn.loadSession()` returns the massive payload. The `models` (`SessionModelState.availableModels[]`) and `configOptions` (`SessionConfigOption[]` containing model category with all values) are both stored onto `chatSession`. `syncSessionSelectionFromConfigOptions()` at L420/L444 immediately re-derives `models.availableModels` from `configOptions` model option — first duplication point.

- **path:** `apps/server/src/shared/utils/session-config-options.util.ts` — `syncSessionSelectionFromConfigOptions()` (L191-225)
  **why_it_matters:** Called in 5 server locations during bootstrap + ACP updates. Calls `deriveModelState()` (L167-189) which maps over **all model config-option values** via `collectConfigOptionValues()`, producing the full list into `target.models.availableModels`. This is the function that **copies the huge list from configOptions into models**, creating the dual-representation problem.

- **path:** `apps/server/src/modules/session/application/get-session-state.service.ts` — `execute()` (L58-104)
  **why_it_matters:** Returns **both** `session.models` (with `availableModels[]`) and `session.configOptions` (with model options repeated) in the same response (L64-67). Every tRPC `getSessionState` carries the full model list twice.

- **path:** `apps/server/src/platform/acp/update.ts` — `handleConfigOptionsUpdate()` (L513-596)
  **why_it_matters:** ACP `config_option_update` event sets `session.configOptions` (L542) and calls `syncSessionSelectionFromConfigOptions()` (L546), then broadcasts **both** `config_options_update` (full array) and potentially `current_model_update` (L587-592). Both broadcast types carry the full model list to all connected clients on every config change.

- **path:** `apps/web/src/hooks/use-chat-session-state-sync.ts` — `applySessionState()` (L182-263) and the `useEffect` hydration (L374-440)
  **why_it_matters:** On initial connect, the tRPC response (containing both `models` and `configOptions`) flows through `applySessionState()` which calls **both** `setModels()` and `setConfigOptions()` — both large arrays land in separate React state atoms.

- **path:** `packages/shared/src/chat/use-chat-core.ts` — `applySessionState()` (L975-1063) and `handleConfigOptionsUpdate()` (L860-877)
  **why_it_matters:** `applySessionState()` (L1013-1027) re-runs `resolveSessionSelectionState()` on the full data, calls `onModelsChange()` and `onConfigOptionsChange()` — the client then holds the full list in two places. `handleConfigOptionsUpdate()` (L865-876) again re-derives models from configOptions.

- **path:** `apps/web/src/components/chat-ui/chat-interface.tsx` — `selectionState` derivation (L364-372), `availableModels` derivation (L396-418)
  **why_it_matters:** Despite server and sync having already done the derivation, `chat-interface.tsx` calls `resolveSessionSelectionState({ configOptions, modes, models })` a **third time** at L364-372, and then maps over the full `availableModels` array at L396-418. This creates a third large mapped array passed to `ChatInput`.

- **path:** `apps/web/src/components/chat-ui/chat-input.tsx` — `modelsWithDetails` (L184-198), `fullFilteredGroups` (L219-241), `renderedModelGroups` (L244-307)
  **why_it_matters:** The existing prior mitigation caps **rendering** to 50 items (`MODEL_SELECTOR_SEARCH_LIMIT`). However, `modelsWithDetails` (L184) maps the **entire** `availableModels` array O(N). `fullFilteredGroups` (L219-241) iterates the full grouped dataset O(N). Only `renderedModelGroups` (L244) achieves the 50-item cap. The previous fix addressed cmdk/rendering lag but **not** the init-time payload and state duplication lag.

## Relevant files and modules

### Server-side (data origin and amplification)

- **path:** `apps/server/src/modules/session/application/session-acp-bootstrap.service.ts`
  **role:** Entry point for ACP session initialization; where massive model list first enters system
  **confidence:** HIGH
  Lines/areas of interest:
  - L237-248: `initializeConnection()` — agent capabilities/initialize payload
  - L345-424: `loadExistingSession()` — stores `loadResult.models`, `loadResult.configOptions`, calls `syncSessionSelectionFromConfigOptions`
  - L426-449: `createNewSession()` — stores `newResult.models`, `newResult.configOptions`, calls `syncSessionSelectionFromConfigOptions`
  - L451-545: `applyDefaultModel()` — iterates `chatSession.models.availableModels` for `find()` match (L481-484); if default model is in capped list, match fails
  - L320-343: `broadcastSelectionSnapshots()` — broadcasts `current_model_update` after bootstrap

- **path:** `apps/server/src/shared/utils/session-config-options.util.ts`
  **role:** Core server utility that derives `models.availableModels` from `configOptions` — primary duplication engine
  **confidence:** HIGH
  - L56-96: `collectConfigOptionValues()` — flattens config option tree into array; iterates all nested options
  - L167-189: `deriveModelState()` — maps collected values into `SessionModelState.availableModels`
  - L191-225: `syncSessionSelectionFromConfigOptions()` — orchestrates derivation, mutates `target.models` with full list

- **path:** `apps/server/src/modules/session/application/get-session-state.service.ts`
  **role:** tRPC endpoint returning full session state to client on connect
  **confidence:** HIGH
  - L58-76: `execute()` — returns `models` + `configOptions` (both may contain large model arrays)

- **path:** `apps/server/src/platform/acp/update.ts`
  **role:** Handles ACP streaming updates including config option changes
  **confidence:** HIGH
  - L513-596: `handleConfigOptionsUpdate()` — receives full config options from agent, stores, re-derives models, broadcasts both

- **path:** `apps/server/src/modules/ai/application/set-model.service.ts`
  **role:** Validates and executes model switch via ACP `unstable_setSessionModel`
  **confidence:** HIGH
  - L131-170: `getRuntimeForModelSwitch()` — validates modelId exists in config options values (L147) or `availableModels` (L161). **Risk**: if capping removes the target model, validation fails.
  - L172-204: `isCurrentModel()` — same validation concern

- **path:** `apps/server/src/modules/ai/application/set-config-option.service.ts`
  **role:** Validates and executes config option changes (including model options)
  **confidence:** HIGH
  - L113-134: Validates that the target value exists in `collectConfigOptionValues(targetOption)` (L127-128). **Risk**: if capping removes the target value, this validation fails.

### Client-side (state/render consumption)

- **path:** `apps/web/src/hooks/use-chat-session-state-sync.ts`
  **role:** Applies server session state to React state on connect/backfill
  **confidence:** HIGH
  - L182-263: `restoreSessionState()` — applies full `models` and `configOptions` into React state
  - L374-440: hydration effect — conditional restore on connect

- **path:** `apps/web/src/hooks/use-chat-session-event-handler.ts`
  **role:** Processes ACP broadcast events on client side
  **confidence:** HIGH
  - L515-521: calls `processSessionEvent` which dispatches `config_options_update` and `current_model_update`

- **path:** `packages/shared/src/chat/use-chat-core.ts`
  **role:** Shared client state machine for ACP event processing
  **confidence:** HIGH
  - L860-877: `handleConfigOptionsUpdate()` — client-side: calls `onConfigOptionsChange()` + re-derives models
  - L909-935: `handleCurrentModelUpdate()` — client-side model update handling
  - L975-1063: `applySessionState()` — initial state application, stores both arrays separately

- **path:** `apps/web/src/components/chat-ui/chat-interface.tsx`
  **role:** Top-level chat component, derives props for ChatInput
  **confidence:** HIGH
  - L364-372: `resolveSessionSelectionState()` — third derivation
  - L396-418: `availableModels` — full-array map (O(N) per render)

- **path:** `apps/web/src/components/chat-ui/chat-input.tsx`
  **role:** Model selector rendering component
  **confidence:** HIGH
  - L184-198: `modelsWithDetails` — maps all availableModels (O(N))
  - L219-241: `fullFilteredGroups` — filters full dataset (O(N))
  - L244-307: `renderedModelGroups` — caps to 50 items

- **path:** `apps/web/src/components/chat-ui/chat-input/shared.ts`
  **role:** Helper utilities for config option normalization
  **confidence:** MEDIUM
  - L67-84: `normalizeModelProviders()` — derives provider from model data
  - L176-217: `normalizeConfigOptions()` — iterates all config option values

### Session config option validation chain

- **path:** `apps/server/src/modules/ai/application/set-config-option.service.ts`
  **role:** Server-side validation for config option changes via ACP
  **confidence:** HIGH
  - L127-128: `collectConfigOptionValues(targetOption).has(value)` — validates value against **uncapped** options. If capping removes valid values, this rejects legitimate model switches.

- **path:** `apps/server/src/modules/ai/application/set-model.service.ts`
  **role:** Server-side validation for model switches
  **confidence:** HIGH
  - L147: `hasSessionConfigOptionValue({ option: modelOption, value: modelId })` — same validation concern
  - L161: `session.models.availableModels.some(model => model.modelId === modelId)` — same validation concern

## Suspected change surface

Under Strategy B (cap at server/session-state boundary), the following are the recommended intervention points and their estimated scope:

### Primary server-side cap points (choose at least one):

1. **`syncSessionSelectionFromConfigOptions()` in `session-config-options.util.ts`** — Cap the `availableModels` array after `deriveModelState()` constructs it. This caps `models` but **not** `configOptions`, so configOptions retains the full list for validation/search.
   - **Function:** add a cap parameter or hard-cap at e.g., 100 items
   - **Must preserve:** `currentModelId` visibility in capped list
   - **Risk:** models go from large to small, configOptions stays large → payload still big

2. **`handleConfigOptionsUpdate()` in `platform/acp/update.ts` (L513-596)** — Cap the model option's `options` array in `session.configOptions` **before** broadcasting and before calling `syncSessionSelectionFromConfigOptions()`. This affects both broadcast payload and derived models.
   - **Must also update** `session.configOptions` in bootstrap (both new + load paths).
   - **+** In `session-acp-bootstrap.service.ts` — cap after `newResult.configOptions` / `loadResult.configOptions` assignment (L419, L443).
   - **Risk:** configOptions validation in `set-config-option.service.ts` (L127-128) blocks switching to models not in capped list.

3. **`get-session-state.service.ts` (L64-67)** — Cap `models` and `configOptions` at the tRPC response boundary.
   - **Lowest risk** for protocol compatibility — only affects REST payload, not internal validation.
   - **Drawback:** internal validation still uses full list, internal broadcasts still carry full list.

### Required companion changes:

4. **`set-config-option.service.ts`** — Validation (L127-128) must use **uncapped** source or the cap strategy must ensure all valid modelIds remain in the capped options. Options:
   - Keep full configOptions on server for validation, only cap for broadcast/persistence/state-return.
   - OR modify validation to allow values that were present in the original uncapped list even if now removed from capped list.

5. **`set-model.service.ts`** — Same validation concern (L147, L161). Must not break model switching to capped-out models.

6. **`session-acp-bootstrap.service.ts` `applyDefaultModel()` (L451-545)** — The `models.find()` at L481 will fail if the default model is not in the capped list. The default model **must be preserved** in the capped list.

### Client-side change scope:

7. **`chat-input.tsx`** — The full-array mapping in `modelsWithDetails` (L184) and `fullFilteredGroups` (L219) becomes safe after capping, but still happens. If server cap is aggressive (e.g., 100), client O(N) cost is negligible.

8. **`chat-interface.tsx` L396-418** — The full-array map also becomes safe.

### Optional search/expand path:

If Strategy B requires a way to browse the full model list:
9. New tRPC query (e.g., `session.listModels` or equivalent) that returns the full uncapped list on demand.
10. Client search to first search locally (capped) and if not found, offer "Search all models" button that fires the new query.

## Boundaries / files to avoid

- **Do NOT touch** `packages/shared/src/chat/event-schema.ts` or `packages/shared/src/chat/types.ts` — BroadcastEvent schema changes would break protocol compatibility.
- **Do NOT modify** any `ModelSelector*` component primitives in `apps/web/src/components/ai-elements/model-selector.tsx` — these are thin wrappers already bounded by existing 50-item cap.
- **Do NOT change** the ACP SDK types or the `SessionConfigOption` ACP type alias — the full type is needed for protocol parsing; cap at application layer.
- **Do NOT modify** domain entities (`session.entity.ts`, `agent.entity.ts`, etc.) — they have no role in this data flow.
- **Do NOT change** persistence (JSON store, session repository) — we are optimizing runtime state, not stored data.
- **Do NOT modify** native client code in `apps/native/` — only server and web paths are in scope.

## Validation surface

### Commands for verifying existing behavior:

```bash
# Server type check
cd apps/server && bun run check-types

# Server tests closest to the affected code
cd apps/server && bun test src/modules/session/application/session-acp-bootstrap.service.test.ts
cd apps/server && bun test src/platform/acp/update.test.ts
cd apps/server && bun test src/modules/ai/application/set-model.service.test.ts
cd apps/server && bun test src/modules/ai/application/set-config-option.service.test.ts
cd apps/server && bun test src/modules/ai/application/set-mode.service.test.ts

# Shared package tests (event processing)
cd packages/shared && bun test src/chat/use-chat-core.test.ts
cd packages/shared && bun test src/chat/event-schema.test.ts

# Web type check and test
cd apps/web && bun run check-types
cd apps/web && bun test src/components/chat-ui/chat-input/shared.test.ts

# Full lint
bunx biome check
```

### Test targets for new cap logic:

| Target | File | Why |
|--------|------|-----|
| bootstrap model list cap | `session-acp-bootstrap.service.test.ts` | Verify capped models after newSession/loadSession; verify default model preserved |
| ACP update model list cap | `platform/acp/update.test.ts` | Verify configOptions broadcast payload is capped |
| state response cap | `get-session-state.service.test.ts` (need to create) | Verify tRPC response has capped arrays |
| set-model validation with capped list | `set-model.service.test.ts` | Verify switching to non-capped model still works |
| set-config-option validation | `set-config-option.service.test.ts` | Verify config option value validation with capped options |
| large-list rendering (new) | `chat-input.test.ts` or manual | Verify UI does not freeze with 1000+ models |
| search/browse cap UX | manual test | Verify "Showing X of Y models" UX and search expansion |

## Triage calibration

- **complexity_assessment:** HIGHER (triage said 68 — actual complexity is higher due to the double-representation between configOptions ↔ models and the multi-service validation chain)
- **risk_assessment:** MATCHED (triage said 72 — correct; the validation chain risk is real but manageable with proper preservation of currentModelId)
- **suggested_executor:** team-heavy
  **rationale:** The change surface spans 6+ server files and 3 client files with non-trivial validation dependencies. A `team-builder` change (single file) would miss the server-side payload and state duplication root cause, which is essential for Strategy B. The capping logic must be coordinated across bootstrap, update, state retrieval, and validation services.

## Risks / unknowns

1. **Current model preservation** — The current/default model MUST remain in the capped list. `applyDefaultModel()` at session-acp-bootstrap.service.ts L481 does a `models.find()` which will fail silently (log warning only) if the default model is capped out. This is acceptable only if the cap logic explicitly preserves the current/default model.

2. **Set-model validation breakage** — `set-model.service.ts` L147 validates `hasSessionConfigOptionValue()` against the config option values. If we cap the options, switching to a model outside the capped set will be rejected server-side. **Mitigation:** keep the full configOptions for server-side validation, only cap for broadcast/persistence/state.

3. **Set-config-option validation breakage** — `set-config-option.service.ts` L127-128 does the same validation. Same mitigation applies.

4. **Search/browse semantics** — If the server-capped list only contains 100 models, client-side search cannot find models beyond that even if the agent has them. The user's choice (Strategy B) accepts this tradeoff but requires an explicit expansion path. **Unknown:** whether the expansion path should be a new tRPC query or an ACP-level re-fetch.

5. **ACP `config_option_update` re-reduction** — If OpenCode pushes a `config_option_update` event with the full list after bootstrap, the cap must be re-applied in `handleConfigOptionsUpdate()`. Otherwise the full list re-enters state.

6. **Broadcast amplification** — The `config_options_update` broadcast currently carries the **full** configOptions array. Even with a single-value change, the entire array is re-sent. This is separate from the model list issue but compounds it. Consider diff-based updates as a future optimization.

7. **Event buffer replay** — The session runtime store retains `messageBuffer` (history for reconnecting clients). If capped data is broadcast, reconnecting clients get the capped version. This is acceptable under Strategy B.

8. **Persistence of metadata** — `updateSessionConfigOptionCurrentValue` and `sessionRepo.updateMetadata` at platform/acp/update.ts L559-561 persist modeId/modelId. These are unaffected by list capping.

## Blockers

- **none** — User decision (Strategy B) is resolved per RUN-INDEX.md line 16-18. No further decision gate needed before architect can proceed.
