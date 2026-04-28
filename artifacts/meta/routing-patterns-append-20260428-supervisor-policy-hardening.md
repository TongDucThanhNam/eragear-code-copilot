# Routing Patterns — Append 2026-04-28 (Supervisor Policy Hardening)

> Sidecar append; parent `artifacts/meta/routing-patterns.md` was read-blocked.
> Session: 20260427-supervisor-policy-hardening T01–T07 curator learning.

---

## Same-File Collision Detection (Confidence: HIGH)

**Pattern**: Before parallel agent dispatch, scan all `allowed_files` / context files across ticket groups. Identify same-file overlaps and serialize those tickets — only one agent writes to a given file at a time.

**Trigger**: Multi-agent parallel execution plans where two or more tickets declare overlapping file targets.

**Routing rule**:
- If `ticketA.allowed_files ∩ ticketB.allowed_files ≠ ∅`, do not run A and B in parallel.
- Serialize them in execution-plan order.
- Apply this check during the explorer → execution-plan transition.

**Rationale**: Prevents silent write collisions, merge-conflict artifacts, and corrupt state from concurrent file writes.

---

## Deterministic Deny-Before-LLM (Confidence: HIGH)

**Pattern**: Permission pipelines must apply a static, deterministic deny filter (allowlist/denylist) *before* any LLM-based evaluation. The LLM permission call is layered between deny-filter and user-approval.

**Pipeline order**: `deterministic deny → LLM permission → user approval`

**Routing rule**:
- Route all permission checks through a gateway that first applies `ALLOWED_HOSTS` / `ALLOWED_COMMANDS` / sandbox-root checks.
- Denied requests never reach the LLM.
- LLM-evaluated requests that pass still gate on user approval for write/destructive operations.

**Rationale**: LLM-based permission is probabilistic and susceptible to prompt injection; deterministic deny is not.

---

## Schema / Runtime Boundary (Confidence: HIGH)

**Pattern**: Classify every schema field as either `LLM-visible` or `server-mapped`. Strip server-mapped fields before model input; re-attach them after model output.

**Routing rule**:
- During prompt construction: remove server-mapped fields from the LLM-facing schema.
- During response processing: map server-computable values back onto the model output before downstream consumption.

**Rationale**: The LLM should not see or be responsible for fields that are purely runtime-determined (timestamps, IDs, computed state). This reduces hallucination risk and tightens the security boundary.

---

## Audit vs Durable Memory — Separate Ports (Confidence: MEDIUM-HIGH)

**Pattern**: Audit logging ports and durable-memory ports should be independent interfaces. Do not route both concerns through a single repository port.

**Routing rule**:
- `AuditPort` — write-only, append-only, high-durability (observability).
- `DurableMemoryPort` — CRUD, session state persistence.
- New modules: declare both ports independently from day one.
- Existing modules: split when the coupling causes friction.

**Rationale**: Conflating audit and persistence creates a single point of failure and makes it difficult to evolve either concern independently.

---

## DI Wiring Coupling (Confidence: MEDIUM)

**Pattern**: Port/service/infra refactors frequently require `container.ts` DI wiring changes. Architect tickets should prewire no-op adapters so downstream tickets can proceed without waiting.

**Routing rule**:
- Architect tickets that introduce new ports must include either:
  - Final DI wiring in `container.ts`, or
  - Stub no-op adapters that satisfy the port interface.
- Downstream implementation tickets should not be blocked on DI wiring.

**Rationale**: Reduces integration-test stalls and allows parallel work across tickets that share new port interfaces.

---

*Appended 2026-04-28 | Session PASS | Do not merge automatically — requires curator review.*
