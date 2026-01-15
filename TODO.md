# Project TODO & Progress

## 🛠 What's Done (Đã làm)

### Backend (Server)
- [x] **ACP Integration**: Implemented `/api/chat` endpoints using the `@agentclientprotocol/sdk`.
- [x] **Agent Spawning**: Server correctly spawns agent processes based on client-provided configurations (command, args, env).
- [x] **SSE Streaming**: Established Server-Sent Events for real-time agent message streaming.
- [x] **Request Logging**: Added `hono/logger` middleware for better visibility into server activity.
- [x] **API Cleanup**: Removed backend settings persistence in favor of client-side management.

### Frontend (Web)
- [x] **Settings Management**: Integrated Zustand with `persist` middleware to manage agent configurations in LocalStorage.
- [x] **Settings UI**: Created a form-based dialog using Shadcn components to add, edit, and delete agents.
- [x] **Auth Bypass**: Mocked `authClient` to temporarily disable authentication for faster development.
- [x] **Chat UI Refactor**: Completely rebuilt the chat interface with modern components.
- [x] **Chat Header**: Added a reactive header that shows:
    - Active agent name.
    - Live connection status (🟢 Connected, 🟡 Connecting, 🔴 Error).
    - **New Chat** button to reset sessions.
- [x] **Bug Fixes**: Resolved critical reference errors like `agent is not defined`.
- [x] **SSE Stability**: Added heartbeats and process termination handling to prevent connection interruptions.

---

## 🚀 To-Do (Dự định làm)

### Core Logic & ACP
- [ ] **Filesystem Tools**: Implement real `readTextFile` and `writeTextFile` logic in the server handlers (currently placeholders).
- [ ] **Tool Call UI**: Enhance the chat messages to show when an agent is calling a tool or waiting for permission.
- [ ] **Session Persistence**: Explore saving chat history to a database (e.g., SQLite or D1).
- [ ] **Advanced Settings**: Add support for project root selection and custom workspace paths.

### UI/UX Improvements
- [ ] **Model Selector Integration**: Restore a way to switch between configured agents directly from the chat input.
- [ ] **Error Recover**: Implement automatic reconnection logic for SSE if the connection drops.
- [ ] **Dark/Light Mode**: Ensure all new components respect the theme toggle.

### Verification & Polish
- [ ] **Full E2E Test**: Verify the entire flow with a real ACP agent (e.g., `opencode acp`).
- [ ] **Production Build**: Verify that the app builds and runs correctly in production mode.
- [ ] **Real Auth**: Restore the `better-auth` integration when ready for deployment.
