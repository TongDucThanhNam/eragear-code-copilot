---
artifact_type: explorer_report
session_id: 20260427-supervisor-intent-timeline
task_id: supervisor-reads-conversation-intent-timeline
producer: team-explorer
status: ACTIVE
created_at: 2026-04-27T00:00:00Z
source_commit: 7368059d3d29a992ff788ca31c467c7626de572a
based_on:
  - artifacts/20260427-supervisor-intent-timeline/00-brief.md
  - artifacts/20260427-supervisor-intent-timeline/01-triage-report.md
consumers:
  - team-architect
  - orchestrator
freshness_rule: invalid_if_brief_triage_or_repo_shape_changes
---
# Explorer Report

## Objective interpreted

Add a `userInstructionTimeline` (all compact user messages in chronological order), `originalTaskGoal` (first user message), and `latestUserInstruction` (last user message) to the supervisor turn snapshot. Keep existing `taskGoal` as `currentTaskGoal` for backward compatibility. Update the supervisor prompt to show the user instruction timeline before memory/blueprint with proper precedence. The approval gate must continue safe ticket routing (e.g. `APP-T01` to `team-builder`) and still block unsafe action options (commit/push/deploy/destructive).

## Entry paths

- **path:** `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts`
  **why_it_matters:** Contains `buildSnapshot()` which is the sole snapshot construction method. Currently pages only the first message (forward, limit=1) for `taskGoal` and the latest messages (backward, limit=8) for `latestAssistantTextPart`. Must be extended with a forward pagination loop to collect all user messages for the timeline. Also contains `selectAutopilotOption()` and `createOptionQuestionDecision()` — the approval gate entry point.

- **path:** `apps/server/src/modules/supervisor/application/ports/supervisor-decision.port.ts`
  **why_it_matters:** Defines `SupervisorTurnSnapshot` interface (lines 21-35). Must add `originalTaskGoal`, `latestUserInstruction`, `userInstructionTimeline`. Keep existing `taskGoal` for compatibility. All snapshot consumers reference this type.

- **path:** `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.ts`
  **why_it_matters:** `buildSupervisorTurnPrompt()` (line 34-116) consumes the snapshot to build the LLM prompt. `SUPERVISOR_TURN_SYSTEM_PROMPT` (line 15-25) sets supervisor behavior rules. `buildSupervisorFollowUpPrompt()` (line 118-147) contains the wording "Continue the original user task" that must be replaced. All three need modification.

## Relevant files and modules

| Path | Role | Confidence |
|------|------|------------|
| `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts` | Primary snapshot builder; approval gate decision logic; message paging orchestration | **HIGH** |
| `apps/server/src/modules/supervisor/application/ports/supervisor-decision.port.ts` | `SupervisorTurnSnapshot` interface definition | **HIGH** |
| `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.ts` | Prompt construction; system prompt wording; follow-up prompt wording | **HIGH** |
| `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts` | Tests for snapshot extraction; approval gate safe/unsafe behavior | **HIGH** |
| `apps/server/src/modules/supervisor/application/supervisor-prompt.builder.test.ts` | Tests for prompt wording and ordering | **HIGH** |
| `apps/server/src/modules/session/application/ports/session-repository.port.ts` | `getMessagesPage()` interface (line 115-119); `SessionMessagesPageQuery`/`SessionMessagesPageResult` types | **HIGH** |
| `apps/server/src/modules/session/application/session-history-replay.service.ts` | Reference pattern for paging ALL messages via forward loop (lines 69-109) | **MEDIUM** |
| `apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.ts` | Snapshot consumer: passes prompt to LLM via `buildSupervisorTurnPrompt(input)` (line 49). No snapshot field destructuring — uses `input.chatId` only. Low blast radius. | **MEDIUM** |
| `apps/server/src/modules/supervisor/application/supervisor-permission.service.ts` | `getTaskGoal()` (line 150-168) also does first-message-only paging — may eventually benefit from timeline but out of scope per brief non-goals. | **LOW** |
| `apps/server/src/modules/supervisor/infra/obsidian-supervisor-memory.adapter.ts` | Uses `latestAssistantTextPart` via `appendLog()`; no snapshot destructuring. No changes needed. | **LOW** |
| `apps/server/src/shared/types/supervisor.types.ts` | `SupervisorDecisionSummary` and `SupervisorSessionState` types — not directly affected. | **LOW** |
| `apps/server/src/modules/supervisor/application/supervisor.schemas.ts` | Zod schemas for turn/permission decisions — not affected. | **LOW** |

## Suspected change surface

### 1. `supervisor-decision.port.ts` — Snapshot interface
Add three fields to `SupervisorTurnSnapshot`:
```typescript
originalTaskGoal: string;          // first user message content
latestUserInstruction: string;     // last user message content
userInstructionTimeline: string[]; // all user messages in chronological order
```
Keep existing `taskGoal: string` as `currentTaskGoal` for backward compatibility.

### 2. `supervisor-loop.service.ts` — Timeline extraction in `buildSnapshot()`
Current flow (lines 382-457):
- `firstPage` = getMessagesPage(forward, limit=1) → extracts `taskGoal`
- `latestPage` = getMessagesPage(backward, limit=8) → extracts `latestAssistantTextPart`

New flow:
- Keep `firstPage` forward/limit=1 to extract `originalTaskGoal`
- Keep `latestPage` backward/limit=8 to extract `latestAssistantTextPart`
- **Add forward pagination loop** (mirror `SessionHistoryReplayService` lines 69-109):
  ```
  let cursor: number | undefined;
  const allMessages: StoredMessage[] = [];
  while (true) {
    const page = await this.sessionRepo.getMessagesPage(chatId, userId, { cursor, limit: <batchSize>, direction: "forward", includeCompacted: true });
    allMessages.push(...page.messages);
    if (!page.hasMore || page.nextCursor === undefined) break;
    cursor = page.nextCursor;
  }
  ```
- Derive `userInstructionTimeline = allMessages.filter(m => m.role === "user").map(m => m.content)` in chronological order
- Derive `latestUserInstruction = userInstructionTimeline[userInstructionTimeline.length - 1]` (or "" if none)
- Set snapshot.originalTaskGoal = originalTaskGoal, snapshot.latestUserInstruction = latestUserInstruction, snapshot.userInstructionTimeline = userInstructionTimeline

**Batch size recommendation:** Use `STORED_REPLAY_PAGE_LIMIT = 200` constant pattern, or define a local constant like `USER_TIMELINE_PAGE_LIMIT = 100`. The brief requires bounding payload — apply `truncateText()` (already available in file as `truncateStart()`, line 883) per user message and cap total array size.

**Truncation:** Add a constant `MAX_USER_INSTRUCTION_CHARS = 2000` for per-message truncation and `MAX_TIMELINE_MESSAGES = 50` for total cap. Already have `truncateStart()` utility at line 883 of the same file.

### 3. `supervisor-loop.service.ts` — `runOptionalMemory()` and `runOptionalResearch()` calls
These currently receive `taskGoal` as a search query parameter (line 416-424). Replace `taskGoal` with `latestUserInstruction` for the search haystack so memory/research queries reflect the latest user scope.

### 4. `supervisor-prompt.builder.ts` — Prompt restructuring
**`buildSupervisorTurnPrompt()` (lines 34-116):**
- After line 69 (`Task goal:` section), add new section:
  ```
  "User instruction timeline:",
  ...snapshot.userInstructionTimeline.map((text, idx) => `${idx + 1}. ${text}`).join("\n") || "(no user instructions)",
  ```
- Add after new section: a **precedence statement** (before line 97 `"Important:"`):
  ```
  "Precedence: latest human instruction > user instruction timeline > latest assistant proposal/gate > plan/artifacts > memory/blueprint > original task.",
  ```

**`SUPERVISOR_TURN_SYSTEM_PROMPT` (lines 15-25):**
- Change "Use the project blueprint and local memory as guardrails." wording — needs to include instruction timeline as the primary guardrail.
- Already has rule against commit/push/deploy/destructive — keep that.

**`buildSupervisorFollowUpPrompt()` (lines 118-147):**
- Line 134: Change `"Continue the original user task using the existing project architecture..."` to `"Continue the current user-approved scope using the existing project architecture..."`.

### 5. `selectAutopilotOption()` (lines 1032-1044)
Safe ticket routing (e.g. `APP-T01` to `team-builder`) — the current regex `UNSAFE_OPTION_RE` matches commit/push/deploy/destructive. Options containing `APP-T01` or `team-builder` do not match the unsafe regex, so they will be considered safe options. The function selects in priority order: recommended → productive → verify → first safe. A generic option like `"Route APP-T01 to team-builder"` does not match `RECOMMENDED_OPTION_RE` but would match `PRODUCTIVE_OPTION_RE` (contains "improve|refine|polish|fix|continue|next|..."). If not, it falls through to `safeOptions[0]`.

**No code change needed for the gate itself,** but the test must verify:
- Input with safe routing option → returns `continue`
- Input with commit/push/deploy/destructive → option is excluded; if destructive is the only option → returns `undefined` (no decision)

## Boundaries / files to avoid

| File | Reason to avoid |
|------|----------------|
| `apps/server/src/modules/session/infra/session.repository.sqlite.ts` | Implementation detail of `getMessagesPage()` — not relevant for supervisor behavioral change. |
| `apps/server/src/modules/session/application/get-session-messages.service.ts` | UI-facing message retrieval with `mapStoredMessageToUiMessage` — not used by supervisor. Supervisor calls `sessionRepo.getMessagesPage()` directly. |
| `apps/server/src/modules/supervisor/infra/exa-supervisor-research.adapter.ts` | Web search adapter — no snapshot dependency. |
| `apps/server/src/modules/supervisor/infra/ai-sdk-supervisor-decision.adapter.ts` | Consumes `buildSupervisorTurnPrompt(input)` — no direct snapshot field destructuring. Only reads `input.chatId`. No changes needed. |
| `apps/server/src/modules/supervisor/application/supervisor.schemas.ts` | Zod schemas for decision output — not affected by input snapshot shape. |
| `apps/server/src/shared/types/supervisor.types.ts` | Contains `SupervisorDecisionSummary` and `SupervisorSessionState` — neither needs changes. |
| `apps/server/src/modules/supervisor/application/supervisor-permission.service.ts` | Uses `getTaskGoal()` which also does first-message-only paging, but brief says "Do not change unrelated server ACP/session flow." Out of scope. |

## Validation surface

| Command or check | Why |
|---|---|
| `bun run check-types` | Snapshot interface addition may cause type errors if consumers destructure `SupervisorTurnSnapshot` directly. The `taskGoal` field is preserved, so this should pass. |
| `bun test supervisor-loop.service.test.ts` | New tests for timeline extraction, chronological ordering, safe/unsafe approval gates. |
| `bun test supervisor-prompt.builder.test.ts` | New tests for prompt includes instruction timeline, does not contain "original user task" wording, precedence order correct. |
| `bun test supervisor-permission.service.test.ts` | Pre-existing — ensure `selectPermissionOption()` still passes, no regression. |
| `bun test supervisor.schemas.test.ts` | Pre-existing — ensure zod schemas unchanged. |
| Manual: inspect `createOptionQuestionDecision()` with text containing `"APP-T01"` + `"team-builder"` | Verify safe ticket routing is not blocked. The option text does not match `UNSAFE_OPTION_RE` and should be selectable via `PRODUCTIVE_OPTION_RE` or as `safeOptions[0]`. |
| Manual: inspect `createOptionQuestionDecision()` with text containing `"AppLayout first"` when older messages say `"KPIGroup"` | Verify prompt shows "current user-approved scope" = AppLayout, not original KPIGroup. |

## Triage calibration

- **complexity_assessment:** LOWER
  Triage scored 58/100 (6/10). After exploration, the changes are localized to 3 application-layer files + 2 test files. The `getMessagesPage()` pagination pattern is already proven by `SessionHistoryReplayService`. No cross-boundary complexity, no transport changes.

- **risk_assessment:** MATCHED
  Triage scored 47/100 (5/10). Risk is correct: approval gate semantics and prompt precedence require care, but blast radius is confined to supervisor application code. Adding new fields to the snapshot interface is backward-compatible since `taskGoal` is preserved. All infra adapters remain unchanged.

- **suggested_executor:** team-builder
  Server-only, application-layer change with focused tests. No cross-boundary UI/tooling changes. Complexity is moderate but well-scoped.

- **rationale:**
  The exploration confirms the triage assessment: supervisor module application layer is the sole change surface. The message paging API (`getMessagesPage`) already exists and has a proven usage pattern in `SessionHistoryReplayService`. No new ports or infra needed. The approval gate logic (`selectAutopilotOption`) already correctly filters unsafe options by regex — the brief's safe routing scenario passes through without modification. Prompt wording changes are isolated to constant strings and a single template function.

## Risks / unknowns

1. **Payload size:** Paging all user messages could return many items for long-running sessions. Mitigation: apply `truncateStart()` per message and cap total timeline messages (recommend `MAX_TIMELINE_MESSAGES = 50`). The brief says "User messages are usually small; truncation exists only as a safety cap."

2. **Cached `taskGoal` usage in memory/research:** `runOptionalMemory()` and `runOptionalResearch()` currently pass `taskGoal` as the haystack for search queries. The timeline-derived `latestUserInstruction` is semantically more appropriate. If `taskGoal` (first user message) differs significantly from `latestUserInstruction` (most recent), the wrong context is being sent to memory/research. Mitigation: switch these to use `latestUserInstruction` instead.

3. **`createMemoryRecoveryDecision` compatibility:** This function (lines 962-989) receives the full snapshot. It accesses `snapshot.projectBlueprint`, `snapshot.memoryResults`, and `snapshot.latestAssistantTextPart`. Adding new fields does not break it. No change needed.

4. **`appendSupervisorLog()` compatibility:** Logs `snapshot.latestAssistantTextPart`. Not affected.

5. **`buildSupervisorFollowUpPrompt()` call site** in `applyDecision()` (line 605-611): receives `followUpPrompt`, `projectBlueprint`, `memoryResults` as individual params, not the snapshot. The `"Continue the original user task"` replacement is low risk but must be exact string match.

6. **Race condition with concurrent message appends:** The pagination loop happens outside `sessionRuntime.runExclusive()`. If new messages arrive during paging, the timeline could be slightly stale. This is acceptable — the snapshot is already read-only and non-transactional. The existing code has the same race (first-page fetch is not locked).

7. **Config override safety:** `selectAutopilotOption()` line 1034 uses `UNSAFE_OPTION_RE` which matches commit/push/deploy/destructive. If a user asks for a "deploy", the assistant may present options containing "deploy" which would be filtered out as unsafe. This is the *desired* behavior per brief: "Unsafe approval gates containing commit/push/deploy/destructive actions are not auto-approved."

## Blockers

- **none**

## Implementation notes for team-builder

### Step order recommendation
1. Add new fields to `SupervisorTurnSnapshot` in `supervisor-decision.port.ts`
2. Implement `userInstructionTimeline` extraction in `buildSnapshot()` of `supervisor-loop.service.ts`
3. Update `buildSupervisorTurnPrompt()` and `SUPERVISOR_TURN_SYSTEM_PROMPT` in `supervisor-prompt.builder.ts`
4. Update `buildSupervisorFollowUpPrompt()` wording
5. Update `runOptionalMemory()` / `runOptionalResearch()` to use `latestUserInstruction` instead of `taskGoal`
6. Add tests to `supervisor-loop.service.test.ts`
7. Add tests to `supervisor-prompt.builder.test.ts`
8. Run full supervisor test suite

### Key type references
- `StoredMessage.role`: `"user" | "assistant"` (session.types.ts:41)
- `SessionMessagesPageQuery`: `{ cursor?: number; direction?: "forward" | "backward"; limit?: number; includeCompacted?: boolean }` (session-repository.port.ts:22-27)
- `SessionMessagesPageResult`: `{ messages: StoredMessage[]; nextCursor?: number; hasMore: boolean }` (session-repository.port.ts:29-33)
- `DEFAULT_SESSION_MESSAGES_PAGE_LIMIT = 100` (constants.ts:134)
- `HARD_MAX_SESSION_MESSAGES_PAGE_LIMIT = 2000` (constants.ts:138)

### Reference pagination pattern (from `SessionHistoryReplayService.replayStoredMessages()` lines 69-109)
```typescript
const storedMessages: StoredMessage[] = [];
let cursor: number | undefined;
while (true) {
  const page = await this.sessionRepo.getMessagesPage(chatId, userId, {
    cursor,
    limit: STORED_REPLAY_PAGE_LIMIT, // 200
    includeCompacted: true,
  });
  storedMessages.push(...page.messages);
  if (!page.hasMore || page.nextCursor === undefined) {
    break;
  }
  cursor = page.nextCursor;
}
```

### Approval gate test patterns (for supervisor-loop.service.test.ts)
- Mock `createOptionQuestionDecision()` with `APP-T01`/`team-builder` option text → verify returns `{ action: "continue", ... }`
- `extractAssistantChoiceOptions()` already tested (lines 135-183)
- New test: `selectAutopilotOption()` with only unsafe options → returns `undefined`
- New test: mixed safe + unsafe → safe option selected, unsafe excluded

### Snapshot test mock shape
```typescript
{
  chatId: string;
  projectRoot: string;
  stopReason: string;
  taskGoal: string;        // keep for compat as currentTaskGoal
  latestAssistantTextPart: string;
  originalTaskGoal: string;
  latestUserInstruction: string;
  userInstructionTimeline: string[];
  // ... optional fields per current interface
}
```

### Prompt string locations to change
- **Line 134 in `supervisor-prompt.builder.ts`:** `"Continue the original user task using the existing project architecture and tech stack."` → `"Continue the current user-approved scope using the existing project architecture and tech stack."`
- **Lines 15-25 (`SUPERVISOR_TURN_SYSTEM_PROMPT`):** Add instruction timeline precedence rule.
- **Lines 97-98:** After "Important:", add precedence statement before the existing token-saving note.
