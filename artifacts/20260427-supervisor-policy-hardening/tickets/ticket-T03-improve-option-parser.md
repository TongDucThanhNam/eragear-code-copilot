---
artifact_type: ticket
session_id: "20260427-supervisor-policy-hardening"
task_id: T03
producer: team-architect
status: ACTIVE
created_at: "2026-04-27T23:00:00Z"
source_commit: UNKNOWN
based_on:
  - 00-brief.md
  - 01-triage-report.md
  - 03-explorer-report.md
  - 04-execution-plan.md
consumers:
  - team-builder
  - team-validator
freshness_rule: invalid_if_plan_brief_or_repo_context_changes
---
# Ticket T03 — Improve Option Parser/Scoring (A/B/C, Vietnamese, Tables)

## Objective
Improve `extractAssistantChoiceOptions` and `selectAutopilotOption` to handle A/B/C formats, Vietnamese input, markdown tables, and provide safe/default scoring fallbacks. Priority #3 from brief.

## Assigned agent
team-builder

## Estimated complexity: 35
## Estimated risk: 25

## Routing rationale
Changes are contained within two pure utility functions (`extractAssistantChoiceOptions`, `selectAutopilotOption`) and associated regex constants in `supervisor-loop.service.ts`. No service orchestration changes. The functions already have thorough test coverage in `supervisor-loop.service.test.ts`. Well-scoped for a builder.

## Context
The current option parser (`extractAssistantChoiceOptions`, lines ~1169–1220) works as follows:
1. Finds the last match of `OPTION_QUESTION_RE` in the assistant text
2. From that anchor, scans subsequent lines for `OPTION_BULLET_RE` patterns (`- item`, `* item`, `1. item`, `1) item`)
3. Stops collecting at first blank line after options start

The scorer (`selectAutopilotOption`, lines ~1228–1241) filters unsafe options and selects by priority: recommended → productive → verify → first safe.

**Gaps to address:**
- **A/B/C format**: Lines like `A) Improve UI  B) Fix bugs  C) Add tests` are not matched — the regex expects bullet points or numbered items on separate lines
- **Vietnamese**: `OPTION_QUESTION_RE` has some Vietnamese (`bạn chọn`, `chọn hướng`) but misses common patterns like `bạn muốn`, `lựa chọn`, `phương án`
- **Markdown tables**: Options in table rows (`| A | Description |`) are missed entirely
- **Scoring fallbacks**: When no recommended/productive/verify option exists, the first safe option is used — but what if the first safe option is nonsensical? Need a "none safe → escalate" path (already exists in `createOptionQuestionDecision` but scoring could be smarter)

## Relevant repo context
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts` — contains:
  - Regex constants (lines ~41–68): `OPTION_QUESTION_RE`, `OPTION_BULLET_RE`, `UNSAFE_OPTION_RE`, `RECOMMENDED_OPTION_RE`, `PRODUCTIVE_OPTION_RE`, `VERIFY_OPTION_RE`
  - `extractAssistantChoiceOptions()` (lines ~1169–1220)
  - `selectAutopilotOption()` (lines ~1228–1241)
  - `createOptionQuestionDecision()` (lines ~1054–1084) — caller of both functions; do NOT modify logic
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts` — existing tests for option parsing/extraction; add new cases

## Allowed files
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts` (MODIFY — only the functions and regex listed above)
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts` (MODIFY — add test cases)

## Files to avoid
- All other functions in `supervisor-loop.service.ts` — do NOT touch `runReview`, `applyDecision`, `createCorrectDecision`, `createDoneVerificationDecision`, `createMemoryRecoveryDecision`, `buildSnapshot`
- All other files

## Constraints / invariants
1. Function signatures must NOT change: `extractAssistantChoiceOptions(text: string): string[]` and `selectAutopilotOption(options: string[]): string | undefined`
2. Backward compatibility: all existing test cases must pass unchanged
3. `createOptionQuestionDecision` behavior must be preserved — it calls these functions and expects them to work as before, just with better coverage
4. Regexes must use `/i` flag for case-insensitive matching (preserve existing convention)
5. Vietnamese patterns must be added to `OPTION_QUESTION_RE` using the existing alternation syntax
6. `selectAutopilotOption` must never return an unsafe option (the unsafe filter is the first step — preserve this)

## Acceptance criteria
1. **A/B/C format**: `extractAssistantChoiceOptions` parses `"A) Add login  B) Add dashboard  C) Add settings"` into `["Add login", "Add dashboard", "Add settings"]`
2. **Single-line A/B/C**: Options on one line like `"A) Option one B) Option two"` are split correctly
3. **Vietnamese patterns**: `extractAssistantChoiceOptions` detects Vietnamese question anchors with `"bạn muốn tôi:"`, `"lựa chọn:"`, `"phương án:"`
4. **Markdown tables**: Options inside a markdown table after an option question anchor are extracted (e.g., `| 1 | Description |` rows)
5. **Scoring fallback**: `selectAutopilotOption` returns `undefined` when all options are unsafe (preserves existing behavior); adds explicit debug-friendly scoring order
6. **Tests**: At least 8 new test cases covering A/B/C single-line, A/B/C multi-line, Vietnamese anchors, markdown tables, edge cases (empty options, all unsafe, mixed safe/unsafe)
7. `bun test src/modules/supervisor/application/supervisor-loop.service.test.ts` passes
8. Full supervisor test suite passes
9. `bunx biome check` passes

## Validation commands
```bash
cd apps/server
bun test src/modules/supervisor/application/supervisor-loop.service.test.ts
bun test src/modules/supervisor/
bunx biome check src/modules/supervisor/application/supervisor-loop.service.ts
```

## Expected output
- Updated `OPTION_QUESTION_RE` with new Vietnamese patterns
- New regex constant for A/B/C letter-option detection (e.g., `/[A-C][).]\s*(.+?)(?=\s*[A-C][).]|$)/gi`)
- Updated `extractAssistantChoiceOptions` with A/B/C and markdown table parsing branches
- Updated `selectAutopilotOption` with explicit scoring fallback documentation (no behavioral change needed, but verify)
- Test file with 8+ new cases, all passing

## Dependency: none
## Execution mode: PARALLEL
## Stop conditions
- A/B/C or table parsing would require structural changes to function signatures (stop and report)
- New regexes break existing test cases in unexpected ways
- Need to modify `createOptionQuestionDecision` logic (out of scope)
## Blockers: none
