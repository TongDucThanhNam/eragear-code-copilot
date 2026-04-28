---
session: "20260427-supervisor-policy-hardening"
artifact: "03-explorer-report"
team: "team-explorer"
status: "complete"
created: "2026-04-27"
next_consumer: "team-architect"
---

# Explorer Report — Supervisor Policy Hardening

## Summary

Explored the codebase to identify all supervisor policy enforcement points, gating logic, and hardening opportunities across the supervisor orchestration layer.

## Scope

- **Target**: Supervisor policy modules (`apps/server/src/modules/supervisor/`, policy gating, capability checks)
- **Method**: Static analysis + trace walkthrough of message routing, permission checks, and capability enforcement
- **Artifacts reviewed**: `00-brief.md`, `01-triage-report.md`

## Findings

### 1. Policy Enforcement Points

| Location | Policy Type | Current State | Hardening Gap |
|----------|------------|---------------|---------------|
| `supervisor/routing/capability-gate.ts` | Capability gate | Basic allow/deny | Missing explicit deny logging |
| `supervisor/policy/intent-classifier.ts` | Intent classification | Regex-based | No fallback for ambiguous intents |
| `supervisor/policy/permission-resolver.ts` | Permission resolution | Linear chain | No timeout/deadline enforcement |
| `supervisor/middleware/policy-middleware.ts` | Middleware chain | Ordered execution | Short-circuit on first deny missing audit trail |

### 2. Hardening Recommendations

1. **Explicit Deny Logging** — Every policy deny must produce a structured audit event with reason, timestamp, and request context.
2. **Ambiguous Intent Fallback** — When intent classifier confidence is below threshold, route to a clarification sub-flow rather than best-guess.
3. **Permission Resolution Timeout** — Add configurable deadline (default 5s) to permission resolution; timeout = deny.
4. **Audit Trail for Middleware** — Each middleware step must append to a policy decision log, even on short-circuit.

### 3. Architecture Impact

- **New artifacts needed**: `supervisor/policy/audit-logger.ts`, `supervisor/policy/timeout-guard.ts`
- **Modified artifacts**: `capability-gate.ts`, `intent-classifier.ts`, `permission-resolver.ts`, `policy-middleware.ts`
- **No schema changes** to existing policy types.

## Explorer Decision

**Proceed to architect** — The exploration confirms clear hardening vectors with bounded scope. All findings are actionable and do not require redesign of the policy framework. Ready for team-architect to produce execution plan.

## Next Steps

- **team-architect** to produce `04-execution-plan.md` with ticket breakdown
- Tickets should cover: audit logging, intent fallback, timeout guard, middleware audit trail
