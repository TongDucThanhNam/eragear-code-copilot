# T04 Output — Fix Config Options Truncation

## Status: ACTIVE

## Metadata
- **Task ID:** T04
- **Producer:** team-heavy
- **Ticket:** `tickets/T04-fix-config-options-truncation.md`

---

## Contract Check

The server-side `config_options_update` mechanism and `getSessionState` were inspected against the contract implied by T01/T02 fixes. The contract requires that model-list responses be capped at or below 100 entries throughout the entire pipeline: utility cap (T01) → server exit-cap on populate (T02) → config-options delivery to clients (T04). T04 verified that both the `config_options_update` event payload and the `getSessionState` response now honor the ≤100 cap after the T01/T02 caps are applied upstream. No contract regressions were detected.

---

## Files Changed

| File | Change |
|------|--------|
| `apps/server/src/infra/acp/update.ts` | Review/confirm that `config_options_update` payload respects the ≤100 cap propagated from upstream (T01/T02) |
| `apps/server/src/transport/trpc/routers/session.ts` | Review/confirm that `getSessionState` returns capped model config options |
| (No production code edits by T04 — verification pass only; cap already enforced by T01+T02 upstream) |

---

## Strategy

**Approach:** Verification-only task. T04 did not introduce new production code; it validated that the end-to-end delivery chain for model config options (utility cap → server populate → ACP event / tRPC response) correctly enforces the ≤100 limit. The rationale is that T01 and T02 applied caps at the ingestion points, and T04 confirms those caps are faithfully carried through to client-facing outputs.

**Verification methods:**
1. Trace `config_options_update` payload through `update.ts` ACP handler
2. Trace `getSessionState` tRPC procedure through `session.ts` router
3. Run existing test suites to confirm no regressions

---

## Validation

### Test Suite Results

| Suite | Result | Notes |
|-------|--------|-------|
| Utility tests (T01 area) | **24/24 PASS** | `capModelList` utility retains ≤100 invariant |
| Update handler tests | **29/29 PASS** | `config_options_update` payload capped correctly |
| Bootstrap/server tests | **7/7 PASS** | Server init with capped config works |
| `check-types` in touched files | **PASS** | No type errors in `update.ts`, `session.ts`; pre-existing unrelated errors in other files remain unchanged |
| `biome` lint/format | **PASS** | No new errors introduced |

### Coverage

- `config_options_update` event payload verified capped ≤100
- `getSessionState` tRPC response verified capped ≤100
- Edge cases: empty model list, exactly-100 list, >100 list all behave correctly (cap applied upstream by T01/T02)

---

## Behavioral Impact

**Clients now receive capped model config options** (≤100 entries) through two channels:

1. **`config_options_update`** ACP event — server to client push
2. **`getSessionState`** tRPC query — client pull

Prior to the T01/T02/T04 chain, the `configOptions` field in both channels could contain the full unfiltered model list (potentially >100 entries), causing UI lag during initial load and model-switch operations.

---

## Residual Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| No explicit `getSessionState` service-level test covering capped model list | Low | The cap is applied upstream (T01 utility, T02 populate); `getSessionState` is a pass-through reader. Existing route-level tests confirm correct response shape. A dedicated service test could be added as a follow-up. |
| Pre-existing unrelated type errors in other files | None (pre-existing) | Out of scope for T04; tracked separately |

---

## Calibration

- **Complexity:** Higher than T01/T02/T03 — requires cross-layer tracing (utility → server populate → ACP event → tRPC response)
- **Verification-only task:** No production code changes; validation through test suites and manual trace analysis
- **Future executor:** team-heavy (server-side analysis domain)

---

## Blockers

None.

---

## Next Steps

1. Team-validator to run over T01, T02, T03, T04 outputs
2. Consider adding explicit `getSessionState` service-layer test for capped model list (low priority)
