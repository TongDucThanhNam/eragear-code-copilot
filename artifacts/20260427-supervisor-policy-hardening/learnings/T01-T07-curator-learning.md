# T01–T07 Curator Learning — 2026-04-27 Supervisor Policy Hardening

> Compiled from execution trace across tickets T01–T07.
> Curator post-mortem; does not modify production code.

---

## 1. Same-File Collision Detection
**Confidence: HIGH**

The supervisor must scan `allowed_files` / context files across parallel groups and serialize overlapping same-file tickets. Without this, multi-agent writes to the same file can race and produce silent corruption or merge-conflict artifacts.

- **Observed risk**: T04 (hard-deny) and T05 (tighten-done-gate) both touched `permission.ts` / `tool-calls.ts` independently.
- **Mitigation in-flight**: serialization was applied retroactively after detecting overlap in the explorer phase.
- **Forward rule**: execution plans must include a "file-collision" pre-pass; any same-file overlap must be serialized regardless of agent parallelism.

---

## 2. Deterministic Deny-Before-LLM
**Confidence: HIGH**

Security and permission gates must apply a pure deterministic deny filter *before* any LLM-based permission evaluation. The LLM layer is probabilistic; the deny filter must be a static allowlist/denylist that is computable without model inference.

- **Observed in T04**: the hard-deny permission refactor moved host-allowlist checks *ahead* of LLM permission calls.
- **Rationale**: if the deny filter runs after or interleaved with LLM, an attacker can exploit prompt-injection to bypass it.
- **Forward rule**: all permission pipelines must follow the pattern `deterministic deny → LLM permission → user approval` (layered, non-bypassable).

---

## 3. Schema / Runtime Boundary
**Confidence: HIGH**

Fields computable by the server must be removed from LLM-facing schemas and mapped server-side. The LLM should not see or produce fields that are purely runtime-determined.

- **Observed in T01**: `RuntimeAction` schema exposed server-computable fields to the LLM; these were extracted and mapped server-side.
- **Forward rule**: schema design must classify fields as `LLM-visible` vs `server-mapped`; server-mapped fields are stripped before model input and re-attached after model output.

---

## 4. Audit vs Durable Memory — Separate Ports
**Confidence: MEDIUM-HIGH**

Audit logging and durable memory (persistence) should use separate port interfaces. Coupling them creates a single point of failure and conflates observability with state durability.

- **Observed in T07**: the initial design routed both audit and session-persistence through a shared `SessionRepositoryPort`. The refactor split them into `AuditPort` and `DurableMemoryPort`.
- **Forward rule**: new modules should declare audit and memory ports independently from day one; existing modules should be refactored when the coupling causes friction.

---

## 5. DI Wiring Coupling
**Confidence: MEDIUM**

Port/service/infra refactors frequently require changes to the bootstrap DI file (`container.ts`). Architect-level tickets should either include the DI wiring step or prewire no-op adapters so that downstream tickets can build without waiting.

- **Observed in T04–T07**: multiple tickets stalled briefly because they needed `container.ts` updates before integration tests could pass.
- **Forward rule**: architecture tickets should ship with a "DI scaffold" — either the final wiring or stub no-op adapters that satisfy the ports.

---

## 6. Estimation Calibration
**Confidence: LIGHT (calibration note)**

T05, T06, and T07 were initially estimated as "heavy" but actual implementation complexity was lower:

- **T05 (tighten-done-gate)**: pure state-machine logic; finished well under estimate.
- **T06 (loop-detection)**: simple counter/timestamp state tracking; lighter than expected.
- **T07 (separate-audit-memory)**: dual-port refactor was straightforward once the interface split was clear.

**Calibration adjustment**: future pure-computation state-tracking tickets and dual-port refactors may be suitable for team-builder level unless they touch security-sensitive pathways. Do not overfit these three data points; treat as light calibration signal only.

---

## Summary

| # | Learning | Confidence |
|---|----------|------------|
| 1 | Same-file collision detection across parallel groups | HIGH |
| 2 | Deterministic deny-before-LLM in permission pipelines | HIGH |
| 3 | Schema/runtime boundary — strip server-computable fields | HIGH |
| 4 | Audit vs durable memory — separate ports | MEDIUM-HIGH |
| 5 | DI wiring coupling — prewire no-op adapters | MEDIUM |
| 6 | Estimation calibration — T05/T06/T07 lighter than expected | LIGHT |

*Generated 2026-04-28 by team-artifact-writer. Session status: PASS.*
