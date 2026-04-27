# Routing Metrics

> Calibration data for routing heuristics: estimate vs actual, risk, validation quality.
> Each entry is dated and tied to a specific task.

---

## 2026-04-25 | T02 (Model Selector Lag)
- **Estimate:** 38
- **Actual:** 29
- **Risk:** LOW
- **Validation:** PASS, quality 91
- **Routing:** team-builder appropriate for bounded-render after data-cap.

## 2026-04-26 | T01 (Supervisor UI ChatInput)
- **Estimate:** 55
- **Actual:** 62
- **Risk:** MEDIUM
- **Validation:** PASS, quality 89
- **Routing:** team-heavy required due to cross-layer hydration complexity.

## 2026-04-27 | T05 (Opencode Init Model List Lag)
- **Estimate:** 42
- **Actual:** 35
- **Risk:** LOW
- **Validation:** PASS, quality 93
- **Routing:** team-builder appropriate for test-only hardening after PASS.

## 2026-04-27 | T06 (Persistent Lag Diagnosis)
- **Estimate:** 78 (complexity), 68 (risk)
- **Actual:** 72 (complexity), 25 (risk)
- **Complexity Delta:** MATCHED — within expected range for cross-boundary diagnostics.
- **Risk Delta:** OVERESTIMATED — dev-only gating (env/localStorage/query flag) + metadata-only instrumentation (no raw payload) reduces production risk to near-zero. Cross-boundary semantic changes would carry higher risk; diagnostics with dev-off default are inherently lower risk.
- **Calibration Rule:** Complexity floor 70+ for any cross-boundary ACP+tRPC+React diagnostic task.
- **Risk Rule:** If diagnostics are disabled by default (behind env/localStorage/query gate) and log only metadata (bytes/counts/durations), production risk is significantly lower than cross-boundary semantic changes. Recalibrate risk estimate downward when dev-only gating is part of the ticket spec.
- **Validation:** PASS, quality 92
- **Routing:** team-heavy required for cross-boundary performance diagnostics.
