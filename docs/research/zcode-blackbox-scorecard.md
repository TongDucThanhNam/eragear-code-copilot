# ZCode Black-Box Scorecard

Date: 2026-06-11

Scope: product-workflow comparison only. ZCode was launched as an end-user app
from `C:\Program Files\ZCode\ZCode.exe`. Observation was limited to visible app
behavior, window/process tree shape, child commands, listener state, and
screenshots. No ZCode archives, binaries, app package contents, private assets,
secrets, tokens, or private config contents were opened, copied, or unpacked.

Evidence:

- ZCode screenshot:
  `docs/research/screenshots/zcode-electron-first-screen.png`
- ZCode sanitized metadata:
  `docs/research/screenshots/zcode-electron-blackbox-metadata.json`
- Eragear Electron first-screen screenshot:
  `docs/research/screenshots/eragear-electron-first-screen.png`
- Eragear dev launch logs:
  `docs/research/screenshots/eragear-dev-desktop-after-zcode-e2e.stdout.log`
  and
  `docs/research/screenshots/eragear-dev-desktop-after-zcode-e2e.stderr.log`

## Black-Box Observation

- ZCode opened a native Electron desktop window titled `ZCode`.
- The observed process tree had Electron main, renderer, GPU, crashpad,
  network service, and Node service processes.
- The Node service spawned a visible ACP child command for the current
  workspace: `zcode-acp-glm-eragear-code-copilot acp`.
- No ZCode-owned local `Listen` TCP socket was observed in the launch sample.
- The ZCode processes started for the sample were closed after observation.

## Workflow Scorecard

| Workflow | ZCode Black-Box Behavior | Eragear Electron Status | Remaining Eragear Work |
| --- | --- | --- | --- |
| Desktop runtime | Native Electron shell with local agent runtime process tree. | Electron shell uses renderer `electron-ipc` into the private `desktop-service`; no local apps/server HTTP bridge is the desktop default. | Package/harden the dev security posture and runtime diagnostics. |
| First screen | Opens into an ADE-style workspace with agent workflow controls. | First screen is Local ADE Control Center with runtime health, CLI/provider status, capabilities, memory, MCP, checkpoints, logs, and dashboard parity blockers. | Visual polish and denser active-workflow affordances. |
| Agent session loop | Local ACP child process participates in agent execution. | Desktop smoke verifies create session, subscribe, send message, observe assistant activity, and stop session through the private service. | Support more installed CLIs beyond OpenCode/Codex on this machine. |
| Provider control | Provider/model management is a visible product surface. | Provider table shows agent/provider mapping, redacted env key names, CLI readiness, auth readiness, model readiness, discovered model identifiers, and persisted health. | Broaden provider-specific probes as more CLIs expose stable read-only status commands. |
| MCP management | MCP is a visible managed-tool workflow. | MCP entries can be added, toggled, initialized, and discovered; stdio and streamable HTTP paths call MCP `initialize`, `tools/list`, and `resources/list`, with protocol errors shown in UI. | Add generic SSE message-endpoint configuration for protocol discovery on bare SSE servers. |
| Capabilities | Skills, commands, agents, MCP, hooks, plugins are surfaced as product concepts. | Registry lists discovered skills/commands/output styles/memory/MCP/providers. Subagents are discovered from Markdown descriptors and invokable through `/agent-*` chat commands. Hooks/plugins are visibly unavailable. | Add signed hook/plugin policy and execution sandbox. |
| Project memory | Project context is surfaced as part of agent workflow. | `AGENTS.md`, `CLAUDE.md`, `.eragear/memory.md`, and `.eragear/context.md` are detected, previewed, redacted for secret-looking lines, and toggleable. | Add finer per-session/per-message memory policy. |
| Checkpoints/change trust | Checkpoint/change review is a visible trust workflow. | Git diff fallback, checkpoint creation, patch storage, patch preview, restore readiness checks, confirmation token, guarded restore, and automatic pre-restore safety checkpoints are implemented. | Add richer conflict-aware restore UX and session-turn attribution. |
| Logs/observability | Runtime activity is treated as a product concern. | Runtime timeline is visible in Electron and backed by local log store queries. | Add deeper ACP traffic/debug inspection. |
| Dashboard parity | Local ADE functions are available in-app. | Local runtime, agents, sessions, logs, memory, MCP, providers, capabilities, and checkpoints have Electron paths or exact blocker entries. | Remote auth admin/device-session management needs a local policy decision before exposure. |

## Comparison Note

ZCode's black-box launch confirms a serious Electron ADE shape: native window,
local runtime delegation, ACP child process, and visible workspace flow. Eragear
now exercises the same core local-ADE categories with its own implementation:
private Electron IPC transport, provider readiness probes, MCP protocol
discovery, checkpoint safety restore, memory/capability actions, manual
subagent invocation, and a verified agent session loop. Further hardening is
now concentrated in non-core execution surfaces such as signed hook/plugin
policy, generic SSE discovery configuration, and richer conflict-aware
checkpoint UX.
