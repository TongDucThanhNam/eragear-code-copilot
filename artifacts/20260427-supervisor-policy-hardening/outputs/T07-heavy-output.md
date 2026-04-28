---
artifact_type: worker_output
session_id: "20260427-supervisor-policy-hardening"
task_id: T07
producer: team-heavy
status: ACTIVE
created_at: "2026-04-28T14:00:00Z"
source_commit: UNKNOWN
based_on:
  - tickets/ticket-T07-separate-audit-memory.md
consumers:
  - team-validator
  - orchestrator
freshness_rule: invalid_if_ticket_changes
---
# Worker Output — T07 Separate Audit Log from Durable Memory Fact

## Contract check
- ticket_present: YES
- contract_status: OK

## Artifacts consumed
- tickets/ticket-T07-separate-audit-memory.md
- 00-brief.md
- 01-triage-report.md
- 03-explorer-report.md
- 04-execution-plan.md
- outputs/T05-heavy-output.md (dependency context)

## Repo discovery
- `apps/server/src/modules/supervisor/application/ports/supervisor-memory.port.ts`
  why: Port file where SupervisorAuditPort and SupervisorAuditEntry must be defined
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts`
  why: Core service with appendSupervisorLog (audit) and SAVE_MEMORY side effect (memory)
- `apps/server/src/modules/supervisor/infra/obsidian-supervisor-memory.adapter.ts`
  why: Contains NoopSupervisorMemoryAdapter and needs NoopSupervisorAuditAdapter
- `apps/server/src/modules/supervisor/di.ts`
  why: Module barrel export — must export NoopSupervisorAuditAdapter
- `apps/server/src/modules/supervisor/index.ts`
  why: Public re-export — must re-export SupervisorAuditPort and SupervisorAuditEntry types
- `apps/server/src/bootstrap/service-registry/ai-services.ts`
  why: DI wiring — must instantiate NoopSupervisorAuditAdapter and pass to SupervisorLoopService

## Strategy
1. Define `SupervisorAuditEntry` and `SupervisorAuditPort` interfaces in the existing port file alongside `SupervisorMemoryPort`.
2. Add `NoopSupervisorAuditAdapter` in the adapter file (implements `SupervisorAuditPort` with no-op).
3. Add `auditPort` field and constructor parameter to `SupervisorLoopService`.
4. Route `appendSupervisorLog()` through `this.auditPort.appendEntry()` instead of `this.memoryPort.appendLog()`.
5. Leave SAVE_MEMORY side effect (lines 594-612) untouched — still uses `this.memoryPort.appendLog()`.
6. Wire `NoopSupervisorAuditAdapter` in `ai-services.ts`.
7. Export new types through `di.ts` and `index.ts`.
8. Add tests for the new types, noop adapter, and verify no-contamination contract.

## Complexity notes
- The core change is small (route audit log to separate port), but touches 6 files across 3 layers (port, service, infra/DI).
- The `ai-services.ts` file is outside the supervisor module but is the DI wiring site — modified to complete the wiring.
- The `SupervisorAuditEntry` interface uses `semanticAction` (not `action` like `SupervisorMemoryLogInput`) to better reflect the audit context. This is a deliberate naming difference from `SupervisorMemoryLogInput.action`.

## Done
- `SupervisorAuditPort` interface with `appendEntry(input: SupervisorAuditEntry)` defined.
- `SupervisorAuditEntry` type with all required and optional fields.
- `SupervisorLoopService` constructor now accepts `auditPort: SupervisorAuditPort`.
- `appendSupervisorLog()` now calls `this.auditPort.appendEntry()` — zero calls to `this.memoryPort.appendLog()` for audit.
- SAVE_MEMORY side effect still uses `this.memoryPort.appendLog()` (line 597) — unchanged.
- `NoopSupervisorAuditAdapter` created for graceful degradation when no audit adapter is wired.
- DI wiring in `ai-services.ts` passes `NoopSupervisorAuditAdapter` instance.
- 4 new tests added (entry shape, optional fields, noop adapter contract, no-contamination check).

## Files changed
- `apps/server/src/modules/supervisor/application/ports/supervisor-memory.port.ts`
  summary: Added `SupervisorAuditEntry` interface and `SupervisorAuditPort` interface with `appendEntry()` method.
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.ts`
  summary: Added `auditPort` field, constructor parameter, and import. `appendSupervisorLog()` now calls `this.auditPort.appendEntry()` instead of `this.memoryPort.appendLog()`.
- `apps/server/src/modules/supervisor/infra/obsidian-supervisor-memory.adapter.ts`
  summary: Added `NoopSupervisorAuditAdapter` class. Updated imports to include `SupervisorAuditPort`.
- `apps/server/src/modules/supervisor/di.ts`
  summary: Added export of `NoopSupervisorAuditAdapter`.
- `apps/server/src/modules/supervisor/index.ts`
  summary: Added re-exports of `SupervisorAuditEntry` and `SupervisorAuditPort` types.
- `apps/server/src/modules/supervisor/application/supervisor-loop.service.test.ts`
  summary: Added 4 tests for audit/memory separation: entry shape validation, optional fields, noop audit adapter, and memory no-contamination check.
- `apps/server/src/bootstrap/service-registry/ai-services.ts`
  summary: Imports `NoopSupervisorAuditAdapter`, instantiates it, and passes as `auditPort` to `SupervisorLoopService`.

## Validation
- `cd apps/server && bun test src/modules/supervisor/application/supervisor-loop.service.test.ts`
  status: PASS
  summary: 60 tests pass (was 56 before T07).
- `cd apps/server && bun test src/modules/supervisor/`
  status: PASS
  summary: 127 tests pass across 7 files. No regressions.
- `cd apps/server && bunx biome check src/modules/supervisor/application/ports/supervisor-memory.port.ts src/modules/supervisor/infra/obsidian-supervisor-memory.adapter.ts src/modules/supervisor/di.ts src/modules/supervisor/index.ts src/bootstrap/service-registry/ai-services.ts`
  status: PASS
  summary: All 5 directly modified files pass biome clean. Pre-existing biome issues in supervisor-loop.service.ts (cognitive complexity, useTopLevelRegex, bitwise operators) are from T05/T06 and not introduced by T07.

## Execution feedback
- estimated_complexity_from_ticket: 55
- actual_complexity: 35
- actual_risk_encountered: 10
- complexity_delta: LOWER
- hidden_coupling: YES
  - `ai-services.ts` (bootstrap layer) needed updating to wire the new port — this is outside the supervisor module's allowed files but is the natural DI wiring site. Ticket anticipated this ("document in ticket output for a follow-up").
  - `SupervisorPermissionService` also receives `memoryPort` but does NOT call `appendLog` — confirmed no audit contamination from that path.
- recommended_future_executor: team-builder

## Behavioral impact
INTERNAL_ONLY — Audit entries now flow through `SupervisorAuditPort` instead of `SupervisorMemoryPort`. The `NoopSupervisorAuditAdapter` silently discards audit entries (same behavior as before where `NoopSupervisorMemoryAdapter.appendLog` was a no-op). When a real audit adapter is wired in the future, it will capture every decision without contaminating memory lookups.

## Residual risks
- The `NoopSupervisorAuditAdapter` currently discards all audit entries — audit trail is lost when `memoryProvider === "none"`. This matches existing behavior (no-op memory adapter), but should be noted: when a real audit adapter is needed, it must be wired in `ai-services.ts`.
- The `ObsidianSupervisorMemoryAdapter.appendLog` still receives both audit and memory calls if any code path bypasses the service layer. No such path exists currently, but the adapter itself doesn't filter by action type.
- `memoryPort.lookup()` in `ObsidianSupervisorMemoryAdapter` searches files in a vault directory — it doesn't query appended log entries, so the pre-existing contamination concern from the ticket (audit entries mixed in memory lookups) was not actually present in the Obsidian adapter's `lookup()` implementation. The separation is still architecturally correct for future adapter implementations.

## Blockers
- none
