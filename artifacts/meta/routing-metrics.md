---
title: "Routing Metrics"
type: "meta"
category: "routing"
updated: "2026-04-26"
version: 1
description: "Calibrated complexity estimates and routing heuristics for task-executor assignment across sessions."
---

# Routing Metrics

## Calibration Entries

### 2026-04-26 — session: `20260426-opencode-init-model-list-lag`

- **Pattern**: cross-boundary ACP + tRPC + React performance / huge model-list payload.
- **Triage Complexity**: 68
- **Actual Complexity**: 80–85
- **Complexity Delta**: HIGHER
- **Risk**: high (manageable with cap-at-exit / internal-uncapped strategy)
- **Recommended Future Executor**:
  - **team-heavy**: integration work crossing ACP / tRPC / React boundaries
  - **team-builder**: isolated utility or UI-only subtasks only
- **Heuristics Added**:
  1. SDK union types / strict-null shared utility work adds complexity buffer **+10 to +15**.
  2. PARTIAL worker output on payload-capping tickets should trigger **repair/validation loop**, not final PASS.
- **Validation Quality**: PASS, score **88**.
