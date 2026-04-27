---
artifact_type: triage_report
session_id: 20260426-opencode-init-model-list-lag
task_id: T00
producer: team-triage
status: ACTIVE
created_at: 2026-04-26
source_commit: UNKNOWN
based_on:
  - artifacts/20260426-opencode-init-model-list-lag/00-brief.md
  - artifacts/meta/routing-metrics.md
  - artifacts/meta/routing-patterns.md
  - artifacts/20260425-model-selector-lag/01-triage-report.md
  - artifacts/20260425-model-selector-lag/learnings/T01-learning.md
  - artifacts/20260425-model-selector-lag/validation/T01-validation.md
consumers:
  - orchestrator
  - team-vault-reader
  - team-explorer
  - team-architect
freshness_rule: invalid_if_brief_or_relevant_history_changes
---
# Triage Report

## Request class
- Cross-boundary performance/UX bug triggered during OpenCode agent initialization.
- Likely involves ACP init/newSession/loadSession model/config-option ingestion, runtime/session-state broadcast, React state sync, and model selector rendering.
- Not a greenfield feature; goal is bounded/lazy handling of extremely large model lists while preserving model selection.

## Scores
- complexity_score: 68
- risk_score: 72
- novelty_score: 45
- confidence_score: 74

## Historical priors used
- artifact: artifacts/meta/routing-metrics.md
  signal: No calibrated routing metrics recorded yet.
  impact_on_route: No numeric prior available; route based on brief, prior session artifacts, and light scan.
- artifact: artifacts/meta/routing-patterns.md
  signal: Validated single incident for `20260425-model-selector-lag`: cmdk/CommandList freezes when unbounded items mount; consumer-level bounded rendering was preferred over primitive virtualization.
  impact_on_route: Raises confidence that frontend selector rendering has a known safe mitigation, but this task appears broader because lag happens immediately during OpenCode init.
- artifact: artifacts/20260425-model-selector-lag/learnings/T01-learning.md
  signal: Bounded rendering at consumer/data-mapping layer prevented cmdk from registering more than ~50 model items; team-builder fit localized selector fixes; hidden cmdk coupling increased risk.
  impact_on_route: Use this pattern if the issue is only selector mounting, but avoid assuming the same route is sufficient for init-time ingestion/broadcast lag.
- artifact: artifacts/20260425-model-selector-lag/validation/T01-validation.md
  signal: Prior fix passed with one known UX tradeoff around search/cap semantics; validation noted missing large-list tests.
  impact_on_route: Recommend explicit decision/test gate for search semantics and large-list behavior.

## Light repo signals
- path_or_pattern: `apps/server/src/modules/session/application/session-acp-bootstrap.service.ts`
  why_it_matters: ACP `initialize`, `newSession`, and `loadSession` results are accepted into runtime state; `newResult.models`, `loadResult.models`, and `configOptions` can carry large model/config-option payloads before UI rendering.
- path_or_pattern: `apps/server/src/shared/utils/session-config-options.util.ts`
  why_it_matters: `syncSessionSelectionFromConfigOptions` derives `SessionModelState.availableModels` by collecting every model option; a huge OpenCode model config option can become a huge model list.
- path_or_pattern: `apps/server/src/modules/session/application/get-session-state.service.ts`
  why_it_matters: Runtime session state returns full `models` and `configOptions`; large lists may be transferred to the client during session-state restore/backfill.
- path_or_pattern: `apps/web/src/hooks/use-chat-session-state-sync.ts`
  why_it_matters: Client state sync directly applies `models` from session state; large arrays can trigger immediate React state/memo work on connection.
- path_or_pattern: `apps/web/src/components/chat-ui/chat-interface.tsx`
  why_it_matters: `availableModels` maps all `selectionState.models.availableModels` before passing to `ChatInput`; this may still be expensive even after selector rendering is bounded.
- path_or_pattern: `apps/web/src/components/chat-ui/chat-input.tsx`
  why_it_matters: Existing prior mitigation filters the full model dataset then caps rendered groups to 50; good for dropdown DOM/cmdk pressure, but full-list filtering/mapping still occurs in memory and may not address init-time payload/state lag.

## Routing recommendation
- needs_vault_context: NO
- needs_explorer: YES
- needs_architect: YES
- initial_executor: none
- requires_human_decision: YES

## Rationale
- The brief says lag occurs immediately when OpenCode initializes and returns an extremely large model list, not only when opening the selector.
- Prior history strongly covers cmdk/rendering lag, but current repo scan shows additional possible bottlenecks before rendering: ACP setup payload size, configOptions-to-model derivation, runtime session-state response, client state sync, and full-list mapping/filtering.
- Blast radius is likely moderate-to-large across server application layer and web hooks/components; a narrow team-builder change may miss server/client contract or payload-size causes.
- Explorer should first confirm the exact path by which OpenCode models enter state and whether both `models.availableModels` and `configOptions` duplicate the same huge list.
- Architect should define the bounded/lazy model-list contract before implementation because tradeoffs affect product behavior: full browse/search availability, current/default model preservation, session-state payload shape, and provider-specific policy.
- Risk is high enough to require human decision before execution because reducing, truncating, or lazily loading model lists may change discoverability and model selection UX.

## Alternative routes
- route: explorer -> architect -> human gate -> team-heavy
  tradeoff: Safest route for cross-boundary payload/render optimization; slower, but reduces risk of fixing only dropdown rendering while init remains laggy.
- route: explorer -> team-builder
  tradeoff: Acceptable only if explorer proves lag is isolated to React selector/list mounting and no large payload/state duplication exists; faster but may under-solve init-time lag.
- route: team-builder directly using prior bounded-rendering pattern
  tradeoff: Lowest overhead, but not recommended because current brief specifically implicates OpenCode init and the light scan shows server/client state paths likely involved.

## Human decision gate
- reason: Need product/UX decision on whether huge OpenCode model lists should remain fully searchable/browsable immediately, be capped with current/default model preservation, or be loaded/search-expanded lazily.
- options:
  - Preserve full list in canonical state but defer/filter rendering on the client; lowest protocol risk, may still carry payload/state cost.
  - Cap or summarize list at server/session-state boundary while preserving current/default model and explicit search/expand behavior; best init performance, but changes full-list discoverability.
  - Implement lazy/paginated/search-based model loading if protocol/data source supports it; best UX/performance balance, but likely highest implementation complexity.
- execution_gate: Do not implement truncation/payload suppression until owner accepts the model discoverability tradeoff.

## Failure risk signals
- OpenCode may expose the huge list through `configOptions` rather than only `models`, causing duplicate payload and duplicate client derivation.
- Existing selector cap prevents unbounded cmdk item registration but still performs full-array mapping/filtering in React.
- Server may log or retain full initialize/newSession/loadSession payloads, increasing CPU/memory/log pressure.
- Reducing model lists can break default model matching, current model visibility, or set-model validation if not preserved explicitly.
- Search behavior can regress if search only covers capped data without clear UX copy or lazy expansion.
- Large-list test coverage is known to be missing from the prior related session.

## Blockers
- none
