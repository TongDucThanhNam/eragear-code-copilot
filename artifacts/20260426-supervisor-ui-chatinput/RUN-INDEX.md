---
session_id: 20260426-supervisor-ui-chatinput
created_at: 2026-04-26T00:00:00.000Z
artifacts:
  - 00-brief.md
  - 01-triage-report.md
---

# RUN-INDEX: 20260426-supervisor-ui-chatinput

## Tasks

| Task | Type | Status | Artifact |
|------|------|--------|----------|
| T00 | triage | ACTIVE | [01-triage-report.md](01-triage-report.md) |
| T01 | explorer | PENDING | — |

## Routing decisions

- T00 triage recommends: needs_explorer → YES, needs_architect → NO, initial_executor → team-builder.
- Explorer should verify frontend state plumbing gap before builder starts.

## Blockers

- **Human decision required**: exposing `full_autopilot` has permission auto-resolution safety implications. Ask user to choose warning/confirmation UX before implementation. See `01-triage-report.md` § Human decision gate for options:
  1. Minimal safe default: mode Off by default; Dialog with warning copy; no one-click toolbar toggle.
  2. Stricter route: require confirmation checkbox before enabling Full autopilot.
  3. Defer visibility: hide/disable UI unless backend/session explicitly reports supervisor capability.
