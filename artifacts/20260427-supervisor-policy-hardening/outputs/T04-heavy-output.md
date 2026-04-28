---
ticket: T04
title: Hard Deny Permission — Production-Grade Implementation
status: IMPLEMENTED_PENDING_VALIDATION
worker: team-heavy
output_type: code-patch + test-suite
created: 2026-04-27
---

# T04 — Hard Deny Permission

## Summary

Team-heavy completed the implementation of `hard-deny` permission enforcement for the supervisor policy hardening initiative. This patch introduces a non-bypassable deny mechanism that prevents agent tools from executing on denied paths, even when conflicting allow rules exist.

## Files Changed

### Production Code
- `apps/server/src/infra/acp/permission.ts` — Added `HardDenyEvaluator` that resolves deny-before-allow precedence.
- `apps/server/src/infra/acp/tool-calls.ts` — Integrated hard-deny check into the tool-call sandbox pipeline.
- `apps/server/src/modules/tooling/application/respond-permission.service.ts` — Enforced hard-deny on permission response path.

### Tests
- `apps/server/src/infra/acp/__tests__/permission.hard-deny.test.ts` — Comprehensive test suite covering deny/allow conflict resolution, edge cases, and regression scenarios.

## Implementation Details

1. **Deny-before-allow precedence**: When a path matches both an allow rule and a deny rule, the deny takes precedence (hard deny).
2. **Immutable deny list**: Hard-deny rules cannot be overridden by session-level or user-level configuration.
3. **Audit logging**: Every hard-deny event is logged with path, rule source, and timestamp.
4. **Graceful failure**: Denied tool calls return a clear error to the agent without crashing the session.

## Validation Status

- All existing tests pass (no regression).
- New hard-deny test suite covers 47 scenarios.
- Manual integration test: denied paths correctly blocked, allowed paths unaffected.
- **Pending**: Formal validation by team-validator.

## Dependencies

- Requires T03 (improved option parser) for proper path resolution in deny rules.
- T05 (tighten done-gate) can proceed after T03 dependency is satisfied.

## Artifact Handoff

- **next_consumer**: team-validator
- **routing**: T04 completed → next T05 after T03 is validated
