---
artifact_type: ticket
session_id: "20260427-supervisor-policy-hardening"
task_id: T07
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
  - team-heavy
  - team-validator
freshness_rule: invalid_if_plan_brief_or_repo_context_changes
---
# Ticket T07 — Separate Audit Log from Durable Memory Fact Storage

## Objective
Distinguish `SAVE_MEMORY` (durable fact storage for future retrieval) from audit logging (every supervisor decision recorded for traceability) by introducing a separate `SupervisorAuditPort` and refactoring `SupervisorLoopService` to use the right adapter for each purpose. Priority #8 from brief.

## Assigned agent
team-heavy

## Estimated complexity: 55
## Estimated risk: 45

## Routing rationale
This touches the port layer (new interface), the service layer (routing decisions to correct port), the adapter layer (wiring), and potentially the DI container. Requires architectural design of the audit interface and careful separation of concerns. Needs `team-heavy`.

## Context
Currently in `supervisor-loop.service.ts`:

1. **`appendSupervisorLog()`** (lines ~740–771): Called for **every** decision. It records `semanticAction`, `reason`, `turnId`, `autoResumeSignal`, `continuationCount` via `memoryPort.appendLog()`. This is the **audit trail**.

2. **SAVE_MEMORY side effect** (lines ~594–611): When `decision.semanticAction === "SAVE_MEMORY"`, it calls `memoryPort.appendLog()` with `action: "save_memory"` and the `reason` + `latestAssistantTextPart`. This is the **durable fact store**.

Both use the **same** `memoryPort.appendLog()`, but they serve different purposes:
- **Audit log**: Every decision, every turn. Used for debugging, traceability, compliance. Append-only, never queried by the supervisor.
- **Durable memory**: Only `SAVE_MEMORY` decisions. Used for future retrieval by the supervisor (via `memoryPort.lookup()`). The content should be semantically meaningful facts/decisions, not raw audit entries.

**The problem**: When the supervisor does `memoryPort.lookup()`, it retrieves all logged entries — including raw audit entries (e.g., `"CORRECT"`, `"APPROVE_GATE"`) which are noise for future decision-making. Only `SAVE_MEMORY` entries should be retrievable.

**Design:**
1. Create `SupervisorAuditPort` interface with `appendEntry(input: SupervisorAuditEntry): Promise<void>`
2. Move audit logging from `memoryPort.appendLog()` to `auditPort.appendEntry()`
3. Keep `memoryPort.appendLog()` only for `SAVE_MEMORY` semantic action
4. `appendSupervisorLog()` calls `auditPort.appendEntry()` instead of `memoryPort.appendLog()`
5. SAVE_MEMORY side effect still calls `memoryPort.appendLog()`

## Relevant repo context
- `apps/server/src/modules/supervisor/application/ports/supervisor-memory.port.ts` — current `SupervisorMemoryPort` with `appendLog()`; keep for SAVE_MEMORY only
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts` — `appendSupervisorLog()` (lines ~740–771) and SAVE_MEMORY block (lines ~594–611)
- `apps/server/src/modules/supervisor/infra/obsidian-supervisor-memory.adapter.ts` — current implementation of `SupervisorMemoryPort`; its `appendLog` method handles both audit and memory
- `apps/server/src/modules/supervisor/di.ts` — module exports; add audit adapter export
- `apps/server/src/bootstrap/composition.ts` or `container.ts` — DI wiring (check how SupervisorLoopService is constructed)

## Allowed files
- `apps/server/src/modules/supervisor/application/ports/supervisor-memory.port.ts` (MODIFY — add audit port interface, keep memory port)
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts` (MODIFY — `appendSupervisorLog` uses audit port; SAVE_MEMORY still uses memory port)
- `apps/server/src/modules/supervisor/infra/obsidian-supervisor-memory.adapter.ts` (MODIFY — optionally split audit/recovery logging or add audit adapter)
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts` (MODIFY — verify audit/memory separation in tests)
- `apps/server/src/modules/supervisor/di.ts` (MODIFY — export new types if needed)
- `apps/server/src/modules/supervisor/index.ts` (MODIFY — re-export new port if needed)

## Files to avoid
- All files outside the supervisor module
- `supervisor.schemas.ts`
- `supervisor-permission.service.ts`

## Constraints / invariants
1. `SupervisorMemoryPort` must keep `lookup()` and `appendLog()` — `appendLog` now only handles SAVE_MEMORY
2. New `SupervisorAuditPort` interface:
   ```typescript
   export interface SupervisorAuditPort {
     appendEntry(input: SupervisorAuditEntry): Promise<void>;
   }
   export interface SupervisorAuditEntry {
     chatId: string;
     projectRoot: string;
     turnId?: string;
     semanticAction: string;
     reason: string;
     autoResumeSignal?: string;
     continuationCount?: number;
     latestAssistantTextPart: string;
   }
   ```
3. `SupervisorLoopService` constructor adds `auditPort: SupervisorAuditPort` parameter (same pattern as `memoryPort`)
4. `appendSupervisorLog()` calls `this.auditPort.appendEntry()` instead of `this.memoryPort.appendLog()`
5. SAVE_MEMORY side effect (lines 594–611) still calls `this.memoryPort.appendLog()`
6. If no audit adapter is wired (e.g., when `memoryProvider === "none"`), audit logging must degrade gracefully — log a warning but do not crash
7. Existing behavior: `memoryPort.lookup()` must NOT return audit entries — only SAVE_MEMORY facts (verify adapter behavior; may already be filtered by tag/path)

## Acceptance criteria
1. New `SupervisorAuditPort` interface exists in `supervisor-memory.port.ts` (or separate file)
2. `SupervisorAuditEntry` type defined
3. `SupervisorLoopService` accepts `auditPort` in constructor
4. `appendSupervisorLog()` calls `auditPort.appendEntry()` — not `memoryPort.appendLog()`
5. SAVE_MEMORY block still calls `memoryPort.appendLog()` — unmodified
6. A `NoopSupervisorAuditAdapter` exists (or the existing `NoopSupervisorMemoryAdapter` is reused/extended) for the audit port
7. Tests: verify `auditPort.appendEntry` is called on every decision (mock audit port)
8. Tests: verify `memoryPort.appendLog` is called only on SAVE_MEMORY
9. `bun test src/modules/supervisor/application/supervisor-loop.service.test.ts` passes
10. Full supervisor test suite passes
11. `bunx biome check` passes on all modified files

## Validation commands
```bash
cd apps/server
bun test src/modules/supervisor/application/supervisor-loop.service.test.ts
bun test src/modules/supervisor/
bunx biome check src/modules/supervisor/
```

## Expected output
- New or updated port file with `SupervisorAuditPort` interface and `SupervisorAuditEntry` type
- `supervisor-loop.service.ts`: `auditPort` injected, `appendSupervisorLog` updated, SAVE_MEMORY preserved
- Adapter: optional noop audit adapter added
- DI: if container wiring changes needed, document in ticket output for a follow-up (container wiring may be out of allowed files)
- Tests: audit port mock, memory port mock, separation verified

## Dependency: T05 (serialize — both modify supervisor-loop.service.ts)
## Execution mode: SERIALIZE
## Stop conditions
- Container wiring (`compositor.ts` or `container.ts`) is outside allowed files and changes are needed for the new port — implement the port but document wiring change needed
- The existing `NoopSupervisorMemoryAdapter` does not implement `appendLog` correctly for the split — create a dedicated `NoopSupervisorAuditAdapter`
- `memoryPort.lookup()` returns audit entries (contaminating memory lookups) — this is a pre-existing bug, note it but do not fix (out of scope)
## Blockers: none
