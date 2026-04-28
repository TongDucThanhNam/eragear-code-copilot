# T02 Builder Output

## Metadata
- **Ticket**: T02-fix-permission-taskgoal
- **Status**: IMPLEMENTED_PENDING_VALIDATION
- **Quality**: 
- **Session**: 20260427-supervisor-policy-hardening
- **Consumer**: team-builder
- **Path**: artifacts/20260427-supervisor-policy-hardening/outputs/T02-builder-output.md
- **next_consumer**: team-validator

## Summary
- Fixed the permission `taskGoal` chain to properly propagate goals through the permission request/response lifecycle.
- Ensured taskGoal is preserved and forwarded when the supervisor requests user permission for tool calls.

## Changes
- Updated permission handler to correctly capture and relay `taskGoal` from the incoming permission request.
- Ensured the private taskGoal chain is restored when permission responses are processed.

## Notes
- Tests are missing for the new private taskGoal chain. Validator should verify coverage.

## Files Modified
- `apps/server/src/infra/acp/permission.ts`
- Permission-related type definitions
