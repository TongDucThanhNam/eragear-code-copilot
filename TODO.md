# Project TODO & Progress

## 🛠 What's Done (Đã làm)

### Backend (Server)
- [x] **ACP Integration**: Implemented `/api/chat` endpoints using the `@agentclientprotocol/sdk`.
- [x] **Agent Spawning**: Server correctly spawns agent processes based on client-provided configurations.
- [x] **Filesystem Tools**: Implemented `readTextFile` and `writeTextFile` handlers for agents.
- [x] **SSE Streaming**: Established Server-Sent Events for real-time agent message streaming.
- [x] **Request Logging**: Added `hono/logger` middleware for better visibility into server activity.
- [x] **Session Persistence**: Implemented file-based storage to persist session state/metadata across restarts.
- [x] **ACP CWD Support**: Agents now respect the `cwd` parameter for setting the working directory.

### Frontend (Web)
- [x] **Chat UI Refactor**: Modularized chat interface (Header, Messages, Input) for better maintainability.
- [x] **Settings Management**: Integrated Zustand with `persist` middleware to manage agent configurations.
- [x] **Advanced Settings**: Added support for configuring `cwd`, environment variables, and agent arguments.
- [x] **Model/Mode Selector**: Integrated UI for switching between agent models and modes within the chat.
- [x] **Slash Commands**: Backend logic and Frontend UI support for slash commands (e.g., `/help`, `/fix`).
- [x] **Connection Recovery**: Implemented auto-reconnection logic and "Resume" capability for stopped sessions.
- [x] **New Chat Dropdown**: Refactored to support cleaner interactions.
- [x] **Server Logging**: Enhanced server logs for easier debugging.

---

## 🚀 To-Do (Dự định làm)

### 🎨 UI Overhaul (Priority - Conductor Style)
- [ ] **3-Pane Layout**: Refactor the app into a 3-column layout:
    - **Left (Sidebar)**: Workspace/Session list with rich status indicators (Git branch, changes stats).
    - **Center (Chat)**: Clean chat area with collapsible "Step" groups (e.g., "Running commands..." -> Click to expand).
    - **Right (Context)**: Multi-tab panel for **Files Changed (Diffs)**, **File Tree**, and **Terminal**.
- [ ] **Collapsible Tool Events**: Group verbose tool outputs into expandable UI blocks (like "> 13 tool calls").
- [ ] **Persistent Terminal**: Embed xterm.js in the bottom-right panel (or toggleable in right panel).
- [ ] **Diff Viewer Integration**: Show file changes in the Right Panel with +Add/-Delete stats.

### Core Logic & ACP
- [ ] **Project Config (eragear.json)**: Support loading agent settings and context from a project-level JSON file.
- [ ] **Git Checkpoints**: Auto-commit or snapshotting state to allow "Undo" functionality.
- [ ] **Parallel Agents**: (Research) Architecture to run multiple agents simultaneously.
- [ ] **Database Integration**: Consider migrating from file-based store to SQLite/D1.

### Minor Improvements
- [ ] **Mobile Responsiveness**: Adapt the complex 3-pane layout for smaller screens (collapsible panels).
- [ ] **Dark/Light Mode**: Ensure new components align with the theme.

### Verification & Polish
- [ ] **Full E2E Test**: Verify the entire flow with a real ACP agent.
- [ ] **Production Build**: Verify that the app builds and runs correctly in production mode.
- [ ] **Real Auth**: Restore the `better-auth` integration.
