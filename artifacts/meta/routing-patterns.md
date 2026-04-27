---
title: "Routing Patterns"
type: "meta"
category: "routing"
updated: "2026-04-26"
version: 1
description: "Confirmed and anti-patterns for architectural decisions and cross-boundary payload handling."
---

# Routing Patterns

## Confirmed Patterns

### 2026-04-26 — session: `20260426-opencode-init-model-list-lag`

**Pattern**: Cap at client-facing server exit boundaries while keeping internal server state uncapped.

- **Applies to**: huge `models.availableModels` lists and model `configOptions.options` lists from ACP / OpenCode init / update flows.
- **Must cap** *both* `models.availableModels` *and* each model's `configOptions.options` in client-facing payloads.
- **Must preserve** current / default model and `currentValue` in capped copies.
- **Scope**: server exit boundary only; internal session state (runtime, validation, default logic) remains fully uncapped.

**Anti-patterns**:
1. Capping render-only (client-side truncation) without server exit cap — payload still bloats the wire.
2. Capping `models` while leaving `configOptions` unbounded — partial fix, still vulnerable.
3. Mutating internal session state for client payload cap — risks breaking validation and default-selection logic downstream.
