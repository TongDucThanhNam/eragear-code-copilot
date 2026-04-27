---
artifact_type: explorer_report
session_id: 20260427-upgrade-supervisor-coding-orchestration
task_id: T00
producer: team-explorer
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: UNKNOWN
based_on:
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/00-brief.md
  - artifacts/20260427-upgrade-supervisor-coding-orchestration/01-triage-report.md
  - artifacts/20260427-supervisor-intent-timeline/validation/T01-validator-report.md
  - artifacts/20260427-supervisor-intent-timeline/learnings/T01-curator-learning.md
consumers:
  - team-architect
  - orchestrator
freshness_rule: invalid_if_brief_triage_or_repo_shape_changes
---
# Explorer Report

## Objective interpreted

Upgrade the Supervisor from a simple turn-scanner (4 control actions) into a generalized ACP coding orchestrator that:

1. Reads full multi-turn user intent via `userInstructionTimeline` (already done in T01).
2. Classifies worker/session state using a **finite semantic action space** (9 actions: `CONTINUE`, `APPROVE_GATE`, `CORRECT`, `REPLAN`, `DONE`, `ESCALATE`, `ABORT`, `SAVE_MEMORY`, `WAIT`).
3. Maps semantic actions to the existing external runtime control actions (`done`/`continue`/`needs_user`/`abort`) for backward compatibility.
4. Rewrites the system prompt into the new action-space format with few-shot examples.
5. Adds deterministic classifiers for common coding orchestration states (safe approval gate, done-without-verification, user-choice selection, memory recovery).
6. Makes memory persistence non-blocking, filters memory lookup errors from context, and adds optional `SAVE_MEMORY`.
7. Preserves all existing validation: unsafe gate regex, external runtime contract, scope-precedence rules.

## Entry paths

- path: `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts`
  why_it_matters: **Central orchestration hub.** The `runReview()` method (line 166) is where deterministic classifiers execute, where LLM `decideTurn()` is called, and where `applyDecision()` dispatches to runtime actions. This is the primary insertion point for the semantic action layer and deterministic classifier pipeline.

- path: `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.ts`
  why_it_matters: **Prompt construction.** Contains `SUPERVISOR_TURN_SYSTEM_PROMPT` (line 15), `SUPERVISOR_PERMISSION_SYSTEM_PROMPT` (line 28), `buildSupervisorTurnPrompt()` (line 35), `buildSupervisorFollowUpPrompt()` (line 132), and `buildSupervisorPermissionPrompt()` (line 163). All need rewriting to expose the finite action space and include few-shot examples.

- path: `apps/server/src/modules/supervisor/application/ports/supervisor-decision.port.ts`
  why_it_matters: **Port contract.** Defines `SupervisorTurnSnapshot` (the input to the LLM decision) and `SupervisorDecisionPort` interface. The snapshot shape and port interface may need expansion but should remain backward-compatible.

- path: `apps/server/src/modules/supervisor/application/supervisor.schemas.ts`
  why_it_matters: **LLM output schema.** `SupervisorTurnDecisionSchema` (line 3) currently encodes only 4 actions. Must be expanded to the full semantic action space, or a new internal schema must be added alongside the existing one.

- path: `apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.ts`
  why_it_matters: **LLM adapter.** Calls `generateText()` with structured output using `SupervisorTurnDecisionSchema`. The schema change (semantic actions) propagates here. The adapter produces `SupervisorDecisionSummary` — the output must remain mappable to the 4 runtime actions.

## Relevant files and modules

- path: `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts`
  role: Central orchestration — deterministic classifiers, snapshot building, decision dispatch, memory logging
  confidence: HIGH

- path: `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.ts`
  role: Prompt construction — system prompt, turn prompt, follow-up prompt, permission prompt
  confidence: HIGH

- path: `apps/server/src/modules/supervisor/application/supervisor.schemas.ts`
  role: Zod schemas for LLM structured output and permission decisions
  confidence: HIGH

- path: `apps/server/src/modules/supervisor/application/ports/supervisor-decision.port.ts`
  role: Port interfaces — `SupervisorTurnSnapshot`, `SupervisorDecisionPort`, `SupervisorPermissionSnapshot`
  confidence: HIGH

- path: `apps/server/src/modules/supervisor/application/ports/supervisor-memory.port.ts`
  role: Memory port — `SupervisorMemoryPort` with `lookup()` and `appendLog()`; no `save` method yet
  confidence: HIGH

- path: `apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.ts`
  role: LLM adapter — calls `generateText()` with structured output; currently maps to `SupervisorTurnDecisionSchema`
  confidence: HIGH

- path: `apps/server/src/modules/supervisor/infra/obsidian-supervisor-memory.adapter.ts`
  role: Memory adapter — Obsidian CLI with multi-layer fallback (CLI → local files); `appendLog()` exists but is not exposed as a semantic action
  confidence: HIGH

- path: `apps/server/src/shared/types/supervisor.types.ts`
  role: Shared type definitions — `SupervisorDecisionSummary`, `SupervisorSessionState`, `SupervisorDecisionAction` (4-action enum)
  confidence: HIGH

- path: `packages/shared/src/chat/types.ts`
  role: UI-side shared types — duplicates `SupervisorDecisionSummary` with the same 4-action contract; consumed by web hooks and event schema
  confidence: HIGH

- path: `packages/shared/src/chat/event-schema.ts`
  role: Event validation — `supervisor_decision` event payload schema (lines 310-317)
  confidence: HIGH

- path: `apps/web/src/hooks/use-chat-session-event-handler.ts`
  role: UI consumer — stores `lastSupervisorDecisionRef.current = decision` (line 651); already uses `SupervisorDecisionSummary` type
  confidence: MEDIUM

- path: `apps/server/src/bootstrap/service-registry/ai-services.ts`
  role: DI wiring — instantiates `SupervisorLoopService`, `AiSdkSupervisorDecisionAdapter`, `ObsidianSupervisorMemoryAdapter`, `SupervisorPermissionService`; event wiring
  confidence: MEDIUM

- path: `apps/server/src/modules/supervisor/application/supervisor-permission.service.ts`
  role: Permission handling — separate flow from turn decisions; not in primary scope unless semantic actions affect permission mapping
  confidence: MEDIUM

- path: `apps/server/src/modules/supervisor/application/supervisor-state.util.ts`
  role: State normalization — `normalizeSupervisorState()`, `createSupervisorStatePatch()`; may need new status values for semantic actions
  confidence: MEDIUM

- path: `apps/server/src/modules/supervisor/index.ts`
  role: Module exports — re-exports ports, services, and types; may need to export new semantic types
  confidence: MEDIUM

- path: `apps/server/src/modules/session/infra/session-sqlite.mapper.types.ts`
  role: Persistence schema — `SupervisorDecisionSummarySchema` (lines 89-93) uses the 4-action enum; needs no change if runtime actions stay the same
  confidence: MEDIUM

## Suspected change surface

### 1. Semantic action layer (new or modified)
- **`supervisor-loop.service.ts`** — Add a `classifySemanticAction()` stage between snapshot building and deterministic classifier dispatch (around lines 192-222). The pipeline should become:
  1. Build snapshot (existing)
  2. Run deterministic classifiers for fast-path decisions (existing: option/memory-recovery)
  3. Call LLM `decideTurn()` with new semantic schema (modified)
  4. Map semantic action to runtime control action (new)
  5. Apply runtime decision (existing)
- **`supervisor.schemas.ts`** — Add a `SupervisorSemanticDecisionSchema` with 9 actions + reasoning + follow-up prompt. Keep the existing 4-action schema for runtime mapping.

### 2. Prompt builder rewrite
- **`supervisor-prompt.builder.ts`** — `SUPERVISOR_TURN_SYSTEM_PROMPT` (lines 15-26): rewrite to identity/goal, observation protocol, thought checklist, finite action space, completion gate, few-shot examples.
- `buildSupervisorTurnPrompt()` (lines 35-130): keep snapshot sections but adjust labels and structure for semantic action context.
- `buildSupervisorFollowUpPrompt()` (lines 132-161): already says "current user-approved scope" (brief requirement met in T01); verify no residual "original task" wording.

### 3. Deterministic classifier expansion
- **`supervisor-loop.service.ts`** — Current classifiers at lines 971-1018:
  - `createOptionQuestionDecision()` — handles option selection; maps to `action: "continue"` with follow-up. Should become `APPROVE_GATE` semantic action.
  - `createMemoryRecoveryDecision()` — handles Obsidian blocked with local memory fallback; maps to `action: "continue"`. Should become `CONTINUE` with context injection.
  - New classifiers needed:
    - Worker self-reports done but no test/verification → `CORRECT`
    - Worker asks for safe approval gate (user-choice) → `APPROVE_GATE` (existing behavior, just retype)
    - Unsafe gate (commit/push/deploy) → `ESCALATE` (currently `selectAutopilotOption` returns undefined, causing null decision → falls through to LLM. This should become explicit `ESCALATE`.)
    - All options unsafe → `ESCALATE` or `ABORT`
    - Completion with validation → `DONE`

### 4. Memory/error filtering
- **`obsidian-supervisor-memory.adapter.ts`** — Already catches errors internally (returns `{ results: [] }`). No memory lookup error propagates to snapshot. **But**: the `searchFiles`/`searchLocalFiles`/`readLocalNote` fallback chain could produce partial results even when Obsidian CLI is down. The ensure: results from fallback may contain stale/incomplete data. Filter condition: if all paths fail (Obsidian CLI + local files), `memoryResults` is already empty — good.
- **`supervisor-loop.service.ts`** `appendSupervisorLog()` (line 662) — already catches errors and logs warn (non-blocking). The brief's `SAVE_MEMORY` needs a new call path here, probably as an optional follow-up step in `applyDecision()` or a separate non-blocking fire-and-forget.

### 5. Runtime control action mapping
- **`supervisor-loop.service.ts`** `applyDecision()` (line 535) — currently dispatches directly on `decision.action` (`done`/`continue`/`needs_user`/`abort`). Must add a mapping layer:
  - `CONTINUE` → `continue`
  - `APPROVE_GATE` → `continue` (with safe approval prompt)
  - `CORRECT` → `continue` (with corrective prompt)
  - `REPLAN` → `continue` (with replan prompt)
  - `DONE` → `done`
  - `ESCALATE` → `needs_user`
  - `ABORT` → `abort`
  - `SAVE_MEMORY` → `continue` or side-effect only
  - `WAIT` → `needs_user`

### 6. SAVE_MEMORY (new)
- No `saveMemory` method exists on `SupervisorMemoryPort`. The existing `appendLog()` only appends decision logs, not general learnings. A new method `save(input: { content: string; tags?: string[] })` may be needed on the port, or `appendLog` can be reused with a new action type.
- `supervisor-loop.service.ts` `runReview()` — `SAVE_MEMORY` should be a fire-and-forget side effect after the decision is applied, with error suppressed (brief: "do not block coding flow if memory persistence fails").

## Boundaries / files to avoid

- `apps/server/src/modules/supervisor/application/supervisor-permission.service.ts` — Permission flow is separate from turn decisions. Do not modify unless semantic actions leak into permission schema (they shouldn't).
- `packages/shared/src/chat/event-schema.ts` — The `supervisor_decision` event schema expects `{ action: "done"|"continue"|"needs_user"|"abort" }`. This must NOT change — only the internal semantic action is new.
- `apps/web/src/hooks/use-chat-session-event-handler.ts` (line 650-651) — Consumes `lastSupervisorDecisionRef.current = decision` where `decision` has type `SupervisorDecisionSummary` (4 actions). No change needed if runtime actions stay the same.
- `apps/server/src/modules/session/infra/session-sqlite.mapper.types.ts` (lines 89-93) — Persistence schema uses the 4-action enum. No change needed.
- `apps/server/src/shared/types/session.types.ts` (lines 359-365) — Event union type for `supervisor_decision`. No change needed.
- `apps/server/src/config/` and bootstrap files — No policy/DI changes needed unless adding new memory provider methods.
- `packages/shared/src/chat/use-chat-core.ts` — Event handler for `supervisor_decision`; must remain backward-compatible.
- ACP protocol layer — No changes needed. Continue/done/needs_user/abort control actions stay the same externally.

## Validation surface

- command_or_check: `bun test apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts`
  why: 28 existing tests on deterministic classifiers, timeline extraction, auto-resume signal detection, option selection, memory recovery decision. New tests needed: semantic action classification, CORRECT detection, ESCALATE for unsafe gates, SAVE_MEMORY non-blocking behavior.

- command_or_check: `bun test apps/server/src/modules/supervisor/application/supervisor-prompt.builder.test.ts`
  why: 6 describe blocks testing prompt content, precedence ordering, follow-up phrasing. New tests needed: system prompt contains finite action space, follow-up prompt says "current user-approved scope" (regression), no "original user task" wording, few-shot examples present.

- command_or_check: `bun test apps/server/src/modules/supervisor/application/supervisor.schemas.test.ts`
  why: Tests schema validation for required followUpPrompt on continue. New tests needed for semantic action schema validation.

- command_or_check: `bun test apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.test.ts`
  why: Tests model parsing. May need new tests if adapter schema changes.

- command_or_check: `bun test packages/shared/src/chat/event-schema.test.ts`
  why: Tests event parsing for `supervisor_decision` — should remain PASSing without changes.

- command_or_check: `bun test apps/server/src/modules/supervisor/infra/obsidian-supervisor-memory.adapter.test.ts`
  why: Tests memory adapter fallback behavior. Should verify memory error filtering works.

- command_or_check: `bun run check-types`
  why: Type safety after schema changes and new types.

## Triage calibration

- complexity_assessment: MATCHED
  rationale: Triage estimated 72/100 (7/10). The explorer confirms genuine new work: semantic action layer (LLM schema + mapping), prompt rewrite with few-shot examples, 3 new deterministic classifiers, SAVE_MEMORY port method, and expanded test surface. However, the existing infrastructure remains well-understood — all changes localized to the supervisor module without cross-boundary modification. Real complexity is closer to 60-65/100.

- risk_assessment: MATCHED
  rationale: Triage estimated 62/100 (6/10). The risk is real but contained:
    - Semantic action names could leak into runtime contract → mitigated by mapping layer (design boundary).
    - Deterministic CORRECT classifier could falsely flag genuine completion → must be regex-based with explicit verification signal.
    - ESCALATE replaces current implicit behavior (LLD decides what to do with unsafe gates) → needs explicit test.
    - SAVE_MEMORY failure must not block flow → already pattern-locked (existing appendLog catches errors).
    - Prompt rewrite could regress scope-precedence → regression tests required.

- suggested_executor: team-builder
  rationale: All changes are application-layer (supervisor module) with no cross-boundary transport, UI, or ACP protocol changes. The semantic-to-runtime mapping is a local contract. Tests are module-focused. However, architect is recommended first to define the semantic action contract and mapping table before builder implementation.

## Risks / unknowns

- **Unknown: `SAVE_MEMORY` port method shape.** The brief says "add optional SAVE_MEMORY path for useful learnings" — but there is no current `save()` method on `SupervisorMemoryPort`. Only `lookup()` and `appendLog()` exist. The architect must decide: (a) add a new `save()` method to the port, (b) reuse `appendLog()` with a new action type, or (c) make it an application-layer concern that calls the existing `appendLog()` with structured content. Option (c) is lowest risk.

- **Risk: Semantic action schema might diverge from LLM provider capability.** The current `SupervisorTurnDecisionSchema` is a simple 4-choice enum with optional followUpPrompt. The 9-action schema is more complex (each action may have different required fields). The `ai-sdk` `Output.object()` structured generation must support this. DeepSeek's structured output fidelity for 9-action schemas is unverified but likely adequate.

- **Risk: CORRECT classifier false positives.** The brief says "worker self-reports done but lacks tests/verification → CORRECT". How reliably can the classifier detect "lacks tests/verification" from `latestAssistantTextPart`? If the regex is too aggressive, genuine completion gets a corrective prompt (annoying). If too conservative, the classifier never fires (fall through to LLM, which is acceptable). The fallback to LLM is safe.

- **Risk: ESCALATE gate vs. LLM override.** Currently, when `selectAutopilotOption` returns undefined (all options unsafe), `createOptionQuestionDecision` returns null, and control falls through to the LLM `decideTurn()`. The LLM could still approve an unsafe option. The brief wants explicit `ESCALATE` when all options are unsafe. This means the deterministic ESCALATE path must take priority over the LLM fallback, which is a behavioral change from the current code.

- **Unknown: Prompt few-shot examples content.** The brief says "few-shot examples" should be in the system prompt. The architect must decide how many examples and whether they include decision traces or just action+rationale. Keeping them short (2-3 examples) is safest for token budget.

- **Unknown: `WAIT` action semantics.** `WAIT` currently maps to `needs_user`. But should it set a different supervisor status? The existing statuses are "idle/queued/reviewing/continuing/done/needs_user/aborted/error/disabled". A new "waiting" status could be added for visibility, but the brief does not require it.

## Blockers

- none
