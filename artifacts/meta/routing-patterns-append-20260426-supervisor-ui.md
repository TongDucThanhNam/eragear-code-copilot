---
target: artifacts/meta/routing-patterns.md
type: append-only-delta
created: 2026-04-26
incident: 20260426-supervisor-ui-chatinput
signal_strength: validated_single_incident
status: pending-merge
---

## 20260426-supervisor-ui-chatinput — capability-gated safety-sensitive UI

- **source**: `artifacts/20260426-supervisor-ui-chatinput/learnings/T01-learning.md`
- **signal_strength**: `validated_single_incident`
- **pattern**: safety-sensitive modes such as `full_autopilot` / auto-permission-resolution require backend/session-derived capability before UI enablement.
- **route_note**: use `team-heavy` when implementation spans shared types, server session state/DI, web hook plumbing, and UI; use `team-builder` only for frontend-only follow-ups after capability plumbing exists.
- **safety_note**: distinguish unsupported (`capability=false`) from supported-but-off (`capability=true`, `mode=off`); avoid frontend-only capability assumptions.
- **mutation_note**: do not optimistically reflect safety-sensitive mode changes; update UI from server-confirmed mutation result and show pending/error feedback.
- **metrics_note**: do not update routing-metrics yet; wait for repeated independent incidents.
