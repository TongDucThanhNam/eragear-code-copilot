# T01 Builder Output

## Metadata
- **Ticket**: T01-remove-runtimeaction-llm-schema
- **Status**: IMPLEMENTED_PENDING_VALIDATION
- **Quality**: 
- **Session**: 20260427-supervisor-policy-hardening
- **Consumer**: team-builder
- **Path**: artifacts/20260427-supervisor-policy-hardening/outputs/T01-builder-output.md
- **next_consumer**: team-validator

## Summary
- Removed `RuntimeAction` from the LLM tool-calling schema to prevent model confusion between runtime-only actions and LLM-exposed tools.
- Cleaned up the prompt builder to stop emitting `RuntimeAction` as a selectable tool for the language model.

## Changes
- Stripped `RuntimeAction` enum members from the LLM-facing tool schema generation.
- Updated prompt builder to exclude runtime-only actions from the tool list sent to the model.

## Files Modified
- `apps/server/src/modules/ai/application/prompt.builder.ts`
- Supervisor schema/types related to tool definitions
