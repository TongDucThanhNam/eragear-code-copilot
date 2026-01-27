# Eragear-Code-Copilot

Multi-platform AI coding assistant using ACP (Agent Client Protocol).
## Architecture
Before working on this codebase, read .agentlens/INDEX.md for navigation.


| Layer | Location | Stack |
|-------|----------|-------|
| UI | `apps/web` (Vite/Tauri), `apps/native` (Expo) | React, Tailwind, Shadcn, HeroUI Native |
| Server | `apps/server` | Hono, Bun, tRPC WebSocket, ACP SDK |
| Agents | External | Claude Code, Codex, Gemini CLI, etc. |

**Data Flow:** UI ↔ tRPC/WS ↔ Server ↔ stdio/ndjson ↔ Agent

### UI (Client)
User-facing interface: render UI, capture input, display agent streams.

### Server (ACP Client)
Manages Agent lifecycle: spawn process, bridge UI↔Agent communication, provide capabilities (filesystem, terminal), persist messages.

### Agents (ACP Agent)
AI backend: receive prompts, execute tool calls, generate responses.

## Docs

- **Platform:** [server](docs/server/README.md) | [web](docs/web/README.md) | [mobile](docs/mobile/README.md)
- **ACP:** `docs/acp/acp-*.md` (overview, session, tool-call, terminal, file-system, etc.)
- **Tasks:** `docs/tasks/`
- **Core:** `docs/core/`