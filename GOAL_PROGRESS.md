# GOAL Progress - Electron ADE Overnight Sprint

Updated: 2026-06-10 20:08 UTC / 2026-06-11 03:08 Asia/Saigon

## Completed

- Read `AGENTS.md` and `GOAL.md` before implementation.
- Preserved default local desktop transport: renderer `electron-ipc` -> Electron main -> private stdio `desktop-service`; no local apps/server HTTP bridge was reintroduced as the desktop default.
- Stabilized the visible OpenCode allowlist path by keeping detected absolute CLI policies injected into `desktop-service` and passing `ERAGEAR_REPO_ROOT` into the runtime service.
- Added Local ADE Control Center as the first screen and inside Settings:
  - runtime health and transport chain
  - active sessions and runtime PID
  - Codex/Claude/Gemini/OpenCode CLI detection
  - provider/agent safe metadata with redacted ENV key names only
  - capability registry grouped by kind with persisted toggles
  - project memory preview with secret-looking-line redaction/warnings
  - MCP add/list/toggle v1 stored in project-local JSON
  - read-only Git change trust fallback
  - runtime log timeline
  - dashboard parity and explicit blockers
- Added transitional project-local capability persistence:
  - `.eragear/capabilities-state.json`
  - `.eragear/mcp-servers.json`
  - documented in capability diagnostics as a SQLite migration bridge.
- Added filesystem discovery for:
  - `.eragear/skills/**/SKILL.md`
  - `.claude/skills/**/SKILL.md`
  - `.eragear/commands/**/*.md`
  - `.eragear/output-styles/**/*.md`
  - user equivalents under `%USERPROFILE%\.eragear\...`
- Added project memory detection for:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.eragear/memory.md`
  - `.eragear/context.md`
- Added sample project command:
  - `.eragear/commands/desktop-smoke.md`
  - verified through `settings.getLocalAdeSnapshot` over desktop-service.
- Merged enabled local command descriptors into the existing chat slash-command picker. Disabled command capabilities are not included.
- Added focused test coverage for command discovery and persisted disabled state:
  - `apps/server/src/modules/settings/application/local-ade.service.test.ts`
- Added reproducible private-service smoke script:
  - `apps/desktop/scripts/smoke-desktop-runtime.ts`
- Created a real OpenCode session through Electron private `DesktopRuntimeHost`, subscribed to session events, sent one message, observed assistant activity, then stopped the session.

## Partial / Below ZCode

- MCP health is explicit `not-probed`; add runtime probes before claiming full MCP parity.
- Provider test-connection is not implemented; provider state is safe metadata only.
- Change trust is read-only Git status/diff fallback; no checkpoint restore or rollback engine.
- Subagents, hooks, and plugins are visible descriptor classes/placeholders, not executable runtime features.
- Output styles are scanned and listed; no output-style application pipeline is wired yet.
- Project memory enablement is represented through capability toggles, but session-specific inclusion/exclusion is still coarse.
- Dashboard auth/admin/device-session management remains blocked for local ADE and documented as remote administration.
- The app is improved toward a serious local ADE, but it is not yet ZCode-class by the hard checklist because MCP probing, checkpoint restore, provider probing, and subagent execution are not complete.

## Explicit Blockers

- Auth admin and device sessions:
  - Dashboard source: `apps/server/src/presentation/dashboard/components/auth-tab.tsx`
  - Server route: `apps/server/src/transport/http/routes/admin.ts`
  - Reason: remote administration surface, not local ADE work. Needs a separate local auth-admin policy before exposing in Electron.
- Full `apps/server check-types` is blocked by existing unrelated failures outside this slice. Examples:
  - `apps/server/src/modules/ai/application/set-config-option.service.ts`
  - `apps/server/src/modules/session/application/discover-agent-sessions.service.ts`
  - `apps/server/src/platform/acp/tool-calls.ts`
  - `apps/server/src/shared/utils/session-config-options.util.ts`
- Full `apps/web check-types` is blocked by existing unrelated React/Vite/type baseline failures. Examples:
  - `apps/web/src/components/ui/badge.tsx`
  - `apps/web/src/components/ui/button.tsx`
  - `apps/web/src/components/ai-elements/inline-citation.tsx`
  - `apps/web/vite.config.ts`

## Verification Commands And Results

```powershell
Get-Content -Raw AGENTS.md
Get-Content -Raw GOAL.md
```
Result: read successfully before implementation.

```powershell
bun run --cwd apps/desktop check-types
```
Result: passed before and after adding the smoke script.

```powershell
bun run --cwd apps/desktop build:main
```
Result: passed.

```powershell
bun test apps/server/src/modules/settings/application/local-ade.service.test.ts
```
Result: passed, 1 test, 4 expectations.

```powershell
bun run --cwd apps/web build
```
Result: passed. Vite emitted chunk-size and Browserslist age warnings only.

```powershell
bun run --cwd apps/server check-types
```
Result: failed from existing unrelated baseline errors. No changed-file matches were found by:

```powershell
bun run --cwd apps/server check-types 2>&1 | Select-String -Pattern 'local-ade|settings.ts|settings-services|use-cases|runtime-host'
```

```powershell
bun run --cwd apps/web check-types
```
Result: failed from existing unrelated baseline errors. No changed-file matches were found by:

```powershell
bun run --cwd apps/web check-types 2>&1 | Select-String -Pattern 'local-ade|chat-interface|settings-dialog|trpc.ts'
```

```powershell
Get-Command opencode,codex,claude,gemini -ErrorAction SilentlyContinue | Select-Object Name,Source,CommandType
opencode --version
codex --version
claude --version
gemini --version
```
Result:
- `opencode.exe` found at `C:\Users\terasumi\.bun\bin\opencode.exe`, version `1.16.2`
- `codex.exe` found at `C:\Users\terasumi\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe`, version `codex-cli 0.137.0`
- `claude` not found
- `gemini` not found

```powershell
$env:ERAGEAR_DESKTOP_SMOKE_PROMPT_WAIT_MS='12000'; bun run --cwd apps/desktop ./scripts/smoke-desktop-runtime.ts
```
Result:
- Runtime ready over `desktop-service`.
- CLI diagnostics: Codex and OpenCode available; Claude and Gemini missing.
- `settings.getLocalAdeSnapshot` returned project root `C:\Users\terasumi\Documents\source_code\eragear-code-copilot`, command `/desktop-smoke`, memory `AGENTS.md` and `CLAUDE.md`, blocker `Auth admin and device sessions`.
- Created real OpenCode session `ba89f23f-0f93-4f5a-8eba-98c0c3ee0009`.
- Subscription connected before send.
- `sendMessage` returned `status: submitted`.
- Assistant activity observed.
- Session stopped and host stopped.

```powershell
$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop
```
Result: exited `0`; Electron dev app opened, loaded renderer, then auto-quit via smoke exit.

```powershell
Get-Process | Where-Object { $_.ProcessName -match 'electron|bun|opencode|codex' } | Select-Object ProcessName,Id,Path
```
Result: no owned Electron/Bun/OpenCode processes remained after shutdown. Existing Codex desktop processes were present.

## Files Changed In This Slice

- `.eragear/commands/desktop-smoke.md`
- `apps/desktop/src/runtime-host.ts`
- `apps/server/src/bootstrap/service-registry/settings-services.ts`
- `apps/server/src/modules/settings/application/local-ade.service.ts`
- `apps/server/src/modules/settings/application/local-ade.service.test.ts`
- `apps/desktop/scripts/smoke-desktop-runtime.ts`
- `apps/server/src/modules/settings/index.ts`
- `apps/server/src/modules/use-cases.ts`
- `apps/server/src/transport/trpc/routers/settings.ts`
- `apps/web/src/components/chat-ui/chat-interface.tsx`
- `apps/web/src/components/left-sidebar/settings-dialog.tsx`
- `apps/web/src/components/local-ade/local-ade-control-center.tsx`

## Next Commands For The Next Agent

```powershell
bun run --cwd apps/desktop check-types
bun run --cwd apps/desktop build:main
bun test apps/server/src/modules/settings/application/local-ade.service.test.ts
bun run --cwd apps/web build
$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='0'; bun run dev:desktop
```

## Next Slice

1. Replace transitional capability/MCP JSON with SQLite-backed repository/ports.
2. Add MCP health probes and runtime wiring.
3. Add provider test-connection actions with strict secret redaction.
4. Add checkpoint rows tied to session turns and a safe restore confirmation flow.
5. Promote subagent descriptors from placeholders to create/list and manual `@agent` invocation.
