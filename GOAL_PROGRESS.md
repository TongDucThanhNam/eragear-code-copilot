# GOAL Progress - Electron ADE Overnight Sprint

Updated: 2026-06-10 21:09 UTC / 2026-06-11 04:09 Asia/Saigon

## Current Result

The resumed sprint now includes a real black-box ZCode Electron launch sample
and a verified Eragear Electron ADE path. Eragear is not being claimed as final
ZCode parity; the remaining blockers are listed below with exact scope.

## Implemented Product Workflows

- Local ADE Control Center remains the Electron first screen and Settings panel:
  runtime health, `electron-ipc -> desktop-service`, active sessions, CLI
  detection, providers, capabilities, memory, MCP, checkpoints, logs, and
  dashboard parity blockers.
- Provider test action:
  `settings.testProvider` executes the configured agent command with
  `--version` via `execFile`, persists redacted health in
  `.eragear/provider-health.json`, and the UI shows the Test action/status.
- MCP add/toggle/probe:
  project-local MCP entries can be added, enabled/disabled, and probed. Stdio
  entries resolve executables without shell expansion; SSE/HTTP entries probe
  endpoint availability with diagnostics.
- Checkpoint create/preview/guarded restore:
  `settings.createCheckpoint` stores Git status, changed files, session ids,
  and patch files. `settings.previewCheckpoint` returns patch preview plus
  restore readiness. `settings.restoreCheckpoint` requires an exact
  `RESTORE <id>` token, matching Git HEAD/status, and `git apply --check -R`
  before applying a reverse patch.
- Project memory enable/disable:
  `AGENTS.md`, `CLAUDE.md`, `.eragear/memory.md`, and `.eragear/context.md`
  are detected, previewed with secret-looking-line redaction, and toggleable.
- Capability enable/disable:
  discovered skills, commands, output styles, memory, MCP, providers, and
  subagents have persisted state. Hooks/plugins are visibly marked unavailable
  instead of being presented as active workflows.
- Subagent manual invocation v1:
  `.eragear/subagents/code-reviewer.md` is discovered as an enabled subagent
  capability, appears in the Local ADE snapshot, and can be invoked from chat
  with `/agent-code-reviewer`, which expands into a delegated instruction
  prompt before sending.
- Logs/runtime refresh:
  the Electron control center exposes runtime refresh and local log timeline
  refresh without opening the server dashboard.
- ZCode e2e black-box benchmark:
  launched `C:\Program Files\ZCode\ZCode.exe` as an end-user app, captured the
  visible Electron window, observed the process tree and ACP child command, and
  closed the launched ZCode processes.

## Evidence

- Eragear first screen:
  `docs/research/screenshots/eragear-electron-first-screen.png`
- Eragear latest dev-launch logs:
  `docs/research/screenshots/eragear-dev-desktop-after-zcode-e2e.stdout.log`
  and
  `docs/research/screenshots/eragear-dev-desktop-after-zcode-e2e.stderr.log`
- ZCode black-box screenshot:
  `docs/research/screenshots/zcode-electron-first-screen.png`
- ZCode sanitized metadata:
  `docs/research/screenshots/zcode-electron-blackbox-metadata.json`
- ZCode workflow scorecard:
  `docs/research/zcode-blackbox-scorecard.md`

## Hard Definition Of Done Status

| Requirement | Status | Evidence |
| --- | --- | --- |
| `bun run dev:desktop` launches usable Electron app | Pass | Exact command rerun with `ERAGEAR_DESKTOP_SMOKE_EXIT_MS=5000`, exited `0`; fresh logs show renderer loaded and runtime ready. |
| Local desktop default is Electron IPC to private service | Pass | Dev logs show `Runtime channel: electron-ipc renderer bridge -> desktop-service runtime core`; smoke endpoint is `desktop-service`. |
| Start session, send message, stream/observe assistant, stop session | Pass | Desktop smoke created chat `397aac4f-11ec-4288-a252-f75abe8385e4`, sent a message, observed assistant activity, stopped subscription/session/host. |
| Provider test action | Pass | `settings.testProvider` returned provider `available`, OpenCode version `1.16.2`, persisted redacted health. |
| MCP add/toggle/probe action | Pass | UI/service support add, toggle, and probe; tests cover stdio executable probe. |
| Checkpoint create action | Pass | Service/UI create checkpoints; tests cover Git patch checkpoint capture. |
| Checkpoint preview/guarded restore | Pass for safe Git reverse-patch case | Tests cover preview, wrong token rejection, correct token restore, and post-restore state. |
| Project memory enable/disable | Pass | UI/service toggles memory sources; tests cover persistence. |
| Capability enable/disable | Pass | Project-local capability state is persisted and reflected in snapshot/chat command availability. |
| Logs/runtime refresh | Pass | Electron UI has refresh actions backed by local snapshot/log queries. |
| Dashboard parity | Pass with explicit blockers | Local ADE workflows are present; remote auth admin/device sessions remain blocked with source files and reason. |
| Provider/MCP/checkpoint/subagent/hook/plugin labels are honest | Pass | Provider/MCP/checkpoint/subagent are implemented; hooks/plugins are marked unavailable. |
| UX screenshots and ZCode comparison | Pass | Screenshot and scorecard paths listed above. |

## Remaining Parity Blockers

- MCP protocol depth:
  - Source: `apps/server/src/modules/settings/application/local-ade.service.ts`
  - Reason: current probe checks executable/endpoint availability, not MCP
    initialize/tool discovery.
- Provider upstream auth/model probing:
  - Source: `apps/server/src/modules/settings/application/local-ade.service.ts`
  - Reason: current safe provider test verifies local CLI/version; it does not
    prove provider account auth or enumerate upstream models.
- Hook/plugin execution:
  - Source: `apps/server/src/modules/settings/application/local-ade.service.ts`
  - UI: `apps/web/src/components/local-ade/local-ade-control-center.tsx`
  - Reason: no signed plugin policy, loader, or hook execution sandbox exists.
    These classes are visibly unavailable.
- Checkpoint restore hardening:
  - Source: `apps/server/src/modules/settings/application/local-ade.service.ts`
  - UI: `apps/web/src/components/local-ade/local-ade-control-center.tsx`
  - Reason: guarded reverse-patch restore works only when HEAD/status and
    reverse-patch checks pass. It still needs conflict-aware UX, undo
    checkpoint creation, and session-turn attribution.
- Remote auth admin/device sessions:
  - Dashboard source:
    `apps/server/src/presentation/dashboard/components/auth-tab.tsx`
  - Server route: `apps/server/src/transport/http/routes/admin.ts`
  - Reason: remote administration surface, not local ADE work. Needs a local
    auth-admin policy before exposing in Electron.

## Verification Commands And Results

```powershell
bun test apps/server/src/modules/settings/application/local-ade.service.test.ts
```

Result: passed, 6 tests, 33 expectations.

```powershell
bun run --cwd apps/desktop check-types
```

Result: passed.

```powershell
bun run --cwd apps/desktop build:main
```

Result: passed.

```powershell
bun run --cwd apps/web build
```

Result: passed. Vite emitted only chunk-size and Browserslist age warnings.

```powershell
$env:ERAGEAR_DESKTOP_SMOKE_PROMPT_WAIT_MS='12000'; bun run --cwd apps/desktop ./scripts/smoke-desktop-runtime.ts
```

Result: passed.

- Runtime endpoint: `desktop-service`, ready `true`.
- CLI diagnostics: Codex `codex-cli 0.137.0`, OpenCode `1.16.2`; Claude and
  Gemini missing on PATH.
- ADE snapshot included provider health, `/desktop-smoke`, subagent
  `code-reviewer`, memory `AGENTS.md`/`CLAUDE.md`, and blocker
  `Auth admin and device sessions`.
- Created OpenCode session `397aac4f-11ec-4288-a252-f75abe8385e4`.
- Sent one message, observed assistant activity, stopped subscription, stopped
  session, stopped host.

```powershell
$env:ERAGEAR_DESKTOP_SMOKE_EXIT_MS='5000'; bun run dev:desktop
```

Result: passed, exited `0`.

```powershell
Start-Process -FilePath 'C:\Program Files\ZCode\ZCode.exe' -PassThru
```

Result: ZCode opened as a visible Electron app. Black-box observation captured
window screenshot, Electron process tree, child `zcode-acp.exe` command, and no
owned listeners in this sample. The launched ZCode processes were closed.

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('bun.exe','electron.exe','opencode.exe','zcode-acp.exe','ZCode.exe') }
```

Result: no owned Eragear/ZCode runtime processes remained after shutdown.

## Files Changed

- `.eragear/provider-health.json`
- `.eragear/subagents/code-reviewer.md`
- `docs/research/screenshots/eragear-dev-desktop-after-zcode-e2e.stderr.log`
- `docs/research/screenshots/eragear-dev-desktop-after-zcode-e2e.stdout.log`
- `docs/research/screenshots/eragear-dev-desktop-screenshot.stderr.log`
- `docs/research/screenshots/eragear-dev-desktop-screenshot.stdout.log`
- `docs/research/screenshots/eragear-electron-first-screen.png`
- `docs/research/screenshots/zcode-electron-blackbox-metadata.json`
- `docs/research/screenshots/zcode-electron-first-screen.png`
- `docs/research/zcode-blackbox-scorecard.md`
- `apps/desktop/scripts/smoke-desktop-runtime.ts`
- `apps/server/src/modules/settings/application/local-ade.service.ts`
- `apps/server/src/modules/settings/application/local-ade.service.test.ts`
- `apps/server/src/modules/settings/index.ts`
- `apps/server/src/transport/trpc/routers/settings.ts`
- `apps/web/src/components/chat-ui/chat-interface.tsx`
- `apps/web/src/components/local-ade/local-ade-control-center.tsx`

## Next Engineering Slice

1. Implement MCP initialize/tool discovery probes.
2. Add safe provider auth/model-list probes for providers that support them.
3. Add checkpoint undo snapshots and conflict-aware restore UX.
4. Add signed hook/plugin policy and sandbox design before enabling execution.
5. Improve active-workflow polish on the first screen without replacing the
   dense ADE control surface.
