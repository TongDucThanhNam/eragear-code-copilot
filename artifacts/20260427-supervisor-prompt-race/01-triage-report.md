---
artifact_type: triage_report
session_id: 20260427-supervisor-prompt-race
task_id: T00
producer: team-triage
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: UNKNOWN
based_on:
  - artifacts/20260427-supervisor-prompt-race/00-brief.md
  - artifacts/20260427-supervisor-prompt-race/RUN-INDEX.md
  - artifacts/20260427-live-supervisor-prompt-rendering/validation/T01-validator-report.md
  - artifacts/meta/routing-metrics.md
  - artifacts/meta/routing-patterns.md
consumers:
  - orchestrator
  - team-vault-reader
  - team-explorer
  - team-architect
freshness_rule: invalid_if_brief_or_relevant_history_changes
---
# Triage Report

## Request class
- Follow-up race fix: bounded React client-state/ref synchronization issue in web hook.
- Expected scope: one production hook plus targeted regression tests.
- Explicit non-scope: no server ACP/supervisor flow changes; no broad diagnostics.

## Concise summary
- The brief identifies a precise stale `statusRef` race after `chat_status: ready`.
- Light scan confirms `use-chat-core-state.ts` currently exposes the raw `useState` setter and only syncs `statusRef.current = status` during render, which matches the suspected race.
- Prior related validation passed for the guard relaxation, but this follow-up targets a narrower same-call-stack state/ref sync gap.

## Scores
- complexity_score: 32/100
- complexity_score_10: 3/10
- risk_score: 28/100
- risk_score_10: 3/10
- novelty_score: 22/100
- novelty_score_10: 2/10
- confidence_score: 84/100
- confidence_score_10: 8/10

## Historical priors used
- artifact: artifacts/20260427-live-supervisor-prompt-rendering/validation/T01-validator-report.md
  signal: Prior related guard fix passed with quality 92; validator noted team-builder fit was good and server remained unchanged.
  impact_on_route: Supports bounded client-only routing to team-builder, but does not eliminate need for regression coverage because the current session is a follow-up race.
- artifact: artifacts/meta/routing-metrics.md
  signal: Bounded UI/render fixes and post-PASS hardening have been overestimated slightly and routed well to team-builder; cross-boundary diagnostics require team-heavy.
  impact_on_route: This task is not cross-boundary diagnostics, so no team-heavy escalation by default.
- artifact: artifacts/meta/routing-patterns.md
  signal: Post-cross-boundary-fix test-hardening and bounded render fixes can route to team-builder; persistent cross-boundary diagnosis routes to team-heavy.
  impact_on_route: Route to team-builder because brief asks for a narrow production fix with tests, not full-chain diagnostics.

## Light repo signals
- path_or_pattern: apps/web/src/hooks/use-chat-core-state.ts
  why_it_matters: Target file currently has `const [status, setStatus] = useState<ChatStatus>(...)` and later `statusRef.current = status` during render; this matches the stale-ref race described in the brief.
- path_or_pattern: apps/web/src/hooks/use-chat-session-event-handler.ts
  why_it_matters: Handler consumes `statusRef` and `setStatus`, so synchronized setter behavior can affect immediate sequential event handling without server changes.
- path_or_pattern: apps/web/src/hooks/use-chat-turn-guards.ts
  why_it_matters: Brief says guard logic should remain unchanged; prior validation already covered narrow guard behavior.
- path_or_pattern: apps/web/src/hooks/use-chat-session-event-handler.test.ts
  why_it_matters: Existing test file is the right place for the requested immediate ready→submitted→ui_message regression.
- path_or_pattern: apps/web/src/hooks/use-chat.types.ts
  why_it_matters: Public `UseChatResult.setStatus(status)` signature should remain unchanged even if internal setter type becomes `Dispatch<SetStateAction<ChatStatus>>`.
- path_or_pattern: apps/web/src/hooks/use-chat-session-event-handler.ts and use-chat-subscription.ts
  why_it_matters: `diagMeasure` still appears used in hook files from light scan; cleanup should be limited to genuinely unused imports only.

## Routing recommendation
- needs_vault_context: NO
- needs_explorer: NO
- needs_architect: NO
- initial_executor: team-builder
- requires_human_decision: NO

## Routing signals
- machine_readable:
  - scope: client_only
  - target_files_expected: ["apps/web/src/hooks/use-chat-core-state.ts", "apps/web/src/hooks/use-chat-session-event-handler.test.ts"]
  - server_changes_allowed: false
  - guard_logic_changes_expected: false
  - diagnostics_expected: false
  - validation_required: ["bun test targeted hook tests", "biome check changed files", "apps/web typecheck or documented unrelated failure"]
  - escalation_condition: tests reveal broader event ordering issue beyond statusRef synchronization

## Rationale
- The root cause and implementation shape are explicit in the brief.
- The production change is localized: wrap status updates so `statusRef.current` updates synchronously before React render catches up.
- Main risk is subtle React `SetStateAction` behavior and preserving public API compatibility, not architectural uncertainty.
- Prior session already validated the guard-side behavior; this follow-up should not reopen server or ACP flow unless tests contradict the brief.

## Alternative routes
- route: team-builder direct implementation
  tradeoff: Fastest and appropriate for narrow hook/test fix; relies on the brief's root-cause confidence.
- route: team-heavy with explorer first
  tradeoff: Safer if new evidence suggests broader ACP/tRPC/client ordering issues, but likely overkill for the current precisely scoped follow-up.

## Recommended next step
- Create a builder ticket for `team-builder` to implement the synchronized status setter in `use-chat-core-state.ts` and add/update the requested handler-level regression test.

## Human decision gate
- none

## Failure risk signals
- Functional setter must resolve from `statusRef.current`, not stale closure state.
- Internal setter rename should not leak into public `UseChatResult.setStatus(status)` API.
- Test should simulate immediate sequential events without manually forcing `statusRef` to ready after the ready event.
- Avoid broadening turn guard logic or changing server/supervisor flow.
- Validation may encounter known repo/tooling permission issues around biome/typecheck; unrelated failures should be documented, not worked around with scope creep.

## Blockers
- none
