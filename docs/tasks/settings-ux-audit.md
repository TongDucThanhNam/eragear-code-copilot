# Settings UX Audit

Date: 2026-06-16

## Problem

The Electron Settings surface had one flat list of 28 destinations. Desktop users had to scan every item with no grouping, and mobile users saw the same list as a long horizontal strip. The `/settings/` route redirected directly to Agents, so Settings had no orientation page or starting point.

This created high recognition cost: users had to know whether something belonged under Runtime, Connection, ACP Auth, MCP, Capabilities, or Plugins before they could act.

## References Used

- `ui-map` baseline for `SettingsLayout`, `settings.agents`, `settings.connection`, and `settings.runtime`.
- `$refactoring-ui` guidance: keep hierarchy clear, reduce low-value visual noise, and reuse the local design system instead of inventing new styling.
- Obsidian Second Brain:
  - `Accordion.md`: progressive disclosure is useful when many related options would overwhelm the first view.
  - `Tooltips.md`: contextual help should stay short and non-essential; required information belongs directly in the UI.
  - `Neo-Brutalism.md`: high-stroke/high-noise styles increase cognitive load in dense software products.

## IA Decision

Keep every existing `/settings/*` route, but organize the top-level navigation into six task-oriented groups:

1. Setup: Agents, Connection, Runtime, Model Providers, Credentials.
2. Account and Access: Plan, OAuth, ACP Auth, Sync.
3. Automation: Bots, Commands, Hooks, Automation, Terminal.
4. Extensions: Plugins, Skills, MCP, Capabilities.
5. Workspace Intelligence: Memory, Repo Snapshots, Prompt, Output Style.
6. Operations: Usage, Activity, Crash Reporting, Archive, Remote Control, ACP Proxy.

The goal is to make common tasks visible first while keeping advanced configuration available through search and grouped navigation.

## UI Changes

- Add a Settings overview route instead of redirecting `/settings/` to Agents.
- Move route metadata into one grouped navigation model so sidebar, mobile browse UI, overview, and tests stay aligned.
- Add desktop search to reduce navigation time for users who know the target.
- Replace the mobile horizontal route strip with grouped disclosure sections.
- Tighten settings page headers and panels so dense pages read as application UI, not marketing cards.
- Improve empty/loading states in high-priority panels without adding non-essential help text.

## Verification Checklist

- Passed: `ui-map` after-change output shows grouped desktop navigation and mobile disclosure sections instead of the old horizontal list of all 28 routes.
- Passed: `bun run --cwd apps/web check-types`.
- Passed: `bun test apps/web/src/components/settings/settings-navigation.test.ts`.
- Passed: `bun run --cwd apps/web build`.
- Preserved: every existing `/settings/*` destination is still present in the grouped navigation model.

Build notes:

- Vite still reports existing chunk-size warnings.
- Browserslist reports stale browser data.
- Biome currently ignores explicit app file paths when run from this workspace configuration, so formatting verification used TypeScript, build, `ui-map`, and direct diff review.
