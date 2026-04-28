# Routing Metrics Append — 2026-04-28 T02 Test-Fix Calibration

## Incident
- **Incident ID**: 20260427-supervisor-policy-hardening
- **Ticket**: T02
- **Date of calibration**: 2026-04-28

## Calibration Signal
- **Revalidation NEEDS_FIX can be caused by acceptance/test coverage gap rather than production bug.**
- If code is correct and missing coverage is the only failure driver, route a minimal test-only fix to team-builder.
- Do not overfit from one incident.

## Metrics Snapshot
| Metric | Value |
|--------|-------|
| actual_complexity | 15 |
| actual_risk | 5 |
| quality | 96 |
| full supervisor suite | 149 pass |
| confidence | MEDIUM |

## Routing Impact
- **Pattern**: coverage-gap-masquerading-as-bug
- **Action**: route test-only fixes to team-builder when code review confirms correctness
- **Constraint**: always triage individually; do not deterministically route all NEEDS_FIX as test-gap

## Append-Only
This file is append-only. Do not modify prior entries.
