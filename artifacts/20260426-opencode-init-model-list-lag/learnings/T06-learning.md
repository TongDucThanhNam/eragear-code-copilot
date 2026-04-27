# T06 Learning Artifact

## Status: PASS ✅

## Task
**T06** — Persistent lag diagnosis after model-list cap (dev-only diagnostics, no production code change)

## Complexity
- **Estimate:** 78
- **Actual:** 72
- **Delta:** MATCHED (complexity within expected range; cross-boundary ACP+tRPC+React diagnostics inherently high-complexity)

## Risk Assessment
- **Actual Risk:** 25 (LOW)
- **Reasoning:** All instrumentation is dev-only gated (behind env/localStorage/query flag), metadata-only logging (bytes/counts/durations, no raw payload), and disabled by default. Production exposure is zero. Initial estimate of 68 was overestimated — the dev-only gating and metadata-only approach drastically reduce production risk compared to cross-boundary semantic changes.

## Validation Quality
- **Score:** 92/100
- Validator: team-curator
- All probe points log correctly under dev gate; no raw payload leaked; React render-count probes accurate.

## Recommended Future Executor
**team-heavy** — Cross-boundary ACP+tRPC+React performance diagnostics require deep system knowledge across all three layers. Never route to team-builder.

## Reusable Pattern

### Evidence-First Diagnostics After Narrow Fix Persistence

- **Trigger:** A prior narrow fix or cap applied to resolve observed lag does not eliminate the lag; the problem persists after the fix.
- **Approach:** 
  1. Map the full chain: ACP connection → server handlers → transport (tRPC) → client state → React render.
  2. Add dev-only gated diagnostic probes at each boundary (env flag, localStorage key, or URL query param).
  3. Log only metadata: byte sizes, message counts, elapsed durations. Never log raw payloads.
  4. Route execution to **team-heavy** — cross-boundary ACP+tRPC+React diagnostics require deep system knowledge.
- **Anti-pattern:** Applying another speculative narrow fix without evidence. Raw payload logging in diagnostics (risk of leaking session data or credentials into logs).
- **Calibration:**
  - `actual_complexity`: 72 (matches 70+ floor for cross-boundary diagnostics)
  - `actual_risk`: 25 (overestimated at 68; dev-only gating + metadata-only approach keeps production risk low)
  - **Complexity floor 70+** for any cross-boundary ACP+tRPC+React diagnostic task.
- **Promotion:** Requires human review before merging to main. Dev-only gates ensure zero production impact; confirm gate mechanism is documented and discoverable.

## Artifact Links
- Ticket: `artifacts/20260426-opencode-init-model-list-lag/tickets/T06-dev-diagnostics.md`
- Output: `artifacts/20260426-opencode-init-model-list-lag/outputs/T06-output.md`
- Validation: `artifacts/20260426-opencode-init-model-list-lag/validation/T06-validation.md`
