# ACP Architecture Implementation Check & Review

**Verdict: [BLOCK]**

> [!CAUTION]
> 3 S0 BLOCKERS + 4 S1 HIGHs + 5 S2 MEDs found. This code CANNOT ship.

## Executive Summary

1. **S0: Client-side UI reactivity is dead** — `useChat` stores messages in `useRef`, meaning streaming text/terminal output never triggers React re-renders.
2. **S0: `setModel` / `setMode` / `setConfigOption` have NO exclusive lock** — concurrent mutations can race and corrupt session state (mode/model desync).
3. **S0: `cancelPrompt` TOCTOU** — releases exclusive lock BEFORE calling `cancelPrompt()` on ACP agent. A concurrent `sendMessage` can acquire the lock and start a new prompt during the cancel window.
4. **S1: Input schemas allow empty `chatId`** — `z.string()` without `.min(1)` lets `""` pass validation, which will silently hit undefined behavior downstream.
5. **S1: `sendMessage` fire-and-forget prompt task** — The `.catch()` on `promptTask` swallows errors; if it rejects with non-`AiSessionRuntimeError`, the session stays in `submitted`/`streaming` forever (zombie turn).
6. **S1: `updateLegacyModeAndModelFromConfigOptions` direct mutation without broadcast** — After `setConfigOption`, `session.modes.currentModeId` and `session.models.currentModelId` are mutated in-place but never broadcast to connected clients, causing UI desync.
7. **S1: `sendMessage` returns `"submitted"` as `stopReason`** — This is NOT a valid ACP `StopReason`. `mapStopReasonToFinishReason("submitted")` likely falls through to a default/undefined, breaking the client-side `chat_finish` handler contract.

---

## Findings Table

| ID | Severity | Category | Location | Evidence | Impact |
|---|---|---|---|---|---|
| F1 | S0 | Correctness | [use-chat.ts:114](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/web/src/hooks/use-chat.ts#L114) | `const messages = getOrderedMessages(messageStateRef.current)` — ref mutation, no reactive subscription | Streaming text invisible to user until turn ends |
| F2 | S0 | Correctness | [use-chat.ts:115](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/web/src/hooks/use-chat.ts#L115) | `const terminalOutputs = terminalOutputsRef.current` | Terminal output invisible during stream |
| F3 | S0 | Concurrency | [set-model.service.ts:46](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/server/src/modules/ai/application/set-model.service.ts#L46) | `execute()` has no `runExclusive` wrapper | Concurrent model switches corrupt `session.models.currentModelId` |
| F4 | S0 | Concurrency | [set-mode.service.ts:46](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/server/src/modules/ai/application/set-mode.service.ts#L46) | `execute()` has no `runExclusive` wrapper | Concurrent mode switches corrupt `session.modes.currentModeId` |
| F5 | S0 | Concurrency | [set-config-option.service.ts:90](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/server/src/modules/ai/application/set-config-option.service.ts#L90) | `execute()` has no `runExclusive` wrapper | Concurrent config changes corrupt `session.configOptions` |
| F6 | S0 | Concurrency | [cancel-prompt.service.ts:55-56](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/server/src/modules/ai/application/cancel-prompt.service.ts#L55-L56) | Lock released at line 53, `cancelPrompt()` called at line 56 outside lock | TOCTOU: new prompt can start during cancel window |
| F7 | S1 | Correctness | [ai.contract.ts:74,89,94,99,105](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/server/src/modules/ai/application/contracts/ai.contract.ts#L74) | `chatId: z.string()` — no `.min(1)` | Empty string `""` bypasses all session lookups silently |
| F8 | S1 | Correctness | [send-message.service.ts:204-222](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/server/src/modules/ai/application/send-message.service.ts#L204-L222) | `.catch()` only logs, never transitions session out of busy state for non-`AiSessionRuntimeError` errors | Zombie turn: session stuck in `submitted`/`streaming` forever |
| F9 | S1 | Correctness | [set-config-option.service.ts:56-70](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/server/src/modules/ai/application/set-config-option.service.ts#L56-L70) | `session.modes.currentModeId = modeOption.currentValue` — direct mutation, no broadcast | Client UI shows stale mode/model after `setConfigOption` |
| F10 | S1 | Correctness | [send-message.service.ts:243](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/server/src/modules/ai/application/send-message.service.ts#L243) | `stopReason: "submitted"` is not a valid ACP StopReason | `mapStopReasonToFinishReason` may return undefined, breaking client `chat_finish` parsing |
| F11 | S2 | Security | [ai.contract.ts:91](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/server/src/modules/ai/application/contracts/ai.contract.ts#L91) | `modelId: z.string()` — no `.min(1)`, no `.max()` | Unbounded string, potential DoS vector on model lookup |
| F12 | S2 | Maintainability | [ai.ts:25-29](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/server/src/transport/trpc/routers/ai.ts#L25-L29) | `const service = ctx.aiServices.sendMessage()` — service factory called per-request | No evidence of singleton reuse; if factory allocates, this is a memory/perf concern |
| F13 | S2 | Correctness | [set-config-option.service.ts:200](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/server/src/modules/ai/application/set-config-option.service.ts#L200) | `return [];` after exhausting retries — silent empty return | Caller treats empty array as "use local fallback", masking total ACP failure |
| F14 | S2 | Correctness | [use-chat.ts:296-305](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/web/src/hooks/use-chat.ts#L296-L305) | Multiple `useEffect` calling `loadHistory()` — no abort/dedup guard visible | Potential double-fetch and UI tearing on rapid reconnect |
| F15 | S2 | Maintainability | [base.ts:42-46](file:///home/terasumi/Documents/source_code/Web/eragear-code-copilot/apps/server/src/transport/trpc/base.ts#L42-L46) | `protectedProcedure` only checks `ctx.auth` exists, no role/scope check | If multi-tenant or role-based access is ever needed, this is a ticking bomb |

---

## Deep Dive

### F3/F4/F5: Missing Exclusive Lock on `setModel`/`setMode`/`setConfigOption` (S0)

**Evidence:** Compare `sendMessage.service.ts` line 97 which correctly uses `this.sessionRuntime.runExclusive(input.chatId, async () => {...})` vs `setModel.service.ts` line 46 which calls `execute()` without any lock:

```typescript
// set-model.service.ts — NO LOCK
async execute(userId: string, chatId: string, modelId: string) {
  const aggregate = this.getRuntimeForModelSwitch(userId, chatId);
  const session = aggregate.raw;
  // ... reads session.models.currentModelId
  await this.sendModelSwitchWithRetry(chatId, session, modelId);
  aggregate.setCurrentModel(modelId); // WRITE without lock
}
```

**Race Timeline:**
1. User clicks Model A → `setModel("A")` starts, reads `currentModelId = "default"`, sends ACP request
2. User clicks Model B → `setModel("B")` starts concurrently, reads `currentModelId = "default"`, sends ACP request
3. Both ACP requests succeed
4. `setModel("A")` writes `currentModelId = "A"`
5. `setModel("B")` writes `currentModelId = "B"`
6. ACP agent actually applied model A last (response order), but server thinks it's B → **desync**

**Fix:** Wrap all three services' `execute()` in `sessionRuntime.runExclusive()`.

---

### F6: `cancelPrompt` TOCTOU (S0)

```typescript
// cancel-prompt.service.ts
async execute(userId: string, chatId: string) {
  const activeSession = await this.sessionRuntime.runExclusive(chatId, async () => {
    // ... marks cancelling
    return aggregate.raw;
  }); // <-- LOCK RELEASED HERE

  // ... UNLOCKED WINDOW ...
  await this.sessionGateway.cancelPrompt(activeSession); // <-- ACP call outside lock
}
```

During the unlocked window between lines 53-56, another `sendMessage` call can acquire the lock, see status as "cancelling", and either:
- Throw `PROMPT_BUSY` (best case)
- Or if `isBusyChatStatus("cancelling")` returns false (it should return true but depends on implementation), start a new prompt that immediately gets cancelled

**Fix:** The ACP cancel call must happen inside the lock, or use a separate cancel-specific flag that prevents re-entry.

---

### F7: Empty `chatId` Passes Validation (S1)

```typescript
// ai.contract.ts
export const SendMessageInputSchema = z.object({
  chatId: z.string(), // <-- NO .min(1)!
  text: z.string().max(MAX_MESSAGE_TEXT_CHARS),
});
```

An attacker (or buggy client) can send `chatId: ""`. Downstream, `requireAuthorizedRuntime({ chatId: "" })` will likely fail with a confusing "session not found" error instead of a clean 400 validation error.

**Fix:** `chatId: z.string().min(1)` across all 5 schemas.

---

### F8: Zombie Turn from Swallowed Errors (S1)

```typescript
// send-message.service.ts:204-222
const promptTask = this.promptTaskRunner
  .runPromptTask({...})
  .catch((error) => {
    // ONLY LOGS! Does NOT transition session status!
    this.logger.error("...", { chatId, turnId, error: errorText });
  });
```

If `runPromptTask` throws something that ISN'T caught internally (e.g., a raw `TypeError` from a null dereference), the `.catch()` at `send-message.service.ts:212` logs it but never calls `aggregate.markError()` or `aggregate.clearActiveTurnIf()`. The session stays forever in `submitted`/`streaming`.

Looking inside `prompt-task-runner.ts:133-191`, the `runPromptTask` method does have its own try/catch that handles `AiSessionRuntimeError` and generic errors, calling `markError` and `clearActiveTurnIf`. BUT: if `persistAssistantFallbackMessage` itself throws (e.g., DB connection failed), that exception propagates up to the `.catch()` in `send-message.service.ts` which only logs.

---

### F9: Silent Mode/Model Desync After `setConfigOption` (S1)

```typescript
// set-config-option.service.ts:56-70
function updateLegacyModeAndModelFromConfigOptions(session, configOptions) {
  const modeOption = configOptions.find((o) => o.category === "mode");
  if (modeOption && session.modes) {
    session.modes.currentModeId = modeOption.currentValue; // direct mutation
  }
  const modelOption = configOptions.find((o) => o.category === "model");
  if (modelOption && session.models) {
    session.models.currentModelId = modelOption.currentValue; // direct mutation
  }
}
```

This mutates `session.modes` and `session.models` in-place but never broadcasts `current_mode_update` or equivalent event. Connected clients will show the old mode/model until next page refresh or session state re-fetch.

---

## Todo Checklist

- [ ] **F1/F2**: Replace `useRef`-derived `messages`/`terminalOutputs` with reactive Zustand selectors (`useChatMessages(chatId)`, `useChatTerminalOutputs(chatId)`)
- [ ] **F3/F4/F5**: Wrap `SetModelService.execute()`, `SetModeService.execute()`, `SetConfigOptionService.execute()` in `sessionRuntime.runExclusive()`
- [ ] **F6**: Move `cancelPrompt()` ACP call inside the exclusive lock in `CancelPromptService`
- [ ] **F7**: Add `.min(1)` to `chatId` in all 5 input schemas (`SendMessageInputSchema`, `SetModelInputSchema`, `SetModeInputSchema`, `SetConfigOptionInputSchema`, `CancelPromptInputSchema`)
- [ ] **F8**: Add session status transition (`markError` + `clearActiveTurnIf`) in the outer `.catch()` of `sendMessage` prompt task
- [ ] **F9**: Broadcast mode/model changes after `updateLegacyModeAndModelFromConfigOptions` in `SetConfigOptionService`
- [ ] **F10**: Verify `mapStopReasonToFinishReason("submitted")` returns a valid value; if not, don't return a synthetic `stopReason` from `sendMessage`
- [ ] **F11**: Add `.min(1).max(256)` to `modelId` and `modeId` in input schemas
- [ ] **F12**: Verify `ctx.aiServices.sendMessage()` factory reuses service instances or is cheap to allocate
- [ ] **F13**: `sendConfigOptionWithRetry` returning `[]` on exhaustion should throw instead of silently returning
- [ ] **F14**: Confirm `useChatHistory` has abort/dedup logic for overlapping `loadHistory()` calls
- [ ] **F15**: Document that `protectedProcedure` has no role-based access; add TODO if multi-tenant is planned

## Codebase Search Requests (Required Verification)

1. `rg "mapStopReasonToFinishReason" apps/server/src/shared/utils` — verify what `"submitted"` maps to
2. `rg "isBusyChatStatus" apps/server/src/shared` — verify `"cancelling"` is treated as busy
3. `rg "export function useChatHistory" apps/web/src` — verify abort/dedup in history loading
4. `rg "setCurrentModel\|setCurrentMode" apps/server/src/modules/session/domain` — verify these methods are idempotent
5. `rg "sendMessage\(\)" apps/server/src` — verify factory allocation pattern for service instances
