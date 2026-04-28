# Curator Learning — T02 Test-Fix (Supervisor Policy Hardening)

## Metadata
- **Incident**: 20260427-supervisor-policy-hardening
- **Ticket**: T02 (test-fix)
- **Ticket Classification**: test-coverage-gap
- **Revalidation Result**: NEEDS_FIX
- **Root Cause**: acceptance/test coverage gap, not a production bug
- **Code Correctness**: confirmed — code logic is correct
- **Failure Driver**: missing test coverage in the acceptance suite
- **Date**: 2026-04-28

## Learning

### Observation
The T02 revalidation returned NEEDS_FIX, but deeper inspection revealed that the underlying code was correct. The only failure driver was missing test coverage — the acceptance suite did not exercise the boundary conditions that the validator checked.

### Signal
- **Revalidation NEEDS_FIX can be caused by acceptance/test coverage gap rather than a production bug.**
- When validator flags a NEEDS_FIX and the code review confirms correctness, the fix is a test-only fix — add the missing test cases, do not modify production logic.

### Routing Rule (calibrated)
```
IF revalidation_status == NEEDS_FIX
   AND code_review == "correct"
   AND failure_driver == "missing_test_coverage"
THEN
   route_to: team-builder
   ticket_type: test-only-fix
   scope: add-missing-acceptance-tests
   do_NOT: modify production code
```

### Calibration Metrics
| Metric | Value |
|--------|-------|
| actual_complexity | 15 |
| actual_risk | 5 |
| quality | 96 |
| full supervisor suite | 149 pass |
| revalidation signal | NEEDS_FIX (coverage gap only) |

### Confidence
**MEDIUM** — This is a single incident. Do not overfit the routing rule. Future NEEDS_FIX incidents should still be triaged individually. This pattern should be treated as a calibration signal that raises awareness, not as a deterministic rule.

### Impact
- Production code unchanged (correct as-is)
- Test suite expanded to cover the gap
- Curator routing for similar future incidents: route test-only fixes to team-builder without unnecessary production code changes

## Append-Only
This file is append-only. Do not modify prior entries.
