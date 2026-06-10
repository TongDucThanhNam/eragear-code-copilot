# GOAL: Overnight Push To A ZCode-Class Eragear ADE

## Objective

Use the remaining overnight window aggressively to turn the current Eragear
desktop app into the closest possible ZCode-class local Agentic Development
Environment by tomorrow morning.

This is no longer a planning-only goal. Research exists and must be used, but
the main job is to implement working product surface in the app. The desired
result is an Electron desktop app that feels meaningfully comparable to ZCode
for local agent work: runtime diagnostics, provider/CLI control, capability
management, skills/commands/output styles, project memory, MCP setup,
checkpoints/change trust, and dense ADE workflow polish.

Be ambitious, but do not fake completion. If the app is not actually ngang/hơn
ZCode by verification, say so plainly and keep working. The success condition is
verified product behavior, not a confident final message.

## Overnight Execution Contract

- Keep working autonomously through the queue below. Do not stop at analysis or
  a roadmap unless blocked by a real external condition.
- Prefer implementation over documentation once enough context is known.
- Ask the user only if a decision is impossible to infer safely. Otherwise make
  conservative product/architecture choices.
- Do not wait for perfect architecture if a vertical slice can ship safely.
- Keep changes aligned with existing repo patterns and AGENTS.md boundaries.
- Preserve the current desktop migration: default local path stays
  Electron IPC/private `desktop-service`, not local HTTP fallback.
- Do not bundle ZCode binaries, copy proprietary code, or read secrets.
- Do not bundle third-party Agent CLIs by default; detect and orchestrate CLIs
  the user installed.
- Do not delete `apps/server`; keep it as server/remote/compat host.
- If time runs out, leave the app in the best runnable state, list exact gaps,
  and do not mark this goal complete unless all hard acceptance criteria pass.

## Evidence Baseline

Use `docs/research/zcode-feature-study.md` as evidence, especially:

- ZCode is a real Electron ADE, not just a webview.
- Live launch showed Electron main/renderer/network utility processes and
  `node.mojom.NodeService`.
- ZCode spawned `resources\glm\zcode-acp.exe` with
  `zcode-acp-glm-eragear-code-copilot acp`.
- Resource inventory includes `acp`, `acp-proxy-runtime`, `codex`, `gemini`,
  `glm`, `opencode`, `tools\ripgrep`.
- User-data inventory shows `acp-config`, `checkpoints`, `repo-snapshots`,
  `session-bindings`, `sessions`, `logs`, `tasks-index.sqlite`,
  `model-providers.json`, `setting.json`, `skills-state.json`.

Use these as product inspiration, not as code to copy.

## Current Eragear Baseline

Verify before relying on this:

- `apps/desktop` hosts Electron.
- `apps/web` is renderer.
- `apps/server/src/runtime/desktop-service.ts` provides private stdio runtime
  service.
- `packages/shared/src/runtime-host.ts` and
  `packages/shared/src/capability-registry.ts` define runtime/capability
  skeletons.
- OpenCode session init through desktop-service was previously verified.
- Electron Settings currently has agent config and minimal runtime allowlist
  sync, but not a real ZCode-class control center.
- `apps/server check-types` may have unrelated existing failures; do not ignore
  failures in changed modules.

## Product Target For Morning

By morning, the app should have a visible "local ADE control surface" that makes
Eragear feel serious even if some advanced internals remain v1:

- Desktop runtime status: mode, channel, service health, agent CLI health,
  child process state, missing CLI hints.
- Provider and agent control: active agent, CLI command/path, model/provider
  mapping, safe API-key/secret strategy, test spawn/test connection where
  feasible.
- Capability registry UI: skills, commands, output styles, subagents, MCP
  servers, hooks/plugins placeholders, diagnostics.
- Skills/commands/output styles v1: file-backed Markdown/frontmatter scanning,
  user/project scopes, enable/disable state, visible in settings, usable from
  chat input where feasible.
- Project memory v1: detect `AGENTS.md`, `CLAUDE.md`, `.eragear/memory.md`,
  preview what is loaded, allow per-session inclusion/exclusion where feasible,
  warn about secrets.
- MCP manager v1: config model and UI for stdio/http/SSE entries, redacted env
  and headers, enable/disable state, health status placeholder or real probe.
- Checkpoint/change trust v0: show file changes tied to sessions/turns where
  current data allows; at minimum implement a clear checkpoint/change review
  foundation and Git diff fallback.
- Dashboard parity for desktop: logs/observability/runtime diagnostics that were
  dashboard-only should have an Electron UI path or documented exact blocker.
- Dense, utilitarian ADE UI. No marketing page, no decorative hero.

## Priority Queue

Work top to bottom. Do not start a lower priority slice if a higher priority
slice is broken unless the higher one is blocked.

### 0. Stabilize And Audit

1. Inspect current worktree and understand dirty files.
2. Run targeted checks enough to know the current desktop state.
3. Start from the current Electron IPC/private service path. Do not regress to
   local HTTP.
4. Identify current tRPC/runtime APIs available to the renderer.

Exit criteria:

- You know which current failures are unrelated.
- You know the fastest path to visible ZCode-class value.

### 1. ADE Control Center

Build a first-class Electron settings/control surface for local runtime:

- Runtime health cards.
- Agent CLI availability cards for Codex, Claude, Gemini, OpenCode.
- Active agent display and edit shortcut.
- Spawn policy/allowlist status.
- Desktop transport display: `electron-ipc` -> `desktop-service`.
- Missing CLI hints and version info.
- Diagnostics refresh action.

Use existing components and restrained dashboard styling. Put this in the
actual app, not only server dashboard.

Acceptance:

- Visible in Electron/web settings.
- Data comes through Electron IPC/private service path.
- No local HTTP fallback.

### 2. Durable Capability Registry v1

Make capability registry real enough to power UI and later runtime loading:

- Define typed descriptors for:
  - `skill`
  - `command`
  - `output-style`
  - `subagent`
  - `mcp-server`
  - `model-provider`
  - `hook`
  - `plugin`
- Persist enabled/disabled state using current SQLite direction or an existing
  repository pattern. If SQLite migration is too risky overnight, use a clearly
  transitional adapter and document why it must be replaced.
- Expose read/update APIs through tRPC usable from Electron IPC.
- Add runtime diagnostics snapshot.

Acceptance:

- Settings can list capability descriptors.
- Toggle state persists across app restart or has a documented transition plan
  plus tests proving the chosen storage.
- Typecheck/build for changed modules passes or exact unrelated blocker is
  documented.

### 3. Skills, Commands, Output Styles v1

Implement the fastest useful ZCode-like extension slice:

- Scan user/project directories:
  - `.eragear/skills/**/SKILL.md`
  - `.eragear/commands/**/*.md`
  - `.eragear/output-styles/**/*.md`
  - optional compatibility import for `.claude/skills/**/SKILL.md`
- Parse Markdown frontmatter safely.
- Register discovered items in capability registry.
- Show in Settings.
- Add chat input discovery:
  - `/command` picker if feasible.
  - `@skill` picker if feasible.
  - If picker is too risky, add an explicit insert/apply UI and document the
    remaining picker work.

Acceptance:

- A sample project capability file appears in UI after scan.
- Disabled items do not appear as active/invokable.
- No secrets are loaded from arbitrary files.

### 4. Provider And CLI Control Center

Make model/provider management more like a product feature:

- Model provider descriptor shape:
  - provider kind
  - display name
  - endpoint/base URL
  - auth mode
  - model list
  - aliases/mapping
  - supported agent/runtime compatibility
- UI to list providers and show missing config.
- Respect secret redaction. Do not print API keys.
- Add test connection where safe; otherwise add explicit "not yet probed"
  diagnostic.

Acceptance:

- User can see provider/model mapping state in app.
- Secrets are redacted in UI/logs.

### 5. Project Memory v1

Surface project context instead of silently injecting it:

- Detect:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.eragear/memory.md`
  - `.eragear/context.md`
- Show preview and source path.
- Warn against secrets.
- Add enabled/disabled state per project/session where feasible.

Acceptance:

- Current repo memory files are detected.
- UI shows which files would influence agent context.

### 6. MCP Manager v1

Build the management foundation:

- MCP server descriptor supports stdio, SSE, streamable HTTP where existing
  runtime can support it.
- Redacted env/header config.
- Enable/disable state.
- Health status: real probe if existing runtime supports it, otherwise explicit
  pending diagnostic.
- Per-project override design.

Acceptance:

- User can add/list/toggle an MCP entry without editing raw JSON.
- Secrets are never shown in plain text.

### 7. Checkpoints And Change Trust v0

Ship the smallest trust layer that works:

- Use Git diff when project is a Git repo.
- Tie changes to active session/turn if current data model supports it.
- Show changed files and diff entry point.
- Add "review before/after" UI foundation.
- If undo/restore cannot be made safe overnight, implement read-only review and
  document restore blockers.

Acceptance:

- User can see file changes caused during a session or current workspace diff.
- No destructive restore runs without explicit confirmation.

### 8. Dashboard Parity In Electron

Port the dashboard-only value that matters locally:

- Logs view or runtime event timeline.
- Observability snapshot.
- Active sessions/projects summary.
- Runtime diagnostics.

Admin API key/device session management can remain server-dashboard-only if
documented as remote administration, not local ADE work.

Acceptance:

- Electron app can show local runtime diagnostics/logs without opening the
  server dashboard.

### 9. Subagents v1

Only start after the previous slices have stable foundations:

- Descriptor shape and UI.
- Manual `@agent` invocation first.
- Isolated context/delegated session design.
- Tool/model policy per subagent.

Acceptance:

- At least descriptor creation/listing works.
- Runtime invocation can be partial if exact blocker is documented.

### 10. Polish And Packaging

Make it feel like a product:

- `bun run dev:desktop` starts cleanly.
- Empty states are actionable.
- Errors are diagnostic, not raw stack dumps.
- UI stays dense and professional.
- Closing Electron cleans owned runtime/agent children.

## Cut Lines

If time is tight, keep this order:

1. Must ship: ADE Control Center, runtime diagnostics, CLI/provider visibility.
2. Must ship: Capability Registry v1 visible in app.
3. Should ship: Skills/commands/output styles scanning and settings UI.
4. Should ship: Project memory preview.
5. Nice overnight win: MCP manager v1.
6. Nice overnight win: Checkpoint/Git diff trust view.
7. Defer if needed: full plugin marketplace, automatic subagent routing,
   vector indexing, mobile/SSH, full rollback engine.

Do not mark the goal complete if only docs were written. The app must visibly
improve.

## Architecture Constraints

- Domain must not import transport/platform.
- Application must depend on ports, not Electron/Hono directly.
- Host-specific code lives at host boundaries:
  - Electron desktop host under `apps/desktop`
  - server/remote host under `apps/server`
- `apps/web` remains renderer.
- Default desktop local transport remains Electron IPC/private service channel.
- No default local runtime HTTP fallback.
- Primary persistence should follow SQLite direction.
- Project-level capability files may be plaintext Markdown, but secrets must not
  be stored there.
- Runtime rules stay canonical; do not duplicate business logic between desktop
  and server.

## Verification

Run what is feasible continuously, not only at the end:

```powershell
bun run --cwd apps/desktop check-types
bun run --cwd apps/desktop build:main
bun run --cwd apps/web build
bun run --cwd apps/server check-types
```

Known server typecheck failures may exist outside the changed scope. If
`apps/server check-types` fails:

- List exact unrelated examples.
- Run narrower tests/checks for changed modules.
- Do not hide changed-module type failures behind unrelated failures.

Desktop/runtime verification must include at least one direct
`DesktopRuntimeHost` smoke through the private service channel for new runtime
APIs. Do not use server HTTP as proof of desktop-local behavior.

For UI-heavy work:

- Start `bun run dev:desktop` if practical.
- Capture screenshots or describe observed UI state from actual runtime.
- Confirm no owned Electron/Bun/agent processes are left after shutdown.

## Hard Acceptance Criteria

This overnight goal is complete only if all are true:

- `bun run dev:desktop` opens the app.
- Local desktop mode uses Electron IPC/private service channel.
- OpenCode or another available agent can still create a real session.
- Electron app has visible ZCode-class ADE control surface, not just hidden APIs.
- Runtime/CLI/provider diagnostics are visible in Electron.
- Capability registry is visible in Electron and backed by real data.
- At least one capability class beyond agents is implemented end-to-end:
  skills, commands, output styles, memory, MCP, checkpoints, or subagents.
- No ZCode proprietary code, schemas, secrets, or binaries are copied.
- Verification results are recorded.
- Remaining gaps to ZCode are explicitly listed.

If these are not all true, leave the goal active or mark partial in the final
report. Do not claim "ngang hoặc hơn ZCode" unless the checklist proves it.

## Final Answer Requirements

When stopping for the morning report, include:

- Exact command the user should run.
- What visibly changed in the Electron app.
- What ZCode-class features now work.
- What is still below ZCode.
- Files changed.
- Verification commands and results.
- Any blockers and exact next slice.
