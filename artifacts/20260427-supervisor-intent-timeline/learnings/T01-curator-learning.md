---
artifact_type: learning_log
session_id: 20260427-supervisor-intent-timeline
task_id: T01
producer: team-curator
status: PASS
created_at: 2026-04-27T00:00:00Z
source_commit: 7368059d3d29a992ff788ca31c467c7626de572a
based_on:
  - artifacts/20260427-supervisor-intent-timeline/01-triage-report.md
  - artifacts/20260427-supervisor-intent-timeline/03-explorer-report.md
  - artifacts/20260427-supervisor-intent-timeline/outputs/T01-builder-output.md
  - artifacts/20260427-supervisor-intent-timeline/validation/T01-validator-report.md
consumers:
  - orchestrator
freshness_rule: invalid_if_triage_validation_or_worker_output_changes
---
# Curator Log

## Recommendation
PROMOTE (session note only — no durable vault write; orchestrator routes to team-artifact-writer)

## Source artifacts
- 01-triage-report.md
- 03-explorer-report.md
- outputs/T01-builder-output.md
- validation/T01-validator-report.md

## Durable product / engineering learnings
- target_path: Project/opencode/sessions/
  rationale: Session learning candidate for human review before any durable memory promotion
  content: |
    Session: 20260427-supervisor-intent-timeline
    Task: Supervisor reads conversation intent timeline

    Distilled reusable lesson:
    Forward pagination loop for user instruction timeline extraction is a proven, low-risk pattern.
    When updating supervisor snapshot behavior:
    1. Use forward cursor loop (mirroring SessionHistoryReplayService pattern) to collect all user messages
    2. Apply truncation per message (MAX_USER_INSTRUCTION_CHARS=2000) and cap (MAX_USER_INSTRUCTION_MESSAGES=50) for bounded payload
    3. Derive taskGoal from latestUserInstruction so latest user instruction controls routing scope
    4. Explicit precedence statement in prompt ("latest human instruction > ...") ensures correct supervisor behavior
    5. Approval gate safety (UNSAFE_OPTION_RE for commit/push/deploy/destructive) already works — no changes needed to gate logic for safe routing cases
    6. Private functions that need test coverage should be exported upfront — hidden coupling found when selectAutopilotOption needed export mid-implementation

    Trigger signals:
    - Supervisor snapshot/prompt changes requiring user message timeline
    - Approval gate behavioral changes
    - Prompt precedence rule changes

    Evidence:
    - team-builder executed cleanly: 28 tests pass, 0 fail
    - Validator confirmed all acceptance criteria met (quality score 92)
    - Complexity came in lower than triage estimate (42 vs 58)
    - No regressions, no cross-boundary changes

    Not reusable when:
    - Cross-boundary transport/UI changes are required
    - Full assistant transcript exposure is needed
    - Approval gate logic changes beyond regex filtering

    Proposed target: Project/opencode/sessions/Session - 2026-04-27 - T01-supervisor-intent-timeline.md

- none

## Session write policy
- allowed_write_path: Project/opencode/sessions/
- actual_session_note_path: Project/opencode/sessions/Session - 2026-04-27 - T01-supervisor-intent-timeline.md
- note_schema: session_learning_candidate_v1
- vault_write_status: SKIPPED (orchestrator routes to team-artifact-writer; curator does not self-write)

## Routing heuristic candidates
- pattern: Supervisor application-layer changes with tests, no cross-boundary complexity
  observed_signal: complexity 58 (6/10) estimated, 42 actual; risk 47 (5/10); server-supervisor-module scope
  suggested_adjustment: For supervisor snapshot/prompt + test tasks, team-builder is sufficient without team-architect or team-heavy. Explorer is valuable to map consumers and confirm change surface.
  confidence: HIGH
- pattern: Forward pagination loop for timeline extraction
  observed_signal: Explorer report mapped SessionHistoryReplayService pattern (lines 69-109); builder mirrored it successfully
  suggested_adjustment: Forward cursor loop is the correct pattern for collecting all user messages — do not use backward-only or first-message-only approaches for timeline needs
  confidence: HIGH
- none

## Calibration signals
- complexity_delta: LOWER
  actual_complexity: 42/100
  actual_risk_encountered: 35/100
  recommended_future_executor: team-builder
  should_update_routing_metrics: NO
  rationale: Triage overestimated complexity (58 vs 42) because it weighted the approval gate safety concern and backward-compatible snapshot expansion. The actual implementation was straightforward — forward pagination pattern existed in codebase, snapshot fields were additive (backward-compatible), and approval gate logic required no changes. No adjustment to routing metrics needed; the routing decision (team-builder with explorer) was correct. The overestimation is within normal variance for this request class.
- complexity_delta: LOWER (second signal for transparency)
  actual_complexity: 42/100
  actual_risk_encountered: 35/100
  recommended_future_executor: team-builder
  should_update_routing_metrics: NO

## Human promotion candidates
- proposed_target: Project/opencode/agent-memory/patterns/
  rationale: Forward pagination loop for user instruction timeline extraction is a reusable pattern for supervisor behavior updates. Pattern is proven (builder executed cleanly, validator confirmed correctness). Retrieval-friendly as a short, focused note.
  content: |
    # Pattern: Supervisor User Instruction Timeline via Forward Pagination

    ## When to use
    Supervisor snapshot/prompt changes that need compact user instruction timeline (all user messages in chronological order) without exposing full assistant transcript.

    ## How to implement
    1. Use forward cursor loop with `sessionRepo.getMessagesPage()` — mirror `SessionHistoryReplayService` pattern
    2. Filter by `role === "user"` to collect timeline
    3. Truncate each message at `MAX_USER_INSTRUCTION_CHARS` (2000) and cap total at `MAX_USER_INSTRUCTION_MESSAGES` (50)
    4. Derive `latestUserInstruction` from last element, `originalTaskGoal` from first element
    5. Use `latestUserInstruction` (not first message) for memory/research query haystack

    ## Prompt precedence rule (add to supervisor prompt)
    ```
    Precedence: latest human instruction > user instruction timeline > latest assistant proposal/gate > plan/artifacts > memory/blueprint > original task.
    ```

    ## Safety note
    Approval gate `UNSAFE_OPTION_RE` (commit/push/deploy/destructive) already filters unsafe options correctly — do not modify gate logic when adding timeline features.

- proposed_target: Project/opencode/agent-memory/routing-hints/
  rationale: Confirms team-builder is correct executor for server-supervisor-module application-layer changes with tests; no architect or heavy team needed
  content: |
    # Routing Hint: Supervisor Snapshot/Prompt Tasks

    ## Signal
    Server supervisor module, application-layer only, tests required, no cross-boundary UI/transport changes, moderate blast radius, safety-sensitive (approval gates).

    ## Recommended executor
    team-builder with team-explorer (not team-architect, not team-heavy)

    ## Why
    - Changes localized to supervisor application layer (port interface, loop service, prompt builder, tests)
    - Message paging API already exists and has proven usage pattern in codebase
    - No new ports or infra needed
    - Approval gate logic (UNSAFE_OPTION_RE) already works — no gate logic changes required
    - Complexity typically lower than triage estimates (42 vs 58 observed)

- proposed_target: Project/opencode/agent-memory/patterns/
  rationale: Hidden coupling lesson: private functions needed for test coverage should be exported upfront. selectAutopilotOption was private, needed export added mid-implementation.
  content: |
    # Anti-Pattern: Hidden Test Coupling on Private Functions

    ## Trigger
    Supervisor approval gate functions (selectAutopilotOption) needed for test coverage but were private.

    ## Lesson
    If a function may need test coverage, export it from initial design. Private-to-export migration mid-implementation introduces hidden coupling and forces interface changes.

    ## Mitigation
    Design functions that may need test coverage as exported from the start, or use dependency injection patterns that allow test substitution without export.

- none

## Suggested meta updates
- target_artifact: artifacts/meta/routing-patterns.md
  change: LIGHT_UPDATE — add entry for "Supervisor snapshot/prompt + tests, server-module-local, no cross-boundary" → team-builder with explorer sufficient, no architect needed. Complexity typically comes in lower than triage estimates for this request class.
  rationale: Session confirms team-builder is correct executor for this request class. Light update only (no schema change).
- none

## Vault writes
- path: Project/opencode/sessions/Session - 2026-04-27 - T01-supervisor-intent-timeline.md
  status: SKIPPED
  note: Orchestrator routes to team-artifact-writer. Curator does not self-write vault. This learning artifact itself is the output for team-artifact-writer to persist.

## Notes
- Validator recommended promotion YES (confidence HIGH, quality score 92)
- No blockers encountered
- No cross-boundary changes; all changes confined to supervisor application layer
- Pre-existing repo type errors in unrelated files (agent, session, settings, platform modules) — none in supervisor module
- Approval gate safety confirmed working: UNSAFE_OPTION_RE unchanged and correctly filters commit/push/deploy/destructive; safe routing (APP-T01 to team-builder) passes through without gate intervention
- Complexity delta LOWER confirms triage overestimated for this request class, but routing decision was still correct
- No durable memory promotion until human review approves promotion candidates
