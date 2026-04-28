# Routing Metrics — Append 2026-04-28 (Supervisor Policy Hardening)

> Sidecar append; parent `artifacts/meta/routing-metrics.md` was read-blocked.
> Session: 20260427-supervisor-policy-hardening T01–T07 curator learning.

---

## Estimation Calibration Signal (Confidence: LIGHT)

### Tickets Compared

| Ticket | Label | Estimated | Actual | Delta |
|--------|-------|-----------|--------|-------|
| T05 — Tighten Done Gate | heavy | ~large | ~medium | under |
| T06 — Loop Detection | heavy | ~large | ~medium | under |
| T07 — Separate Audit/Memory | heavy | ~large | ~medium | under |

### Calibration Observation

T05, T06, and T07 were all initially estimated as "heavy" but actual implementation complexity fell in the medium range:

- **T05**: Pure state-machine transition logic; no new IO, no new ports.
- **T06**: Simple counter/timestamp-based state tracking; minimal surface area.
- **T07**: Dual-port refactor — straightforward once the interface split was clearly defined.

### Routing Implication

Future tickets matching these profiles may be routed to **team-builder** level rather than **architect**:

- Pure-computation state tracking (no new IO, no security boundary changes)
- Dual-port refactors (clear interface split, existing patterns to follow)
- **Exception**: retain architect-level routing if the change touches security-sensitive pathways (permission pipelines, auth, sandbox enforcement).

### Anti-Overfitting Notice

This is a light calibration signal from three tickets in one session. Do not generalize to all "heavy"-labeled tickets. Apply incrementally; revisit after 3–5 more sessions.

---

## Collision Detection Metric (Confidence: HIGH)

**Metric**: Number of same-file overlaps detected during explorer → execution-plan transition.

**This session**: 1 collision detected (T04 ↔ T05 on `permission.ts` / `tool-calls.ts`). Resolved by serialization before dispatch.

**Threshold**: Any overlap > 0 triggers mandatory serialization pre-pass.

---

## Permission Pipeline Efficiency (Confidence: HIGH)

**Metric**: Ratio of requests filtered at deterministic-deny layer vs reaching LLM.

**This session**: T04 refactor moved all host-allowlist checks to deterministic-deny layer. Previously some checks were interleaved with LLM evaluation.

**Target**: 100% of allowlist/denylist checks at deterministic-deny layer; 0% evaluated by LLM.

---

*Appended 2026-04-28 | Session PASS | Do not merge automatically — requires curator review.*
