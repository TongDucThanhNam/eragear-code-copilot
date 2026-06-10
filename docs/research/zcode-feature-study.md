# ZCode Feature Study

Date: 2026-06-11

Scope: safe competitive/product research for Eragear desktop planning. This study uses public ZCode/Z.AI documentation, visible UI, process metadata, and filesystem inventory only. It does not decompile ZCode, copy proprietary code, inspect private credentials, or reuse ZCode-owned schemas.

## Sources

- ZCode new docs: https://zcode.z.ai/en/newdocs/welcome
- ZCode legacy ADE tools: https://zcode.z.ai/en/docs/legacy/ADE-tools
- ZCode legacy Agent Chat: https://zcode.z.ai/en/docs/legacy/agents
- ZCode legacy Specialized Agents: https://zcode.z.ai/en/docs/legacy/specialized-agents
- ZCode legacy Commands: https://zcode.z.ai/en/docs/legacy/commands
- ZCode legacy Plugins: https://zcode.z.ai/en/docs/legacy/plugin
- ZCode legacy MCP Services: https://zcode.z.ai/en/docs/legacy/mcp-services
- ZCode legacy Skills: https://zcode.z.ai/en/docs/legacy/skill
- ZCode legacy Memory: https://zcode.z.ai/en/docs/legacy/memory
- ZCode legacy Version Control: https://zcode.z.ai/en/docs/legacy/version-control
- ZCode legacy Safety Confirmation: https://zcode.z.ai/en/docs/legacy/safety-confirm
- ZCode legacy Remote Development: https://zcode.z.ai/en/docs/legacy/remote
- Z.AI MCP Vision Server: https://docs.z.ai/devpack/mcp/vision-mcp-server
- Z.AI GLM Coding Plan quick start: https://docs.z.ai/devpack/quick-start
- Z.AI model switching guide: https://docs.z.ai/devpack/using5.1

## Local Observations

Installed app:

- Executable: `C:\Program Files\ZCode\ZCode.exe`
- Product/file version observed from Windows metadata: `2.13.0.1163`
- Electron runtime observed from process command line: Electron `41.0.3`
- Main app resources include `app.asar`, `app.asar.unpacked`, Electron/Chromium assets, and updater metadata.

Runtime/resource layout observed:

- `resources\acp`
  - Contains `@agentclientprotocol/claude-agent-acp` package metadata, version `0.29.2`.
  - Includes `@agentclientprotocol/sdk`, `@modelcontextprotocol`, `@anthropic-ai/claude-agent-sdk`, Hono/Express-related dependencies, Zod schemas, and bundled ripgrep under SDK vendor paths.
- `resources\acp-proxy-runtime\dist`
  - Contains HTTP/WS proxy modules and compatibility adapters such as `codexAnthropicCompat`, `codexGeminiCompat`, `codexOpenaiChatCompat`, `geminiOpenaiChatCompat`, model override modules, traffic event emitter, and runtime routes.
- `resources\glm`
  - Contains `zcode-acp.exe`.
- `resources\codex`
  - Contains `zcode-codex-bundle` package metadata.
- `resources\gemini`
  - Contains Gemini runtime bundles, policies, docs, sandbox profiles, tree-sitter assets, OAuth/provider modules, and memory discovery files.
- `resources\opencode`
  - Contains `opencode.exe`.
- `resources\tools\ripgrep`
  - Contains `rg.exe`.

Runtime process observation:

- ZCode launches multiple Electron processes plus `zcode-acp.exe` with an `acp` command line for the current workspace.

Live launch sample on 2026-06-11:

- Launched `C:\Program Files\ZCode\ZCode.exe` with `Start-Process`.
- Main window title was `ZCode`.
- Observed Electron main process, crashpad, GPU, network service, renderer
  processes, and a `node.mojom.NodeService` utility process.
- The Node service spawned `C:\Program Files\ZCode\resources\glm\zcode-acp.exe`
  with command line `zcode-acp-glm-eragear-code-copilot acp`.
- TCP sample for ZCode-owned PIDs showed `Bound` and `Established` outbound TLS
  connections from the Electron network service; no `Listen` state was observed
  in that sample.
- The process tree was terminated after observation with `taskkill /T /F`, and
  no ZCode processes remained.

User data layout observed without reading secrets:

- `~\.zcode\cli` contains `artifacts`, `db`, `exec`, `log`, `models`, and `config.json`.
- `~\.zcode\v2` contains `acp-config`, `checkpoints`, `repo-snapshots`, `session-bindings`, `sessions`, `logs`, `tasks-index.sqlite`, `model-providers.json`, `setting.json`, `skills-state.json`, and model cache/state files.
- `~\.zcode\v2\acp-config` is organized by agent provider: `claude`, `codex`, `gemini`, `glm`, `opencode`; workspace subfolders include `skills` and workspace metadata.

Interpretation: ZCode is not just a webview around a chat server. It is an Electron ADE with a local runtime, ACP bridge/proxy layers, per-agent provider adapters, per-workspace config, checkpoints/snapshots, model-provider registry, skills state, and task/session indexes.

## Feature Inventory

### 1. ADE Positioning

ZCode positions itself as an Agentic Development Environment for long-horizon tasks. The product center is not manual code editing; it is task execution by agents with project context, file tools, terminal, Git, preview, and permission control.

Eragear takeaway: keep the desktop app focused on project/session workflow and agent execution, not a generic chat shell.

### 2. Multi-Agent Framework

Public docs list Claude Code, Gemini CLI, Codex, and OpenCode as major agent frameworks. Local resources also show GLM/ZCode ACP runtime pieces. ZCode lets users select/switch agent framework during a workflow.

Eragear takeaway: implement an agent-provider registry and runtime diagnostics, but keep the product constraint: do not bundle Agent CLIs. Users install/manage Codex, Claude, Gemini, OpenCode themselves.

### 3. Model Providers

The observed settings UI supports:

- Built-in providers such as Z.AI and BigModel.
- Custom providers such as OpenRouter, Moonshot, MiniMax, DeepSeek, Mimo, and Qwen.
- Separate Anthropic-compatible and OpenAI-compatible endpoints.
- API key mode and subscription mode.
- Model list management.
- Claude model mapping.

Eragear takeaway: model providers should be a first-class settings domain, separate from agent runtime. It needs provider kind, endpoints, auth mode, model list, model aliases/mapping, and per-agent compatibility metadata.

### 4. ACP Proxy And Compatibility Layer

Local files show a dedicated ACP/proxy runtime with HTTP/WS forwarding, traffic capture, certificate support, compatibility transforms, and model override modules.

Eragear takeaway: Phase 2 runtime host should expose diagnostics and transport bootstrap explicitly. Later, add a local traffic/debug surface for agent requests without coupling it to UI code.

### 5. Agent CLI Management

ZCode has an `Agent CLI` settings entry and per-provider `acp-config` folders. Public docs and local layout indicate provider-specific workspace config for Claude, Codex, Gemini, GLM, and OpenCode.

Eragear takeaway: add a CLI availability/health diagnostic surface:

- command found/missing
- detected version
- auth status if safely detectable
- runtime adapter readiness
- suggested install command or docs link

Missing CLI must be a warning/diagnostic, not an app startup failure.

### 6. Skills

ZCode Skills are Markdown instruction modules with YAML frontmatter. Docs describe user, project, and plugin skills; reference files; scripts inside skill folders; enable/disable state; auto-trigger and manual `@` invocation.

Eragear takeaway: implement a `skills` capability domain:

- storage scopes: user, project, plugin-provided
- file format: `SKILL.md` with `name` and `description`
- optional reference files and scripts
- enabled/disabled state by scope/context
- runtime loader with progressive disclosure

Suggested Eragear paths:

- user: `%APPDATA%\Eragear\skills\...`
- project: `.eragear\skills\...`
- compatibility import: `.claude\skills\...`

### 7. Subagents / Specialized Agents

ZCode Specialized Agents have isolated context, independent prompts, tool permissions, reusable configuration, specialized behavior, and model routing. Docs show built-ins like `bug-analyzer`, `code-reviewer`, `dev-planner`, `story-generator`, and `ui-sketcher`. Custom agents can be created in settings or Markdown files with frontmatter.

Eragear takeaway: subagents should be modeled as separate delegated sessions, not as prompt snippets inside the parent chat. Minimum domain shape:

- `name`
- `description`
- `model`
- `toolPolicy`
- `systemPrompt`
- `scope`
- `autoInvoke`

Runtime rule: parent session delegates work and receives summarized result; subagent context must not pollute the main session unless intentionally attached.

### 8. Commands

ZCode slash commands are reusable prompt shortcuts. Docs describe user commands, plugin commands, and built-in commands. Commands are Markdown files with frontmatter fields such as `description` and `argument-hint`.

Eragear takeaway: commands are lighter than skills and should be implemented as prompt templates with argument parsing:

- user/project/plugin scopes
- `/` fuzzy picker in chat input
- markdown prompt body
- optional argument hints
- parameters appended or bound into template variables

Suggested Eragear paths:

- user: `%APPDATA%\Eragear\commands\...`
- project: `.eragear\commands\...`

### 9. MCP Servers

ZCode exposes MCP server management with built-in and custom configuration. Public docs mention built-in visual understanding, internet search, and web reader MCP services. Z.AI docs list tools for screenshot-to-artifact, OCR, error diagnosis, diagram understanding, and data visualization.

Eragear takeaway: MCP should be a managed external-tool capability:

- registry of MCP servers
- transport kind: stdio, SSE, streamable HTTP when supported
- environment/header configuration with secret redaction
- enabled/disabled state
- per-project overrides
- tool discovery and health

Security rule: secrets are stored in an OS/user secret store or redacted config layer, not plain project files.

### 10. Plugins

ZCode plugins are marketplace-provided bundles of capabilities. Docs list plugin type tags: Agent, Command, MCP, LSP, Skill, Hook. Marketplace sources can be GitHub repo, SSH URL, remote marketplace JSON, or local path. Scopes include user, project, and local.

Eragear takeaway: do not start with a full marketplace. Start with a local plugin manifest format that can install/register skills, commands, agents, MCP servers, hooks, and optional LSP integrations into the same capability registry.

### 11. Hooks

The ZCode settings UI contains Hooks, and plugin docs list Hook as a plugin type. Public docs found in this pass did not expose a full hook specification.

Eragear takeaway: reserve hook slots now, implement later:

- lifecycle events: before send, after response, before tool call, after tool call, before commit/checkpoint
- restricted execution policy
- visible audit log
- opt-in per workspace

### 12. Memory

ZCode memory is project Markdown context, primarily `CLAUDE.md` or `.claude/CLAUDE.md`, auto-loaded into conversations. It stores project conventions, standards, and workflows.

Eragear takeaway: Eragear already has `AGENTS.md` and project docs. Desktop should surface memory files as editable project context:

- detect `AGENTS.md`, `CLAUDE.md`, `.eragear\memory.md`
- preview what will be loaded
- allow per-session enable/disable
- warn against secrets

### 13. Indexing

The ZCode UI has Indexing settings. Local data shows `repo-snapshots`, `tasks-index.sqlite`, and repo snapshot indexing settings.

Eragear takeaway: start with pragmatic indexing:

- SQLite task/session index
- ripgrep/file tree for fast exact search
- repo snapshot metadata for change tracking
- optional vector indexing only after exact/project indexing is stable

### 14. Versioning And Checkpoints

ZCode docs describe conversation-level checkpoints, diff review, undo latest changes, restore to a message checkpoint, and Git panel integration. Local data includes `checkpoints` and `repo-snapshots`.

Eragear takeaway: this is high-value for agent trust. Implement after runtime host/capability registry:

- capture file change set per user message
- show multi-file diff before/after tool execution
- one-click undo last agent change
- map changes back to session message IDs
- use Git when available, fallback to local snapshots

### 15. Permission Modes And Safety Confirmation

ZCode docs define permission modes: Always Ask, Accept Edits, Plan Mode, Bypass Permissions. Safety confirmation supports allow, reject, and always allow for repeated action types.

Eragear takeaway: add explicit permission profiles:

- `always-ask`
- `accept-edits`
- `plan-first`
- `trusted-workspace`

The existing ACP permission flow can become the enforcement point. Store temporary grants by session/action type, not globally.

### 16. Output Style

ZCode output styles are Markdown-defined response modes with built-in styles and custom style files.

Eragear takeaway: implement as another lightweight capability type:

- project/user styles
- active style per session
- markdown body loaded into system/developer prompt area
- do not confuse with skills; style controls response shape, skill controls task procedure.

### 17. Remote Control And SSH

ZCode supports mobile remote control of a running desktop session and SSH remote project development. Public docs say desktop remains the execution host for mobile remote control; SSH mode executes code on the remote server.

Eragear takeaway: keep remote/client-only architecture, but do not let it block desktop local runtime. Remote control can come later after:

- runtime host contract is stable
- local auth/token boundary is robust
- session event stream is explicit
- permission prompts are transport-agnostic

## Recommended Eragear Roadmap

### Phase 2: Runtime Host/Core Boundary

Current GOAL.md is already aligned. Do this first:

- runtime host contract: start, stop, health, diagnostics, bootstrap metadata
- shared runtime creation path for desktop and server host
- local desktop auth bypass remains loopback/token-gated
- CLI availability diagnostics surface
- no bundling of external Agent CLIs

### Phase 3: Capability Registry

Create one canonical registry that can describe and load:

- skills
- commands
- subagents
- MCP servers
- model providers
- output styles
- hooks placeholders
- plugin-provided capabilities later

This avoids scattering settings logic across chat UI, server runtime, and Electron main.

### Phase 4: Skills, Commands, And Model Providers

These are high-value and relatively low-risk:

- Markdown/frontmatter parser
- user/project scopes
- enable/disable state
- chat input invocation for `@skill` and `/command`
- provider endpoints, model mapping, and missing-key diagnostics

### Phase 5: Subagents And MCP

Implement after the registry exists:

- subagent as delegated session runtime with isolated context
- per-subagent model/tool policy
- MCP config management and health checks
- MCP tools only loaded into context when enabled/relevant

### Phase 6: Checkpoints, Indexing, Plugins, Remote

These are valuable but touch more trust/security surface:

- conversation-level checkpoints and undo
- SQLite task/session index and repo snapshots
- plugin manifest/marketplace
- mobile remote and SSH remote host modes

## Proposed Domain Model

```ts
type CapabilityKind =
  | "skill"
  | "command"
  | "subagent"
  | "mcp-server"
  | "model-provider"
  | "output-style"
  | "hook"
  | "plugin";

type CapabilityScope = "user" | "project" | "local" | "plugin";

interface CapabilityDescriptor {
  id: string;
  kind: CapabilityKind;
  name: string;
  description?: string;
  scope: CapabilityScope;
  enabled: boolean;
  sourcePath?: string;
  pluginId?: string;
  tags?: string[];
  diagnostics?: RuntimeDiagnostic[];
}
```

Do not encode every capability into one giant JSON object. Use the registry for discovery/state, then type-specific modules for validation and runtime behavior.

## Architecture Notes For Eragear

- Keep `apps/web` as renderer. Add settings surfaces incrementally; do not redesign the main UI.
- Keep `apps/server` as host for remote/HTTP mode.
- Move runtime rules into shared runtime/core paths before adding feature-heavy registries.
- Electron main should own local runtime lifecycle, diagnostics, and local bootstrap in desktop mode.
- Storage should align with current SQLite direction from `apps/server/AGENTS.md`; avoid adding new JSON primary stores.
- Project-level capability files should live under `.eragear` by default, with import/compat for `.claude` where useful.
- Secret values must never be committed into project-level capability files.

## What Not To Copy

- Do not copy ZCode app-data schemas.
- Do not decompile or reuse ZCode proprietary source.
- Do not bundle `zcode-acp.exe`, `opencode.exe`, Gemini bundles, Codex bundles, or other third-party Agent CLIs.
- Do not rely on ZCode-specific hidden folders.
- Do not couple Eragear runtime to one provider's subscription flow.

## Immediate Backlog Candidates

1. Add runtime diagnostics DTO to Phase 2 host contract.
2. Add CLI provider discovery for Codex, Claude, Gemini, and OpenCode.
3. Add model provider domain with endpoint/model mapping and redacted auth state.
4. Add capability registry tables in SQLite.
5. Add Markdown/frontmatter parser utility for skills, commands, agents, and output styles.
6. Add first project-level `.eragear/skills` loader.
7. Add `/command` and `@capability` resolution in web chat input without redesigning UI.
8. Add subagent definition model, then implement delegated session execution.
9. Add MCP server config/health manager with strict secret redaction.
10. Add checkpoint/change-set capture around agent file writes.
