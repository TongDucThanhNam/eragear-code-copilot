# Eragear-Code-Copilot: System Overview

This project is a web-based AI coding assistant built on the **Agent Client Protocol (ACP)**. It provides a bridge between a browser-based UI and local AI agents capable of manipulating the filesystem and running terminal commands.

## 🏗 Architecture & Tech Stack

The system follows a 3-tier architecture that clearly distinguishes roles according to the **Agent Client Protocol (ACP)** definitions:

### 1. Client (User Interface)
*   **Role**: The user-facing interface where users interact with the system.
*   **Implementations**: Web App (`apps/web`), and potential future Desktop/Mobile apps.
*   **Tech Stack**: React 18+ (Vite), Tailwind CSS, Shadcn UI.
*   **Responsibilities**: Rendering UI, capturing user input, displaying agent stream.

### 2. Server (ACP Client)
*   **Role**: Acts as the **Client** in the ACP context. It manages the connection to the Agent.
*   **Implementation**: Hono Server (`apps/server`).
*   **Tech Stack**: Bun / Node.js, `@agentclientprotocol/sdk`.
*   **Responsibilities**:
    *   Spawning and managing the Agent process (`child_process`).
    *   Bridging communication between the UI (WebSocket/SSE) and the Agent (Stdio).
    *   Providing system capabilities (File System access, Terminal execution) to the Agent.

### 3. Agents (ACP Agents)
*   **Role**: The intelligent backend process that performs tasks.
*   **Implementations**: Claude Code, Codex, OpenCode, Gemini CLI, etc.
*   **Responsibilities**: Receiving prompts, thinking, executing tool calls (provided by the Server), and generating responses.

---

### Internal Structure

#### Backend (`apps/server`)
- **Runtime**: Bun / Node.js
- **Framework**: [Hono](https://hono.dev/)
- **Core Library**: `@agentclientprotocol/sdk`
- **Communication**:
    - **Frontend → Backend**: REST APIs (JSON) for initialization and prompt submission.
    - **Backend → Agent**: Standard Input/Output (ndjson) via `node:child_process`.
    - **Backend → Frontend**: tRPC Subscriptions (WebSocket) for real-time streaming and status updates.

#### Frontend (`apps/web`)
- **Framework**: React 18+ (Vite)
- **Styling**: Tailwind CSS + [Shadcn UI](https://ui.shadcn.com/)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Authentication**: [Better-Auth](https://www.better-auth.com/)

#### Shared Workspace
- `packages/shared`: Shared types, event schemas, and protocol helpers.

## 📂 Key File Map

| Path | Description |
|---|---|
| `apps/server/src/index.ts` | Server logic, ACP connection handling, SSE streaming. |
| `apps/web/src/routes/index.tsx` | Main Chat interface, SSE consumer, session management. |
| `apps/web/src/store/settings-store.ts` | Zustand store for agent settings and LocalStorage sync. |
| `apps/web/src/components/settings-dialog.tsx` | CRUD UI for managing agent configurations. |
| `TODO.md` | Feature roadmap and progress tracking. |

## 🚀 Development Guide

### Setup
1. `bun install`
2. `bun run dev` (Starts backend on `:3000` and frontend on `:3001`).

### Authentication
Authentication is currently **mocked** in `apps/web/src/lib/auth-client.ts`. To restore real auth:
1. Revert the mock in `auth-client.ts`.
2. Configure environment variables for Better-Auth.

### Adding a New Agent
1. Open the **Settings** dialog in the Web UI.
2. Provide a Name, Command (e.g., `opencode`), Args (e.g., `acp`), and Environment variables.
3. These are saved to `LocalStorage` and passed to the server when starting a chat.

## 🤖 AI Assistant Conventions

### Coding Standards
- **Components**: Use PascalCase for filenames. Follow Shadcn patterns for UI primitives.
- **State**: Keep business logic in Zustand stores; keep UI state in `useState`.
- **API**: Use absolute paths for server endpoints (`/api/...`).
- **Imports**: Use `@/` alias for `apps/web/src`.

### Backend Implementation
- Use Hono's `logger()` middleware.
- Prefer `ndJsonStream` for ACP communication.
- Always handle `proc.on('exit')` and `proc.on('error')` to close SSE streams gracefully.

### UI Consistency
- Use the `ChatHeader` component for session metadata.
- Status indicators:
    - 🟢 `connected`
    - 🟡 `connecting`
    - 🔴 `error`
    - ⚪ `idle`
