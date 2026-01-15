# Eragear-Code-Copilot: System Overview

This project is a web-based AI coding assistant built on the **Agent Client Protocol (ACP)**. It provides a bridge between a browser-based UI and local AI agents capable of manipulating the filesystem and running terminal commands.

## 🏗 Architecture & Tech Stack

### 1. Backend (`apps/server`)
- **Runtime**: Bun / Node.js
- **Framework**: [Hono](https://hono.dev/)
- **Core Library**: `@agentclientprotocol/sdk`
- **Communication**:
    - **Frontend → Backend**: REST APIs (JSON) for initialization and prompt submission.
    - **Backend → Agent**: Standard Input/Output (ndjson) via `node:child_process`.
    - **Backend → Frontend**: Server-Sent Events (SSE) for real-time streaming and status updates.
- **SSE Features**: 
    - Heartbeats every 15s to keep connections alive.
    - Automatic cleanup and error reporting if the agent process exits.

### 2. Frontend (`apps/web`)
- **Framework**: React 18+ (Vite)
- **Styling**: Tailwind CSS + [Shadcn UI](https://ui.shadcn.com/)
- **Icons**: Lucide React
- **Routing**: [TanStack Router](https://tanstack.com/router)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
    - **Persistence**: `persist` middleware stores all agent configurations in `LocalStorage`.
- **Authentication**: [Better-Auth](https://www.better-auth.com/) (Currently mocked for local development).

### 3. Shared Workspace
- `packages/shared`: Shared types, event schemas, and protocol helpers.
- `packages/runner`: A thin wrapper/CLI for running ACP agents in batch mode.

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
