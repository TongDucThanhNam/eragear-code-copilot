# 📘 Eragear Server - Comprehensive System Report

## 1. Executive Summary
Eragear Server acts as a robust **Backend-For-Frontend (BFF)** and **Agent Orchestrator**. It manages the lifecycle of local AI agents, enforces security boundaries (sandbox), and serves as a bridge between the User Interface (web/native) and the underlying Agent Processes using the **Agent Client Protocol (ACP)**.

The system is built on **Node.js/Bun**, using **Hono** for HTTP/WebSocket transport, and follows **Clean Architecture** principles to ensure maintainability and testability.

## 2. 🏗️ Architecture & Design Patterns

### 2.1. Structural Overview
The application follows a **Hexagonal (Ports & Adapters)** architecture, organized by **Vertical Features**.

```mermaid
graph TD
    Client[Client (Web/Native)] <--> Transport[Transport Layer (tRPC/WS/HTTP)]
    Transport --> Application[Application Layer (Use Cases)]
    Application --> Domain[Domain Layer (Entities)]
    Application --> Ports[Ports (Interfaces)]
    Infra[Infrastructure Layer] -.->|Implements| Ports
    Infra --> External[External Systems (Agent Process, FS, Git)]
```

### 2.2. Vertical Slice Modules (`src/modules/*`)
Each feature is self-contained with its own layers:
- **Session**: Manages chat sessions, state, and message history.
- **Agent**: Manages agent configurations.
- **Project**: Handles project roots and context.
- **AI**: Logic specifically for prompting and context building.
- **Tooling**: Handles file system/git operations requested by agents.
- **Settings**: Manages application-wide configuration.

### 2.3. Dependency Injection (DI)
- **Mechanism**: Manual Dependency Injection via a Singleton Container (`src/bootstrap/container.ts`).
- **Flow**:
  1. `Container` initializes all **Adapters** (Infra).
  2. Services are instantiated on-demand (e.g., inside tRPC procedures) receiving Adapters as arguments (implementing Port interfaces).
  3. **Benefit**: Decouples logic from implementation (e.g., swapping `JsonStore` for `SQLite` would only require changing the Adapter, not the Service).

---

## 3. 🧠 Core Concepts & Protocols

### 3.1. Agent Client Protocol (ACP)
The backbone of communication. It runs over `stdio` (Standard Input/Output) of the spawned agent process using **NDJSON**.

- **Handshake**:
  - Server sends: `initialize { protocolVersion: 1, clientCapabilities: ... }`
  - Agent responds: `capabilities`, `agentInfo`.
- **Message Types**:
  - **Downstream (Server -> Agent)**: `prompt`, `cancel`, `terminate`.
  - **Upstream (Agent -> Server)**: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `plan`, `turn_end`.

### 3.2. Session State Machine
A session exists in two parallel states: **Lifecycle State** (Server) and **Chat Status** (UI/Interaction).

| Lifecycle State | Description |
| :--- | :--- |
| `running` | Process is active and responsive. |
| `stopped` | Process killed or exited (cleanly or error). |
| `inactive` | Process exited successfully (code 0). |

| Chat Status (UI) | Description |
| :--- | :--- |
| `ready` | Idle, waiting for user input. |
| `submitted` | User sent a message, waiting for agent ack. |
| `streaming` | Receiving chunks from agent. |
| `awaiting_permission` | Blocked, waiting for user approval on tool call. |
| `error` | Something went wrong. |
| `cancelling` | User requested stop, waiting for process term. |

### 3.3. Buffering Strategy (`SessionBuffering`)
Since agents stream tokens, the server creates a `SessionBuffering` instance for each session:
- **Accumulation**: Collects `content` and `reasoning` chunks.
- **Broadcast**: Real-time patches sent to UI via WebSocket.
- **Persistence**: Only flushes to disk (JSON) when `turn_end` or `prompt_end` is received, preventing partial writes.

---

## 4. 🌊 Detailed Data Flows

### 4.1. Session Creation & Startup
1. **Request**: UI calls `trpc.session.createSession`.
2. **Setup**: `CreateSessionService` resolves `ProjectRoot` and `AgentCommand` (default: `opencode`).
3. **Spawn**: `AgentRuntimeAdapter` spawns process (with env/command sanitization).
4. **Connect**: `createAcpConnectionAdapter` attaches to `stdout`/`stdin`.
5. **Handshake**: Negotiation of capabilities (e.g., `loadSession` support).
6. **Persistence**: Session metadata saved to `.eragear/sessions.json`.
7. **Broadcast**: Status becomes `ready`.

### 4.2. User Sending Message
1. **Input**: `SendMessageService` receives text/images.
2. **Persist User Msg**: Immediate write to JSON store (`role: user`).
3. **Broadcast**: UI receives user message.
4. **ACP Prompt**: `session.conn.prompt(...)` sends payload to Agent.
5. **Streaming Loop**:
   - Agent emits `chunk` -> `SessionUpdateHandler`.
   - Handler updates `Buffer`.
   - Handler broadcasts `ui_message` (partial) to WebSocket.
6. **Completion**:
   - `turn_end` received.
   - Buffer flushed.
   - Assistant message persisted to JSON store (`role: assistant`).
   - Status set to `ready`.

### 4.3. Tool Call & Permission System
1. **Trigger**: Agent emits `tool_call` (e.g., `writeTextFile`).
2. **Intercept**: `createPermissionHandler` checks if tool requires approval.
3. **Hold**: Process promise is **cached** in memory (`session.pendingPermissions`).
4. **Notify**: Broadcast `chatStatus: awaiting_permission` and permission request ID.
5. **User Action**: UI calls `trpc.tool.respondToPermissionRequest(decision)`.
6. **Resolve**: `RespondPermissionService` finds the cached promise and resolves it.
7. **Resume**: Agent gets the result of the tool call (or rejection error).

---

## 5. 🛡️ Security & Sandbox

### 5.1. Process Isolation
- **Command Whitelist**: Only commands in `ALLOWED_AGENT_COMMANDS` (default: `opencode`, `node`, `python`) can be spawned.
- **Env Sanitization**: Sensitive environment variables are stripped unless explicitly allowed in `ALLOWED_ENV_KEYS`.
- **Timeouts**: `AGENT_TIMEOUT_MS` ensures runaway processes are killed.

### 5.2. File System Sandbox
- **Project Root**: All file operations are typically relative to `ProjectRoot`.
- **Permission Boundary**: High-risk operations (Write, Terminal) **always** trigger the Permission System unless explicitly configured otherwise (though current implementation defaults to strictly asking).

---

## 6. 📂 Persistence (Storage)

The system is **Serverless-ready** (in design) but currently uses **Local JSON Files** for simplicity and portability.

- **Location**: Store in `.eragear/` inside the workspace or user home.
- **Files**:
  - `sessions.json`: Metadata of all sessions.
  - `projects.json`: Known projects and their settings.
  - `agents.json`: Custom agent configurations.
  - `settings.json`: User preferences (UI theme, etc.).
- **Log Store**: Specialized handling for logs (`src/infra/logging/log-store.ts`) to avoid performance bottlenecks.

# File tree:
```bash
terasumi@terasumi-linux:~/Documents/source_code/Web/eragear-code-copilot/apps/server$ eza --tree --git-ignore
.
├── AGENTS.md
├── Dockerfile
├── docs
│  ├── acp
│  │  ├── acp-agent-plan.md
│  │  ├── acp-architechture.md
│  │  ├── acp-chat-protocol.md
│  │  ├── acp-client-side-connection.md
│  │  ├── acp-content.md
│  │  ├── acp-extensibility.md
│  │  ├── acp-file-system.md
│  │  ├── acp-initialization.md
│  │  ├── acp-overview.md
│  │  ├── acp-permission-response-fix.md
│  │  ├── acp-prompt-turn.md
│  │  ├── acp-schema.md
│  │  ├── acp-session-mode.md
│  │  ├── acp-session-setup.md
│  │  ├── acp-slash-command.md
│  │  ├── acp-terminal.md
│  │  ├── acp-tool-call.md
│  │  └── acp-transport.md
│  ├── design_system.md
│  ├── INDEX.md
│  ├── ui-message-normalization.md
│  └── ui-message-usechat-client.md
├── package.json
├── public
│  ├── client.js
│  └── styles.css
├── src
│  ├── ARCHITECTURE.md
│  ├── bootstrap
│  │  ├── container.ts
│  │  └── server.ts
│  ├── config
│  │  ├── constants.ts
│  │  └── environment.ts
│  ├── index.ts
│  ├── infra
│  │  ├── acp
│  │  │  ├── connection.ts
│  │  │  ├── handlers.ts
│  │  │  ├── permission.ts
│  │  │  ├── session-acp.adapter.ts
│  │  │  ├── tool-calls.ts
│  │  │  └── update.ts
│  │  ├── auth
│  │  │  ├── auth.ts
│  │  │  ├── bootstrap.ts
│  │  │  ├── credentials.ts
│  │  │  ├── guards.ts
│  │  │  ├── paths.ts
│  │  │  └── secret.ts
│  │  ├── caching
│  │  │  ├── index.ts
│  │  │  ├── middleware.ts
│  │  │  ├── response-cache.ts
│  │  │  └── types.ts
│  │  ├── filesystem
│  │  ├── git
│  │  │  └── index.ts
│  │  ├── logging
│  │  │  ├── log-store.ts
│  │  │  ├── logger.ts
│  │  │  ├── request-logger.ts
│  │  │  └── structured-logger.ts
│  │  ├── process
│  │  │  └── index.ts
│  │  └── storage
│  │     └── json-store.ts
│  ├── modules
│  │  ├── agent
│  │  │  ├── application
│  │  │  │  ├── agent.service.ts
│  │  │  │  └── ports
│  │  │  │     └── agent-repository.port.ts
│  │  │  ├── domain
│  │  │  │  └── agent.entity.ts
│  │  │  └── infra
│  │  │     └── agent.repository.json.ts
│  │  ├── ai
│  │  │  ├── application
│  │  │  │  ├── acp-error.util.ts
│  │  │  │  ├── cancel-prompt.service.ts
│  │  │  │  ├── prompt.builder.ts
│  │  │  │  ├── send-message.service.ts
│  │  │  │  ├── set-mode.service.ts
│  │  │  │  └── set-model.service.ts
│  │  │  ├── domain
│  │  │  └── infra
│  │  ├── dashboard
│  │  │  ├── application
│  │  │  ├── domain
│  │  │  └── infra
│  │  ├── project
│  │  │  ├── application
│  │  │  │  ├── ports
│  │  │  │  │  └── project-repository.port.ts
│  │  │  │  └── project.service.ts
│  │  │  ├── domain
│  │  │  │  └── project.entity.ts
│  │  │  └── infra
│  │  │     └── project.repository.json.ts
│  │  ├── session
│  │  │  ├── application
│  │  │  │  ├── create-session.service.ts
│  │  │  │  ├── delete-session.service.ts
│  │  │  │  ├── get-session-messages.service.ts
│  │  │  │  ├── get-session-state.service.ts
│  │  │  │  ├── list-sessions.service.ts
│  │  │  │  ├── ports
│  │  │  │  │  ├── agent-runtime.port.ts
│  │  │  │  │  ├── session-acp.port.ts
│  │  │  │  │  ├── session-repository.port.ts
│  │  │  │  │  └── session-runtime.port.ts
│  │  │  │  ├── reconcile-session-status.service.ts
│  │  │  │  ├── resume-session.service.ts
│  │  │  │  ├── stop-session.service.ts
│  │  │  │  └── update-session-meta.service.ts
│  │  │  ├── domain
│  │  │  │  └── session.entity.ts
│  │  │  ├── infra
│  │  │  │  ├── runtime-store.ts
│  │  │  │  └── session.repository.json.ts
│  │  │  └── SESSION-MODULE.md
│  │  ├── settings
│  │  │  ├── application
│  │  │  │  └── ports
│  │  │  │     └── settings-repository.port.ts
│  │  │  ├── domain
│  │  │  │  └── settings.entity.ts
│  │  │  └── infra
│  │  │     └── ui-settings.repository.json.ts
│  │  └── tooling
│  │     ├── application
│  │     │  ├── code-context.service.ts
│  │     │  ├── ports
│  │     │  │  └── git.port.ts
│  │     │  └── respond-permission.service.ts
│  │     ├── domain
│  │     └── infra
│  ├── shared
│  │  ├── errors
│  │  │  └── index.ts
│  │  ├── logger
│  │  ├── ports
│  │  │  ├── event-bus.port.ts
│  │  │  └── log-store.port.ts
│  │  ├── types
│  │  │  ├── agent.types.ts
│  │  │  ├── common.types.ts
│  │  │  ├── log.types.ts
│  │  │  ├── project.types.ts
│  │  │  ├── session.types.ts
│  │  │  └── settings.types.ts
│  │  └── utils
│  │     ├── chat-events.util.ts
│  │     ├── cli-args.util.ts
│  │     ├── content-block.util.ts
│  │     ├── event-bus.ts
│  │     ├── id.util.ts
│  │     ├── path.util.ts
│  │     ├── project-roots.util.ts
│  │     ├── session-cleanup.util.ts
│  │     ├── ui-message.util.ts
│  │     └── ui-settings.util.ts
│  └── transport
│     ├── http
│     │  ├── constants.ts
│     │  ├── cors-factory.ts
│     │  ├── cors.ts
│     │  ├── error-handler.ts
│     │  ├── request-id.ts
│     │  ├── routes
│     │  │  ├── admin.ts
│     │  │  ├── agents.ts
│     │  │  ├── dashboard.ts
│     │  │  ├── helpers.ts
│     │  │  ├── index.ts
│     │  │  ├── projects.ts
│     │  │  ├── sessions.ts
│     │  │  └── settings.ts
│     │  ├── ui
│     │  │  ├── components
│     │  │  │  ├── add-agent-modal.tsx
│     │  │  │  ├── add-project-modal.tsx
│     │  │  │  ├── agent-card.tsx
│     │  │  │  ├── agent-stats.tsx
│     │  │  │  ├── agents-tab.tsx
│     │  │  │  ├── api-key-row.tsx
│     │  │  │  ├── auth-tab.tsx
│     │  │  │  ├── dashboard-footer.tsx
│     │  │  │  ├── dashboard-header.tsx
│     │  │  │  ├── dashboard-nav.tsx
│     │  │  │  ├── device-session-row.tsx
│     │  │  │  ├── edit-agent-modals.tsx
│     │  │  │  ├── logs-tab.tsx
│     │  │  │  ├── overview-stats.tsx
│     │  │  │  ├── project-card.tsx
│     │  │  │  ├── projects-tab.tsx
│     │  │  │  ├── session-row.tsx
│     │  │  │  ├── sessions-tab.tsx
│     │  │  │  ├── settings-tab.tsx
│     │  │  │  ├── tab-button.tsx
│     │  │  │  └── tab-panel.tsx
│     │  │  ├── dashboard-data.ts
│     │  │  ├── dashboard-view.tsx
│     │  │  ├── document.tsx
│     │  │  ├── login.tsx
│     │  │  ├── render-document.ts
│     │  │  ├── styles.css
│     │  │  ├── ui-assets.ts
│     │  │  └── utils.ts
│     │  └── utils
│     │     └── auth.ts
│     ├── trpc
│     │  ├── base.ts
│     │  ├── context.ts
│     │  ├── router.ts
│     │  ├── routers
│     │  │  ├── agents.ts
│     │  │  ├── ai.ts
│     │  │  ├── auth.ts
│     │  │  ├── code.ts
│     │  │  ├── project.ts
│     │  │  ├── session.ts
│     │  │  └── tool.ts
│     │  └── types.ts
│     └── ws
├── todo.md
├── tsconfig.json
├── tsdown.config.ts
└── ui
   ├── client.tsx
   └── tsconfig.json
```