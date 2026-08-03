# Supervisos Goal

> Created by the `create-goal` skill.
> Executor agent: read this entire file before changing any code.
> This file is a planning artifact only. Do not treat this creation as implementation.

---

## Objective

Build the Supervisos feature for Eragear Code Copilot in two stages:

- V0: MiniMax-M3-backed Supervisor decisions, deterministic Scope Resolver v0, Goal Mode state, GoalModeController, guarded phase transitions, compact context prompts, and audit/decision visibility.
- V1: AST/import-graph-backed Scope Resolver with reachability, improved metrics, incremental index updates, and tighter UI/verification around long-running goal execution.

The implementation must keep runtime/business behavior in `packages/runtime`, keep Electron main/preload thin, and preserve existing ACP permission and project-root sandbox boundaries.

---

## Feasibility Decision

This is feasible, but it is a medium-hard runtime feature. The project already has useful foundations:

- `packages/runtime/src/modules/supervisor` contains `SupervisorLoopService`, permission supervision, model decision ports, prompt builders, policy, and tests.
- `packages/runtime/src/modules/repo-snapshot-indexing` exposes a package-level index service and tRPC router for repo snapshot refresh/search.
- `packages/runtime/src/modules/settings/application/local-ade.service.ts` already builds Project Index v0 signals, including files, bounded symbols, tasks, semantic tags, and optional embeddings.
- `packages/runtime/src/modules/file-watcher` already publishes file change events for active project roots.
- Desktop renderer already has Supervisor UI entry points and Project Index settings surfaces.

Primary risks:

- The current Supervisor decision adapter only supports DeepSeek via `@ai-sdk/deepseek`; the target model is MiniMax-M3.
- Current Project Index symbol extraction is regex-based and bounded; V0 must not overclaim precision.
- Goal Mode needs a write-side controller. `SupervisorLoopService` alone cannot advance phases, run gates, or write `PhaseRecord` outcomes.
- A long-running goal can span changes to resolver capabilities; `resolverVersion` must be recorded per `ScopeResolution`, not once at goal creation.
- Metrics must be derived from raw phase/attempt data, not stored as a second source of truth.

---

## Context

- Reason: Supervisos should reduce manual re-prompting by choosing minimal next-step context, resolving likely target files, and safely continuing phase-by-phase without concatenating raw history.
- Priority: correctness and safety > UX polish > speed.
- Executor: AI agent, no human review at every step.
- Created: 2026-06-20, Asia/Saigon.
- Required model: MiniMax-M3. Do not keep the Supervisor decision path tied to DeepSeek.

---

## Current State

| Item | Value |
|------|-------|
| Monorepo | Bun workspaces, `apps/*` and `packages/*` |
| Product architecture | Desktop-first Electron plus preserved native mobile |
| Runtime package | `packages/runtime` |
| API contract package | `packages/api-contract` |
| Shared chat contracts | `packages/shared` |
| Current Supervisor module | `packages/runtime/src/modules/supervisor` |
| Current Supervisor loop | Semantic action loop: continue / needs_user / done / abort |
| Current Supervisor state | `SupervisorSessionState` with mode/status/reason/continuationCount/lastDecision/loop detection fields |
| Current decision adapter | `AiSdkSupervisorDecisionAdapter` uses `createDeepSeek` and supports only DeepSeek model ids |
| Current Project Index package | `packages/runtime/src/modules/repo-snapshot-indexing` |
| Current repo index source | `LocalAdeService` snapshot/refresh/search adapter |
| Current symbol extraction | Regex line scan via `symbolFromLine`; not AST |
| Current signal scan cap | 128 KB per indexable file for symbols/tasks/semantic tags |
| Current file watcher | `packages/runtime/src/modules/file-watcher` publishes project file changes |
| Current UI hooks | Desktop chat context rail has Supervisor control; Settings has repo snapshot index panel |

---

## Target State

### V0 Target

| Area | Target |
|------|--------|
| Supervisor model | MiniMax-M3, not DeepSeek |
| MiniMax integration | Provider adapter supports official MiniMax endpoint/config with `MINIMAX_API_KEY` or settings equivalent |
| Scope Resolver | Deterministic v0 resolver using Project Index metadata, path/name/symbol/task/semantic/mtime scores |
| Resolver output | Structured `ScopeResolution`, not a prompt string |
| Resolver versioning | Each resolution records `resolverVersion: "v0-no-graph"` and diagnostics |
| Goal Mode | Separate goal state, not merged into `SupervisorSessionState` |
| Controller | New `GoalModeController` handles phase attempts, gates, state writes, and next prompt creation |
| Loop | `SupervisorLoopService` remains the turn-level semantic loop |
| Session lifecycle | One fresh linked execution attempt per phase attempt; attempts must be associated with goal/phase ids |
| Gates | Deterministic checks for modified/created/deleted files, destructive actions, and verification failures |
| Context allocator | Next prompt uses original intent, stable constraints, compact prior outcome summaries, current phase goal, allowed files, and verification requirement |
| Outcome summary | Structured summary with `keyDecision`, `filesChanged`, `gotcha`, and `verification` |
| Audit UI | Users can inspect scope resolution, phase attempts, gate result, verification result, and decision reasons |

### V1 Target

| Area | Target |
|------|--------|
| Resolver version | `resolverVersion: "v1-import-graph"` |
| Index quality | AST-based symbols for TypeScript/TSX and import/export graph |
| Reachability | Resolver can score whether a candidate is reachable from app/router/root entry points |
| Route/component mapping | Resolver can distinguish same-name screens/components across desktop/native/package contexts |
| Incremental updates | File watcher invalidates or refreshes relevant index slices without full manual refresh for normal edits |
| LLM disambiguation | MiniMax-M3 only chooses among top-K precomputed candidates when deterministic gap is low |
| Metrics | Derived metrics by resolver version, gate reason, attempt count, and context growth |
| UI | Decision Log exposes per-phase resolver version, graph confidence, and gate breakdown |

---

## Architecture Decisions

### Components

The implementation has three separate components:

1. `ScopeResolver`
   - Resolves user/phase intent to likely target files.
   - Uses deterministic scoring first.
   - Calls MiniMax-M3 only for ambiguous top-K disambiguation.

2. `SupervisorLoopService`
   - Keeps the existing turn-level semantic loop.
   - Does not own phase transitions.
   - Does not write Goal Mode state directly.

3. `GoalModeController`
   - Owns Goal Mode lifecycle.
   - Starts phase attempts.
   - Receives loop results.
   - Collects changed/created/deleted files and verification evidence.
   - Runs deterministic gates.
   - Writes `SupervisorGoalState`.
   - Builds the next compact prompt.

### State

Do not redefine the meaning of `SupervisorSessionState.continuationCount`.

Use separate Goal Mode state:

```ts
type ResolverVersion = "v0-no-graph" | "v1-import-graph";

type ScopeResolution = {
  resolverVersion: ResolverVersion;
  primaryTarget: { path: string; score: number; reason: string };
  secondaryTargets: { path: string; score: number; reason: string }[];
  resolvedViaLLM: boolean;
  diagnostics: {
    signalScanSkippedBySize: number;
    symbolExtractionMode: "regex" | "ast";
  };
};

type GateResult =
  | { decision: "auto_continue"; reasons: [] }
  | {
      decision: "needs_user";
      reasons: Array<
        | "scope_drift_modified"
        | "scope_drift_created"
        | "file_deleted"
        | "destructive_action"
        | "verification_failed"
      >;
    };

type PhaseAttemptRecord = {
  attemptId: string;
  chatId: string;
  startedAt: string;
  finishedAt?: string;
  supervisorFinalState?: {
    status: "done" | "needs_user" | "aborted" | "error";
    continuationCount: number;
    reason?: string;
  };
  filesTouched: string[];
  filesCreated: string[];
  filesDeleted: string[];
  verification?: { command: string; exitCode: number | null };
  gate?: GateResult;
};

type PhaseRecord = {
  phaseId: string;
  goal: string;
  filesAllowed: string[];
  scopeResolution: ScopeResolution;
  attempts: PhaseAttemptRecord[];
  outcomeSummary?: {
    keyDecision: string;
    filesChanged: string[];
    gotcha: string;
    verification: string;
  };
  decision: "pending" | "auto_continue" | "needs_user" | "user_rejected";
};

type SupervisorGoalState = {
  goalId: string;
  originalIntent: string;
  constraints: string[];
  currentPhaseId: string;
  phases: PhaseRecord[];
};
```

`resolverVersion` belongs to each `ScopeResolution`, not to the goal root. Goal metrics are derived from `phases`, not stored separately.

---

## Constraints

- [ ] Do not implement business/runtime rules in Electron main or preload.
- [ ] Do not move runtime/application behavior into `apps/desktop`.
- [ ] Do not change `apps/native` structure or make it import desktop internals.
- [ ] Do not merge Goal Mode phase state into `SupervisorSessionState`.
- [ ] Do not redefine `continuationCount`; it remains turn count for one supervisor execution session/attempt.
- [ ] Do not store derived metrics as mutable goal fields; compute them from `phases`.
- [ ] Do not treat V0 `resolvedViaLLM` rate as an index maturity metric. It is only meaningful once V1 graph signals exist.
- [ ] Do not forward raw prior transcripts or full raw diffs into subsequent phase prompts.
- [ ] Do not let the LLM search the whole repo from scratch in Scope Resolver. LLM may only disambiguate among deterministic top-K candidates.
- [ ] Do not auto-continue when files are deleted, even if deleted files are inside the allowlist.
- [ ] Do not auto-continue when verification fails.
- [ ] Do not auto-continue when files are modified or created outside `filesAllowed`.
- [ ] Do not keep Supervisor decision support tied to DeepSeek.
- [ ] Do not rename MiniMax model id. Use `MiniMax-M3` unless official docs change and the agent records the exact evidence.
- [ ] Do not store MiniMax API keys in repo files, logs, snapshots, or audit exports.
- [ ] Preserve ACP permission boundaries and project-root sandbox checks.
- [ ] If a blocker prevents clean implementation, stop and document it instead of weakening gates.

---

## Success Criteria

Every criterion requires evidence. Do not mark complete from memory.

### Required Evidence per Criterion

| # | Criterion | Verification Command | Expected Output / Signal |
|---|-----------|----------------------|--------------------------|
| 1 | Supervisor decision provider no longer depends on DeepSeek-only adapter | `rg -n "createDeepSeek|@ai-sdk/deepseek|supervisorDeepSeek|DEEPSEEK_API_KEY" packages/runtime/src packages/runtime/package.json packages/runtime/settings.schema.json` | Exit code 1, or only archived/migration notes outside active runtime/config |
| 2 | MiniMax-M3 supervisor config exists | `rg -n "MiniMax-M3|MINIMAX_API_KEY|minimax" packages/runtime/src packages/runtime/settings.schema.json apps/desktop/src` | Active config, settings, adapter, tests, and UI references are present |
| 3 | MiniMax adapter has tests for configured, missing-key, unsupported-provider, schema-output, and retry paths | `bun test packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.test.ts` | Exit code 0 |
| 4 | Scope Resolver v0 contract and service exist | `rg -n "ScopeResolution|resolverVersion|v0-no-graph|signalScanSkippedBySize|symbolExtractionMode" packages/runtime/src` | Contract, service, tests, and router/use-case wiring are present |
| 5 | Scope Resolver v0 deterministic tests pass | `bun test packages/runtime/src/modules/scope-resolution/application/scope-resolver.service.test.ts` | Exit code 0 |
| 6 | V0 symbol extraction covers typed TSX component declarations | `bun test packages/runtime/src/modules/scope-resolution/application/scope-resolver.service.test.ts packages/runtime/src/modules/repo-snapshot-indexing/application/repo-snapshot-indexing.service.test.ts` | Tests include `export const HomePage: FC<Props> = ...` or equivalent and pass |
| 7 | Signal scan size skips are observable diagnostics, not confused with missing indexed files | `rg -n "signalScanSkippedBySize" packages/runtime/src apps/desktop/src` | Diagnostics are exposed through resolver/index result and UI or logs |
| 8 | Goal Mode state is separate from `SupervisorSessionState` | `rg -n "SupervisorGoalState|PhaseRecord|PhaseAttemptRecord|GoalModeController" packages/runtime/src` | Separate module/types/controller exist |
| 9 | `SupervisorSessionState` is not expanded with phase/goal fields | `rg -n "phaseId|goalId|currentPhaseId|phases|filesAllowed|outcomeSummary" packages/runtime/src/shared/types/supervisor.types.ts packages/shared/src/chat/types.ts` | Exit code 1 |
| 10 | GoalModeController handles phase attempt lifecycle and gate decisions | `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-controller.service.test.ts` | Exit code 0 |
| 11 | Gate logic blocks out-of-scope modify/create, all deletes, destructive action, and verification failure | `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-gate.test.ts` | Exit code 0 |
| 12 | Context Budget Allocator never injects raw transcripts/diffs into next phase prompt | `bun test packages/runtime/src/modules/goal-mode/application/goal-mode-prompt.builder.test.ts` | Exit code 0; tests assert only compact summaries and allowlist appear |
| 13 | Structured outcome summaries are schema-validated | `bun test packages/runtime/src/modules/goal-mode/application/goal-mode.schemas.test.ts` | Exit code 0 |
| 14 | Audit/Decision Log events are parseable by shared chat event schema | `bun test packages/shared/src/chat/event-schema.test.ts packages/shared/src/chat/use-chat-core.test.ts` | Exit code 0 |
| 15 | Desktop UI typechecks with Goal Mode surfaces | `bun run --cwd apps/desktop check-types` | Exit code 0 |
| 16 | Runtime typechecks | `bun run --cwd packages/runtime check-types` | Exit code 0 |
| 17 | API contract typechecks if new tRPC procedures are exposed | `bun run --cwd packages/api-contract check-types` | Exit code 0 |
| 18 | V1 import graph exists and resolver version is emitted per resolution | `rg -n "v1-import-graph|importGraph|reachability|routeMap" packages/runtime/src/modules` | Active V1 code and tests are present |
| 19 | V1 resolver tests cover same-name routes/components across workspaces | `bun test packages/runtime/src/modules/scope-resolution/application/scope-resolver-v1.test.ts` | Exit code 0 |
| 20 | File watcher integration invalidates or refreshes resolver/index graph state | `bun test packages/runtime/src/modules/scope-resolution/init/scope-resolution-events.init.test.ts packages/runtime/src/modules/file-watcher/init/file-watcher-events.init.test.ts` | Exit code 0 |
| 21 | Derived metrics are computed from phases, not stored as mutable fields | `rg -n "computeGoalMetrics|resolvedViaLLMRate|gateRejectReasons|avgAttemptsPerPhase" packages/runtime/src` | Metrics function exists; no mutable root `metrics` field in goal state |
| 22 | Product blocker suite still passes | `bun run audit:blockers` | Exit code 0 |
| 23 | Repo formatting and linting remain clean | `bunx biome check packages apps/desktop apps/native --error-on-warnings` | Exit code 0 |
| 24 | Full product build passes | `bun run build` | Exit code 0 |
| 25 | Desktop smoke covers MiniMax supervisor config and at least one guarded goal flow | `$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop` | Exit code 0 and smoke output includes explicit supervisor/goal markers added by implementation |

### Reference Artifacts

- `AGENTS.md` - repo architecture and migration discipline.
- `README.md` - current desktop-first architecture and verification commands.
- `packages/runtime/src/modules/supervisor` - current Supervisor implementation.
- `packages/runtime/src/modules/repo-snapshot-indexing` - current Project Index package.
- `packages/runtime/src/modules/settings/application/local-ade.service.ts` - current index source and regex signal extraction.
- MiniMax docs:
  - `https://platform.minimax.io/docs/llms.txt`
  - `https://platform.minimax.io/docs/api-reference/text-openai-api`
  - `https://platform.minimax.io/docs/api-reference/text-anthropic-api`
  - `https://platform.minimax.io/docs/guides/text-m3-function-call`
  - `https://platform.minimax.io/docs/token-plan/other-tools`

### Completion Condition

Agent finishes only when:

- [ ] All V0 criteria pass.
- [ ] All V1 criteria pass.
- [ ] All verification commands above pass with expected signals.
- [ ] MiniMax-M3 is the active Supervisor decision model path.
- [ ] No DeepSeek-specific Supervisor config remains in active runtime/config.
- [ ] No Goal Mode state is merged into `SupervisorSessionState`.
- [ ] No raw transcript/diff reinjection is used for phase prompts.
- [ ] No unresolved `[estimated]` or `[needs confirmation]` requirement remains in this file.

---

## Execution Plan

### Phase 0 - Baseline and Provider Research

1. Read this entire file, `AGENTS.md`, `README.md`, current `GOAL.md`, and relevant runtime modules.
2. Re-check official MiniMax docs before implementing provider changes.
3. Decide the concrete MiniMax adapter strategy based on current package support:
   - Prefer an AI SDK-compatible provider if available and stable.
   - Use official OpenAI-compatible endpoint if that is the least invasive with current `generateText` usage.
   - Use Anthropic-compatible endpoint only if it is better supported for reasoning/thinking and object output can be made reliable.
4. Record the decision in code comments/tests or a short docs note if the tradeoff is non-obvious.

### Phase 1 - MiniMax-M3 Supervisor Provider

1. Replace DeepSeek-only decision model support with MiniMax-M3 support.
2. Update settings/env/schema/types/UI from DeepSeek-specific fields to provider-neutral or MiniMax-specific fields.
3. Preserve fail-closed behavior when Supervisor is disabled, model is empty, or API key is missing.
4. Preserve schema-validated semantic decisions and permission decisions.
5. Add redaction tests for MiniMax API key handling.

### Phase 2 - Scope Resolver V0

1. Create a runtime module for scope resolution or extend repo-snapshot-indexing with a clean application service boundary.
2. Add `ScopeResolution` contract and tRPC procedure or internal use-case API.
3. Reuse Project Index v0 data; do not reuse `/index` prompt output as the resolver API.
4. Implement deterministic scoring:
   - path/name match
   - symbol match
   - task marker match
   - semantic tag match
   - recency/mtime bonus
   - active project/workspace context bonus when available
5. Emit `resolverVersion: "v0-no-graph"` per resolution.
6. Add `signalScanSkippedBySize` and `symbolExtractionMode: "regex"` diagnostics.
7. Improve typed TSX component extraction enough for common component patterns.
8. Add ambiguous top-K disambiguation only after deterministic scoring exists.

### Phase 3 - Goal Mode State and Storage

1. Add `SupervisorGoalState`, `PhaseRecord`, `PhaseAttemptRecord`, gate types, and schemas in a separate Goal Mode module.
2. Add repository/storage for goal state.
3. Do not alter `SupervisorSessionState` for goal/phase fields.
4. Link phase attempts to sessions using explicit `goalId`, `phaseId`, and `attemptId` metadata.

### Phase 4 - GoalModeController V0

1. Implement `GoalModeController.startGoal`.
2. Implement `GoalModeController.startPhaseAttempt`.
3. Implement `GoalModeController.handleLoopResult`.
4. Collect changed/created/deleted files from git/worktree status, including untracked files.
5. Collect verification command/exit code evidence.
6. Run deterministic gate.
7. Write phase attempt and outcome summary.
8. Advance `currentPhaseId` only when gate passes.
9. Keep phase unchanged and mark needs-user/pending when gate fails.

### Phase 5 - Context Budget Allocator

1. Build next phase prompt from:
   - original intent
   - stable constraints
   - completed phase outcome summaries
   - current phase goal
   - `filesAllowed`
   - required verification command
2. Explicitly exclude raw transcript, raw agent output, and full raw diff.
3. Add tests that long prior output does not leak into next prompt.

### Phase 6 - Audit Events and Desktop UI V0

1. Add shared event/schema support for Goal Mode audit updates.
2. Update desktop chat context rail or a dedicated decision log surface.
3. Display:
   - current goal/phase
   - scope resolution and confidence
   - resolver version
   - files allowed/touched/created/deleted
   - gate result
   - verification result
   - outcome summary
4. Keep UI dense and operational; do not make a landing page or marketing surface.

### Phase 7 - V1 AST and Import Graph

1. Implement AST symbol extraction for TypeScript/TSX.
   - Use TypeScript compiler APIs already available before adding new parser dependencies.
   - Add `ts-morph` only if it materially reduces complexity and matches repo constraints.
2. Build import/export graph.
3. Build route/root reachability signals for desktop and native contexts.
4. Emit `resolverVersion: "v1-import-graph"` when graph signals are used.
5. Add tests for same-name files/components across workspaces.
6. Add graph invalidation/refresh from file watcher events.

### Phase 8 - Derived Metrics and Verification

1. Implement `computeGoalMetrics(goal)`.
2. Group `resolvedViaLLMRate` by `resolverVersion`.
3. Count `signalScanSkippedBySize`.
4. Tally gate reject reasons.
5. Compute average attempts per phase.
6. Add context growth/token-size measurement if existing token tooling can support it without large new dependencies.
7. Run all Success Criteria commands.
8. Update `GOAL_PROGRESS.md` after major phases if this goal becomes the active execution goal.

---

## Out of Scope

- Do not rename `apps/native`.
- Do not redesign the entire chat UI.
- Do not add a browser-accessible local HTTP runtime for default desktop mode.
- Do not replace ACP or the underlying agent process runtime.
- Do not benchmark MiniMax-M3 against other models as part of this feature.
- Do not build a general multi-provider marketplace.
- Do not migrate unrelated model selectors outside the Supervisor decision path unless required to remove active Supervisor DeepSeek coupling.
- Do not implement V1 for non-TypeScript languages unless it falls out naturally from a chosen parser and tests remain focused.

---

## References

- MiniMax docs index: https://platform.minimax.io/docs/llms.txt
- MiniMax OpenAI SDK docs: https://platform.minimax.io/docs/api-reference/text-openai-api
- MiniMax Anthropic SDK docs: https://platform.minimax.io/docs/api-reference/text-anthropic-api
- MiniMax Tool Use and Interleaved Thinking: https://platform.minimax.io/docs/guides/text-m3-function-call
- MiniMax Other Tools config: https://platform.minimax.io/docs/token-plan/other-tools
- AI SDK MiniMax community provider docs: https://ai-sdk.dev/providers/community-providers/minimax
- `packages/runtime/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.ts`
- `packages/runtime/src/modules/supervisor/application/supervisor-loop.service.ts`
- `packages/runtime/src/modules/repo-snapshot-indexing/application/contracts/repo-snapshot-indexing.contract.ts`
- `packages/runtime/src/modules/settings/application/local-ade.service.ts`
- `packages/runtime/src/modules/file-watcher/init/file-watcher-events.init.ts`

---

## Agent Instructions

### Execution

1. Read this entire file before any code changes.
2. Verify current MiniMax docs and current installed package APIs before choosing implementation details.
3. Follow Constraints before Execution Plan if they conflict.
4. Implement V0 before V1.
5. Do not mark this complete until both V0 and V1 Success Criteria pass.
6. After each major phase, record changed files, verification commands, and remaining work.
7. If MiniMax API behavior differs from docs or AI SDK behavior, add a failing/skip-safe test and document the blocker.
8. If any verification command cannot run locally, document the exact reason and the strongest substitute evidence.

### Anti-Bias Instructions

Scope Shrink:

- Do not redefine Supervisos as only "turn auto-continue"; Goal Mode and Scope Resolver are part of the objective.
- Do not call V0 complete without MiniMax-M3 decision support.
- Do not call the whole goal complete without V1 import graph reachability.

Uncertainty Stop:

- If a resolver hit looks plausible but no test proves it, treat it as incomplete.
- If provider output parsing is flaky, continue hardening tests instead of accepting manual confidence.
- If metrics are unclear, compute them from stored phases rather than hand-wave.

Memory Trust:

- Do not assume existing Project Index behavior from conversation memory. Inspect code and tests.
- Do not assume DeepSeek references are gone. Run `rg`.
- Do not assume Goal Mode state is separate. Inspect `SupervisorSessionState` and shared chat types.

