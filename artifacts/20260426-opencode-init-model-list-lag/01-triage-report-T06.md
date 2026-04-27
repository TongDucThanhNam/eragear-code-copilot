# T06 Triage Report

## Status: ACTIVE

## Task Info
- **task_id**: T06
- **title**: Persistent Lag Diagnosis After Model-List Cap
- **suggested_ticket**: T06-persistent-lag-diagnosis

## Scores
- **complexity**: 78
- **risk**: 68
- **novelty**: 62
- **confidence**: 76

## Context Flags
- **needs_vault_context**: NO
- **needs_explorer**: YES
- **needs_architect**: NO
- **requires_human_decision**: YES

## Routing Decision
- **initial_executor**: team-heavy
- **strategy**: explorer → team-heavy diagnostics → validator → user gate
- **human_decision_gate**: Dev-only diagnostics / local evidence collection requires user approval before instrumentation proceeds.

## Diagnostic Gates
| Gate | Focus |
|------|-------|
| payload size | Message/tool-result payload bloat |
| event frequency | Rate of ACP update events |
| transport | WS/tRPC channel throughput |
| client state sync | UI state reconciliation lag |
| React render | Component re-render cost / profiling |
| storage persistence | JSON store write pressure |
| tool output flood | Tool-call result volume during init |

## Pipeline
```
explorer ──► team-heavy diagnostics ──► validator ──► user gate
```

## Next Action
- Safe to begin explorer mapping immediately (no production code changes).
- Require user approval before team-heavy instrumentation runs.
- After diagnostics complete, validator confirms findings; user gate opens for decision on fix/no-fix/accept.

## Notes
- T06 builds on the model-list cap from T01–T04; lag persists despite capping, indicating a separate bottleneck.
- Exploratory mapping identifies which diagnostic gate(s) dominate before costly instrumentation.
- Human decision required because diagnostic collection is dev-only and collects local evidence (privacy, environment impact).
